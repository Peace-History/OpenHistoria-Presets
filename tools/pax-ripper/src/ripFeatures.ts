// ripFeatures — start a game for a preset and capture the in-game
// "features" (cities, landmarks, battalions, polities, region ownership).
//
// Per the user's "always try, fall back gracefully" decision:
//   - Always run, unless caller sets includeFeatures=false
//   - On any failure (no button, button disabled, timeout, parse error,
//     exception) write features_status.json with a precise reason
//   - NEVER throw — the per-preset capture continues with public-only data
//
// What we know about the game state:
//   - Pax stores it in Firestore (projects/pax-historia-dev), delivered
//     via the gRPC-Web Listen channel. We capture the raw response
//     bodies to disk for offline analysis.
//   - The game URL is /game/{gameId}?round=1 — by the time we see
//     that URL, the Firestore subscriptions are firing.

import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import { TIMEOUTS } from './config.js';
import { FeaturesStatus, MapFeatures } from './types.js';
import { captureFirestoreTraffic } from './firestoreCapture.js';

const P = '[ripFeatures]';

/**
 * Try to start a game for the currently-loaded preset and capture the
 * map features. Always returns a FeaturesStatus — never throws.
 *
 * `page` is expected to already be on the preset detail page.
 * `targetDir` is the per-preset directory (e.g. presets/{paxID}/{version}/).
 */
