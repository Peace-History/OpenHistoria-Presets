// ripEditor — capture the full data the editor view exposes.
//
// Schema (per the user's manual exploration of the editor at /presets/{paxID}):
//
//   Polities (list):
//     - Each click → detail panel: Polity Color, Regions Owned, Additional Names, Tags
//
//   Map Features (list, with detail panel per feature):
//     - Name
//     - Owner: "dynamic" | "assigned" (specific polity)
//     - Non-Moving (boolean)
//     - Placement (style)
//     - Style
//     - Map Symbol
//     - Icon Scale
//     - Override Color
//     - Lb Scale
//     - Lb Size
//     - Label Placement: Above | Below | Left | Right | Center | No Label
//     - Longitude, Latitude
//     - Region (region ID)
//     - Tags
//
//   AI Prompts (12 main prompts):
//     - Each: Template Function, Output Structure Function, optional Cleanup Function
//     - Plus 12 Template Helpers, each with:
//         Info Tab: Name, Description, Tags
//         Function: Function Body
//
//   Advanced Settings:
//     - Consolidation Settings
//     - Map Rendering Options
//     - Document Size
//
//   Recommended Polities (Picks) — separate from the polity list
//
//   Version Metadata: versionID, isPublished, isMutating, banAppeal, changeLog,
//                     created, lastEdited, versionName
//   Author Profile: uid, displayName, photoURL
//   Basemap: id, name, tileUrl, attribution
//
// Flow:
//   1. Auth check via Firestore REST
//   2. Optionally inject cookies from --cookies file
//   3. Navigate to /presets/{paxID}?versionID=N
//   4. Wait for "Loading preset data..." to clear
//   5. Walk React Fiber tree, merge the state
//   6. Click through nested submenus (including each Polity + Map Feature
//      detail panel), re-walk after each click
//   7. Persist as editor.json + editor_status.json + raw state

import { BrowserContext, Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import { PAX_PRESETS_URL, PAX_MAP_EDITOR_URL, TIMEOUTS } from './config.js';
import {
  AIPromptStage,
  AuthorProfile,
  BasemapMetadata,
  EditorCaptureStatus,
  EditorData,
  EditorFailureReason,
  MapFeatures,
  MapFeatureDefinition,
  MapFeatureLocation,
  Polity,
  PolityDefinition,
  PolityFlag,
  RegionDefinition,
  TemplateHelper,
  VersionMetadata,
  AdvancedSettings,
} from './types.js';
import {
  categorizeMapFeatures,
  deriveRegionOwnership,
} from './ripFeatures.js';
import { writeEditorStatus } from './manifest.js';
import {
  fetchPresetFromFirestore,
  fetchCollectionFromFirestore,
  fetchDocumentFromFirestore,
} from './firestoreExtract.js';

const P = '[ripEditor]';

export interface CaptureEditorOptions {
  /** Path to cookies.json (optional). If set, we inject these cookies
   *  into the browser context before navigation — useful for fresh auth. */
  cookiesFile?: string;
  /** Submenu-click budget in ms (default 60s). */
  clickBudgetMs?: number;
  /** If true, do NOT actually click anything. Just walk the tree at the
   *  initial render. Useful for debugging. */
  noClicks?: boolean;
  /** The Pax ID the user requested (before any Copy flow). Recorded in
   *  editor_status.json so the saved copy can be traced back to the original. */
  originalPreset?: string;
  /** The version the user requested. Recorded in editor_status.json. */
  originalVersion?: number;
  /** Skip the Firestore REST auth check. Set true when we just created a
   *  copy and navigated to it — the page navigation itself proves auth
   *  works (Pax's client uses Firebase ID tokens, which the REST endpoint
   *  doesn't accept; but the new copy's doc is owner-only and 403s on REST
   *  even when auth is otherwise valid). */
  skipAuthCheck?: boolean;
  /** Override the editor URL. Defaults to `/presets/{paxID}?versionID={version}`
   *  (the public detail page, which never exposes editor state). Pass
   *  `/tools/map-editor?presetUID={id}` to scrape the actual editor UI
   *  where polities/mapFeatures/AI prompts/template helpers live. */
  mapEditorURL?: string;
  /** Author UID of the preset. If set, we fetch the author's profile from
   *  `userPublicProfiles/{authorUID}` and surface it on editorData.authorProfile.
   *  Discovered in the mitm dump (2026-06-20): the document is publicly
   *  readable via Firestore REST and contains displayName, photoURL,
   *  profileDescription, region, lifetimeSpendingUSD, totalTokensIn/Out, etc. */
  authorUID?: string;
}

interface ReactFiber {
  child?: ReactFiber;
  sibling?: ReactFiber;
  memoizedProps?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Walk the page's React Fiber tree to find the deepest node whose
 * memoizedProps matches any of the editor-state key patterns.
 *
 * Returns only the depth + key-hit count (NOT the fiber itself) — fibers
 * contain circular references that crash Playwright's serializer.
 * The caller re-walks to the captured depth via `getNodeProps`.
 */
async function findEditorStateNode(
  page: Page,
): Promise<{ depth: number; hits: number } | null> {
  const result = await page.evaluate((): { depth: number; hits: number } | null => {
    const findFiber = (el: Element): unknown => {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
          return (el as unknown as Record<string, unknown>)[k];
        }
      }
      return null;
    };
    const root = document.getElementById('__next') || document.body;
    let fiber = findFiber(root) as ReactFiber | null;
    if (!fiber) fiber = findFiber(document.documentElement) as ReactFiber | null;
    if (!fiber) return null;

    const candidateKeys =
      // Real keys observed on /tools/map-editor (June 2026):
      //   localMapFeatureData  — keyed object of all map features
      //   regionEntriesSnapshot — keyed object of region entries
      //   regionCountsByType   — {Coastal: N, Land: N, Ocean: N, Strait: N}
      //   baseMapGeometry      — basemap tile config + geometry
      //   mapFeaturesLayerRef  — Leaflet layer ref
      //   setLocalMapFeatureData — callback (signals editor mode)
      // Plus historical keys from the public detail page:
      //   polity|recommended|ai.?prompt|editor.?state|mapEditor|
      //   regionEditor|versionMetadata|basemap|templateHelper|advancedSetting
      /localMapFeature|regionEntry|regionCount|baseMapGeometry|mapFeaturesLayer|setLocalMapFeature|polity|recommended|ai.?prompt|editor.?state|mapEditor|regionEditor|versionMetadata|basemap|templateHelper|advancedSetting/i;

    let bestDepth = -1;
    let bestHits = 0;
    const seen = new WeakSet();
    const walk = (f: ReactFiber, depth: number): void => {
      if (!f || seen.has(f) || depth > 1000) return;
      seen.add(f);
      if (f.memoizedProps && typeof f.memoizedProps === 'object') {
        const keys = Object.keys(f.memoizedProps);
        let hits = 0;
        for (const k of keys) if (candidateKeys.test(k)) hits++;
        if (hits >= 2 && hits > bestHits) {
          bestDepth = depth;
          bestHits = hits;
        }
      }
      if (f.child) walk(f.child, depth + 1);
      if (f.sibling) walk(f.sibling, depth + 1);
    };
    walk(fiber, 0);
    return bestDepth >= 0 ? { depth: bestDepth, hits: bestHits } : null;
  });
  return result;
}

