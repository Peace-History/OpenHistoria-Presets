# Dump-All Capture Failures Fix Plan

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** `bun run tools/preset-exporter/scripts/dump-all.ts` produces FAIL rows in its summary for several UIDs. Two observed failure shapes (with the same downstream cause):

- **Editor-walk death (`oXpjRtLOk8mKevWqId3D` / "A New 'Old' World" v340):** Editor pass wrote `editor.json` (2.8 MB) but the React-state walk produced **0 polities, 0 map features, no `advancedSettings`, `extras: {}`** — `mapGeometryDocumentID` is missing. `ripExtras` then logs `evaluate: Target crashed` three times. No `geometry.json` is written. dump-all: `FAIL : transform: geometry.json missing in /home/john/Projects/OpenHistoria-Presets/out/cache/oXpjRtLOk8mKevWqId3D/340`.
- **Copy-popup timeout (`GQvQSkuDWJ04XwX0vFbC` / "Planetos Complete (ASOIAF)" v9):** Non-owner Copy flow clicks the Copy button, then a hard-coded 10s wait on `button:has-text("Create a Copy")` times out → `RipError('copy_blocked')`. Editor pass is skipped entirely. Play Now fallback runs but the resulting capture has no `editor.json`, no `mapGeometryDocumentID`, and no `geometry.json`.

A **control case** (`W9bUMvfQW68sa9FNION5` / "Star Wars: Live Another Life" v9) in the same dump-all run PASSES: editor walk found 31 polities and 180 map features; `extras.initialPresetData.mapGeometryDocumentID` is present (via `advancedSettings.raw.mapGeometryDocumentID`); geometry CDN URL resolves; `geometry.json` is downloaded.

**Trigger:** Any non-owner Pax preset whose editor capture does not yield a fully-populated `editor.json` (either Copy-flow race or a Chromium tab crash mid-walk). dump-all's transform requires `geometry.json` (capture.ts:17 throws) but cannot derive it without `editor.json` content.

**Root Cause:** Geometry download at `tools/pax-ripper/src/ripPreset.ts:749-784` is gated EXCLUSIVELY on `editor.json` containing `mapGeometryDocumentID` (under `editor.advancedSettings.raw` or `editor.extras.initialPresetData`). When the editor pass fails (Copy popup timeout, editor walk dies, browser tab crashes), `editor.json` is missing or its `mapGeometryDocumentID` field is empty → geometry CDN URL is unknown → `geometry.json` is not written → `loadCaptureFromDir` throws. Three contributing factors:

1. **Structural coupling** (primary, ripPreset.ts:749): geometry URL is derivable only from `editor.json`. The legacy `--geometry` ripper used response interception of `map-geometry.paxhistoria.co` requests, which works without editor auth — but the new flow dropped that path.
2. **No Copy-popup retry** (ripPreset.ts:296-308): a single 10s `waitFor({state:'visible'})` on `button:has-text("Create a Copy")` with no retry, no longer timeout, no diagnostic (the `.catch(() => false)` discards the original Playwright error).
3. **Too-permissive resume gate** (`tools/preset-exporter/src/capture.ts:59-74`): `latestCaptureDirLooksComplete` only checks `manifest.json` + non-empty `preset.json`. A capture that errored in the editor pass still produces both files, so `--resume` reuses a known-broken capture and re-fails on transform.

## Investigation

### Trace of the editor-walk death (failure mode #1)

`tools/pax-ripper/src/ripEditor.ts:266-348` (captureEditorState) → `runCapture` (lines 350-594). The flow is:

1. Navigate to `/tools/map-editor?presetUID={effective}` (line 363).
2. Wait for "Loading preset data…" to clear (line 383, 30s budget).
3. **Initial React-state walk** (lines 400-428, `waitForEditorState(page, 30_000, 1_500)`). Polls `findEditorStateNode` for the editor React fiber state node. The success log is "editor-state node found after N attempt(s)".
4. **Submenu click loop** (lines 431-475, 60s budget). Clicks each submenu, re-walks, re-merges state.
5. **Augment with public collections** (lines 489-538): `fetchCollectionFromFirestore('promptStore')`, `templateHelpers`, `userPublicProfiles/{authorUID}`.
6. **Persist** (lines 540-572): write `editor_state_raw.json` + `editor.json`.
7. **Status** (lines 574-593).