export async function tryCaptureFeatures(
  page: Page,
  targetDir: string,
): Promise<FeaturesStatus> {
  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

  const fail = (
    reason: FeaturesStatus['reason'],
    error?: string,
  ): FeaturesStatus => ({
    attempted: true,
    success: false,
    reason,
    durationMs: elapsed(),
    error,
  });

  // 1) Find the actual Play / Start Game button.
  //    The hero CTA is "Play Now" inside a bottom-overlay container
  //    (`bg-linear-to-t.from-white.to-transparent.p-6.pt-40` on paxhistoria.co).
  //    The header can also contain a "Play" link, which we explicitly
  //    avoid by trying the most-specific selectors first.
  //
  //    First, wait SPECIFICALLY for the "Play Now" button — Pax's React
  //    app mounts it via Suspense, so it may not be present at
  //    domcontentloaded. Up to 30s. (We can't wait for "any button"
  //    because the header has icon-only buttons that resolve instantly.)
  const waitStart = Date.now();
  let waitedForPlayNow = false;
  try {
    await page.waitForSelector('button:has-text("Play Now"), a:has-text("Play Now")', {
      timeout: 30_000,
      state: 'visible',
    });
    waitedForPlayNow = true;
  } catch {
    // fall through — findPlayButton will return null and we'll log
  }
  const waitedMs = Date.now() - waitStart;
  console.log(
    chalk.gray(
      `${P}   wait for Play Now: ${waitedMs}ms ${waitedForPlayNow ? '(appeared)' : '(timed out)'}`,
    ),
  );

  const playButton = await findPlayButton(page);
  if (!playButton) {
    // Diagnostic: dump every visible button on the page so we can see
    // what the user is working with.
    const diagnostic = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, a[role="button"]'),
      );
      return buttons
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 10 && r.height > 10;
        })
        .slice(0, 20)
        .map((b) => ({
          text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          tag: b.tagName,
          role: b.getAttribute('role'),
          classes: (b.className || '').toString().slice(0, 80),
        }));
    }).catch(() => 'evaluate failed');
    console.log(
      chalk.yellow(
        `${P}   no Play Now button after ${waitedMs}ms wait. ` +
          `Page URL: ${page.url()}, title: "${await page.title().catch(() => '?')}"`,
      ),
    );
    console.log(
      chalk.yellow(`${P}   visible buttons on page (first 20):`),
    );
    if (Array.isArray(diagnostic)) {
      for (const b of diagnostic) {
        console.log(
          chalk.yellow(
            `${P}     - [${b.tag}${b.role ? ` role=${b.role}` : ''}] ` +
              `"${b.text}"`,
          ),
        );
      }
    }
    return fail('no_play_button');
  }

  // 2) Check it's enabled
  let enabled = true;
  try {
    enabled = await playButton.isEnabled({ timeout: TIMEOUTS.playButton });
  } catch {
    enabled = false;
  }
  if (!enabled) {
    return fail('play_disabled');
  }

  // 3) Scroll into view + click
  try {
    await playButton.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    await playButton.click({ timeout: TIMEOUTS.playButton });
    console.log(chalk.gray(`${P}   clicked Play/Start Game`));
  } catch (e) {
    return fail('play_disabled', e instanceof Error ? e.message : String(e));
  }

  // 4) Country-select step (Pax UI: click Play → pick a country → "Play As Country")
  //    If the screen never appears (or the bottom-right button is missing — known
  //    bug on some presets), just continue and let the game-state capture run.
  await tryCountrySelectAndStart(page);

  // 5) Start capturing Firestore Listen responses. The game state is
  //    delivered via Firestore's gRPC-Web channel, so the responses
  //    start flowing as soon as the game mounts.
  console.log(chalk.gray(`${P}   starting Firestore capture (will listen for ${TIMEOUTS.gameStateLoad}ms)`));
  const capture = await captureFirestoreTraffic(page, targetDir);

  // 6) Wait for game state to accumulate. We poll the page URL — when
  //    it changes to /game/{gameId}?round=N, the game is loaded.
  const gameUrlRe = /\/game\/[A-Za-z0-9_-]+/;
  const startWait = Date.now();
  let gameUrl = '';
  while (Date.now() - startWait < TIMEOUTS.gameStateLoad) {
    if (gameUrlRe.test(page.url())) {
      gameUrl = page.url();
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (gameUrl) {
    console.log(
      chalk.gray(
        `${P}   game URL detected: ${gameUrl.slice(0, 80)}… after ${elapsed()}ms total`,
      ),
    );
  } else {
    console.log(
      chalk.yellow(
        `${P}   no /game/ URL after ${TIMEOUTS.gameStateLoad}ms — keeping captured traffic anyway`,
      ),
    );
  }

  // Give the React app a moment to fully mount the game state into
  // its component tree.
  await new Promise((r) => setTimeout(r, 3_000));

  // 7) Walk the page's React Fiber tree to find the game-state node
  //    (the node that has mapFeaturesData + regionData + playerCountry).
  //    This works around Firestore's 403 on game subcollections — the
  //    data is already in the in-memory React state, we just have to
  //    read it.
  const gameState = await extractGameStateFromReact(page);

  // 8) Stop the Firestore capture (we may not need the gapi channel
  //    if React extraction worked).
  const frames = capture.stop();
  console.log(
    chalk.gray(
      `${P}   captured ${capture.responseCount()} Firestore responses, ` +
        `${frames.length} gapi messages total`,
    ),
  );

  if (!gameState) {
    return fail(
      'timeout',
      `no game state found in React tree (${frames.length} gapi messages captured)`,
    );
  }

  // 9) Build MapFeatures from the React state. We pass the raw state
  //    through for the diagnostic write too.
  let features: MapFeatures;
  try {
    features = mapReactStateToFeatures(gameState);
  } catch (e) {
    return fail('parse_error', e instanceof Error ? e.message : String(e));
  }

  // Persist the raw state for debugging
  const apiResponsesDir = path.join(targetDir, 'api_responses');
  fs.mkdirSync(apiResponsesDir, { recursive: true });
  try {
    fs.writeFileSync(
      path.join(apiResponsesDir, 'react_game_state.json'),
      JSON.stringify(gameState, null, 2),
    );
  } catch {
    // best-effort
  }

  // 10) Persist features.json
  try {
    fs.writeFileSync(
      path.join(targetDir, 'features.json'),
      JSON.stringify(features, null, 2),
    );
    console.log(
      chalk.green(
        `${P}   ✓ features captured from React state: ` +
          `${features.polities.length} polities, ` +
          `${features.cities.length} cities, ${features.landmarks.length} landmarks, ` +
          `${features.battalions.length} battalions, ` +
          `${Object.keys(features.regionOwnership).length} region-owner mappings`,
      ),
    );
  } catch (e) {
    return fail(
      'parse_error',
      `write features.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    attempted: true,
    success: true,
    durationMs: elapsed(),
  };
}

// ---- React-tree game state extraction ----

interface ReactFiber {
  child?: ReactFiber;
  sibling?: ReactFiber;
  memoizedProps?: Record<string, unknown> & {
    mapFeaturesData?: Record<string, unknown>;
    regionData?: Record<string, unknown>;
    playerCountry?: string;
    playerEntityId?: string;
    featureMap?: Record<string, unknown>;
    regionMap?: Record<string, unknown>;
    moveFeatureRef?: { current?: unknown };
  };
  [k: string]: unknown;
}

/**
 * Walk the page's React Fiber tree to find the component node that
 * holds the game state. The game-state node has these signature keys:
 *   - mapFeaturesData: { [featureId]: { ... } }
 *   - regionData: { [regionIndex]: { ... } }
 *   - playerCountry: "Saudi Arabia"
 *   - featureMap, regionMap, moveFeatureRef, unitTypesMap, regionTypesMap
 */
async function extractGameStateFromReact(
  page: Page,
): Promise<Record<string, unknown> | null> {
  const result = await page.evaluate(() => {
    const findFiberKey = (el: Element): unknown => {
      for (const k of Object.keys(el)) {
        if (
          k.startsWith('__reactFiber$') ||
          k.startsWith('__reactInternalInstance$')
        )
          return (el as unknown as Record<string, unknown>)[k];
      }
      return null;
    };
    const root = document.getElementById('__next') || document.body;
    let fiber = findFiberKey(root) as ReactFiber | null;
    if (!fiber) fiber = findFiberKey(document.documentElement) as ReactFiber | null;
    if (!fiber) return { error: 'no fiber' };

    // Walk and find the deepest node whose memoizedProps has
    // mapFeaturesData + regionData (the two signature keys)
    const matches: Array<{
      depth: number;
      keyCount: number;
      sample: string[];
    }> = [];
    const seen = new WeakSet();
    const walk = (f: ReactFiber, depth: number): void => {
      if (!f || seen.has(f) || depth > 800) return;
      seen.add(f);
      if (f.memoizedProps && typeof f.memoizedProps === 'object') {
        const p = f.memoizedProps;
        if (p.mapFeaturesData && p.regionData) {
          matches.push({
            depth,
            keyCount: Object.keys(p).length,
            sample: Object.keys(p).slice(0, 15),
          });
        }
      }
      if (f.child) walk(f.child, depth + 1);
      if (f.sibling) walk(f.sibling, depth + 1);
    };
    walk(fiber, 0);

    matches.sort((a, b) => b.depth - a.depth);
    return { matchCount: matches.length, topMatches: matches.slice(0, 5) };
  });

  if (result && typeof result === 'object' && 'error' in result) {
    console.log(
      chalk.yellow(`${P}   React walk: ${(result as { error: string }).error}`),
    );
    return null;
  }

  const matches = (result as { topMatches: Array<{ depth: number }> })
    .topMatches;
  if (!matches || matches.length === 0) {
    console.log(
      chalk.yellow(`${P}   no React node with both mapFeaturesData and regionData`),
    );
    return null;
  }

  // Walk the tree again and return the props of the deepest match
  const finalProps = await page.evaluate((targetDepth: number) => {
    const findFiberKey = (el: Element): unknown => {
      for (const k of Object.keys(el)) {
        if (
          k.startsWith('__reactFiber$') ||
          k.startsWith('__reactInternalInstance$')
        )
          return (el as unknown as Record<string, unknown>)[k];
      }
      return null;
    };
    const root = document.getElementById('__next') || document.body;
    let fiber = findFiberKey(root) as ReactFiber | null;
    if (!fiber) fiber = findFiberKey(document.documentElement) as ReactFiber | null;
    if (!fiber) return null;
    const seen = new WeakSet();
    let found: Record<string, unknown> | null = null;
    const walk = (f: ReactFiber, depth: number): void => {
      if (found || !f || seen.has(f) || depth > 800) return;
      seen.add(f);
      if (f.memoizedProps && typeof f.memoizedProps === 'object') {
        if (f.memoizedProps.mapFeaturesData && f.memoizedProps.regionData) {
          if (depth === targetDepth) {
            found = f.memoizedProps;
            return;
          }
        }
      }
      if (f.child) walk(f.child, depth + 1);
      if (f.sibling) walk(f.sibling, depth + 1);
    };
    walk(fiber, 0);
    return found;
  }, matches[0].depth);

  if (!finalProps) {
    console.log(
      chalk.yellow(
        `${P}   could not re-locate the game-state node at depth ${matches[0].depth}`,
      ),
    );
    return null;
  }
  console.log(
    chalk.gray(
      `${P}   found game-state node in React tree at depth ${matches[0].depth} ` +
        `(${Object.keys(finalProps).length} props)`,
    ),
  );
  return finalProps;
}

/**
 * Pure helper: bucket raw map features into cities / landmarks / battalions
 * by their tag set. Same logic `mapReactStateToFeatures` used inline; now
 * reusable from the editor-derivation path (`extractFeaturesFromEditorData`).
 */
export function categorizeMapFeatures(
  rawMapFeatures: Record<string, unknown>,
  _polities: MapFeatures['polities'],
): Pick<MapFeatures, 'cities' | 'landmarks' | 'battalions'> {
  const cities: MapFeatures['cities'] = [];
  const landmarks: MapFeatures['landmarks'] = [];
  const battalions: MapFeatures['battalions'] = [];

  for (const [id, f] of Object.entries(rawMapFeatures)) {
    if (!f || typeof f !== 'object') continue;
    const obj = f as Record<string, unknown>;
    const tags = Array.isArray(obj.tags) ? (obj.tags as string[]) : [];
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    const name = (obj.name as string) || id;
    const loc = obj.location as
      | { latitude?: number; longitude?: number; regionID?: string }
      | undefined;
    const location: number[] = loc
      ? [loc.longitude ?? 0, loc.latitude ?? 0]
      : [];
    const ownerName = (obj.ownerName as string) || (obj.owner as string);

    if (tagSet.has('city') || tagSet.has('capital')) {
      const isCapital = tagSet.has('capital');
      cities.push({
        id,
        name,
        location,
        ownerPolityId: ownerName,
        ...(isCapital ? { isCapital: true } : {}),
        ...(typeof obj.scale === 'number' ? { scale: obj.scale as number } : {}),
      });
    } else if (
      tagSet.has('landmark') ||
      tagSet.has('monument') ||
      tagSet.has('wonder')
    ) {
      landmarks.push({
        id,
        name,
        type: tags.join(' '),
        location,
      });
    } else if (
      tagSet.has('battalion') ||
      tagSet.has('army') ||
      tagSet.has('unit') ||
      tagSet.has('fleet') ||
      tagSet.has('armada') ||
      tagSet.has('force')
    ) {
      battalions.push({
        id,
        ownerPolityId: ownerName || '',
        location,
        ...(typeof obj.count === 'number'
          ? { count: obj.count as number }
          : {}),
      });
    }
    // Anything else (e.g. custom tags we don't recognise) is dropped.
  }

  return { cities, landmarks, battalions };
}

/**
 * Pure helper: invert each polity's `regionsOwned[]` array into a
 * `regionIdx → polityName` map. Last-wins on collision (documented behaviour).
 * The editor view exposes this directly via `countryDescriptions[name].regionsOwned`,
 * which the Play Now flow does NOT — so this is the editor path's primary
 * source for region ownership.
 */
export function deriveRegionOwnership(
  polities: MapFeatures['polities'],
  polityDefinitions: Array<{ name: string; regionsOwned?: string[] }>,
): Record<string, string> {
  void polities; // kept for symmetry with `categorizeMapFeatures`
  const out: Record<string, string> = {};
  for (const pd of polityDefinitions) {
    if (!Array.isArray(pd.regionsOwned)) continue;
    for (const regionIdx of pd.regionsOwned) {
      // Last-wins on collision — see plan/design decision
      out[regionIdx] = pd.name;
    }
  }
  return out;
}

function mapReactStateToFeatures(state: Record<string, unknown>): MapFeatures {
  // Best-effort mapping of the React state shape to our MapFeatures.
  // Confirmed taxonomy from a real run on `modern_day` (June 2026):
  //   mapFeaturesData = {
  //     <featureId>: {
  //       name: "Alexandria",
  //       description: "Located in Nile River Egypt",
  //       location: { latitude, longitude, regionID },  // object, not array
  //       type: "coordinate",                          // always
  //       displaySymbol: "square" | "star" | ...,
  //       tags: ["city", "medium_city"] | ["city", "capital"] | ["landmark"],
  //       scale, labelPlacement,
  //       ownerName: "Egypt",                           // string, not an ID
  //     }
  //   }
  //   regionData = { <regionIndex>: { name, tags, ... } } (geographic regions)
  //   countryDescriptions = { <countryName>: { ...polity metadata... } }
  const rawFeatures = (state.mapFeaturesData as Record<string, unknown>) || {};
  const countryDescriptions =
    (state.countryDescriptions as Record<string, unknown>) || {};

  // 1) Polities from countryDescriptions (205 countries keyed by name)
  const polities: MapFeatures['polities'] = [];
  for (const [name, info] of Object.entries(countryDescriptions)) {
    if (!info || typeof info !== 'object') continue;
    const obj = info as Record<string, unknown>;
    polities.push({
      id: (obj.uid as string) || (obj.id as string) || name,
      name,
      color: (obj.color as string) || undefined,
      leaderName: (obj.leader as string) || (obj.leaderName as string) || undefined,
    });
  }

  // 2) Features (cities, landmarks, battalions) — delegate to the pure helper
  const { cities, landmarks, battalions } = categorizeMapFeatures(rawFeatures, polities);

  // 3) Region ownership. Pax's regionData has { name, tags, ... } but
  //    the actual ownership mapping is in `regionDataMap` or
  //    computed elsewhere. We try a few candidate keys; if none
  //    exist, regionOwnership stays empty (still useful for the
  //    cities + polities data). The editor path derives ownership from
  //    `polities.*.regionsOwned[]` via `deriveRegionOwnership` instead.
  const regionOwnership: Record<string, string> = {};
  const regionOwner = (state.regionDataMap as Record<string, unknown>) || {};
  for (const [idx, owner] of Object.entries(regionOwner)) {
    if (typeof owner === 'string') {
      regionOwnership[idx] = owner;
    }
  }

  return {
    polities,
    cities,
    landmarks,
    battalions,
    regionOwnership,
    capturedAt: new Date().toISOString(),
  };
}

// ---- internal ----

/**
 * Selector chain for the actual "Play" CTA. Ordered most-specific first
 * to avoid matching header navigation links that contain the word "Play".
 */
const PLAY_BUTTON_SELECTORS: string[] = [
  // Hero overlay CTA (the bottom-of-image "Play Now" button on paxhistoria.co)
  '[class*="bg-linear-to-t"] button:has-text("Play Now")',
  '[class*="from-white"][class*="to-transparent"] button:has-text("Play Now")',
  // Exact text match is more specific than substring
  'button:text-is("Play Now")',
  'button:text-is("Start Game")',
  'a:text-is("Play Now")',
  // Substring fallbacks
  'button:has-text("Play Now")',
  'button:has-text("Start Game")',
  'button:has-text("Play as")',
  // Last-resort: bare "Play" (may match nav links, but at least we'll try)
  'button:has-text("Play")',
  'a:has-text("Play Now")',
  'a:has-text("Start Game")',
];

/** Walk the selector chain, return the first visible+enabled match. */
async function findPlayButton(page: Page) {
  for (const selector of PLAY_BUTTON_SELECTORS) {
    const btn = page.locator(selector).first();
    const count = await btn.count().catch(() => 0);
    if (count === 0) continue;
    try {
      const visible = await btn.isVisible({ timeout: 1_000 }).catch(() => false);
      if (!visible) continue;
      const enabled = await btn.isEnabled({ timeout: 1_000 }).catch(() => false);
      if (!enabled) continue;
      console.log(chalk.gray(`${P}   play button via: ${selector}`));
      return btn;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * After clicking Play Now, Pax shows a country-select screen. The full
 * flow the user reported:
 *   1. Click "Play Now" (handled in findPlayButton + click)
 *   2. Click a country card on the left side
 *   3. Click "Play As Country" (sometimes labelled "Play as <CountryName>")
 *   4. Click "Start Game"
 *
 * Every step is best-effort. If the country-select UI is skipped entirely
 * (e.g. a custom preset that boots straight into the game) we return
 * early and let the game-state poll take over.
 */
async function tryCountrySelectAndStart(page: Page): Promise<void> {
  // 1) Wait for a country card to appear. The country-select grid
  //    uses `<div data-pick-card="true"><button role="button">…</button></div>`
  //    per card. We target the `data-pick-card` attribute (specific to
  //    these cards) and grab the first card's button.
  const countryCard = page
    .locator('[data-pick-card] button')
    .first();

  const cardAppeared = await countryCard
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!cardAppeared) {
    console.log(
      chalk.gray(
        `${P}   no country cards appeared (skipped past this step, or UI differs) — continuing`,
      ),
    );
    return;
  }

  // 2) Click the first (leftmost) country card
  try {
    await countryCard.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    await countryCard.click({ timeout: 5_000 });
    console.log(
      chalk.gray(`${P}   clicked first country card (left side)`),
    );
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}   could not click a country card (${e instanceof Error ? e.message : String(e)}) — continuing without`,
      ),
    );
    return;
  }

  // Small delay to let the next-stage button mount
  await page.waitForTimeout(500);

  // 3) "Play As Country" — button text may be "Play As Country",
  //    "Play as country", or "Play as <CountryName>" (e.g. "Play as
  //    United States"). Match anything starting with "Play as".
  const playAsCountry = page
    .locator(
      'button:has-text("Play As Country"), button:has-text("Play as country"), button:has-text("Play as "), a:has-text("Play As Country"), a:has-text("Play as "), button:has-text("Play As "), a:has-text("Play As ")',
    )
    .first();

  const playAppeared = await playAsCountry
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!playAppeared) {
    console.log(
      chalk.yellow(
        `${P}   "Play As Country" did not appear after country click — continuing`,
      ),
    );
    return;
  }

  try {
    const text = (await playAsCountry.textContent().catch(() => '')) ?? '';
    await playAsCountry.click({ timeout: 5_000 });
    console.log(
      chalk.gray(`${P}   clicked "Play As" button (text: "${text.trim().slice(0, 60)}")`),
    );
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}   "Play As Country" click failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return;
  }

  // 4) "Start Game" — final commit step. Some presets show this,
  //    some go straight into the game.
  const startGame = page
    .locator(
      'button:has-text("Start Game"), button:has-text("Start"), a:has-text("Start Game")',
    )
    .first();

  const startAppeared = await startGame
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!startAppeared) {
    console.log(
      chalk.gray(
        `${P}   no "Start Game" button (skipped past, or game already starting) — continuing`,
      ),
    );
    return;
  }

  try {
    await startGame.click({ timeout: 5_000 });
    console.log(chalk.gray(`${P}   clicked "Start Game"`));
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}   "Start Game" click failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