/** Pull the rich editor props off a fiber node at the captured depth. */
async function getNodeProps(
  page: Page,
  depth: number,
): Promise<Record<string, unknown> | null> {
  return await page.evaluate((targetDepth: number) => {
    const findFiber = (el: Element): unknown => {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
          return (el as unknown as Record<string, unknown>)[k];
        }
      }
      return null;
    };
    const root = document.getElementById('__next') || document.body;
    let fiber = findFiber(root) as ReactFiber | null;
    if (!fiber) fiber = findFiber(document.documentElement) as ReactFiber | null;
    if (!fiber) return null;
    const seen = new WeakSet();
    const walk = (f: ReactFiber, depth: number): Record<string, unknown> | null => {
      if (!f || seen.has(f) || depth > 1000) return null;
      seen.add(f);
      if (depth === targetDepth && f.memoizedProps) {
        return f.memoizedProps as Record<string, unknown>;
      }
      const c = f.child ? walk(f.child, depth + 1) : null;
      if (c) return c;
      const s = f.sibling ? walk(f.sibling, depth + 1) : null;
      if (s) return s;
      return null;
    };
    return walk(fiber, 0);
  }, depth);
}

/** Read the cookies.json file (Firefox cookies.json export shape) and
 *  convert to Playwright's `addCookies` shape. Handles HttpOnly. */
function readFirefoxCookies(
  file: string,
): Array<Parameters<BrowserContext['addCookies']>[0][number]> {
  interface FirefoxCookie {
    name: string;
    value: string;
    domain: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }
  const raw: FirefoxCookie[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return raw.map((c) => {
    const cookie: Parameters<BrowserContext['addCookies']>[0][number] = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
    };
    if (c.httpOnly) cookie.httpOnly = true;
    if (c.secure) cookie.secure = true;
    const ss = c.sameSite?.toLowerCase();
    if (ss === 'lax' || ss === 'strict' || ss === 'none') {
      cookie.sameSite = (ss[0].toUpperCase() + ss.slice(1)) as
        | 'Lax'
        | 'Strict'
        | 'None';
    }
    return cookie;
  });
}

/**
 * Capture the editor-view state. Returns a status object — never throws.
 * Writes editor.json + editor_status.json + api_responses/editor_state_raw.json
 * into `targetDir` (which should already exist).
 */