For the failing UID, the editor walk succeeded enough to write `editor.json` (2.8 MB), but the schema extraction in `ripEditor.ts:790-870` produced an empty result. Inspecting the actual capture:

```
$ bun -e '...'   # against out/cache/oXpjRtLOk8mKevWqId3D/340/editor.json
top keys: [polities, recommendedPolities, mapFeatures, regionMap, aiPrompts,
           templateHelpers, regionEditorState, regionCountsByType,
           extras, promptStoreRaw, authorProfile]
polities count: 0
extras: {}                          # empty object, not the expected object-with-initialPresetData
advancedSettings: undefined         # missing entirely
extras.initialPresetData?.mapGeometryDocumentID: <missing>
```

Compare to the success case `BYp5Mv7IaFXAjoO8jGLK/89/editor.json`:

```
extras: { initialPresetData: { mapGeometryDocumentID: 'r2:map-geometry/8kxr9m…', ... } }
advancedSettings: { raw: { mapGeometryDocumentID: 'r2:map-geometry/8kxr9m…', ... } }
polities count: 276
```

`tools/pax-ripper/src/ripEditor.ts:802-849` populates `data.advancedSettings` from `ipd.mapGeometryDocumentID` (line 845). In the failing capture, `ipd` itself was either missing or did not contain the field — the React-state walk returned an incomplete state node.

After ripEditor.ts writes the empty editor.json, `ripPreset.ts:594-598` calls `extractFeaturesFromEditorData` (ripEditor.ts:1438-1476), which reads `editor.polities` and `editor.mapFeatures` and produces an empty features.json:

```json
{ "polities": [], "cities": [], "landmarks": [], "battalions": [],
  "regionOwnership": {}, "capturedAt": "..." }
```

Then `ripExtras` (ripPreset.ts:619-640 → ripExtras.ts:34-80) runs. Each of its three sub-scrapes uses `page.evaluate(...)` against the same page. Once the Playwright target is dead (or the page navigated away), all three throw `Error: Target crashed`. The outer try/catch at ripExtras.ts:50-68 catches each error and logs yellow:

```
[ripExtras] Display symbol scrape failed: evaluate: Target crashed
[ripExtras] Flag URL scrape failed: evaluate: Target crashed
[ripExtras] Polity image scrape failed: evaluate: Target crashed
```

These three messages are the SAME single crash, not three separate failures. `extras.json` is written empty.

Then `extractFullFromPage` (ripPreset.ts:695, extractFromNextData.ts:610-684) waits 15s for `/api/preset*` response or `__NEXT_DATA__` poll; both time out and return null:

```
[extractPresetFromPage] extractFull: no API / no __NEXT_DATA__ after 15000ms — returning null
```

Then `ripPreset.ts:749-784` tries to derive the geometry CDN URL from `editor.json`:

```ts
const mapDocID = editor?.advancedSettings?.raw?.mapGeometryDocumentID
              ?? editor?.extras?.initialPresetData?.mapGeometryDocumentID;
if (!mapDocID) {
  console.log(chalk.yellow(`${P}   no mapGeometryDocumentID in editor.json — skipping geometry download`));
  // no geometry.json written
}
```

In the failing case, both paths return undefined → no geometry.json.

### Trace of the Copy-popup timeout (failure mode #2)

`tools/pax-ripper/src/ripPreset.ts:179-345` (`ensureCopyOfPreset`). For a non-owner preset:

1. Click the Copy button (line 286, 10s wait).
2. Wait for `button:has-text("Create a Copy")` to be visible (line 299, 10s hard-coded timeout).
3. Click the popup button.
4. Poll for URL change to `/presets/{newId}?versionID=1` (line 314-331, 30s budget).

Step 2 (ripPreset.ts:296-301):

```ts
const createCopy = page.locator('button:has-text("Create a Copy")').first();
const popupAppeared = await createCopy
  .waitFor({ state: 'visible', timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
```

The `.catch(() => false)` discards the original Playwright timeout error, making postmortem debugging impossible.

When the popup never appears, `ensureCopyOfPreset` calls `dismissPopups(page)` (best-effort cleanup) and throws `RipError('copy_blocked', '"Create a Copy" popup never appeared after clicking Copy')`.

The throw propagates to `capturePreset`'s outer try/catch at ripPreset.ts:649-655:

```ts
} catch (e) {
  console.log(chalk.yellow(`${P}   editor capture errored: ${msg}`));
}
```

