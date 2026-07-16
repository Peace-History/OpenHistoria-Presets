// Per-page preset extractor — response-driven.
//
// paxhistoria.co no longer embeds __NEXT_DATA__ in the HTML for the
// preset detail page (`next-data script tag present: false` on every
// recent run). All data is loaded via client-side API calls. So this
// module sets up response listeners BEFORE navigation, then builds the
// PresetData from whatever fires:
//
//   1. Preset API:   /api/presets/{id} or /api/preset/{id} → JSON body
//   2. Geometry CDN: map-geometry.paxhistoria.co/*.json → JSON body
//   3. Image CDN:    preset-assets.paxhistoria.co/* → first two images
//   4. __NEXT_DATA__: legacy fallback (some pages still have it)
//
// If nothing fires within the timeout, returns null so the caller can
// log a clean failure and move on.

import { Page, APIResponse } from 'playwright';
import { PresetData } from './types.js';
import { TIMEOUTS, PAX_PRESETS_URL } from './config.js';

const P = '[extractPresetFromPage]';

export interface ExtractedPreset {
  data: PresetData;
  /** Raw source we used (api / next_data / dom_probe) */
  rawSource: Record<string, unknown>;
  /** Where the landing image URL was found (for diagnostics) */
  landingImageSource: 'api' | 'next_data' | 'network_capture' | 'dom_probe' | null;
  coverImageSource: 'api' | 'next_data' | 'network_capture' | 'dom_probe' | null;
  geometryURLSource: 'api' | 'next_data' | 'network_capture' | 'dom_probe' | null;
}

interface Captures {
  presetAPI: APIResponse | null;
  geometryAPI: APIResponse | null;
  imageURLs: string[]; // ordered list of preset-assets URLs seen
}