export async function captureEditorState(
  page: Page,
  paxID: string,
  version: number,
  targetDir: string,
  opts: CaptureEditorOptions = {},
): Promise<EditorCaptureStatus> {
  const start = Date.now();
  const budgetMs = opts.clickBudgetMs ?? 60_000;
  const status: EditorCaptureStatus = {
    attempted: true,
    captured: false,
    durationMs: 0,
    submenusClicked: 0,
  };

  const fail = (
    reason: EditorFailureReason,
    error?: string,
    extras?: Partial<EditorCaptureStatus>,
  ): EditorCaptureStatus => {
    status.captured = false;
    status.reason = reason;
    if (error) status.error = error;
    status.durationMs = Date.now() - start;
    if (extras) Object.assign(status, extras);
    return status;
  };

  // 1) Auth check via Firestore REST. Skipped when the caller has just
  //    created a copy and navigated to it (the new copy's doc is
  //    owner-only and 403s on REST even though the in-app navigation
  //    proves auth is valid via Firebase ID tokens).
  if (!opts.skipAuthCheck) {
    const db = await fetchPresetFromFirestore(page, paxID);
    if (!db) {
      if (opts.cookiesFile && fs.existsSync(opts.cookiesFile)) {
        console.log(
          chalk.gray(
            `${P} no auth — injecting cookies from ${opts.cookiesFile} and retrying`,
          ),
        );
        try {
          const cookies = readFirefoxCookies(opts.cookiesFile);
          await page.context().addCookies(cookies);
          status.cookiesInjected = true;
          const db2 = await fetchPresetFromFirestore(page, paxID);
          if (!db2) {
            return fail(
              'auth_invalid_even_with_cookies',
              'Firestore REST still 403 after cookie injection',
              { cookiesInjected: true },
            );
          }
          return await runCapture(
            page, paxID, version, targetDir, opts, status, budgetMs, start, db2,
          );
        } catch (e) {
          return fail(
            'auth_invalid_even_with_cookies',
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      return fail(
        'auth_invalid',
        `Firestore REST 403 for simplePresets/${paxID} (cookies may be stale)`,
      );
    }
    return await runCapture(
      page, paxID, version, targetDir, opts, status, budgetMs, start, db,
    );
  }

  console.log(
    chalk.gray(
      `${P} skipping REST auth check (skipAuthCheck set) — proceeding to editor scrape`,
    ),
  );
  return await runCapture(
    page, paxID, version, targetDir, opts, status, budgetMs, start, null,
  );
}

async function runCapture(
  page: Page,
  paxID: string,
  version: number,
  targetDir: string,
  opts: CaptureEditorOptions,
  status: EditorCaptureStatus,
  budgetMs: number,
  start: number,
  _db: { db: string; raw: Record<string, unknown>; bytes: number } | null,
): Promise<EditorCaptureStatus> {
  // Default URL is the public detail page; override via opts.mapEditorURL
  // to scrape the actual editor at /tools/map-editor?presetUID={id}.
  const url =
    opts.mapEditorURL ?? `${PAX_PRESETS_URL}/${paxID}?versionID=${version}`;
  console.log(chalk.gray(`${P} navigating to ${url}`));
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageLoad,
    });
  } catch (e) {
    return finalizeStatus(
      status,
      start,
      0,
      'parse_error',
      e instanceof Error ? e.message : String(e),
      targetDir,
    );
  }

  // 2) Wait for "Loading preset data..." to clear
  const loadCleared = await waitForLoadToClear(page, 30_000);
  if (!loadCleared) {
    status.finalUrl = page.url();
    return finalizeStatus(
      status,
      start,
      0,
      'still_loading',
      'Page still showing "Loading preset data..." after 30s — auth is likely invalid',
      targetDir,
    );
  }

  // 3) Walk React tree → initial state. The "Loading preset data..."
  //    overlay clears before Firestore's Listen channel finishes
  //    hydrating the editor's React state, so a single walk often
  //    misses the editor node. Retry for up to 30s with 1.5s gaps.
  let mergedState: Record<string, unknown> = {};
  try {
    const found = (await waitForEditorState(page, 30_000, 1_500)) as
      | { depth: number; hits: number }
      | null;
    if (found) {
      const props = await getNodeProps(page, found.depth);
      if (props) {
        mergedState = deepMerge(mergedState, props);
        console.log(
          chalk.gray(
            `${P} initial state walk: depth ${found.depth}, ${Object.keys(props).length} keys`,
          ),
        );
      }
    } else {
      console.log(
        chalk.yellow(
          `${P} no editor-state node found in React tree after 30s — page may not be in editor view`,
        ),
      );
    }
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P} React walk errored: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  // 4) Click through submenus
  if (!opts.noClicks) {
    const clickStart = Date.now();
    let noNewStateStreak = 0;
    while (Date.now() - clickStart < budgetMs && noNewStateStreak < 5) {
      const buttons = await listSubmenuButtons(page);
      if (buttons.length === 0) break;
      let clickedThisRound = 0;
      for (let i = 0; i < buttons.length; i++) {
        if (Date.now() - clickStart > budgetMs) break;
        const btn = buttons[i];
        try {
          await btn.click({ timeout: 3_000 });
          await page.waitForTimeout(800); // let any new state mount
          const f2 = await findEditorStateNode(page);
          if (f2) {
            const props2 = await getNodeProps(page, f2.depth);
            if (props2) {
              const beforeSize = Object.keys(mergedState).length;
              mergedState = deepMerge(mergedState, props2);
              const afterSize = Object.keys(mergedState).length;
              if (afterSize > beforeSize) {
                noNewStateStreak = 0;
                status.submenusClicked += 1;
                clickedThisRound += 1;
                console.log(
                  chalk.gray(
                    `${P} click ${status.submenusClicked}: +${afterSize - beforeSize} new keys (total: ${afterSize})`,
                  ),
                );
              } else {
                noNewStateStreak += 1;
              }
            } else {
              noNewStateStreak += 1;
            }
          } else {
            noNewStateStreak += 1;
          }
        } catch {
          noNewStateStreak += 1;
        }
      }
      if (clickedThisRound === 0) break;
    }
  }

  // 5) Persist. Strip non-serializable values from mergedState first —
//    React's memoizedProps contain callbacks, refs, and elements that
//    have circular references and crash JSON.stringify.
  const safeMergedState = sanitizeForJson(mergedState) as Record<string, unknown>;
  let editorData = shapeEditorData(safeMergedState);

  // 5b) Augment with top-level collections that aren't in the React
  //     tree but ARE publicly readable via Firestore REST:
  //     - `promptStore` — every AI prompt the system knows about
  //     - `templateHelpers` — every helper doc referenced from prompts
  //     These were observed in the user's mitm dump and verified
  //     publicly readable via REST (HTTP 200, no auth) on 2026-06-20.
  try {
    const promptStore = await fetchCollectionFromFirestore(page, 'promptStore');
    if (promptStore) {
      const shaped = shapeAIPrompts(promptStore.docs as Record<string, Record<string, unknown>>);
      for (const [pk, stage] of Object.entries(shaped)) {
        if (!editorData.aiPrompts[pk]) editorData.aiPrompts[pk] = stage;
      }
      editorData.promptStoreRaw = promptStore.docs;
    }
    const helpers = await fetchCollectionFromFirestore(page, 'templateHelpers');
    if (helpers) {
      for (const [, helperDoc] of Object.entries(helpers.docs)) {
        editorData.templateHelpers.push(
          shapeTemplateHelper(helperDoc),
        );
      }
    }
    // 5c) Fetch the preset author's public profile. The authorUID comes
    //     either from the option (threaded up from ripPreset's owner check)
    //     or from the preset doc we already fetched during the auth check.
    //     userPublicProfiles/{uid} is publicly readable via Firestore REST
    //     (verified 2026-06-20) and carries displayName, photoURL,
    //     profileDescription, region, lifetimeSpendingUSD, totalTokensIn/Out.
    let authorUID = opts.authorUID;
    if (!authorUID) {
      try {
        const presetDoc = await fetchPresetFromFirestore(page, paxID);
        authorUID = presetDoc?.raw.authorUID as string | undefined;
      } catch {
        // ignore — owner-only copies 403 on REST; we just skip the profile
      }
    }
    if (authorUID) {
      const profile = await fetchDocumentFromFirestore(
        page,
        `userPublicProfiles/${authorUID}`,
      );
      if (profile) {
        editorData.authorProfile = shapeAuthorProfile(profile.raw);
      }
    }
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P} could not augment editor with public collections: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  }

  try {
    fs.mkdirSync(path.join(targetDir, 'api_responses'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'api_responses', 'editor_state_raw.json'),
      JSON.stringify(safeMergedState, null, 2),
    );
    fs.writeFileSync(
      path.join(targetDir, 'editor.json'),
      JSON.stringify(editorData, null, 2),
    );
    console.log(
      chalk.green(
        `${P} ✓ editor.json written: ` +
          `${editorData.polities.length} polities, ` +
          `${editorData.recommendedPolities.length} recommended, ` +
          `${editorData.mapFeatures.length} map features, ` +
          `${Object.keys(editorData.regionMap).length} regions, ` +
          `${Object.keys(editorData.aiPrompts).length} AI prompt stages, ` +
          `${editorData.templateHelpers.length} template helpers, ` +
          `author=${editorData.authorProfile?.displayName ?? 'n/a'}, ` +
          `(${status.submenusClicked} submenus clicked)`,
      ),
    );
  } catch (e) {
    return finalizeStatus(
      status,
      start,
      status.submenusClicked,
      'parse_error',
      `write editor.json: ${e instanceof Error ? e.message : String(e)}`,
      targetDir,
    );
  }

  status.captured = true;
  status.durationMs = Date.now() - start;
  status.finalUrl = page.url();
  status.sourcePreset = paxID;
  status.originalPreset = opts.originalPreset;
  status.originalVersion = opts.originalVersion;
  // Persist editor_status.json so downstream tools (and humans) can see
  // provenance + submenu-click count without re-parsing editor.json.
  try {
    writeEditorStatus(targetDir, status);
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P} could not write editor_status.json: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  }
  return status;
}