Editor pass is short-circuited. Play Now runs as fallback (step 4) — but no `editor.json` is written, so geometry.json can't be derived either.

### The "Target crashed" symptom (both failure modes)

`evaluate: Target crashed` is not in the source code; it is a Playwright runtime error emitted by `page.evaluate()` when the Chromium tab/process has crashed or been killed. Once the target is dead, EVERY subsequent `page.evaluate` against the same page throws the same error. The three ripExtras scrape functions each call `page.evaluate` once at the top (count query) and again per item (50 iterations max). The "three failures" log is one crash surfacing three times because ripExtras.ts:50-68 catches per-scrape, not per-evaluate.

The likely sequence for failure mode #1:

- Editor walk's React-state walk completed enough to write editor.json but with `ipd.mapGeometryDocumentID` missing.
- After writing editor.json, the page may have navigated to a different state (e.g. redirected by Pax, or closed by the React app).
- ripExtras's first `page.evaluate` throws "Target crashed"; the page is dead.
- Subsequent ripExtras calls fail identically.
- extractFull's `__NEXT_DATA__` polling throws the same error (silently swallowed by extractFromNextData.ts:677-680 → returns null).

For failure mode #2, the Copy popup may never have appeared because:

- The Copy click POST is asynchronous; Pax's UI takes >10s to render the confirmation modal (the timeout was empirically calibrated, but real-world Pax latency varies).
- The Copy operation was silently rate-limited or rejected by Pax's backend, and the UI did not display the expected popup at all.
- A preset-specific UI variant rendered the popup with different markup.

The .catch(() => false) discards the underlying error so we cannot distinguish.

### dump-all pipeline integration

`tools/preset-exporter/scripts/dump-all.ts:171-186` always invokes pax-ripper with `--with-editor` so geometry.json can be derived. `dump-all.ts:204-211` treats `proc.exited !== 0` as FAIL, but pax-ripper exits 0 even when editor capture errors (the catch at ripPreset.ts:649-655 swallows it). So an editor-failed capture:

1. Exits 0 (looks like success).
2. Writes manifest.json + preset.json (passes `latestCaptureDirLooksComplete` gate).
3. Does NOT write geometry.json.
4. dump-all's transform (dump-all.ts:215-230) calls `loadCaptureFromDir`, which throws `Error("geometry.json missing in ${captureDir}")` (capture.ts:17).
5. dump-all prints `FAIL : transform: geometry.json missing in ...`.

For `--resume`, `captureCacheLooksComplete` (dump-all.ts:162-164) only checks `manifest.json` + non-empty `preset.json`. A broken capture from a previous run will pass the gate, the transform will re-run and re-fail. With `--resume --force`, the capture is re-attempted from scratch but the resume gate is bypassed entirely.

### Three observable failure modes collapse to one root cause

| Mode | Upstream cause | Downstream symptom | FAIL message |
|---|---|---|---|
| 1 (oXpjRtLOk8mKevWqId3D) | Editor walk returned empty `ipd`; `editor.json` lacks `mapGeometryDocumentID` | No geometry.json | "geometry.json missing" |
| 2 (GQvQSkuDWJ04XwX0vFbC) | Copy popup timeout; `editor.json` not written at all | No geometry.json | "geometry.json missing" |
| (legacy "extras empty") | Same as mode 1, but `editor.json` was complete enough that geometry.json was downloaded; transform PASSES | n/a (passes) | n/a |

Modes 1 and 2 are different UPSTREAM failures producing the SAME downstream FAIL. Fixing either in isolation reduces some failures but not all. The robust fix addresses the shared downstream symptom: when `editor.json` does not yield a geometry URL, the capture should still produce a usable bundle (or fail loudly enough that dump-all does not silently re-attempt a known-broken capture).

## Behavior Contract

**Given:** A Pax UID for a preset whose editor capture cannot complete (Copy popup times out, editor walk dies, browser tab crashes, or `editor.json` is missing `mapGeometryDocumentID`).

**When:** `bun run tools/preset-exporter/scripts/dump-all.ts` invokes pax-ripper for that UID and the resulting capture lacks `geometry.json` (because geometry derivation requires editor.json content that is absent or incomplete).

**Currently (bug):**

