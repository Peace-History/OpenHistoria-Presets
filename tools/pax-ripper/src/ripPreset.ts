// ripPreset — capture ONE preset end-to-end into the per-(paxID, version)
// directory tree.
//
// Pax's data model is two-phase:
//   - Initial page:  title, description, paxID, version, landing image,
//                    "Play Now" button. No geometry URL, no cover, no
//                    author, no game state.
//   - After Play Now → country → Play As Country → Start Game:
//                    full preset data + game state populates
//                    (geometry URL, author UID, cover image, polities,
//                    cities, region ownership, etc.)
//
// So the flow is:
//   1. Navigate
//   2. Fast DOM scrape (5 fields we can get immediately)
//   3. Start the game (Play Now → country → Play As Country → Start Game)
//   4. Re-extract: now look for the full data in __NEXT_DATA__ / RSC
//   5. Merge the full data into preset.json (geometry URL, cover, author)
//   6. Download geometry, cover, landing
//   7. Write manifest
//
// Idempotent: if manifest.json exists in the target dir and force=false,
// returns { status: 'skipped' } and does nothing.

import { BrowserContext, Page, Response as PlaywrightResponse } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import {
  PAX_PRESETS_URL,
  PAX_MAP_EDITOR_URL,
  TIMEOUTS,
  INTER_PRESET_DELAY_MS,
  extFromContentType,
} from './config.js';
import {
  CaptureFileSet,
  CaptureManifest,
  FeaturesStatus,
  PresetData,
} from './types.js';
import {
  extractFullFromPage,
  extractInitialFromPage,
} from './extractFromNextData.js';
import { writeFeaturesStatus, writeManifest } from './manifest.js';
import { tryCaptureFeatures } from './ripFeatures.js';
import {
  fetchPresetFromFirestore,
  firestoreDocToPresetFields,
} from './firestoreExtract.js';
import { getSignedInUserUID } from './auth.js';

const P = '[ripPreset]';

/**
 * Try to dismiss any open modals, popups, or overlays.
 * Best-effort — ignores failures.
 */