async function waitForLoadToClear(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stillLoading = await page.evaluate(() => {
      const text = document.body.innerText;
      return /loading preset data|loading\.\.\./i.test(text);
    });
    if (!stillLoading) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

/**
 * Poll `findEditorStateNode` until it finds a node or the budget is
 * exhausted. The "Loading preset data..." overlay clears before
 * Firestore's Listen channel finishes hydrating the editor's React
 * state, so a single walk almost always misses the editor node on
 * freshly-navigated pages.
 */
async function waitForEditorState(
  page: Page,
  timeoutMs: number,
  delayMs: number,
): Promise<{ depth: number; hits: number } | null> {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts += 1;
    const found = await findEditorStateNode(page);
    if (found) {
      console.log(
        chalk.gray(
          `${P} editor-state node found after ${attempts} attempt(s) (${Date.now() - start}ms, ${found.hits} key hits)`,
        ),
      );
      return found;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function listSubmenuButtons(
  page: Page,
): Promise<Array<import('playwright').Locator>> {
  // Find any clickable submenu trigger. We exclude:
  //  - the persistent header (y < 100)
  //  - the Play Now button (unique text)
  //  - country pick-cards
  //  - already-open expandable elements (aria-expanded=true)
  const handles = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, a[role="button"], [role="button"], [role="tab"], [data-tab], [data-submenu]',
      ),
    );
    const out: Array<{
      text: string;
      x: number;
      y: number;
      tagName: string;
      ariaExpanded: string | null;
      dataSubmenu: string | null;
    }> = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.y < 100) continue; // skip header
      if (/Play Now/.test(el.textContent || '')) continue;
      if (el.closest('[data-pick-card]')) continue;
      const aria = el.getAttribute('aria-expanded');
      if (aria === 'true') continue;
      out.push({
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        x: Math.round(r.x),
        y: Math.round(r.y),
        tagName: el.tagName,
        ariaExpanded: aria,
        dataSubmenu: el.getAttribute('data-submenu'),
      });
    }
    return out;
  });

  // Re-locate each handle by its (text, position) so we get fresh Locators
  const locators: Array<import('playwright').Locator> = [];
  for (const h of handles) {
    try {
      // Find by approximate position
      const loc = page
        .locator(h.tagName.toLowerCase())
        .filter({ hasText: h.text })
        .first();
      // Filter by bounding box (Playwright has no direct bbox selector,
      // so we re-check on click)
      locators.push(loc);
    } catch {
      // ignore
    }
  }
  return locators.slice(0, 50);
}

/** Deep-merge two plain objects (B overwrites A on key collision,
 *  arrays are replaced not concatenated). */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  if (!a || Object.keys(a).length === 0) return { ...b };
  if (!b || Object.keys(b).length === 0) return { ...a };
  const out: Record<string, unknown> = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    if (
      av && bv && typeof av === 'object' && typeof bv === 'object' &&
      !Array.isArray(av) && !Array.isArray(bv) &&
      Object.getPrototypeOf(av) === Object.prototype &&
      Object.getPrototypeOf(bv) === Object.prototype
    ) {
      out[k] = deepMerge(
        av as Record<string, unknown>,
        bv as Record<string, unknown>,
      );
    } else {
      out[k] = bv;
    }
  }
  return out;
}

/**
 * Walk an object and return a JSON-serializable copy:
 *   - Functions, refs, React elements, and other non-data types → dropped
 *   - Plain objects → recursed
 *   - Arrays → mapped
 *   - Primitives (string, number, boolean, null) → preserved
 *   - Anything else (Date, Map, Set, etc.) → coerced to string
 *   - Uses a `seen` WeakSet to avoid infinite recursion on cycles
 *
 * React's `memoizedProps` includes callbacks, refs to DOM nodes, and
 * other objects that hold back-references into the React fiber tree.
 * Those crash JSON.stringify with "Converting circular structure to JSON"
 * unless we strip them out.
 */
function sanitizeForJson(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();
  if (t === 'function') return undefined;
  if (t === 'symbol') return undefined;
  if (t !== 'object') return undefined;
  const obj = value as object;
  if (seen.has(obj)) return undefined; // cycle
  seen.add(obj);
  // React-specific sentinels
  if (
    typeof (obj as { $$typeof?: unknown }).$$typeof !== 'undefined' ||
    (obj as { _owner?: unknown })._owner ||
    (obj as { __reactFiber$?: unknown }).__reactFiber$ ||
    (obj as { __reactInternalInstance$?: unknown }).__reactInternalInstance$
  ) {
    return undefined;
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitizeForJson(v, seen));
  }
  // Plain object — recurse
  if (Object.getPrototypeOf(obj) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const sv = sanitizeForJson(v, seen);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  // Other class instances (Date, Map, Set, etc.) — toString as a fallback
  try {
    return String(obj);
  } catch {
    return undefined;
  }
}