- pax-ripper exits 0; manifest.json is written; the capture appears complete.
- `loadCaptureFromDir` throws `Error: geometry.json missing in <dir>` (capture.ts:17).
- dump-all prints `FAIL : transform: geometry.json missing in /home/john/Projects/OpenHistoria-Presets/out/cache/<UID>/<version>`.
- With `--resume`, dump-all reuses the broken capture (resume gate only checks manifest+preset), re-runs transform, re-fails. The user cannot tell whether a re-run will succeed without manual inspection.
- Three failure modes (Copy popup timeout, editor-walk death with empty ipd, and "Target crashed" mid-ripExtras) all collapse to the same FAIL message; the user has no way to distinguish them.

**Expected (fix):**

- When editor capture fails in any way (Copy popup timeout, walk death, browser crash, missing `mapGeometryDocumentID`), dump-all either:
  - **Re-runs the capture** automatically (no broken state lingers across `--resume` runs), OR
  - **Reports the specific upstream cause** in the FAIL row (e.g., `FAIL : copy popup timed out — no editor.json`, `FAIL : editor walk incomplete — editor.json has 0 polities and no mapGeometryDocumentID`, etc.), so the user can decide whether to retry manually.
- `--resume` never reuses a capture that lacks `geometry.json` OR has an editor.json with `polities.length === 0` AND `mapGeometryDocumentID === undefined`.
- A Copy-popup timeout is retried at least once with a longer wait before being reported as a hard failure.
- dump-all inter-UID delay respects pax-ripper's `INTER_PRESET_DELAY_MS` (1s) so back-to-back non-owner captures do not race Pax's Copy-flow state.

**Anti-regression:**

- `diffAgainstHubBundles` on a successfully-captured UID still passes all 12 checks (no regression in the happy path).
- `bun test tools/preset-exporter/tests/` still passes.
- A capture that legitimately produces an empty features.json (e.g., a real Pax preset with no game-data yet, per the README troubleshooting entry) is still considered valid — the fix must NOT reject captures on the basis of empty features alone. The reject criterion is the absence of `mapGeometryDocumentID` in a populated editor.json, not features emptiness.
- pax-ripper's existing tests in `tools/pax-ripper/` continue to pass.
- A preset whose Copy flow succeeds normally (like `W9bUMvfQW68sa9FNION5`) captures and exports in a single iteration without retries.

## Fix Approach

**Chosen:** Add an "incomplete-capture detector" to the resume gate + retry Copy-popup once with a longer timeout + propagate upstream-failure cause through the capture status. Three small, surgical changes at the existing boundary points — no refactoring, no new modules.

**Why:** All three observable failure modes converge on "editor capture did not produce a usable geometry URL". The structural fix would be to add a fallback geometry-derivation path (e.g., re-introducing response interception of `map-geometry.paxhistoria.co` requests, like the legacy `--geometry` flow) — but that requires a deeper change to ripPreset.ts and Playwright lifecycle, and the public preset page may or may not emit geometry requests without editor auth. The surgical fix addresses the user's immediate need: stop silently re-using broken captures, give them actionable failure messages, and retry the most common transient cause (Copy popup timing).

