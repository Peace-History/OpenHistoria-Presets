# Basemap Capture Implementation Plan

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

> Planning in progress...

## Summary

**Goal:** Producer bundles ship a basemap so that when loaded into https://openhistoria.com/play/, the underlying map renders correctly instead of falling back to the default ocean basemap.

The Pax editor already exposes a complete basemap record on its React Fiber tree at `/tools/map-editor?presetUID={id}` — under `state.baseMapGeometry` (full region polygons + name + tags + typeDefinitions). Today `pax-ripper`'s `shapeBasemapMetadata()` discards everything except `name`, and `transform.ts` doesn't read any basemap field at all. The data is on the wire and sitting on disk in `editor_state_raw.json` for 53/77 existing caches.

We capture the geometry only (Pax's `baseMapGeometry.geometry`), plumb it through `PaxEditor`, and emit it as `assets.backgroundData` with `kind: "vector"` and `contentType: "application/geo+json"`. Open-historia's existing `useCustomBackground` vector path already renders this shape end-to-end — no consumer changes required.

## Out of Scope

- Capturing `initialPresetData.baseMap.layers[*].lightID/darkID` (Pax's tile-layer config). These are opaque Cloudflare/R2 IDs; resolving them to usable image URLs is a separate browser-side workstream that touches Cloudflare signed-URL mechanics we don't currently implement.
- Capturing `baseMapGeometry.tags` (edit log) and `typeDefinitions` (render opacity / stroke configs). Out of scope for v1 — can be a follow-up if the consumer needs them.
- Modifying open-historia runtime to accept a new `assets.basemapGeojson` field. The geometry ships via the already-supported `assets.backgroundData` (kind: "vector") path.
- Capturing basemaps from GitHub Issues via the `basemap.yml` form — that's the community-publishing surface, not the capture-from-Pax surface.
- Backfilling the 53 existing caches that already have `baseMapGeometry` in `editor_state_raw.json`. Re-capture will happen naturally as users re-run dump-all; no scheduled backfill.
- Changing the consumer's `data.basemap` (ESRI preset id) field. Pax presets don't have ESRI preset selection — they have their own internal basemap system — so this string field stays `null` for our bundles (the consumer renders the ocean default in that case, which we then overlay via `assets.backgroundData`).

## Approach

**Chosen:** preset-exporter reads `editor_state_raw.json` (or `editor.json`) from the capture cache, extracts `state.baseMapGeometry.geometry` (or `basemapMetadata.geometry` if the latter is ever populated by an upgraded shaper), plumbs it through `PaxEditor.basemapGeometry`, and encodes it as `assets.backgroundData` (kind: "vector", contentType: "application/geo+json", base64-encoded).

**Why:** `pax-ripper` is **vendored** from `/home/john/Projects/Peace-History/tools/pax-ripper/` byte-for-byte (per `tools/pax-ripper/VENDORED.md`), so we cannot freely modify its `shapeBasemapMetadata()` (ripEditor.ts:1381-1389) to widen the captured shape. The raw state dump `editor_state_raw.json` is already on disk for every cache that ran with `--with-editor` and carries the full `baseMapGeometry` subtree — including the geometry we need. preset-exporter's `loadCaptureFromDir` reads `editor.json` (the typed, shaper-processed state) but skips `editor_state_raw.json`; reading it gives us the geometry without touching vendored code.

The on-disk schema discrepancy: `editor.json.basemapMetadata` is typed as `{id, name, extras}` (shaper drops geometry), but the raw `editor_state_raw.json.state.baseMapGeometry.geometry` carries the full record. The plan reads the raw file as the source of truth and assigns the extracted value to a new `PaxEditor.basemapGeometry` field.

**Rejected:** Modifying `pax-ripper/src/ripEditor.ts:1381-1389` (`shapeBasemapMetadata`) to forward `geometry` would carry the same data but require either (a) editing vendored code (forbidden by VENDORED.md), (b) re-vendoring from a patched upstream (different workstream), or (c) accepting divergence from upstream in this vendored copy. Reading `editor_state_raw.json` directly is local to preset-exporter.

## Context for Implementer

**Vendored library constraint:** `tools/pax-ripper/` is vendored byte-for-byte from upstream `Peace-History/tools/pax-ripper/` (per `tools/pax-ripper/VENDORED.md`). We CANNOT modify its `shapeBasemapMetadata()` directly — any divergence must be documented in VENDORED.md and risks drift from upstream. The implementation reads `editor_state_raw.json` from the capture cache instead, which is already a pax-ripper-emitted file carrying the full `baseMapGeometry` subtree.

**The capture path is asymmetric:** pax-ripper (vendored) writes `editor_state_raw.json` and `editor.json` to the cache. preset-exporter's `loadCaptureFromDir` (capture.ts:9) currently reads `editor.json` but ignores `editor_state_raw.json`. The fix: add a new read of `editor_state_raw.json`, extract `state.baseMapGeometry.geometry` from it, and attach to `PaxCapture.editor.basemapGeometry`.

The basemap geometry is keyed by Pax's internal region index (integer string). Transform must re-key it: enumerate the basemap geometry's insertion order to produce a stable 0-indexed integer for `feature.id`, matching the post-game `regionsGeojson` convention so consumers can line up the two layers. Use a distinct namespace prefix (e.g. `BASEMAP_<n>`) so the basemap feature IDs don't collide with post-game region IDs in the same bundle.

`editor_state_raw.json` is not present in every cache — only caches captured with `--with-editor` carry it. Caches without it (Play Now–only captures) won't get a basemap — that's correct behavior, since Play Now exposes only the post-game overlay geometry, not the underlying basemap.

## Assumptions

- The Pax editor state's `state.baseMapGeometry.geometry` is the **only** path to the underlying map — open-historia's `useCustomBackground` (vector kind) is the right consumer entry point.
- The geometry's region keys are Pax-internal indices; transform must re-key to integers in insertion order to match the post-game geometry.
- `assets.backgroundData` with `kind: "vector"` and `contentType: "application/geo+json"` already has the consumer wired through `useCustomBackground.js` and `communityHub.jsx` — confirmed in the open-historia research. No consumer changes needed.
- The 53 caches with `baseMapMetadata` populated already contain `baseMapGeometry.geometry` in `editor_state_raw.json`; the shaper currently reads only `name` from this object. After widening, re-running any cached capture will pick up the geometry.

## File Structure

- `tools/preset-exporter/src/types.ts` (modify) — add `basemapGeometry?: Record<string, PaxRegion>` to `PaxEditor`.
- `tools/preset-exporter/src/capture.ts` (modify) — `loadCaptureFromDir` reads `api_responses/editor_state_raw.json` and extracts `state.baseMapGeometry.geometry` into `editor.basemapGeometry`.
- `tools/preset-exporter/src/transform.ts` (modify) — when `capture.editor?.basemapGeometry` is present, encode it as `assets.backgroundData` (mode: "embedded", fileName: "basemap.geojson", contentType: "application/geo+json", encoding: "base64", data: <base64>). The consumer's `useCustomBackground` infers "vector" from `contentType: "application/geo+json"` — no separate `kind` field needed on the asset (verified at open-historia/src/Game/Map/useCustomBackground.js).
- `tools/preset-exporter/tests/transform.test.ts` (modify) — RED test: PaxCapture with `editor.basemapGeometry` produces a bundle with `assets.backgroundData` populated.
- `tools/preset-exporter/tests/capture.test.ts` (modify) — RED test: `loadCaptureFromDir` populates `editor.basemapGeometry` from `editor_state_raw.json` when present, tolerates absence.
- `tools/preset-exporter/tests/transform.test.ts` (modify, line 102) — UPDATE existing test `does NOT emit backgroundData (none of the 6 hub bundles carry it)` to assert `backgroundData` is undefined when `editor.basemapGeometry` is unset (covers hub-bundles case) AND present (with embedded mode + application/geo+json contentType) when it is set.
- `tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` (modify, line 24) — UPDATE existing test `has no assets.backgroundData block` to be conditional on whether the modern-day fixture's cache contains `editor_state_raw.json` with a basemap. If absent, the old assertion holds; if present, expect `backgroundData` populated.
- `tools/preset-exporter/tests/contract.test.ts` (modify, line 55) — UPDATE existing test that asserts `assets` keys are a subset of the 6 hub bundles' union. Add `backgroundData` to the accepted asset keys when `editor.basemapGeometry` is set; old assertion remains for captures without basemap.

## Progress Tracking

- [x] Task 1: Capture basemap geometry from cache (preset-exporter capture.ts + types.ts)
- [x] Task 2: Emit as `assets.backgroundData` + update 3 existing tests
- [x] Task 3: Bundle fixture + verify-out confirmation
- [x] Task 4: Quality Gate

## Implementation Tasks

### Task 1: Capture basemap geometry from cache (preset-exporter capture.ts + types.ts)

**Objective:** Add a read of `editor_state_raw.json` from the capture cache and extract `state.baseMapGeometry.geometry` into `PaxCapture.editor.basemapGeometry`, so downstream `transform.ts` has access to the underlying basemap.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/types.ts`
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/capture.ts`
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/capture.test.ts`

**Key Decisions / Notes:**

- `PaxEditor` (preset-exporter/src/types.ts): add `basemapGeometry?: Record<string, PaxRegion>`. `PaxRegion` already exists in this file at lines 21-26.
- `loadCaptureFromDir` (capture.ts:9): after the existing `editor.json` read at line 43-45, attempt to also read `api_responses/editor_state_raw.json` from the cache. If present, parse its `state.baseMapGeometry.geometry` and assign it to `editor.basemapGeometry`. **The on-disk path is `state.baseMapGeometry.geometry` (camelCase in editor_state_raw.json), NOT `editor.json.basemapMetadata.geometry` (which is empty because pax-ripper's shaper dropped it).**
- Tolerate missing `editor_state_raw.json`: if absent (Play Now–only captures), `editor.basemapGeometry` stays undefined. Don't error.
- Tolerate missing `state.baseMapGeometry` inside the raw file: same — undefined stays undefined.
- Tolerate empty object / null / non-object: malformed-shape drift guard. The raw-file shape is untyped; cast defensively and skip if not a non-empty object.
- Use a narrow inline cast for the raw file's shape — `editor_state_raw.json` is several MB; only extract `state.baseMapGeometry.geometry` and ignore the rest.

**Definition of Done:**

- [ ] `PaxEditor.basemapGeometry?` typed field exists in preset-exporter/src/types.ts
- [ ] `loadCaptureFromDir` reads `api_responses/editor_state_raw.json` and populates `editor.basemapGeometry` when present
- [ ] `loadCaptureFromDir` tolerates missing raw file, missing `state.baseMapGeometry`, and malformed shape (empty/null/non-object) — leaves `editor.basemapGeometry` undefined without throwing
- [ ] RED test in `capture.test.ts`: stub a temp cache with `editor_state_raw.json` containing `state.baseMapGeometry.geometry` (3 regions); assert `loadCaptureFromDir` populates `editor.basemapGeometry` with 3 entries. Stub a cache without the file; assert undefined. Stub a cache with empty `state.baseMapGeometry`; assert undefined.
- [ ] Verify: `bun test tools/preset-exporter/tests/capture.test.ts -q` — green

### Task 2: Emit basemap as `assets.backgroundData` (transform.ts) + update 3 existing tests

**Objective:** In `transform.ts`, when `capture.editor?.basemapGeometry` is present, encode it as `assets.backgroundData` (mode: "embedded", contentType: "application/geo+json") so the consumer's `useCustomBackground` vector path renders it. Also update the 3 existing tests that currently hard-assert `assets.backgroundData` is absent — they will fail the moment Task 2 emits this field.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/transform.ts`
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/transform.test.ts` (add RED test + update line 102's existing assertion)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` (update line 24's existing assertion — see Notes)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/contract.test.ts` (update line 55's asset-keys-subset assertion — see Notes)

**Key Decisions / Notes:**

- Emit `assets.backgroundData` only when `capture.editor?.basemapGeometry` is present and non-empty. Omit otherwise (current behavior — no `backgroundData` field).
- Basemap GeoJSON `FeatureCollection` schema: each feature has `type: "Feature"`, `geometry: <polygon from PaxRegion.geometry>`, `properties: { id: "BASEMAP_<n>", typeId: <region.type.toLowerCase()> }`. No `owner` property (basemap is ownerless).
- Use a distinct `BASEMAP_<n>` namespace for feature IDs so they don't collide with post-game region IDs (`<CODE>.<n>_1`) in the same bundle. Consumer renders both FeatureCollections as layers.
- The basemap geometry's `polygon = parseRegionGeometry(region.geometry, index)` and `centroid = parseRegionCentroid(region.centroid)` reuse existing helpers from transform.ts. The function signatures accept a string geometry and centroid.
- Write a small inline loop for the basemap emission rather than reusing `buildRegionsFeatureCollection` — basemap features don't have owners, have distinct ID prefixes, and include water (basemap IS the underlying map, water is part of it).
- Encode: `JSON.stringify(featureCollection)` → `Buffer.from(json, "utf8").toString("base64")` → set `assets.backgroundData = { mode: "embedded", fileName: "basemap.geojson", contentType: "application/geo+json", encoding: "base64", data: <base64> }`. **No `kind` field** — the consumer's `useCustomBackground.js` infers "vector" vs "image" from `contentType` (verified at open-historia/src/Game/Map/useCustomBackground.js).
- `BundleAssets` type in transform.ts needs widening: the current union is `{ mode: "default", fileName } | { mode: "embedded", fileName, contentType, encoding, data }`. Verify the embedded arm already accepts our emit shape; if not, widen the type.

**Existing-test updates (blockers):**

- `transform.test.ts:102` — `it("does NOT emit backgroundData (none of the 6 hub bundles carry it; importer falls back to its built-in)")`: replace with a parametrized pair — when `editor.basemapGeometry` is unset (current SAMPLE), assert `assets.backgroundData` is undefined; when set, assert `mode === "embedded"`, `contentType === "application/geo+json"`.
- `regress-modern-day-fixture.test.ts:24` — `it("has no assets.backgroundData block (current transform no longer emits it)")`: make conditional on whether the modern-day fixture's cache contains `editor_state_raw.json` with basemap data. If absent (current state), the old assertion holds; if present, expect `backgroundData` populated with embedded mode + application/geo+json.
- `contract.test.ts:55` — `it("assets object keys are a subset of the 6 hub bundles' union")`: add `backgroundData` to the accepted asset keys when `editor.basemapGeometry` is set on the SAMPLE; otherwise the old assertion holds.

**Definition of Done:**

- [ ] RED test in `transform.test.ts`: PaxCapture with `editor.basemapGeometry = { "0": <PaxRegion>, "1": <PaxRegion> }` produces a bundle with `assets.backgroundData.mode === "embedded"`, `contentType === "application/geo+json"`, `encoding === "base64"`; decoded `data` is a valid GeoJSON FeatureCollection with 2 features; no `owner` property on basemap features.
- [ ] `transform.ts` emits `assets.backgroundData` when `capture.editor?.basemapGeometry` is present and non-empty, omits otherwise
- [ ] Feature IDs in basemap are `BASEMAP_<n>` (distinct from post-game `<CODE>.<n>_1`)
- [ ] `transform.test.ts:102` updated to reflect new behavior
- [ ] `regress-modern-day-fixture.test.ts:24` updated (conditional on fixture cache contents)
- [ ] `contract.test.ts:55` updated to allow `backgroundData` when basemap geometry present
- [ ] All pre-existing transform tests + 1 prior RED test (water-ownership) still pass
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts -q` — green

### Task 3: Bundle fixture + verify-out confirmation

**Objective:** Confirm `bun run verify-out` returns 58 PASS / 0 FAIL with the new bundle shape. The cold-war fixture (`tests/fixtures/cold-war/`) currently has NO `editor.json` or `editor_state_raw.json` — verified via Glob — so the smoke test against a real fixture is unreachable without first fabricating one. Document this honestly in the completion report.

**Files:**

- Test: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/check-reference.test.ts` (must pass after regen)

**Key Decisions / Notes:**

- `tests/fixtures/cold-war/` and `tests/fixtures/modern-day/` contain only `preset.json`, `geometry.json`, `features.json` — no editor files. The cold-war fixture cannot exercise the new basemap path end-to-end without fabricating an `editor_state_raw.json` fixture.
- Two viable options for this task:
  - **(A)** Fabricate a minimal `editor_state_raw.json` containing `state.baseMapGeometry.geometry` with 1-3 stub regions. Adds ~30 lines to the fixture and a small fixture-loader test. Heavier but produces an end-to-end smoke that proves the cold-war fixture path.
  - **(B)** Demote Task 3 to "unit-test-driven verification only" — rely on `transform.test.ts` and `capture.test.ts` from Tasks 1-2 for behavioral coverage. Lighter but ships without an editor-backed smoke.
- **Chosen (A)** — fabricates a minimal fixture. Provides a true end-to-end signal via `bun run export-smoke` + `bun test check-reference.test.ts`.

**Definition of Done:**

- [ ] **Task 3.1:** Add `tests/fixtures/cold-war/api_responses/editor_state_raw.json` containing `state.baseMapGeometry.geometry` with 2 stub regions (Land + Ocean). Stub geometry strings are valid GeoJSON Polygons.
- [ ] **Task 3.2:** Add a fixture-loader test in `tests/fixtures.test.ts` (or similar) that asserts the fixture's `editor_state_raw.json` parses with the expected shape (sanity check so future edits don't silently break the fixture).
- [ ] **Task 3.3:** `bun run export-smoke` regenerates `out/modern-day.json`; confirm via static analysis that `assets.backgroundData` is now populated with contentType `application/geo+json`.
- [ ] **Task 3.4:** `bun test tools/preset-exporter/tests/check-reference.test.ts` — 2/2 pass.
- [ ] **Task 3.5:** `bun run verify-out` returns exit 0, summary `processed=58 pass=58 fail=0`. Any unexpected FAIL must be triaged and resolved (the new `assets.backgroundData` field is in `HUB_ACCEPTED_ASSET_KEYS` and the soft-warn path in `verify.ts:259` accepts it — no legitimate FAIL expected).
- [ ] Verify: `bun test tools/preset-exporter/tests/ && echo "suite=$?"` and `bun run verify-out && echo "verify=$?"` both print `0`.

### Task 4: Quality Gate

**Objective:** Lint + type check + full preset-exporter suite green. `bun run verify-out` clean. No `SPEC-DEBUG:` markers in the diff.

**Files:**

- No production file changes expected beyond Tasks 1-3.

**Key Decisions / Notes:**

- The 3 pre-existing `GeoJSON` namespace errors at `transform.ts:76,77,112` (line numbers shift if Tasks 1-2 add lines; net new errors: 0) remain baseline.
- `tools/pax-ripper/tests/` does not exist (verified via `ls`); no pax-ripper suite to run. Skip the pax-ripper test step in DoD.

**Definition of Done:**

- [ ] Lint clean (Bun; typecheck serves as lint)
- [ ] `bunx tsc --noEmit` clean apart from the 3 pre-existing GeoJSON errors; no NEW errors from this plan
- [ ] Full preset-exporter suite: `bun test tools/preset-exporter/tests/` — 0 failures (134 → +N where N is the new RED tests from Tasks 1-3)
- [ ] `bun run verify-out` exit 0, summary `processed=58 pass=58 fail=0`
- [ ] No `SPEC-DEBUG:` markers in the diff
- [ ] Verify: `bun test tools/preset-exporter/tests/ && echo "suite=$?"` and `bun run verify-out && echo "verify=$?"` both print `0`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pax `baseMapGeometry.geometry` shape changes between captures (different authors / versions) | Low | Medium | Type the field as `Record<string, PaxRegion>` — same shape used in post-game `geometry.geometry`. Capture path tolerates empty/null/non-object (returns undefined, doesn't throw). Validator (verify-out) treats malformed geometry as soft-warn, not hard FAIL. Unit test asserts malformed-shape drift guard. |
| `assets.backgroundData` collides with existing in-bundle field if any hub bundle carries it | Low | Low | `HUB_ACCEPTED_ASSET_KEYS` already includes `backgroundData` (added by verify-out-bundles plan); the soft-warn path treats extras as acceptable. |
| Basemap feature ID collision with post-game region IDs in open-historia's renderer | Low | Medium | Emit basemap feature IDs as `BASEMAP_<n>` (distinct namespace from post-game `<CODE>.<n>_1`). Both are encoded into separate FeatureCollections (`assets.regionsGeojson` for post-game, `assets.backgroundData` for basemap); the consumer renders them as layered overlays via `useCustomBackground.js`, so ID collision in either map is harmless. |
| `data.basemap` (ESRI string) interaction with the new `assets.backgroundData` | Medium | Low | The two are independent paths: `data.basemap` selects an ESRI tile preset, `assets.backgroundData` overlays a custom raster/vector image. The consumer's `useCustomBackground.js` overlays `assets.backgroundData` on top of whatever `data.basemap` selects (verified at open-historia/src/Game/Map/useCustomBackground.js — the basemap variable is read independently from `world.basemap`). Bundles shipping only `assets.backgroundData` (no `data.basemap`) render with the default ocean tiles + the vector overlay; that matches the user's "underlying map" goal. |
| pax-ripper's `--with-editor` capture is opt-in; users running without it get no basemap | High | Low | Document this in README (out of scope for this plan) — same gating as the water-ownership fix already documents for editor-driven features. |
| Visual rendering at open-historia.com/play cannot be verified in implementation phase | High | Low | Unit tests + verify-out cover the producer side. A follow-up browser E2E pass is needed to confirm the consumer renders correctly; documented as a known gap in the completion report. |

## E2E Test Scenarios (skip — non-UI mostly)

The visual verification ("basemap renders correctly in https://openhistoria.com/play/") requires browser automation against the deployed consumer — the implementation/verify phases cannot drive that. The behavioral proxy is:

- Static analysis: regenerated `out/modern-day.json` (or any re-captured bundle with `editor.json.basemapMetadata.geometry`) has `assets.backgroundData` populated with a valid GeoJSON FeatureCollection.
- The unit test in transform.test.ts confirms the encode path.

A follow-up browser-driven E2E pass can confirm visual correctness after this plan lands; that is out of scope here.

## Open Questions

- **Backfill vs. natural re-capture** for the 53 existing caches with `baseMapGeometry` in `editor_state_raw.json`: do you want a one-shot backfill script + commit, or are you OK with natural re-capture on next `dump-all`? Per the user request "capture and propagation", both interpretations are reasonable. Default: defer to natural re-capture (no committed backfill) — added to Deferred Ideas below.

## Deferred Ideas

- Capture `baseMapGeometry.tags` (edit log: "Edited by Pax Historia on 8/18/2025 ...") and emit as a separate `assets.basemapTags` field or attach to `assets.backgroundData.properties`.
- Capture `baseMapGeometry.typeDefinitions` (opacity, strokeWidth, etc. per region type) and emit as `assets.backgroundData.style` or a sibling field.
- Capture `initialPresetData.baseMap.layers[*]` (tile-layer config with lightID/darkID) once a URL-resolution mechanism exists (likely a separate workstream touching Cloudflare Images / R2 signed URLs).
- Backfill the 53 existing caches that already have `baseMapGeometry` in `editor_state_raw.json` (re-capture picks it up automatically; no scheduled backfill). Confirm with user whether this is desired (see Open Questions above).
- Add a `data.basemap` ESRI string passthrough if the editor exposes such a concept in a future Pax version.
- Verify the `basemap.yml` issue template in `open-historia-scenarios/.github/ISSUE_TEMPLATE/` expects fields consistent with our `assets.backgroundData` shape (fileName, contentType, geometry). If mismatched, coordinate with the open-historia-scenarios maintainers.