function shapeEditorData(state: Record<string, unknown>): EditorData {
  const data: EditorData = {
    polities: [],
    recommendedPolities: [],
    mapFeatures: [],
    regionMap: {},
    aiPrompts: {},
    templateHelpers: [],
    advancedSettings: undefined,
    regionEditorState: {},
    regionCountsByType: {},
    extras: {},
  };

  // Special-case: initialPresetData is the canonical container for the
  // map editor's full preset state. Walk its substructure first.
  const ipd = state.initialPresetData as Record<string, unknown> | undefined;
  if (ipd && typeof ipd === 'object') {
    // regionData — 781 regions keyed by stringified index
    if (ipd.regionData && typeof ipd.regionData === 'object' && !Array.isArray(ipd.regionData)) {
      for (const [rid, r] of Object.entries(ipd.regionData as Record<string, unknown>)) {
        if (r && typeof r === 'object') {
          data.regionMap[rid] = shapeRegion(rid, r as Record<string, unknown>);
        }
      }
    }
    // recommendedEntities — 20 picks keyed by UUID
    if (ipd.recommendedEntities && typeof ipd.recommendedEntities === 'object' && !Array.isArray(ipd.recommendedEntities)) {
      for (const [eid, ed] of Object.entries(ipd.recommendedEntities as Record<string, unknown>)) {
        if (ed && typeof ed === 'object') {
          const er = ed as Record<string, unknown>;
          if (!er.name) er.name = (er.entityId as string) || eid;
          data.recommendedPolities.push(shapePolity(er));
        }
      }
    }
    // prompts — 12 AI prompts keyed by name (eventConsolidator, jumpForward, …)
    if (ipd.prompts && typeof ipd.prompts === 'object' && !Array.isArray(ipd.prompts)) {
      const shaped = shapeAIPrompts(ipd.prompts as Record<string, unknown>);
      for (const [pk, stage] of Object.entries(shaped)) {
        if (!data.aiPrompts[pk]) data.aiPrompts[pk] = stage;
      }
    }
    // consolidationSettings + eventConsolidations + startingTimelineText
    // + rulesText → AdvancedSettings
    const settingsSrc: Record<string, unknown> = {
      consolidationSettings: ipd.consolidationSettings,
      eventConsolidations: ipd.eventConsolidations,
      rulesText: ipd.rulesText,
      startingTimelineText: ipd.startingTimelineText,
      title: ipd.title,
      description: ipd.description,
      presetCategory: ipd.presetCategory,
      presetCategoryString: ipd.presetCategoryString,
      coverImageURL: ipd.coverImageURL,
      landingImageURL: ipd.landingImageURL,
      versionID: ipd.versionID,
      isPublished: ipd.isPublished,
      lastRoundCompleted: ipd.lastRoundCompleted,
      mapGeometryDocumentID: ipd.mapGeometryDocumentID,
      authorUID: ipd.authorUID,
      presetUID: ipd.presetUID,
    };
    data.advancedSettings = shapeAdvancedSettings(settingsSrc);
    data.simpleGameRaw = settingsSrc;
    // rounds[0] has countryDescriptions (polities) + mapFeatures
    if (ipd.rounds && typeof ipd.rounds === 'object' && !Array.isArray(ipd.rounds)) {
      const r0 = (ipd.rounds as Record<string, unknown>)['0'];
      if (r0 && typeof r0 === 'object') {
        const r0obj = r0 as Record<string, unknown>;
        // countryDescriptions — 205 polities keyed by polity NAME
        if (r0obj.countryDescriptions && typeof r0obj.countryDescriptions === 'object' && !Array.isArray(r0obj.countryDescriptions)) {
          for (const [pname, pdesc] of Object.entries(r0obj.countryDescriptions as Record<string, unknown>)) {
            if (pdesc && typeof pdesc === 'object') {
              const pdr = pdesc as Record<string, unknown>;
              if (!pdr.name) pdr.name = pname;
              data.polities.push(shapePolity(pdr));
            }
          }
        }
        // mapFeatures — 792 features keyed by 8-char ID
        if (r0obj.mapFeatures && typeof r0obj.mapFeatures === 'object' && !Array.isArray(r0obj.mapFeatures)) {
          for (const [fid, fv] of Object.entries(r0obj.mapFeatures as Record<string, unknown>)) {
            if (fv && typeof fv === 'object') {
              const fr = fv as Record<string, unknown>;
              if (!fr.id) fr.id = fid;
              data.mapFeatures.push(shapeMapFeature(fr));
            }
          }
        }
      }
    }
  }

  for (const [k, v] of Object.entries(state)) {
    // localMapFeatureData — keyed object of all map features on
    // /tools/map-editor (792 entries for modern_day). Each entry has the
    //   { name, displaySymbol, labelPlacement, description, type, tags,
    //     scale, location.{longitude, latitude, regionID} }
    // shape, matching `MapFeatureDefinition`.
    if (/^localMapFeatureData$/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      for (const [fid, fv] of Object.entries(obj)) {
        if (fv && typeof fv === 'object') {
          const fr = fv as Record<string, unknown>;
          if (!fr.id) fr.id = fid;
          data.mapFeatures.push(shapeMapFeature(fr));
        }
      }
      continue;
    }

    // regionEntriesSnapshot — keyed object of region entries (name, tags, …)
    if (/^regionEntriesSnapshot$/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      for (const [rid, r] of Object.entries(obj)) {
        if (r && typeof r === 'object') {
          data.regionMap[rid] = shapeRegion(rid, r as Record<string, unknown>);
        }
      }
      continue;
    }

    // regionCountsByType — { Coastal: N, Land: N, Ocean: N, Strait: N }
    if (/^regionCountsByType$/.test(k) && v && typeof v === 'object') {
      for (const [t, n] of Object.entries(v as Record<string, unknown>)) {
        if (typeof n === 'number') data.regionCountsByType[t] = n;
      }
      continue;
    }

    // baseMapGeometry — basemap tile config + geometry (from React tree)
    if (/^baseMapGeometry$/.test(k) && v && typeof v === 'object') {
      data.basemapMetadata = shapeBasemapMetadata(v as Record<string, unknown>);
      continue;
    }

    // Skip React-internal keys (setter callbacks, layer refs, refs)
    if (/^setLocalMapFeatureData$|^mapFeaturesLayerRef$|^container$|^setRegion|^data-overlay-container$|^mapRef$|^mapRefreshTrigger$|^sessionIdentity$|^sessionControlRef$|^initialPresetData$/.test(k)) {
      continue;
    }

    if (/polity/i.test(k) && Array.isArray(v)) {
      const arr = v as unknown[];
      const isPicks = /recommend|pick/i.test(k);
      const out = isPicks ? data.recommendedPolities : data.polities;
      for (const item of arr) {
        if (item && typeof item === 'object') {
          out.push(shapePolity(item as Record<string, unknown>));
        }
      }
    } else if (/map.?feature/i.test(k) && Array.isArray(v)) {
      for (const item of v as unknown[]) {
        if (item && typeof item === 'object') {
          data.mapFeatures.push(
            shapeMapFeature(item as Record<string, unknown>),
          );
        }
      }
    } else if (/^mapFeatures$/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      // Map editor variants expose mapFeatures as a keyed object (not array)
      for (const [fid, fv] of Object.entries(v as Record<string, unknown>)) {
        if (fv && typeof fv === 'object') {
          const fr = fv as Record<string, unknown>;
          if (!fr.id) fr.id = fid;
          data.mapFeatures.push(shapeMapFeature(fr));
        }
      }
    } else if (/region/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (/map/i.test(k)) {
        for (const [rid, r] of Object.entries(obj)) {
          if (r && typeof r === 'object') {
            data.regionMap[rid] = shapeRegion(
              rid,
              r as Record<string, unknown>,
            );
          }
        }
      } else if (/count/i.test(k)) {
        for (const [t, n] of Object.entries(obj)) {
          if (typeof n === 'number') data.regionCountsByType[t] = n;
        }
      } else if (/editor|state|setting|tool/i.test(k)) {
        for (const [f, val] of Object.entries(obj)) {
          data.regionEditorState[f] = val;
        }
      }
    } else if (/prompt/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      // promptStore docs OR simpleGames.prompts map — both keyed/structured
      const shaped = shapeAIPrompts(v as Record<string, unknown>);
      // Merge: don't overwrite already-captured prompts
      for (const [pk, stage] of Object.entries(shaped)) {
        if (!data.aiPrompts[pk]) data.aiPrompts[pk] = stage;
      }
    } else if (/template.?helper/i.test(k)) {
      // templateHelpers may arrive as an array OR a map keyed by UUID
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object') {
            data.templateHelpers.push(
              shapeTemplateHelper(item as Record<string, unknown>),
            );
          }
        }
      } else if (v && typeof v === 'object') {
        for (const [, helperObj] of Object.entries(v)) {
          if (helperObj && typeof helperObj === 'object') {
            data.templateHelpers.push(
              shapeTemplateHelper(helperObj as Record<string, unknown>),
            );
          }
        }
      }
    } else if (/advanced.?setting|simple.?game|game.?config|consolidation|map.?rendering/i.test(k) && v && typeof v === 'object') {
      data.advancedSettings = shapeAdvancedSettings(v as Record<string, unknown>);
      data.simpleGameRaw = v as Record<string, unknown>;
    } else if (/version/i.test(k) && v && typeof v === 'object') {
      data.versionMetadata = shapeVersionMetadata(v as Record<string, unknown>);
    } else if (/author/i.test(k) && v && typeof v === 'object') {
      data.authorProfile = shapeAuthorProfile(v as Record<string, unknown>);
    } else if (/basemap/i.test(k) && v && typeof v === 'object') {
      data.basemapMetadata = shapeBasemapMetadata(v as Record<string, unknown>);
    } else {
      data.extras[k] = v;
    }
  }

  return data;
}