async function dismissPopups(page: Page): Promise<void> {
  try {
    // Click any close/dismiss buttons
    const closeSelectors = [
      'button[aria-label="Close"]',
      'button:has-text("Close")',
      'button:has-text("Cancel")',
      'button:has-text("Dismiss")',
      '[data-testid="close"]',
      '.modal-close',
    ];
    for (const sel of closeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    // Press Escape as a fallback
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  } catch {
    // ignore
  }
}

/**
 * Tiny discriminated exception so the orchestration in `capturePreset`
 * can branch on `err.code` without string-matching on messages. Codes:
 *   - 'copy_blocked'        — Copy button missing/disabled or popup
 *                             didn't appear within the budget
 *   - 'firestore_no_author' — simplePresets doc lacks authorUID (rare;
 *                             Pax never sets this on real presets)
 */
export class RipError extends Error {
  constructor(
    public code: 'copy_blocked' | 'firestore_no_author' | string,
    message: string,
  ) {
    super(message);
    this.name = 'RipError';
  }
}

export interface CopyFlowResult {
  /** The Pax ID the editor scrape should run against. Equals the original
   *  when the user is the owner; equals the new copy's id otherwise. */
  effectivePaxID: string;
  /** The version to scrape. 1 for fresh copies; the original version for owners. */
  effectiveVersion: number;
  /** 'original' when no Copy was needed; 'copy:<paxID>' when we copied. */
  editorSource: 'original' | `copy:${string}`;
  /** True if we created a new copy on this run; false if owner or reused. */
  copyCreated: boolean;
  /** Override URL for the editor scrape. The rich editor data lives at
   *  `/tools/map-editor?presetUID={id}`, NOT at `/presets/{id}?versionID=1`
   *  (which is the public detail page and never exposes editor state).
   *  Always set. */
  mapEditorURL: string;
  /** Author UID of the ORIGINAL preset (from simplePresets/{id}.authorUID).
   *  Threaded into captureEditorState so it can fetch the author's public
   *  profile from userPublicProfiles/{authorUID}. */
  authorUID?: string;
}

export interface CapturePresetOptions {
  paxID: string;
  /** Base output dir (e.g. /…/Peace-History/presets/) */
  outputBaseDir: string;
  /** Overwrite existing manifest.json (default: false) */
  force?: boolean;
  /** Run the map-features capture step (default: true) */
  includeFeatures?: boolean;
  /** Run the editor-view capture step (default: false — opt-in only) */
  withEditor?: boolean;
  /** Skip Play Now entirely, even when editor capture fails. Default: false. */
  noGame?: boolean;
  /** Force Play Now even when editor capture succeeds. Default: false. */
  withGame?: boolean;
  /** Reuse a copy recorded in a prior manifest instead of creating a new one. */
  reuseCopy?: boolean;
  /** Path to cookies.json (for the editor capture; supports HttpOnly) */
  cookiesFile?: string;
}

export type CaptureStatus =
  | 'captured'
  | 'skipped'
  | 'failed_no_page_data'
  | 'failed_navigation'
  | 'failed_download'
  | 'failed_write';

export interface CapturePresetResult {
  paxID: string;
  version?: number;
  status: CaptureStatus;
  error?: string;
  /** Full path to presets/{paxID}/{version}/ */
  outputDir?: string;
  manifest?: CaptureManifest;
}

/**
 * Ensure we have a preset we can scrape the editor view of.
 *
 *   1. Reads `simplePresets/{paxID}` via Firestore REST to get `authorUID`.
 *   2. Decodes the signed-in user's UID from the `__session` cookie.
 *   3. If signed-in user is the author → return `{editorSource: 'original'}`.
 *   4. Otherwise (and if `opts.reuseCopy` + manifest's prior copy still
 *      exists) → return `{editorSource: 'copy:<priorId>'}`.
 *   5. Otherwise → navigate to `/presets/{paxID}`, click Copy, click
 *      "Create a Copy", poll URL for `/presets/{newId}?versionID=1`,
 *      return `{editorSource: 'copy:<newId>'}`.
 *
 * Throws `RipError('copy_blocked')` on any UI-level failure (Copy
 * missing/disabled/popup never appears/redirect never happens).
 */
export async function ensureCopyOfPreset(
  page: Page,
  context: BrowserContext,
  originalPaxID: string,
  originalVersion: number,
  targetDir: string,
  opts: { reuseCopy?: boolean },
): Promise<CopyFlowResult> {
  // 1) Author UID from the public Firestore REST doc
  const fsDoc = await fetchPresetFromFirestore(page, originalPaxID);
  const authorUID = fsDoc?.raw.authorUID as string | undefined;
  if (!authorUID) {
    throw new RipError(
      'firestore_no_author',
      `simplePresets/${originalPaxID} has no authorUID — cannot determine ownership`,
    );
  }

  // 2) Decode signed-in user UID
  const signedInUID = await getSignedInUserUID(context);

  // 3) Owner path — skip Copy entirely
  if (signedInUID && signedInUID === authorUID) {
    console.log(
      chalk.gray(
        `${P}   owner detected (${authorUID}) — skipping Copy flow, scraping original`,
      ),
    );
    return {
      effectivePaxID: originalPaxID,
      effectiveVersion: originalVersion,
      editorSource: 'original',
      copyCreated: false,
      mapEditorURL: `${PAX_MAP_EDITOR_URL}?presetUID=${originalPaxID}`,
      authorUID,
    };
  }

  // 4) Reuse-copy path: if --reuse-copy and the manifest already records
  //    a working copy that still exists in Firestore, reuse it.
  if (opts.reuseCopy) {
    const manifestFile = path.join(targetDir, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const existing = JSON.parse(
          fs.readFileSync(manifestFile, 'utf-8'),
        ) as CaptureManifest;
        const prior = (existing.editorSource ?? '').match(/^copy:(.+)$/)?.[1];
        if (prior) {
          const stillExists = await fetchPresetFromFirestore(page, prior);
          if (stillExists) {
            console.log(
              chalk.gray(
                `${P}   reusing prior copy ${prior} (manifest.editorSource)`,
              ),
            );
            return {
              effectivePaxID: prior,
              effectiveVersion: 1,
              editorSource: `copy:${prior}`,
              copyCreated: false,
              mapEditorURL: `${PAX_MAP_EDITOR_URL}?presetUID=${prior}`,
              authorUID,
            };
          }
          console.log(
            chalk.gray(
              `${P}   manifest's prior copy ${prior} no longer exists — creating new`,
            ),
          );
        }
      } catch (e) {
        console.log(
          chalk.yellow(
            `${P}   could not read manifest for reuse: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
      }
    }
  }

  // 5) Non-owner copy flow. Navigate to /presets/{paxID}, click Copy, click
  //    "Create a Copy", poll URL for the new preset redirect.
  console.log(
    chalk.gray(
      `${P}   not owner of ${originalPaxID} (signedIn=${signedInUID ?? '?'}, author=${authorUID}) — creating copy`,
    ),
  );
  await page.goto(`${PAX_PRESETS_URL}/${originalPaxID}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageLoad,
  });

  // 5a) Click the Copy button. Selectors: prefer the action-bar variant
  //     (sibling of "Play Now"). Fall back to any button containing "Copy".
  const copyBtn = page.locator('button:has-text("Copy")').first();
  const visible = await copyBtn
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    throw new RipError(
      'copy_blocked',
      `No Copy button on /presets/${originalPaxID} (preset may be copy-protected or hidden)`,
    );
  }
  const enabled = await copyBtn.isEnabled({ timeout: 2_000 }).catch(() => false);
  if (!enabled) {
    throw new RipError(
      'copy_blocked',
      `Copy button on /presets/${originalPaxID} is disabled`,
    );
  }
  await copyBtn.click();
  console.log(chalk.gray(`${P}   clicked Copy button`));

  // 5b) Wait for the in-window popup with "Create a Copy" button.
  const createCopy = page.locator('button:has-text("Create a Copy")').first();
  const popupAppeared = await createCopy
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!popupAppeared) {
    // Try to dismiss any open modal/popup before throwing
    await dismissPopups(page);
    throw new RipError(
      'copy_blocked',
      `"Create a Copy" popup never appeared after clicking Copy`,
    );
  }
  await createCopy.click();
  console.log(chalk.gray(`${P}   clicked Create a Copy — waiting for redirect`));

  // 5c) Poll URL for the redirect to /presets/{newId}?versionID=1.
  const copyUrlRe = /\/presets\/([A-Za-z0-9_-]+)\?versionID=(\d+)/;
  const pollStart = Date.now();
  let newPaxID = '';
  while (Date.now() - pollStart < 30_000) {
    const m = copyUrlRe.exec(page.url());
    if (m && m[1] !== originalPaxID) {
      newPaxID = m[1];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!newPaxID) {
    // Try to dismiss any open modal/popup before throwing
    await dismissPopups(page);
    throw new RipError(
      'copy_blocked',
      `No /presets/<new>?versionID=1 redirect within 30s (still on ${page.url()})`,
    );
  }

  console.log(
    chalk.green(`${P}   ✓ copy created: ${newPaxID}`),
  );
  return {
    effectivePaxID: newPaxID,
    effectiveVersion: 1,
    editorSource: `copy:${newPaxID}`,
    copyCreated: true,
    mapEditorURL: `${PAX_MAP_EDITOR_URL}?presetUID=${newPaxID}`,
    authorUID,
  };
}

export async function capturePreset(
  page: Page,
  opts: CapturePresetOptions,
): Promise<CapturePresetResult> {
  const { paxID, outputBaseDir } = opts;
  const force = opts.force ?? false;
  const includeFeatures = opts.includeFeatures ?? true;
  const url = `${PAX_PRESETS_URL}/${paxID}`;

  console.log(chalk.gray(`${P} capturing ${paxID} (${url})`));

  // 1) Navigate
  let response: PlaywrightResponse | null;
  try {
    response = await page.goto(url, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageLoad,
    });
    console.log(
      chalk.gray(`${P}   navigation committed (HTTP ${response?.status() ?? '?'})`),
    );
    await page
      .waitForLoadState('domcontentloaded', { timeout: 10_000 })
      .then(() => console.log(chalk.gray(`${P}   DOM ready`)))
      .catch(() =>
        console.log(chalk.gray(`${P}   DOM not ready after 10s — proceeding`)),
      );
  } catch (e) {
    return {
      paxID,
      status: 'failed_navigation',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (!response || !response.ok()) {
    return {
      paxID,
      status: 'failed_navigation',
      error: `HTTP ${response?.status() ?? 'no-response'} for ${url}`,
    };
  }

  // 2) Fast initial DOM scrape (title, description, paxID, version, landing).
  //    No waiting for __NEXT_DATA__ — we know Pax doesn't expose the
  //    full preset data until the game is started.
  const initial = await extractInitialFromPage(page, paxID);
  if (!initial) {
    return {
      paxID,
      status: 'failed_no_page_data',
      error: 'could not extract even basic fields from the initial render',
    };
  }
  console.log(
    chalk.gray(
      `${P}   initial: title="${initial.title}" v${initial.publishedVersionID}`,
    ),
  );

  const version = initial.publishedVersionID;
  const targetDir = path.join(outputBaseDir, paxID, String(version));

  // 3) Idempotency check
  const manifestFile = path.join(targetDir, 'manifest.json');
  if (!force && fs.existsSync(manifestFile)) {
    console.log(
      chalk.gray(`${P}   skip (manifest exists) — use --force to overwrite`),
    );
    return { paxID, version, status: 'skipped', outputDir: targetDir };
  }

  // Wipe contents if --force
  if (force && fs.existsSync(targetDir)) {
    for (const f of fs.readdirSync(targetDir)) {
      try {
        fs.rmSync(path.join(targetDir, f), { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Persist initial raw state for debugging
  const apiResponsesDir = path.join(targetDir, 'api_responses');
  fs.mkdirSync(apiResponsesDir, { recursive: true });
  fs.writeFileSync(
    path.join(apiResponsesDir, 'page_initial.json'),
    JSON.stringify(initial.rawSource ?? {}, null, 2),
  );

  // Build the initial PresetData. Will be merged with the post-game
  // extraction below.
  const initialData: PresetData = {
    id: paxID,
    publishedVersionID: version,
    title: initial.title,
    description: initial.description,
    landingImageURL: initial.landingImageURL,
    // These get filled in after game start
    geometryURL: undefined,
    coverImageURL: undefined,
    authorUID: undefined,
    tags: [],
    roundsPlayed: 0,
    gamesStarted: 0,
    slug: undefined,
    extras: { captureSource: 'initial_dom' },
  };

  // 2b) Try the Firestore REST API for the rich preset document. The
  //     page already subscribes to this via the Listen channel, so
  //     we have a valid session for it. The REST endpoint returns
  //     a clean 695 KB JSON with coverImageURL, landingImageURL,
  //     description, authorUID, roundsPlayed, gamesStarted,
  //     versionDescriptions, presetCategory, etc. — way more than
  //     the initial DOM scrape.
  let data: PresetData = initialData;
  const fsResult = await fetchPresetFromFirestore(page, paxID).catch(
    (e) => {
      console.log(
        chalk.gray(
          `${P}   Firestore REST failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      return null;
    },
  );
  if (fsResult) {
    const fields = firestoreDocToPresetFields(
      fsResult.raw,
      paxID,
      version,
    );
    data = {
      ...initialData,
      ...fields,
      // Don't let Firestore overwrite the page title (Falls back to draft)
      title: initialData.title || fields.title,
      description: initialData.description || fields.description,
      landingImageURL: initialData.landingImageURL ?? fields.landingImageURL,
      id: paxID,
      publishedVersionID: version,
      extras: {
        ...initialData.extras,
        ...fields.extras,
        captureSource: 'initial_dom + firestore_rest',
        firestoreDb: fsResult.db,
        firestoreDocBytes: fsResult.bytes,
      },
    };
    // If Firestore gave us a different version, prefer it (the URL
    // ?versionID= param is the user's selection, but the document's
    // publishedVersionID is the source of truth)
    if (fields.publishedVersionID && fields.publishedVersionID !== version) {
      console.log(
        chalk.gray(
          `${P}   Firestore says version ${fields.publishedVersionID} ` +
            `(URL had ${version}) — using Firestore`,
        ),
      );
    }
  }

  // Write the initial preset.json (we'll re-write it with the merged
  // data after the game starts)
  const files: CaptureFileSet = {};
  const presetFile = path.join(targetDir, 'preset.json');
  try {
    fs.writeFileSync(presetFile, JSON.stringify(data, null, 2));
    files.preset = 'preset.json';
  } catch (e) {
    return {
      paxID,
      version,
      status: 'failed_write',
      error: `write preset.json: ${e instanceof Error ? e.message : String(e)}`,
      outputDir: targetDir,
    };
  }

  // 4) Editor-view capture (opt-in via --with-editor). When enabled, this
  //    runs BEFORE Play Now: if it succeeds, we derive `features.json`
  //    from the editor data and skip Play Now entirely (since editor data
  //    is a strict superset of the in-game state). If it fails, Play Now
  //    runs as a fallback (unless --no-game).
  //
  //    Sub-steps:
  //      4a) ensureCopyOfPreset — owner check + Copy flow if needed
  //      4b) captureEditorState on the effective preset
  //      4c) extractFeaturesFromEditorData → features.json (on success)
  let copyFlow: CopyFlowResult | null = null;
  let editorCaptured = false;
  let editorDerivedFeatures = false;
  if (opts.withEditor) {
    try {
      copyFlow = await ensureCopyOfPreset(
        page,
        page.context() as BrowserContext,
        paxID,
        version,
        targetDir,
        { reuseCopy: opts.reuseCopy ?? false },
      );
      const { captureEditorState, extractFeaturesFromEditorData } =
        await import('./ripEditor.js');
      const editorStatus = await captureEditorState(
        page,
        copyFlow.effectivePaxID,
        copyFlow.effectiveVersion,
        targetDir,
        {
          cookiesFile: opts.cookiesFile,
          originalPreset: paxID,
          originalVersion: version,
          // The freshly-made copy's doc is owner-only on the Firestore
          // REST API (even though the in-app navigation succeeded).
          // Skip the REST auth check — the page navigation itself proves
          // auth works via Pax's Firebase ID token.
          skipAuthCheck: copyFlow.copyCreated,
          // The rich editor data lives at /tools/map-editor?presetUID={id},
          // NOT at /presets/{id}?versionID=N (which is the public detail
          // page and never exposes editor state).
          mapEditorURL: copyFlow.mapEditorURL,
          // Author UID of the original preset — lets the editor capture
          // fetch userPublicProfiles/{authorUID} for the author profile.
          authorUID: copyFlow.authorUID,
        },
      );
      if (editorStatus.captured) {
        files.editor = 'editor.json';
        editorCaptured = true;
        console.log(
          chalk.green(
            `${P}   editor.json captured: ${editorStatus.submenusClicked} submenus clicked, ` +
              `${(editorStatus.durationMs / 1000).toFixed(1)}s`,
          ),
        );
        // Derive features.json from editor data. Skip Play Now when this
        // succeeds (unless --with-game forces both).
        try {
          const editorDataPath = path.join(targetDir, 'editor.json');
          const editorData = JSON.parse(
            fs.readFileSync(editorDataPath, 'utf-8'),
          );
          const features = extractFeaturesFromEditorData(editorData);
          fs.writeFileSync(
            path.join(targetDir, 'features.json'),
            JSON.stringify(features, null, 2),
          );
          files.features = 'features.json';
          editorDerivedFeatures = true;
          console.log(
            chalk.green(
              `${P}   features.json derived from editor: ` +
                `${features.polities.length} polities, ${features.cities.length} cities, ` +
                `${features.landmarks.length} landmarks, ${features.battalions.length} battalions, ` +
                `${Object.keys(features.regionOwnership).length} region-owner mappings`,
            ),
          );
        } catch (e) {
          console.log(
            chalk.yellow(
              `${P}   could not derive features.json from editor: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          );
        }
        // Scrape extras from the editor DOM (display symbols, flag URLs, polity images)
        try {
          const { ripExtras } = await import('./ripExtras.js');
          const extras = await ripExtras(
            page,
            copyFlow.effectivePaxID,
            copyFlow.effectiveVersion,
            targetDir,
          );
          console.log(
            chalk.green(
              `${P}   extras scraped: ${Object.keys(extras.displaySymbols).length} symbols, ` +
              `${Object.keys(extras.flagURLs).length} flags, ` +
              `${Object.keys(extras.polityImages).length} polity images`,
            ),
          );
        } catch (e) {
          console.log(
            chalk.yellow(
              `${P}   extras scrape failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        }
      } else {
        console.log(
          chalk.yellow(
            `${P}   editor capture skipped: ${editorStatus.reason ?? 'unknown'}` +
              (editorStatus.error ? ` — ${editorStatus.error}` : ''),
          ),
        );
      }
    } catch (e) {
      console.log(
        chalk.yellow(
          `${P}   editor capture errored: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  // 5) Play Now flow — runs unless we derived features from editor and
  //    the user didn't force --with-game. Skipped entirely if --no-game.
  //    The existing tryCaptureFeatures handles country select + start.
  let featuresStatus: FeaturesStatus;
  const skipPlayNow = (editorDerivedFeatures && !opts.withGame) || opts.noGame;
  if (!skipPlayNow && includeFeatures) {
    featuresStatus = await tryCaptureFeatures(page, targetDir);
    writeFeaturesStatus(targetDir, featuresStatus);
    if (featuresStatus.success) files.features = 'features.json';
  } else if (editorDerivedFeatures) {
    featuresStatus = {
      attempted: true,
      success: true,
      reason: 'derived_from_editor',
    };
    writeFeaturesStatus(targetDir, featuresStatus);
  } else if (opts.noGame) {
    featuresStatus = {
      attempted: false,
      success: false,
      reason: 'no_game_flag',
    };
    writeFeaturesStatus(targetDir, featuresStatus);
  } else {
    featuresStatus = {
      attempted: false,
      success: false,
      reason: 'skipped_via_flag',
    };
    writeFeaturesStatus(targetDir, featuresStatus);
  }

  // 5) After the game is started (or skipped), re-extract the page.
  //    Now __NEXT_DATA__ / RSC may have populated with the full preset
  //    data — geometry URL, cover image, author UID, tags, etc.
  let mergedData: PresetData = initialData;
  try {
    const full = await extractFullFromPage(page, paxID, initial);
    if (full) {
      fs.writeFileSync(
        path.join(apiResponsesDir, 'page_after_game.json'),
        JSON.stringify(full.rawSource ?? {}, null, 2),
      );
      // Merge: keep initial title/description/landing, add everything else
      mergedData = {
        ...initialData,
        ...full.data,
        title: initialData.title || full.data.title,
        description: initialData.description || full.data.description,
        landingImageURL:
          initialData.landingImageURL ?? full.data.landingImageURL,
        id: paxID,
        publishedVersionID: version,
        extras: {
          ...initialData.extras,
          ...(full.data.extras ?? {}),
          captureSource: 'initial_dom + full_after_game',
        },
      };
      fs.writeFileSync(presetFile, JSON.stringify(mergedData, null, 2));
      console.log(
        chalk.gray(
          `${P}   enriched: geometry=${!!mergedData.geometryURL} ` +
            `cover=${!!mergedData.coverImageURL} author=${!!mergedData.authorUID}`,
        ),
      );
    } else {
      console.log(
        chalk.yellow(
          `${P}   full extraction after game returned nothing — keeping initial data only`,
        ),
      );
    }
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}   full extraction after game errored: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  }

  // 6) Download geometry, cover, landing
  const downloads: Array<Promise<void>> = [];

  // 6a) Geometry from editor's mapGeometryDocumentID (preferred). The
  //     public Firestore REST doesn't expose geometryURL directly, but
  //     the editor's initialPresetData.mapGeometryDocumentID gives us
  //     the R2 object key like "r2:map-geometry/{authorUID}/{presetId}_{ver}_{epoch}".
  //     The CDN URL is `https://map-geometry.paxhistoria.co/{path-after-r2:}.json`.
  if (!mergedData.geometryURL) {
    const editorJsonPath = path.join(targetDir, 'editor.json');
    if (fs.existsSync(editorJsonPath)) {
      try {
        const editor = JSON.parse(fs.readFileSync(editorJsonPath, 'utf-8'));
        const mapDocID = (editor?.advancedSettings?.raw?.mapGeometryDocumentID ??
          editor?.extras?.initialPresetData?.mapGeometryDocumentID ??
          null) as string | null;
        if (mapDocID && typeof mapDocID === 'string') {
          const cdnPath = mapDocID.replace(/^r2:/, '');
          const cdnURL = `https://map-geometry.paxhistoria.co/${cdnPath}.json`;
          console.log(
            chalk.gray(`${P}   geometry CDN: ${cdnURL}`),
          );
          downloads.push(
            downloadTo(page, cdnURL, path.join(targetDir, 'geometry.json')).then(
              (filename) => {
                if (filename) {
                  files.geometry = filename;
                  mergedData.geometryURL = cdnURL;
                }
              },
            ),
          );
        }
      } catch (e) {
        console.log(
          chalk.yellow(
            `${P}   could not derive geometry CDN URL from editor.json: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
      }
    }
  }

  if (mergedData.geometryURL) {
    downloads.push(
      downloadTo(
        page,
        mergedData.geometryURL,
        path.join(targetDir, 'geometry.json'),
      ).then((filename) => {
        if (filename) files.geometry = filename;
      }),
    );
  }

  if (mergedData.coverImageURL) {
    downloads.push(
      downloadBinary(page, mergedData.coverImageURL, targetDir, 'cover').then(
        (filename) => {
          if (filename) files.cover = filename;
        },
      ),
    );
  }

  if (mergedData.landingImageURL) {
    downloads.push(
      downloadBinary(
        page,
        mergedData.landingImageURL,
        targetDir,
        'landing',
      ).then((filename) => {
        if (filename) files.landing = filename;
      }),
    );
  }

  const downloadResults = await Promise.allSettled(downloads);
  const downloadFailures = downloadResults
    .filter((r) => r.status === 'rejected')
    .map((r) => (r as PromiseRejectedResult).reason);
  if (downloadFailures.length > 0) {
    console.log(
      chalk.yellow(
        `${P}   ${downloadFailures.length} download(s) failed: ${downloadFailures
          .map((f) => (f instanceof Error ? f.message : String(f)))
          .join('; ')}`,
      ),
    );
  }

  // 7) Manifest
  const manifest: CaptureManifest = {
    paxID,
    version,
    sourceURL: url,
    capturedAt: new Date().toISOString(),
    files,
    featuresStatus,
    editorSource: copyFlow?.editorSource,
  };
  writeManifest(targetDir, manifest);

  console.log(
    chalk.green(
      `${P}   ✓ ${paxID} v${version} → ${path.relative(process.cwd(), targetDir)}/ ` +
        `(files: ${Object.keys(files).join(', ') || 'none'})`,
    ),
  );

  return {
    paxID,
    version,
    status: 'captured',
    outputDir: targetDir,
    manifest,
  };
}

// ---- helpers ----

/** Download a JSON-suspect URL and save to `dest`. Returns basename or null on failure. */
async function downloadTo(
  page: Page,
  url: string,
  dest: string,
): Promise<string | null> {
  try {
    const res = await page.context().request.get(url, {
      timeout: TIMEOUTS.geometryResponse,
    });
    if (!res.ok()) {
      console.log(
        chalk.yellow(`${P}     download ${url} → HTTP ${res.status()}`),
      );
      return null;
    }
    const body = await res.body();
    fs.writeFileSync(dest, body);
    return path.basename(dest);
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}     download ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return null;
  }
}

/** Download a binary (image) and save as `<base>.<ext>` based on content-type / URL. */
async function downloadBinary(
  page: Page,
  url: string,
  destDir: string,
  base: string,
): Promise<string | null> {
  try {
    const res = await page.context().request.get(url, {
      timeout: TIMEOUTS.geometryResponse,
    });
    if (!res.ok()) {
      console.log(
        chalk.yellow(`${P}     download ${url} → HTTP ${res.status()}`),
      );
      return null;
    }
    const body = await res.body();
    const ct = res.headers()['content-type'] ?? '';
    const ext = extFromContentType(ct, url);
    const filename = `${base}${ext}`;
    fs.writeFileSync(path.join(destDir, filename), body);
    return filename;
  } catch (e) {
    console.log(
      chalk.yellow(
        `${P}     download ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return null;
  }
}

/** Sleep helper for inter-preset rate limit. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const DEFAULT_INTER_PRESET_DELAY_MS = INTER_PRESET_DELAY_MS;