Rejected alternative (broader, deferred): Add a public-page geometry-response interception fallback in ripPreset.ts step 6. This would solve more cases (Capture Failure Mode #1 specifically) but requires verifying whether the public preset page emits geometry requests without auth — out of scope for a quick-mode bugfix. Note it as a follow-up if the surgical fix leaves too many UIDs un-exported.

**Files:**

- Modify: `tools/pax-ripper/src/ripPreset.ts` (Copy-popup retry with longer timeout + capture-status enrichment).
- Modify: `tools/preset-exporter/src/capture.ts` (tighten `latestCaptureDirLooksComplete` to require geometry.json or mark the capture as failed-incomplete; `loadCaptureFromDir` accepts the new flag).
- Modify: `tools/preset-exporter/src/types.ts` (add `incomplete?: boolean` to `PaxCapture` if needed; or use `CaptureManifest` to carry the failure reason).
- Modify: `tools/preset-exporter/scripts/dump-all.ts` (inter-UID delay honoring `INTER_PRESET_DELAY_MS`; surface specific upstream failure reason in FAIL row).
- Modify: `tools/pax-ripper/src/index.ts` (capture-status exit code: non-zero when editor sub-pass failed but capture continued, so dump-all can distinguish "captured-with-warnings" from "captured-clean").
- Test: `tools/preset-exporter/tests/capture.test.ts` (RED for tightened gate); new test in `tools/preset-exporter/tests/dump-all-filter.test.ts` or a new file for the failure-reason propagation.

**Strategy:**

1. **Tighten resume gate.** `latestCaptureDirLooksComplete` (capture.ts:59-74) returns `undefined` when `geometry.json` is absent. This makes `--resume` re-capture broken UIDs. Simple one-line gate change; no risk to the happy path (the success case writes geometry.json).

2. **Retry Copy popup once.** In `ripPreset.ts:296-308`, wrap the popup wait in a 2-attempt loop: first attempt at 10s; on timeout, re-click Copy button and wait 20s. If still missing, throw with the original Playwright error preserved in the message (replace `.catch(() => false)` with `.catch((e) => { throw new Error(`popup never appeared: ${e.message}`); })`). This addresses the most common transient cause for non-owner presets.

3. **Surface upstream failure reason in FAIL row.** Add an optional `incomplete` field to the `CaptureManifest` written at `ripPreset.ts:836-845`. When the editor sub-pass threw, set `manifest.incomplete = 'editor_capture_failed'` (or a more specific reason). `loadCaptureFromDir` reads this and either: (a) throws with the specific reason included (so dump-all's FAIL row shows it), or (b) returns a `PaxCapture` with `incomplete` set and lets dump-all decide.

4. **Inter-UID delay in dump-all.** Honor pax-ripper's `INTER_PRESET_DELAY_MS` (currently 1s, from `tools/pax-ripper/src/config.ts`) between UIDs in `dump-all.ts:286-308`. Prevents back-to-back Copy-flow races.

5. **Non-zero exit when editor failed.** `tools/pax-ripper/src/index.ts:264` currently logs `Done. status=captured` and exits 0 for any capture that reached step 7. Change to exit non-zero when `manifest.incomplete` is set, so dump-all can detect "captured-but-broken" before transform runs (avoids even attempting loadCaptureFromDir on a known-broken capture).

**Tests:** Tightened gate test goes in `capture.test.ts` (RED: existing tests still pass with a real geometry.json; new test: cache dir with manifest+preset but no geometry returns undefined from `latestCaptureDirLooksComplete`). Copy-popup retry test goes in a new `ripPreset.test.ts` or extends `ripPreset.ts` with a small injectable selector helper (avoid mocking Playwright — instead, factor the popup wait into a `waitForCreateCopyPopup(page, timeoutMs)` pure function and unit-test it).

**Defense-in-depth:**

- Layer 1 (entry): pax-ripper's Copy-popup retry at step 2.
- Layer 2 (capture): manifest.incomplete flag at step 7.
- Layer 3 (orchestrator): `latestCaptureDirLooksComplete` gate at dump-all resume check.
- Layer 4 (orchestrator): inter-UID delay in dump-all loop.
- Layer 5 (exit): non-zero exit when manifest.incomplete is set.

## Tasks

- [x] Task 1: Write Reproducing Tests (RED)
- [x] Task 2: Implement Fix at Root Cause
- [x] Task 3: Quality Gate

### Task 1: Write Reproducing Tests (RED)

**Objective:** Encode each Behavior Contract clause as a failing test before any fix code lands.

**Files:**

- Test: `tools/preset-exporter/tests/capture.test.ts` — add a RED test for the tightened resume gate.
- Test: `tools/preset-exporter/tests/capture.test.ts` — add a RED test for `loadCaptureFromDir` propagating the new `incomplete` flag (or throwing with the specific reason).
- Test: new `tools/pax-ripper/src/ripPreset.test.ts` (or extend existing) — RED for the popup-retry helper.

**Key Decisions / Notes:**

- Reuse the existing `capture.test.ts` test class for the resume-gate tests (parsimony rule: one test class per production class, not per fix).
- For Copy-popup retry: factor the popup wait into a small testable function `waitForCreateCopyPopup(page, timeoutMs)` returning `Promise<boolean>`. Inject a fake page or use a real Playwright page in a headless fixture — prefer the latter for fidelity. If a real-page test is too heavy, parameterize on a timeout parameter and unit-test the timeout/retry logic with a mock page that resolves after the second attempt.
- RED tests must run against the CURRENT (buggy) implementation and fail. Verify each test fails for the right reason (not syntax).

**Definition of Done:**

- [ ] `latestCaptureDirLooksComplete` test fails: with manifest+preset but no geometry.json, current code returns the dir; new test asserts it returns undefined.
- [ ] `loadCaptureFromDir` test fails: when manifest contains `incomplete` field, current code ignores it; new test asserts the failure reason propagates (either via throw with reason or via the returned PaxCapture's incomplete field).
- [ ] Copy-popup retry test fails: current single-attempt logic throws after 10s; new test asserts two attempts are made with extended timeout.
- [ ] Verify: `bun test tools/preset-exporter/tests/capture.test.ts` — new tests FAIL, existing tests PASS.

### Task 2: Implement Fix at Root Cause

**Objective:** Make each RED test pass with the minimum change at the documented root-cause site.

**Files:**

- Modify: `tools/preset-exporter/src/capture.ts:59-74` — tighten `latestCaptureDirLooksComplete`.
- Modify: `tools/preset-exporter/src/capture.ts:9-35` — propagate `incomplete` field (or throw with reason).
- Modify: `tools/pax-ripper/src/ripPreset.ts:296-308` — Copy-popup retry + preserved error message.
- Modify: `tools/pax-ripper/src/ripPreset.ts:836-845` — set `manifest.incomplete` when editor sub-pass threw.
- Modify: `tools/preset-exporter/scripts/dump-all.ts:286-308` — inter-UID delay.
- Modify: `tools/pax-ripper/src/index.ts:264` — non-zero exit when `manifest.incomplete` is set.
- Modify: `tools/pax-ripper/src/types.ts` — add `incomplete?: string` to `CaptureManifest`.

**Key Decisions / Notes:**

- Tighten resume gate: add `if (!existsSync(join(best.dir, "geometry.json"))) return undefined;` after the preset.json check.
- Copy-popup retry: factor `waitForCreateCopyPopup(page)` as a pure helper, retry with 20s on first 10s timeout.
- Surface failure reason: when the editor try/catch at ripPreset.ts:649-655 fires, set `editorFailureReason = e.message` and write it to `manifest.incomplete` before `writeManifest` at step 7.
- dump-all: import `INTER_PRESET_DELAY_MS` from pax-ripper's config; `await sleep(INTER_PRESET_DELAY_MS)` between UIDs.
- Non-zero exit: in `tools/pax-ripper/src/index.ts` after `writeRunSummary`, check `manifest.incomplete` and `process.exit(2)` if set (exit 2 = "captured-but-incomplete", distinct from 0=ok, 1=failed-navigation, 3=failed-write).

**Definition of Done:**

- [ ] All Task 1 RED tests now PASS.
- [ ] Existing tests in `tools/preset-exporter/tests/` and `tools/pax-ripper/` still pass.
- [ ] Diff touches the named root-cause files only (no opportunistic cleanup).
- [ ] Verify: `bun test tools/preset-exporter/tests/capture.test.ts` — all green.

### Task 3: Quality Gate

**Objective:** Lint + type check + full test suite green.

**Files:**

- No production files expected; update this plan's progress and status.

**Key Decisions / Notes:**

- Run `bun run typecheck` (the project-defined alias for `tsc --noEmit` on both packages).
- Run `bun test` from the repo root (the project's test runner).
- Run a small live dump-all check: `bun run tools/preset-exporter/scripts/dump-all.ts --limit 1` against the first UID in `IDs` to confirm the happy path still produces PASS.

**Definition of Done:**

- [ ] `bun run typecheck` clean.
- [ ] `bun test tools/preset-exporter/tests/` all green.
- [ ] `bun test tools/pax-ripper/` (if tests exist) all green.
- [ ] `bun run tools/preset-exporter/scripts/dump-all.ts --limit 1` produces PASS (or SKIP if already exported).
- [ ] Performance audit: no expensive uncached work added to dump-all's UID loop (inter-UID delay is `setTimeout`, not a polling loop).
- [ ] Verify: `bun run typecheck && bun test tools/preset-exporter/tests/`.

## Out of Scope

- Adding a public-page geometry-response interception fallback in ripPreset.ts (broader fix; deferred).
- Per-UID HTML/UI verification in Open-Historia (out of scope for dump-all).
- Replacing the `--with-editor` dependency for non-owner presets entirely.
- Parallelizing pax-ripper captures (Pax rate limits are unknown; deferred).
- Refactoring the editor walk (`runCapture`) to be more resilient to page navigation (large change; deferred).