function shapePolity(obj: Record<string, unknown>): PolityDefinition {
  // Polities in `countryDescriptions` are keyed by polity NAME (not UID).
  // The dump shows no `id`/`uid` field on the polity itself — the mapValue
  // key IS the identifier. Flag carries the rich flag metadata (id, isSensitive,
  // height, width, imageURL, compressedImageURL, iconImageURL, icon.{zoom,cx,cy}).
  return {
    name: String((obj.name as string) || ''),
    color: (obj.color as string) || undefined,
    additionalNames: Array.isArray(obj.additionalNames)
      ? (obj.additionalNames as string[])
      : undefined,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : undefined,
    regionsOwned: Array.isArray(obj.regionsOwned)
      ? (obj.regionsOwned as string[])
      : undefined,
    flag: shapePolityFlag(obj.flag as Record<string, unknown> | undefined),
    extras: stripKnownFields(obj, [
      'name', 'color', 'additionalNames', 'tags', 'regionsOwned', 'flag',
    ]),
  };
}

function shapePolityFlag(
  obj: Record<string, unknown> | undefined,
): PolityFlag | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const icon = obj.icon as Record<string, unknown> | undefined;
  return {
    id: (obj.id as string) || undefined,
    isSensitive:
      typeof obj.isSensitive === 'boolean'
        ? (obj.isSensitive as boolean)
        : undefined,
    height: typeof obj.height === 'number' ? (obj.height as number) : undefined,
    width: typeof obj.width === 'number' ? (obj.width as number) : undefined,
    imageURL: (obj.imageURL as string) || undefined,
    compressedImageURL: (obj.compressedImageURL as string) || undefined,
    iconImageURL: (obj.iconImageURL as string) || undefined,
    icon: icon && typeof icon === 'object'
      ? {
          zoom: typeof icon.zoom === 'number' ? (icon.zoom as number) : undefined,
          cx: typeof icon.cx === 'number' ? (icon.cx as number) : undefined,
          cy: typeof icon.cy === 'number' ? (icon.cy as number) : undefined,
        }
      : undefined,
    extras: stripKnownFields(obj, [
      'id', 'isSensitive', 'height', 'width',
      'imageURL', 'compressedImageURL', 'iconImageURL', 'icon',
    ]),
  };
}

function shapeMapFeature(obj: Record<string, unknown>): MapFeatureDefinition {
  // Wire shape (per the dump): { name, displaySymbol, labelPlacement,
  // description, type ("coordinate"|…), tags, scale, location: {longitude,
  // latitude, regionID} }. The dump did NOT contain any feature with a `geom`
  // field (every feature seen was coordinate-typed); if one shows up later
  // it's preserved in `raw`.
  const loc = obj.location as Record<string, unknown> | undefined;
  const location: MapFeatureLocation | undefined =
    loc && typeof loc === 'object'
      ? {
          longitude:
            typeof loc.longitude === 'number' ? (loc.longitude as number) : undefined,
          latitude:
            typeof loc.latitude === 'number' ? (loc.latitude as number) : undefined,
          regionID: (loc.regionID as string) || undefined,
        }
      : undefined;
  return {
    id: String(
      (obj.uid as string) ||
        (obj.id as string) ||
        (obj.featureID as string) ||
        '',
    ),
    name: (obj.name as string) || undefined,
    description: (obj.description as string) || undefined,
    type: (obj.type as string) || undefined,
    displaySymbol: (obj.displaySymbol as string) || undefined,
    labelPlacement: (obj.labelPlacement as string) || undefined,
    scale: typeof obj.scale === 'number' ? (obj.scale as number) : undefined,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : undefined,
    location,
    geom: typeof obj.geom === 'string' ? (obj.geom as string) : undefined,
    raw: obj,
  };
}

function shapeRegion(index: string, obj: Record<string, unknown>): RegionDefinition {
  // The dump's regionData carries only { name, tags } — keep that as the
  // typed surface and stash everything else in `extras`.
  return {
    index,
    name: (obj.name as string) || undefined,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : undefined,
    extras: stripKnownFields(obj, ['name', 'tags']),
  };
}