interface LooseState {
  polities?: unknown;
  nations?: unknown;
  cities?: unknown;
  landmarks?: unknown;
  battalions?: unknown;
  units?: unknown;
  regionOwnership?: unknown;
  regions?: unknown;
  features?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function extractFeatures(state: Record<string, unknown>): MapFeatures {
  // Some game states wrap features in a sub-object; peel a few known keys.
  const candidates: LooseState[] = [];
  if (isObject(state.features)) candidates.push(state.features as LooseState);
  candidates.push(state as LooseState);

  let polities: unknown[] = [];
  let cities: unknown[] = [];
  let landmarks: unknown[] = [];
  let battalions: unknown[] = [];
  let regionOwnership: Record<string, string> = {};

  for (const c of candidates) {
    if (polities.length === 0) polities = asArray(c.polities ?? c.nations);
    if (cities.length === 0) cities = asArray(c.cities);
    if (landmarks.length === 0) landmarks = asArray(c.landmarks);
    if (battalions.length === 0) battalions = asArray(c.battalions ?? c.units);

    if (Object.keys(regionOwnership).length === 0) {
      if (isObject(c.regionOwnership)) {
        regionOwnership = c.regionOwnership as Record<string, string>;
      } else if (isObject(c.regions)) {
        // Some shapes use regions[regionId] = { ownerPolityId, ... }
        const out: Record<string, string> = {};
        for (const [rid, rdata] of Object.entries(c.regions)) {
          if (isObject(rdata)) {
            const owner =
              (rdata.ownerPolityId as string) ??
              (rdata.polityId as string) ??
              (rdata.owner as string);
            if (typeof owner === 'string') out[rid] = owner;
          }
        }
        regionOwnership = out;
      }
    }
  }

  return {
    polities: polities as MapFeatures['polities'],
    cities: cities as MapFeatures['cities'],
    landmarks: landmarks as MapFeatures['landmarks'],
    battalions: battalions as MapFeatures['battalions'],
    regionOwnership,
    capturedAt: new Date().toISOString(),
  };
}