export async function extractPresetFromPage(
  page: Page,
  paxID: string,
  timeoutMs: number = TIMEOUTS.nextDataWait,
): Promise<ExtractedPreset | null> {
  const captures: Captures = {
    presetAPI: null,
    geometryAPI: null,
    imageURLs: [],
  };

  // Set up listeners BEFORE navigation
  // (handler is typed as `any` to match the pattern in legacy ripGeometry.ts —
  //  Playwright's `on('response', ...)` overload signatures are strict)
  const handler = (response: any): void => {
    try {
      const url: string = response.url();
      const status: number = response.status();
      if (status !== 200) return;
      const ct: string = (
        (response.headers() as Record<string, string>)['content-type'] || ''
      ).toLowerCase();

      // Preset API: any /api/presets* (or /api/preset*) that mentions our paxID
      if (!captures.presetAPI && /\/api\/preset/i.test(url)) {
        if (url.includes(paxID) || new URL(url).searchParams.get('id') === paxID) {
          if (ct.includes('json')) {
            captures.presetAPI = response as APIResponse;
          }
        }
      }

      // Geometry CDN
      if (
        !captures.geometryAPI &&
        url.includes('map-geometry.paxhistoria.co') &&
        (ct.includes('json') || url.endsWith('.json'))
      ) {
        captures.geometryAPI = response as APIResponse;
      }

      // Image CDN — collect the first few
      if (url.includes('preset-assets.paxhistoria.co') && ct.includes('image')) {
        if (captures.imageURLs.length < 4 && !captures.imageURLs.includes(url)) {
          captures.imageURLs.push(url);
        }
      }
    } catch {
      // ignore
    }
  };
  page.on('response', handler as any);

  try {
    // Navigate
    await page.goto(`${PAX_PRESETS_URL}/${paxID}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageLoad,
    });
    console.log(`${P}   page loaded: ${page.url()}`);

    // Brief wait for any preset API response to fire. We cap this at
    // 5s because we know paxhistoria.co (RSC-based) doesn't make one —
    // we'd rather fall back to DOM quickly than block the user for 45s.
    const apiWaitMs = Math.min(timeoutMs, 5_000);
    const start = Date.now();
    let nextData: unknown = null;
    while (Date.now() - start < apiWaitMs) {
      if (captures.presetAPI) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const elapsed = Date.now() - start;
    console.log(
      `${P}   waited ${elapsed}ms — presetAPI=${!!captures.presetAPI}, ` +
        `images=${captures.imageURLs.length}`,
    );

    if (captures.presetAPI) {
      const body = await captures.presetAPI.json().catch(() => null);
      if (body) return buildFromAPI(body, paxID, captures);
      console.warn(`${P} preset API response had no JSON body — falling back to DOM`);
    }

    // No preset API. Try __NEXT_DATA__ quickly (legacy fallback) — but
    // skip the wait entirely if the script tag isn't even in the HTML.
    const hasNextDataScript = await page
      .evaluate(
        () => !!document.querySelector('script#__NEXT_DATA__'),
      )
      .catch(() => false);
    if (hasNextDataScript) {
      nextData = await waitForNextData(page, Math.min(timeoutMs, 10_000));
      if (nextData) return buildFromNextData(nextData as LegacyNextData, paxID, captures);
    } else {
      console.log(`${P}   no <script id="__NEXT_DATA__"> in DOM — skipping __NEXT_DATA__ wait`);
    }

    // DOM-only fallback: title from <title>, description from
    // <meta name="description">, paxID from URL, version from
    // ?versionID=N, landing from <img alt="Preset image">.
    console.log(
      `${P} no API / no __NEXT_DATA__ — falling back to DOM-only extraction`,
    );
    return buildFromDOM(page, paxID, captures);
  } finally {
    page.off('response', handler as any);
  }
}

/**
 * Last-resort DOM-only extraction. Used when no /api/preset response
 * and no __NEXT_DATA__ payload are available (which is the case for
 * paxhistoria.co's current RSC-based preset page). The result is a
 * minimal PresetData — geometry / cover / author will be null — but
 * the script can still proceed.
 */
async function buildFromDOM(
  page: Page,
  paxID: string,
  captures: Captures,
): Promise<ExtractedPreset | null> {
  const dom = await page.evaluate(() => {
    const titleEl = document.querySelector('title');
    const descEl = document.querySelector('meta[name="description"]');
    const landingEl = document.querySelector('img[alt="Preset image"]');
    const ogEl = document.querySelector('meta[property="og:image"]');
    return {
      title: titleEl ? titleEl.textContent : null,
      description: descEl ? descEl.getAttribute('content') : null,
      landingSrc:
        landingEl?.getAttribute('src') ??
        ogEl?.getAttribute('content') ??
        null,
    };
  });

  const u = new URL(page.url());
  const versionParam = u.searchParams.get('versionID');
  const version = versionParam ? Number(versionParam) : NaN;
  const title = dom.title?.replace(/\s*-\s*Pax Historia\s*$/i, '').trim() ?? null;

  if (!title) {
    console.warn(`${P} DOM fallback: no <title> in document`);
    return null;
  }

  // Prefer network-captured landing URL; fall back to the DOM <img>
  const landingFromNetwork = captures.imageURLs[0];
  const landingImageURL = landingFromNetwork ?? dom.landingSrc ?? undefined;

  console.log(
    `${P} DOM fallback OK: title="${title}" version=${version} ` +
      `landing=${landingImageURL?.slice(0, 80)}…`,
  );

  const data: PresetData = {
    id: paxID,
    publishedVersionID: version,
    title,
    description: dom.description ?? '',
    coverImageURL: captures.imageURLs[1] ?? undefined,
    landingImageURL,
    geometryURL: undefined,
    authorUID: undefined,
    tags: [],
    roundsPlayed: 0,
    gamesStarted: 0,
    slug: undefined,
    extras: { source: 'dom_fallback' },
  };

  return {
    data,
    rawSource: { source: 'dom_fallback' },
    landingImageSource: landingFromNetwork ? 'network_capture' : 'dom_probe',
    coverImageSource: captures.imageURLs[1] ? 'network_capture' : null,
    geometryURLSource: null,
  };
}

// ---- builders ----

interface LooseAPI {
  // top-level
  id?: string;
  uid?: string;
  title?: string;
  description?: string;
  // nested
  preset?: LooseAPI;
  data?: LooseAPI;
  result?: LooseAPI;
  // URLs
  coverImageURL?: string;
  coverImageUrl?: string;
  coverUrl?: string;
  landingImageURL?: string;
  landingImageUrl?: string;
  landingUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  geometryURL?: string;
  geometryUrl?: string;
  geometry?: string | { url?: string };
  mapGeometry?: string | { url?: string };
  // author / version / tags
  authorUID?: string;
  publishedVersionID?: number;
  publishedVersion?: number;
  versionID?: number;
  tags?: string[];
  roundsPlayed?: number;
  gamesStarted?: number;
  slug?: string;
  // any other fields
  [k: string]: unknown;
}

function findPresetObject(body: LooseAPI, paxID: string): LooseAPI | null {
  // Try the body itself, then common nested keys.
  const candidates: LooseAPI[] = [body];
  if (body.preset) candidates.push(body.preset);
  if (body.data && typeof body.data === 'object') candidates.push(body.data);
  if (body.result && typeof body.result === 'object') candidates.push(body.result);
  for (const c of candidates) {
    if (c && (c.id === paxID || c.uid === paxID)) return c;
  }
  // If exactly one object, use it
  if (candidates.length >= 2 && candidates[1]) return candidates[1];
  return body;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  }
  return undefined;
}

function pickGeometryURL(obj: LooseAPI): string | undefined {
  return pickString(
    obj.geometryURL,
    obj.geometryUrl,
    typeof obj.geometry === 'string' ? obj.geometry : obj.geometry?.url,
    typeof obj.mapGeometry === 'string' ? obj.mapGeometry : obj.mapGeometry?.url,
  );
}

function buildFromAPI(
  body: LooseAPI,
  paxID: string,
  captures: Captures,
): ExtractedPreset | null {
  const obj = findPresetObject(body, paxID);
  if (!obj) return null;

  const title = pickString(obj.title);
  const version = obj.publishedVersionID ?? obj.publishedVersion ?? obj.versionID;
  if (!title || version == null) {
    console.warn(
      `${P} API body missing title or version (got title=${title}, version=${version})`,
    );
    return null;
  }

  // URLs — API first, then network-captured image fallback
  const apiCover = pickString(obj.coverImageURL, obj.coverImageUrl, obj.coverUrl, obj.thumbnailUrl);
  const apiLanding = pickString(obj.landingImageURL, obj.landingImageUrl, obj.landingUrl);
  const apiGeometry = pickGeometryURL(obj);

  // For images, fall back to whatever we captured from the network
  const networkLanding = captures.imageURLs[0]; // first image is usually the landing/hero
  const networkCover = captures.imageURLs[1] ?? captures.imageURLs[0];
  // For geometry, fall back to the URL of the captured response
  const networkGeometry = captures.geometryAPI?.url();

  // Strip the known top-level fields, leave the rest in `extras`
  const {
    id: _i,
    uid: _u,
    title: _t,
    description: _d,
    coverImageURL: _ci,
    coverImageUrl: _cu,
    coverUrl: _cu2,
    thumbnailUrl: _tu,
    landingImageURL: _li,
    landingImageUrl: _lu,
    landingUrl: _lu2,
    geometryURL: _gu,
    geometryUrl: _gu2,
    geometry: _g,
    mapGeometry: _mg,
    authorUID: _au,
    publishedVersionID: _pv,
    publishedVersion: _pv2,
    versionID: _vi,
    tags: _tg,
    roundsPlayed: _rp,
    gamesStarted: _gs,
    slug: _sl,
    preset: _p,
    data: _d2,
    result: _r,
    ...extras
  } = obj as Record<string, unknown>;

  const coverImageURL = apiCover ?? networkCover;
  const landingImageURL = apiLanding ?? networkLanding;
  const geometryURL = apiGeometry ?? networkGeometry;

  const data: PresetData = {
    id: paxID,
    publishedVersionID: version,
    title,
    description: typeof obj.description === 'string' ? obj.description : '',
    coverImageURL,
    landingImageURL,
    geometryURL,
    authorUID: typeof obj.authorUID === 'string' ? obj.authorUID : undefined,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
    roundsPlayed: typeof obj.roundsPlayed === 'number' ? obj.roundsPlayed : 0,
    gamesStarted: typeof obj.gamesStarted === 'number' ? obj.gamesStarted : 0,
    slug: typeof obj.slug === 'string' ? obj.slug : undefined,
    extras,
  };

  return {
    data,
    rawSource: obj,
    coverImageSource: apiCover ? 'api' : networkCover ? 'network_capture' : null,
    landingImageSource: apiLanding ? 'api' : networkLanding ? 'network_capture' : null,
    geometryURLSource: apiGeometry ? 'api' : networkGeometry ? 'network_capture' : null,
  };
}

// ---- __NEXT_DATA__ legacy path (preserved for older pages) ----

interface LegacyNextData {
  props?: {
    pageProps?: LooseAPI & {
      preset?: LooseAPI;
    };
  };
}

function buildFromNextData(
  nextData: LegacyNextData,
  paxID: string,
  _captures: Captures,
): ExtractedPreset | null {
  const pageProps = nextData?.props?.pageProps;
  const preset = pageProps?.preset ?? pageProps;
  if (!preset) return null;
  const title = pickString(preset.title);
  const version = preset.publishedVersionID;
  if (!title || version == null) return null;

  const data: PresetData = {
    id: paxID,
    publishedVersionID: version,
    title,
    description: typeof preset.description === 'string' ? preset.description : '',
    coverImageURL: pickString(preset.coverImageURL, preset.coverImageUrl, preset.coverUrl, preset.thumbnailUrl),
    landingImageURL: pickString(preset.landingImageURL, preset.landingImageUrl, preset.landingUrl),
    geometryURL: pickGeometryURL(preset),
    authorUID: typeof preset.authorUID === 'string' ? preset.authorUID : undefined,
    tags: Array.isArray(preset.tags) ? (preset.tags as string[]) : [],
    roundsPlayed: typeof preset.roundsPlayed === 'number' ? preset.roundsPlayed : 0,
    gamesStarted: typeof preset.gamesStarted === 'number' ? preset.gamesStarted : 0,
    slug: typeof preset.slug === 'string' ? preset.slug : undefined,
    extras: {},
  };

  return {
    data,
    rawSource: (pageProps ?? {}) as Record<string, unknown>,
    coverImageSource: data.coverImageURL ? 'next_data' : null,
    landingImageSource: data.landingImageURL ? 'next_data' : null,
    geometryURLSource: data.geometryURL ? 'next_data' : null,
  };
}

// ---- game state (unchanged) ----

export interface ExtractedGameState {
  state: Record<string, unknown>;
  source: 'pageProps.game' | 'pageProps.scenario' | 'pageProps.liveGame';
}

export async function extractGameStateFromPage(
  page: Page,
  timeoutMs: number = TIMEOUTS.gameStateLoad,
): Promise<ExtractedGameState | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() => {
      const win = window as unknown as { __NEXT_DATA__?: LegacyNextData };
      const pp = win.__NEXT_DATA__?.props?.pageProps;
      if (!pp) return null;
      const ppAny = pp as unknown as Record<string, unknown>;
      if (ppAny.game && typeof ppAny.game === 'object') {
        return { state: ppAny.game as Record<string, unknown>, source: 'pageProps.game' as const };
      }
      if (ppAny.scenario && typeof ppAny.scenario === 'object') {
        return { state: ppAny.scenario as Record<string, unknown>, source: 'pageProps.scenario' as const };
      }
      if (ppAny.liveGame && typeof ppAny.liveGame === 'object') {
        return { state: ppAny.liveGame as Record<string, unknown>, source: 'pageProps.liveGame' as const };
      }
      return null;
    });
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// ---- __NEXT_DATA__ polling (legacy) ----

async function waitForNextData(
  page: Page,
  timeoutMs: number,
): Promise<LegacyNextData | null> {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => {
      const win = window as unknown as { __NEXT_DATA__?: LegacyNextData };
      if (win.__NEXT_DATA__ && win.__NEXT_DATA__.props?.pageProps) {
        return win.__NEXT_DATA__;
      }
      return null;
    });
    if (result) return result;

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 5_000) {
      lastLog = elapsed;
      const hasScript = await page
        .evaluate(
          () =>
            !!document.querySelector('script#__NEXT_DATA__') ||
            !!document.querySelector('script[type="application/json"]'),
        )
        .catch(() => false);
      console.log(
        `${P}   polling __NEXT_DATA__… ${(elapsed / 1000).toFixed(0)}s elapsed ` +
          `(next-data script tag present: ${hasScript})`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// ---- Two-phase extraction (ripPreset uses these) ----

/** Result of the fast initial DOM scrape. */
export interface InitialPresetData {
  title: string;
  description: string;
  publishedVersionID: number;
  landingImageURL?: string;
  rawSource: Record<string, unknown>;
}

/**
 * Fast DOM-only extraction. Used by capturePreset BEFORE starting the
 * game. Gets the 5 fields Pax exposes in the initial render: title,
 * description, paxID, version, landing image. No waiting for
 * __NEXT_DATA__ or API responses.
 *
 * Returns null only if the page doesn't have a `<title>` at all (which
 * would mean navigation actually failed).
 */
export async function extractInitialFromPage(
  page: Page,
  paxID: string,
): Promise<InitialPresetData | null> {
  // Wait up to 5s for the URL to gain ?versionID=N — Pax adds it via
  // client-side routing after the initial load.
  try {
    await page.waitForURL(/\?.*versionID=\d+/, { timeout: 5_000 });
  } catch {
    // not fatal — we'll fall through to the DOM-extract fallback below
  }

  const dom = await page.evaluate(() => {
    const titleEl = document.querySelector('title');
    const descEl = document.querySelector('meta[name="description"]');
    const landingEl = document.querySelector('img[alt="Preset image"]');
    const ogEl = document.querySelector('meta[property="og:image"]');
    // Try the page's RSC payload for the version too (chunk that
    // contains `"versionID":N` or `"publishedVersionID":N`)
    let rscVersion: number | null = null;
    const rscScripts = Array.from(
      document.querySelectorAll('script'),
    ).filter((s) => s.textContent && s.textContent.includes('self.__next_f.push'));
    for (const s of rscScripts) {
      const m = s.textContent!.match(/"versionID":\s*"?(\d+)"?/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) {
          rscVersion = n;
          break;
        }
      }
    }
    return {
      title: titleEl ? titleEl.textContent : null,
      description: descEl ? descEl.getAttribute('content') : null,
      landingSrc:
        landingEl?.getAttribute('src') ??
        ogEl?.getAttribute('content') ??
        null,
      rscVersion,
    };
  });

  const u = new URL(page.url());
  const versionParam = u.searchParams.get('versionID');
  const versionFromUrl = versionParam ? Number(versionParam) : NaN;
  const version = Number.isFinite(versionFromUrl)
    ? versionFromUrl
    : dom.rscVersion ?? NaN;
  const title = dom.title?.replace(/\s*-\s*Pax Historia\s*$/i, '').trim() ?? null;

  if (!title) {
    console.warn(`${P} extractInitial: no <title> in document`);
    return null;
  }
  if (Number.isNaN(version)) {
    console.warn(
      `${P} extractInitial: no version found (url=${page.url()}, rsc=${dom.rscVersion})`,
    );
    return null;
  }

  return {
    title,
    description: dom.description ?? '',
    publishedVersionID: version,
    landingImageURL: dom.landingSrc ?? undefined,
    rawSource: {
      source: 'initial_dom',
      pageTitle: dom.title,
      metaDescription: dom.description,
      landingSrc: dom.landingSrc,
      pageURL: page.url(),
      versionFromUrl,
      rscVersion: dom.rscVersion,
    },
  };
}

/** Result of the post-game full extraction. */
export interface FullPresetResult {
  data: PresetData;
  rawSource: Record<string, unknown>;
}

/**
 * After the game has been started, re-poll the page for the full
 * preset data. We expect __NEXT_DATA__ to now contain geometry URL,
 * cover image, author UID, tags, etc.
 *
 * The page is already on the preset URL — we just wait. The wait is
 * capped at 15s; if nothing materialises, return null and let the
 * caller fall back to the initial data only.
 */
export async function extractFullFromPage(
  page: Page,
  paxID: string,
  initial: InitialPresetData,
  timeoutMs: number = 15_000,
): Promise<FullPresetResult | null> {
  // Listen for the preset API response (in case Pax fires one after
  // game start). Set up BEFORE we start waiting.
  let presetAPI: APIResponse | null = null;
  const handler = (response: any): void => {
    try {
      const url: string = response.url();
      const status: number = response.status();
      if (status !== 200) return;
      const ct: string = (
        (response.headers() as Record<string, string>)['content-type'] || ''
      ).toLowerCase();
      if (!presetAPI && /\/api\/preset/i.test(url) && url.includes(paxID)) {
        if (ct.includes('json')) presetAPI = response as APIResponse;
      }
    } catch {
      // ignore
    }
  };
  page.on('response', handler as any);

  try {
    // Race: API response fires OR __NEXT_DATA__ populates OR timeout
    const start = Date.now();
    let nextData: unknown = null;
    while (Date.now() - start < timeoutMs) {
      if (presetAPI) break;
      const fromNext = await Promise.race([
        waitForNextData(page, 2_000).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 500)),
      ]);
      if (fromNext) {
        nextData = fromNext;
        break;
      }
    }

    if (presetAPI) {
      const body = await (presetAPI as APIResponse).json().catch(() => null);
      if (body) {
        const extracted = buildFromAPI(body as LooseAPI, paxID, {
          presetAPI: null,
          geometryAPI: null,
          imageURLs: [],
        });
        if (extracted) {
          return { data: extracted.data, rawSource: { source: 'api_after_game', body } };
        }
      }
    }

    if (nextData) {
      const extracted = buildFromNextData(nextData as LegacyNextData, paxID, {
        presetAPI: null,
        geometryAPI: null,
        imageURLs: [],
      });
      if (extracted) return { data: extracted.data, rawSource: { source: 'next_data_after_game' } };
    }

    // Nothing populated. Return a minimal PresetData so the caller
    // can still merge in the initial fields.
    console.log(
      `${P} extractFull: no API / no __NEXT_DATA__ after ${timeoutMs}ms — returning null`,
    );
    return null;
  } finally {
    page.off('response', handler as any);
  }
}