function shapeAIPrompts(obj: Record<string, unknown>): Record<string, AIPromptStage> {
  // Two on-wire shapes for AI prompts:
  //   1) promptStore/{uuid}: top-level { promptKey, promptConfig, title,
  //      publishDate, isPublished, authorUID, tags }. The body of each prompt
  //      lives inside `promptConfig`.
  //   2) simpleGames/{id}/prompts/{name}: flat map (promptKey = name).
  //
  // Either way, the inner shape is: { promptKey, enabled, aiModel, firstStage,
  // maxThinkingTokens, maxOutputTokens, schema, template, promptSource,
  // templateHelpers: { uuid → helper } }.
  const out: Record<string, AIPromptStage> = {};

  const promptConfigs: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    const vj = v as Record<string, unknown>;
    if (vj.promptConfig && typeof vj.promptConfig === 'object') {
      const cfg = vj.promptConfig as Record<string, unknown>;
      const key = (cfg.promptKey as string) || (vj.promptKey as string) || k;
      promptConfigs[key] = cfg;
    } else if (typeof vj.promptKey === 'string') {
      promptConfigs[vj.promptKey as string] = vj;
    }
  }

  for (const [key, cfg] of Object.entries(promptConfigs)) {
    const inlineHelpers = cfg.templateHelpers as
      | Record<string, unknown>
      | undefined;
    const helpers: Record<string, TemplateHelper> = {};
    if (inlineHelpers && typeof inlineHelpers === 'object') {
      for (const [hUid, hObj] of Object.entries(inlineHelpers)) {
        if (hObj && typeof hObj === 'object') {
          helpers[hUid] = shapeTemplateHelper(
            { UID: hUid, ...(hObj as Record<string, unknown>) },
          );
        }
      }
    }
    const schema =
      cfg.schema && typeof cfg.schema === 'object'
        ? (cfg.schema as Record<string, unknown>)
        : undefined;
    out[key] = {
      promptKey: key,
      enabled:
        typeof cfg.enabled === 'boolean' ? (cfg.enabled as boolean) : undefined,
      aiModel: (cfg.aiModel as string) || undefined,
      firstStage: (cfg.firstStage as string) || undefined,
      maxThinkingTokens:
        typeof cfg.maxThinkingTokens === 'number'
          ? (cfg.maxThinkingTokens as number)
          : undefined,
      maxOutputTokens:
        typeof cfg.maxOutputTokens === 'number'
          ? (cfg.maxOutputTokens as number)
          : undefined,
      schema,
      template:
        typeof cfg.template === 'string' ? (cfg.template as string) : undefined,
      promptSource: (cfg.promptSource as string) || undefined,
      templateHelpers:
        Object.keys(helpers).length > 0 ? helpers : undefined,
      extras: stripKnownFields(cfg, [
        'promptKey', 'enabled', 'aiModel', 'firstStage',
        'maxThinkingTokens', 'maxOutputTokens', 'schema',
        'template', 'promptSource', 'templateHelpers',
      ]),
    };
  }

  return out;
}

function shapeTemplateHelper(obj: Record<string, unknown>): TemplateHelper {
  // Wire shape: { UID, name, description, tags, functionBody, authorUID,
  // isPublished, forkedFromUID, forkedFromUpdatedAt, updatedAt, forGameDataVersion }
  const uid =
    (obj.UID as string) ||
    (obj.uid as string) ||
    (obj.id as string) ||
    '';
  const info = (obj.info as Record<string, unknown>) || {};
  return {
    uid,
    name: (info.name as string) || (obj.name as string) || '',
    description:
      (info.description as string) || (obj.description as string) || undefined,
    tags: Array.isArray(info.tags)
      ? (info.tags as string[])
      : Array.isArray(obj.tags)
        ? (obj.tags as string[])
        : undefined,
    functionBody:
      typeof obj.function === 'string'
        ? (obj.function as string)
        : typeof obj.functionBody === 'string'
          ? (obj.functionBody as string)
          : typeof obj.body === 'string'
            ? (obj.body as string)
            : undefined,
    authorUID: (obj.authorUID as string) || undefined,
    isPublished:
      typeof obj.isPublished === 'boolean'
        ? (obj.isPublished as boolean)
        : undefined,
    forkedFromUID: (obj.forkedFromUID as string) || undefined,
    forkedFromUpdatedAt:
      typeof obj.forkedFromUpdatedAt === 'number'
        ? (obj.forkedFromUpdatedAt as number)
        : undefined,
    updatedAt:
      typeof obj.updatedAt === 'number' ? (obj.updatedAt as number) : undefined,
    forGameDataVersion:
      typeof obj.forGameDataVersion === 'number'
        ? (obj.forGameDataVersion as number)
        : undefined,
    extras: stripKnownFields(obj, [
      'UID', 'uid', 'id', 'info', 'name', 'description', 'tags',
      'function', 'functionBody', 'body',
      'authorUID', 'isPublished', 'forkedFromUID', 'forkedFromUpdatedAt',
      'updatedAt', 'forGameDataVersion',
    ]),
  };
}

function shapeAdvancedSettings(
  obj: Record<string, unknown>,
): AdvancedSettings {
  // Wire source is `simpleGames/{id}` (or its `prompts` sibling). The editor
  // surfaces a grab-bag of these as "Advanced Settings": consolidation,
  // mode, thinking, difficulty, rulesText, etc.
  return {
    consolidationSettings:
      obj.consolidationSettings && typeof obj.consolidationSettings === 'object'
        ? (obj.consolidationSettings as Record<string, unknown>)
        : undefined,
    consolidationChunkSize:
      typeof obj.consolidationChunkSize === 'number'
        ? (obj.consolidationChunkSize as number)
        : undefined,
    eventConsolidations:
      obj.eventConsolidations && typeof obj.eventConsolidations === 'object'
        ? (obj.eventConsolidations as Record<string, unknown>)
        : undefined,
    mode: (obj.mode as string) || undefined,
    thinking:
      typeof obj.thinking === 'boolean'
        ? (obj.thinking as boolean)
        : (obj.thinking as string) || undefined,
    startsOnRound:
      typeof obj.startsOnRound === 'number'
        ? (obj.startsOnRound as number)
        : undefined,
    lastRoundCompleted:
      typeof obj.lastRoundCompleted === 'number'
        ? (obj.lastRoundCompleted as number)
        : undefined,
    difficulty: (obj.difficulty as string) || undefined,
    rulesText: (obj.rulesText as string) || undefined,
    advisor:
      obj.advisor && typeof obj.advisor === 'object'
        ? (obj.advisor as Record<string, unknown>)
        : undefined,
    raw: obj,
  };
}

function shapeVersionMetadata(obj: Record<string, unknown>): VersionMetadata {
  return {
    versionID: typeof obj.versionID === 'number' ? (obj.versionID as number) : undefined,
    isPublished:
      typeof obj.isPublished === 'boolean' ? (obj.isPublished as boolean) : undefined,
    isMutating:
      typeof obj.isMutating === 'boolean' ? (obj.isMutating as boolean) : undefined,
    banAppeal: (obj.banAppeal as string) || undefined,
    changeLog: (obj.changeLog as string) || undefined,
    createdAt:
      (obj.createdAt as string) || (obj.created as string) || undefined,
    lastEdited: (obj.lastEdited as string) || undefined,
    versionName: (obj.versionName as string) || undefined,
    extras: {},
  };
}

function shapeAuthorProfile(obj: Record<string, unknown>): AuthorProfile {
  // Wire surface (per `userPublicProfiles/{uid}`): displayName, photoURL,
  // profileDescription, region, lifetimeSpendingUSD, gameplay stats, plus
  // a per-preset selection-frequency counter map (uid → count). The dump
  // shows a long tail of author-name keys (e.g. "USA", "Germany") — those
  // are nation-selection-frequency counters, not names; we surface them via
  // `countrySelectionFrequency` if they look numeric.
  const authoredTitles: Record<string, string> = {};
  const selectionFreq: Record<string, number> = {};
  const countryFreq: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && typeof k === 'string') {
      if (k.length >= 18) selectionFreq[k] = v;
      else countryFreq[k] = v;
    }
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{18,22}$/.test(k)) {
      authoredTitles[k] = v;
    }
  }
  return {
    uid: String((obj.uid as string) || (obj.userUID as string) || ''),
    displayName: (obj.displayName as string) || undefined,
    photoURL: (obj.photoURL as string) || undefined,
    profileDescription: (obj.profileDescription as string) || undefined,
    region: (obj.region as string) || undefined,
    createdAt: (obj.createdAt as string) || undefined,
    lastActive: (obj.lastActive as string) || undefined,
    lifetimeSpendingUSD:
      typeof obj.lifetimeSpendingUSD === 'number'
        ? (obj.lifetimeSpendingUSD as number)
        : undefined,
    roundsPlayed:
      typeof obj.roundsPlayed === 'number' ? (obj.roundsPlayed as number) : undefined,
    gamesStarted:
      typeof obj.gamesStarted === 'number' ? (obj.gamesStarted as number) : undefined,
    totalTokensIn:
      typeof obj.totalTokensIn === 'number' ? (obj.totalTokensIn as number) : undefined,
    totalTokensOut:
      typeof obj.totalTokensOut === 'number'
        ? (obj.totalTokensOut as number)
        : undefined,
    nationsDestroyed:
      typeof obj.nationsDestroyed === 'number'
        ? (obj.nationsDestroyed as number)
        : undefined,
    regionsConquered:
      typeof obj.regionsConquered === 'number'
        ? (obj.regionsConquered as number)
        : undefined,
    numberOfClaims:
      typeof obj.numberOfClaims === 'number'
        ? (obj.numberOfClaims as number)
        : undefined,
    publishedFlagsCount:
      typeof obj.publishedFlagsCount === 'number'
        ? (obj.publishedFlagsCount as number)
        : undefined,
    favorites:
      typeof obj.favorites === 'number' ? (obj.favorites as number) : undefined,
    authoredPresetTitles:
      Object.keys(authoredTitles).length > 0 ? authoredTitles : undefined,
    presetSelectionFrequency:
      Object.keys(selectionFreq).length > 0 ? selectionFreq : undefined,
    countrySelectionFrequency:
      Object.keys(countryFreq).length > 0 ? countryFreq : undefined,
    turnedOffTutorial:
      typeof obj.turnedOffTutorial === 'boolean'
        ? (obj.turnedOffTutorial as boolean)
        : undefined,
    extras: stripKnownFields(obj, [
      'uid', 'userUID', 'displayName', 'photoURL', 'profileDescription',
      'region', 'createdAt', 'lastActive', 'lifetimeSpendingUSD',
      'roundsPlayed', 'gamesStarted', 'totalTokensIn', 'totalTokensOut',
      'nationsDestroyed', 'regionsConquered', 'numberOfClaims',
      'publishedFlagsCount', 'favorites', 'turnedOffTutorial',
    ]),
  };
}

function shapeBasemapMetadata(obj: Record<string, unknown>): BasemapMetadata {
  return {
    id: String((obj.id as string) || (obj.uid as string) || ''),
    name: (obj.name as string) || undefined,
    tileUrl: (obj.tileUrl as string) || undefined,
    attribution: (obj.attribution as string) || undefined,
    extras: {},
  };
}

function stripKnownFields(
  obj: Record<string, unknown>,
  known: string[],
): Record<string, unknown> {
  const set = new Set(known);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!set.has(k)) out[k] = v;
  return out;
}

function finalizeStatus(
  status: EditorCaptureStatus,
  start: number,
  submenusClicked: number,
  reason: EditorFailureReason,
  error: string,
  targetDir?: string,
): EditorCaptureStatus {
  status.captured = false;
  status.reason = reason;
  status.error = error;
  status.durationMs = Date.now() - start;
  status.submenusClicked = submenusClicked;
  status.finalUrl = undefined;
  // Best-effort: write editor_status.json so callers can read failure
  // provenance without re-running the scrape.
  try {
    if (targetDir) writeEditorStatus(targetDir, status);
  } catch {
    // ignore — best-effort
  }
  return status;
}

/**
 * Derive a `MapFeatures` payload from a captured `EditorData`.
 *
 * The editor view is a strict superset of the in-game state:
 *   - `editor.polities[i].regionsOwned[]` → inverts to `regionOwnership`
 *   - `editor.mapFeatures[]` → categorised into cities / landmarks /
 *     battalions by the same tag-based logic Play Now uses
 *   - `editor.polities[]` → `Polity[]` (keyed by polity name)
 *
 * No game start is required — the data is already on disk in
 * `editor.json`. Used by `capturePreset` to write `features.json` when
 * `--with-editor` succeeds, replacing the Play Now capture path.
 */
export function extractFeaturesFromEditorData(editor: EditorData): MapFeatures {
  // 1) Polities. Editor polities are keyed by name; we surface that as
  //    both `id` and `name` so downstream consumers that key by either
  //    continue to work.
  const polities: Polity[] = editor.polities.map((pd) => ({
    id: pd.name,
    name: pd.name,
    ...(pd.color ? { color: pd.color } : {}),
    ...(pd.additionalNames && pd.additionalNames.length > 0
      ? { leaderName: pd.additionalNames[0] }
      : {}),
  }));

  // 2) Cities / landmarks / battalions. Editor stores features as an
  //    array; Play Now stores them as a record keyed by 8-char ID.
  //    Re-shape to the record shape the categoriser expects.
  const rawMapFeatures: Record<string, unknown> = {};
  for (const f of editor.mapFeatures) {
    if (!f.id) continue;
    rawMapFeatures[f.id] = f.raw ?? f;
  }
  const { cities, landmarks, battalions } = categorizeMapFeatures(
    rawMapFeatures,
    polities,
  );

  // 3) Region ownership — invert each polity's regionsOwned[].
  //    See `deriveRegionOwnership` for the last-wins policy.
  const regionOwnership = deriveRegionOwnership(polities, editor.polities);

  return {
    polities,
    cities,
    landmarks,
    battalions,
    regionOwnership,
    capturedAt: new Date().toISOString(),
  };
}
