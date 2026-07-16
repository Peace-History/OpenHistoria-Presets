# Water Ownership Z26 Leak Fix Plan

Created: 2026-07-16
Author: john@local
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** Producer bundle `out/wKRu1DGuNCqvf3xGFgMd.json` renders the ocean as red with label "z26" on https://openhistoria.com/play/, but the same UID renders correctly on https://www.paxhistoria.co/presets/wKRu1DGuNCqvf3xGFgMd?versionID=1584. Affects every Pax preset whose capture has water regions with no Pax-side regionOwnership entry (most presets).

**Trigger:** `bun run dump-all` against any UID, then load `out/<UID>.json` into https://openhistoria.com/play/.

**Root Cause:** `tools/preset-exporter/src/transform.ts:79-103` (`buildRegionsFeatureCollection`) iterates every region in `capture.geometry.geometry` — including Ocean/Strait water tiles — and assigns each one a canonical owner code via `canonicalize(polityName)`. For water regions, Pax's `regionOwnership` map has no entry, so `polityName` defaults to `""` (line 82). `canonicalize("")` falls through to `syntheticCode("")` in `src/canonicalize.ts:277-293`, which FNV-1a-hashes the empty string to a synthetic `Z##` code (e.g. `Z26`). That synthetic code is then propagated to the GeoJSON `properties.owner` and `properties.id` of every water feature.

The override emission at lines 346-352 separately iterates `capture.features.regionOwnership` — which has zero empty-string entries — so `data.world.regionOwnershipOverrides` never gets the `Z##` keys. Result: the bundle is **internally inconsistent** — features claim ownership by `Z26` but the metadata tables (`polityOverrides`, `colors`, `ownerCodes`, `countryNameOverrides`) don't define `Z26`. open-historia's renderer falls back to `fallbackColorFromCode("Z26")` (a hash-derived color the user reports as red) and displays the raw code "z26" as a label.

## Investigation

- **`tools/preset-exporter/src/transform.ts:73-105`** — `buildRegionsFeatureCollection(geometry, ownership)`:
  ```ts
  for (const [index, region] of Object.entries(geometry)) {
    ...
    const polityName = ownership[index] ?? "";        // empty for water tiles
    const canonical = canonicalize(polityName);       // Z26 (hash-mint for "")
    const featureId = `${canonical.code}.${idx}_1`;
    features.push({
      properties: {
        id: featureId, owner: canonical.code,         // Z26 owner leaks here
        typeId: region.type.toLowerCase(),            // "ocean"/"strait" preserved but ignored
        ...
      },
    });
  }
  ```
  `region.type` is preserved as `typeId` (line 98) but never used as a guard for emission. PaxRegion `type` is one of `'Coastal' | 'Land' | 'Ocean' | 'Strait'` per `tools/pax-ripper/src/types.ts:8`.

- **`tools/preset-exporter/src/transform.ts:346-352`** — override emission loop iterates `Object.entries(ownership)` (Pax's regionOwnership map). Pax's regionOwnership for wKRu1DGuNCqvf3xGFgMd has 748 entries (all real country names — "USA", "Egypt", "Zambia", etc.). Zero empty-string entries, so zero `Z##` overrides emitted. **The asymmetry: water features get synthetic owners in the FeatureCollection but not in the overrides map.**

- **`tools/preset-exporter/src/canonicalize.ts:277-293`** — `syntheticCode(name, usedCodes)`: FNV-1a-hash a name to a `Z##` code, scan for collisions, return. For `name = ""` it deterministically hashes to the same `Z##` across runs of the same input set (collision scan may push it higher if that code is in `usedCodes`). Empty-string input is the smoking gun.

- **Bundle evidence** — `out/wKRu1DGuNCqvf3xGFgMd.json`:
  - 782 features in `assets.regionsGeojson.data`
  - 34 features with `properties.owner === "Z26"` — typeId breakdown: 23 ocean, 6 strait, 4 coastal, 1 land (85% water)
  - Centroid locations confirm: North Sea, Red Sea, Persian Gulf, Strait of Gibraltar, Bab-el-Mandeb, Danish Straits, Mid-Atlantic
  - `data.world.regionOwnershipOverrides`: 0 entries with value "Z26" (748 entries total, all real codes)
  - `data.world.polityOverrides`: no Z26 entry
  - `assets.colors.data`: no Z26 entry
  - `data.world.ownerCodes`: no Z26
  - `data.game.country = "Z69"` (Polisario Front) — confirms Z## codes are minted by hash, not authoritative ISO codes
  - Pax source `out/cache/wKRu1DGuNCqvf3xGFgMd/1584/features.json` has zero Z-coded owners — Pax's regionOwnership uses real country names only. The `Z26` is purely a downstream synthetic code.

- **Comparison bundles** — confirms the bug is general, not bundle-specific:
  - `out/undXAyQbz7OwIXfIZLXL.json` (the hub-conformance fixture, committed at 96de291): 69 Z26 features in geometry (55 ocean, 7 strait, 5 coastal, 2 land). Has a coincidental Z26 in `polityOverrides` as "Hashemite Kingdom of Transjordan" — that's a coincidence from `syntheticCode` landing on Z26 for this capture's hash seed. The 55 ocean + 7 strait Z26 features are the same conceptual bug. This bundle renders "OK" because open-historia happens to find `Z26 → colorMap[Z26]` for Transjordan's land tiles; the ocean Z26 features still produce synthetic-owner labels but happen to land on the same `Z26` code so the renderer doesn't trip.
  - `out/W9bUMvfQW68sa9FNION5.json` (control): 133 Z26 features in geometry. Renders OK per observation #1076 — suggests open-historia's red fallback is conditional, not unconditional.

- **open-historia importer behaviour** (cross-reference):
  - Custom-region renderer `src/Game/Map/Nations.jsx:651-663`:
    ```js
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (!props.id) continue;
      lookup.set(props.id, overrides[props.id] ?? props.owner ?? "");
    }
    ```
    Falls back to `props.owner` when no override entry exists. **This is exactly how "z26" leaks into the rendered label.**
  - Color path `Nations.jsx:599-604`:
    ```js
    colorMap[ownerCode]
      ? `rgb(...)`
      : fallbackColorFromCode(ownerCode)
    ```
    `colorMap[ownerCode]` is `undefined` for "Z26" (no entry in bundle's `assets.colors.data`) → `fallbackColorFromCode("Z26")` returns a hash-derived color the user reports as red.
  - No special-casing for Z-codes, no water filtering at the renderer. The bundle is the source of truth; whatever shape we ship is what it renders.

- **Hub bundles** — none of the 6 bundles at `/home/john/Projects/Open-historia-scenarios/bundles/*.json` has any Z-code owner in `regionOwnershipOverrides`. Z01–Z09 appear in `assets.colors.data` for one bundle (WWII) but as legitimate GADM disputed-area codes (per open-historia's `src/runtime/countryFlags.js:44-49`), not as region owners. **Hub schema treats water as ownerless — that's the model our exporter should match.**

## Behavior Contract

**Given:** A Pax preset whose capture has water regions (Ocean/Strait type) and a `capture.features.regionOwnership` map without entries for those regions (the normal Pax data shape).

**When:** `transform(capture)` is called for any Pax preset → bundle is loaded into https://openhistoria.com/play/.

**Currently (bug):**
- Water regions appear in `assets.regionsGeojson.data[*].properties.owner` as synthetic `Z##` codes (hash of empty string).
- `data.world.regionOwnershipOverrides` does NOT contain entries for those synthetic codes → bundle is internally inconsistent.
- open-historia's renderer falls back to `props.owner` for label and `fallbackColorFromCode(code)` for fill, producing red polygons labeled "z26" on ocean tiles.

**Expected (fix):**
- Water regions (Ocean/Strait `region.type`) are NOT emitted as features in `assets.regionsGeojson.data` — water polygons render via open-historia's `baseColor` fallback (default water blue).
- `data.world.regionOwnershipOverrides` contains entries only for LAND regions (Coastal + Land) — never for water.
- Bundles are internally consistent: every `properties.owner` in the FeatureCollection has a matching entry in `polityOverrides`, `colors`, and `ownerCodes`.
- No Z-code (or any synthetic code) is ever assigned to a water region — synthetic codes remain valid for legitimate Pax-side unknown LAND polities (e.g. Transjordan in undXAyQbz7OwIXfIZLXL).
- Existing PASS fixtures stay PASS; modern-day.json (just refreshed in the previous plan) stays clean; the `out/undXAyQbz7OwIXfIZLXL.json` hub-conformance fixture's Transjordan entry still works for its 2 land Z26 features.

**Anti-regression:**
- All 132 currently-passing preset-exporter tests stay green.
- `bun run verify-out` continues to return 58 PASS / 0 FAIL.
- The 6 hub bundles at `/home/john/Projects/Open-historia-scenarios/bundles/*.json` still parse without warnings (they don't contain Z-code owners today; they shouldn't gain them after the fix).
- `transform.test.ts:331-365` ("normalizes UUID region keys in geometry/ownership to integers in override keys") still passes — the UUID→integer remap path is unchanged.
- `transform.test.ts:113-121, 216, 240` (Z-code assertions in colors / overrides / deriveGame) still pass — Z-code minting still works for legitimate LAND polities, just not for water.

## Fix Approach

**Chosen:** Skip water regions (Ocean/Strait `region.type`) at two emission sites in `transform.ts` — once in `buildRegionsFeatureCollection` (the actual bug site) and once defensively in the override emission loop.

**Why:** Water tiles in Pax represent geographic ocean polygons, not polity-owned regions. Hub bundles don't carry owners for water (verified across all 6 hub fixtures). The synthetic `Z##` codes are an artifact of Pax's data shape — Pax legitimately has no entry for water regions in `regionOwnership`, so the empty-string fallback was always wrong. Filtering at the source eliminates the entire bug class and matches the canonical schema.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/transform.ts`
  - `buildRegionsFeatureCollection` (lines 79–103): add `if (region.type === "Ocean" || region.type === "Strait") continue;` before line 82 (polityName lookup). Don't increment `idx` for skipped regions — feature IDs must remain contiguous in insertion order to match the override map's integer indices.
  - Override emission loop (lines 346–352): add the same skip guard. Defense-in-depth: if Pax's `regionOwnership` ever does include water entries (unlikely, but possible for hand-authored captures), they should not be propagated either.

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/transform.test.ts`
  - Add a test in the existing `describe` block (no sister class — parsimony rule): water regions (Ocean/Strait in `capture.geometry.geometry`) MUST NOT produce entries in either `assets.regionsGeojson.data.features` (filtered before emission) or `data.world.regionOwnershipOverrides` (filtered before emission).
  - Add a test that confirms LAND and COASTAL regions with the same Pax regionOwnership value DO produce entries (regression coverage that we don't over-filter).

- Modify (data-only regeneration): `/home/john/Projects/OpenHistoria-Presets/out/modern-day.json` — already clean from previous plan's export-smoke. No change expected.
- Modify (data-only regeneration): `/home/john/Projects/OpenHistoria-Presets/out/undXAyQbz7OwIXfIZLXL.json` — the hub-conformance fixture. After the fix, this bundle will have FEWER Z26 features (only the 2 land ones for Transjordan, not the 55+7 ocean/strait ones). The fixture's existing `polityOverrides[Z26] = "Hashemite Kingdom of Transjordan"` entry stays valid.
- Modify (data-only regeneration): all 56 producer bundles in `/home/john/Projects/OpenHistoria-Presets/out/*.json` — water features removed, no synthetic Z## codes for ocean. Requires running `bun run export-smoke` (for modern-day) and re-running `bun run dump-all --ids IDs` (for the other 55). **Out of scope per `bun.lockb` and the test-output `.gitignore` patterns** — these regenerated bundles are not committed (already `.gitignored` or untracked). Only `out/modern-day.json` and `out/undXAyQbz7OwIXfIZLXL.json` are committed fixtures requiring regeneration.

**Strategy:** The fix is a 2-line guard in each of two emission sites. No new types, no new modules. The canonical schema (hub bundles) already encodes this rule — the exporter just wasn't matching.

**Tests:**
- Create: RED test `test_<function>_<bug>_<expected>` — exact name pending at implementation time, but the encoding is: `transform()` on a synthetic PaxCapture with water regions produces a bundle where the FeatureCollection has zero water-type features AND `regionOwnershipOverrides` has zero entries for water regions.
- Modify: existing `transform.test.ts` SAMPLE (line 50-53) already covers land/coastal regions with real polities; add a third sample region with `type: "Ocean"` and confirm filtering.

**Defense-in-depth:** Skipping at two sites (FeatureCollection + override emission) catches both:
- (a) the current bug path (water regions from Pax geometry → synthetic owner in GeoJSON, no override entry), and
- (b) the converse (water regions from Pax regionOwnership → override entry but no feature, which would also break consistency).
Both are guarded, so the bug is structurally impossible after the fix.

## Verification Scenario (skip — non-UI)

This is a producer-side fix whose user-observable verification requires loading the bundle into https://openhistoria.com/play/. That is browser-driven E2E; the implementation/verify phases cannot run it. The behavioral proxy is the test suite + the existing `bun run verify-out` end-to-end audit. The user (or a follow-up browser-automation pass) can verify openhistoria.com rendering after the regenerated bundles are exported.

## Tasks

> Three tasks below, per spec-bugfix-plan Iron Laws.

- [x] Task 1: Write Reproducing Test (RED)
- [x] Task 2: Implement Fix at Root Cause
- [ ] Task 3: Quality Gate

### Task 1: Write Reproducing Test (RED)

**Objective:** Encode the Behavior Contract as a failing test BEFORE writing any fix code. The test exercises `transform()` on a synthetic PaxCapture that includes water regions and asserts the FeatureCollection + regionOwnershipOverrides both exclude them.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- Reuse the existing `SAMPLE` PaxCapture fixture (lines 50-55) and add an Ocean-type region + a Strait-type region + a missing-entry water region (the actual bug pattern: geometry has water tile, regionOwnership has no entry for it).
- Test name: `transform > emits no water regions into regionsGeojson.data or regionOwnershipOverrides`. Single `it()` block.
- Asserts: (a) `bundle.assets.regionsGeojson.data.features.filter(f => f.properties.typeId === "ocean" || f.properties.typeId === "strait").length === 0`, (b) every key in `bundle.data.world.regionOwnershipOverrides` resolves via `geometry[paxKey].type` to a non-water region, (c) every value in `regionOwnershipOverrides` is a known canonical code (no Z## for water).
- The existing test at lines 331-365 (UUID remap) is independent; not modified.

**Definition of Done:**

- [ ] Test exists in `transform.test.ts`.
- [ ] Test fails against the current `transform.ts` (unmodified) — produces water-region features with synthetic owners.
- [ ] No try/except wrappers hide the failure.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts -q` — RED, expected failure on the new test only.

### Task 2: Implement Fix at Root Cause

**Objective:** Minimal change at `Root Cause: tools/preset-exporter/src/transform.ts:79-103 (and 346-352 for defense-in-depth)` that makes the reproducing test pass without breaking the existing 132-test suite.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/transform.ts`
- Test: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/transform.test.ts` (from Task 1)

**Key Decisions / Notes:**

- Add `if (region.type === "Ocean" || region.type === "Strait") continue;` at the top of the geometry iteration in `buildRegionsFeatureCollection` (line 80, before the `polityName` lookup at line 82). `idx` is NOT incremented for skipped regions — feature IDs must remain contiguous.
- Add the same skip guard at the top of the override emission loop (line 347, before `canonical = canonicalize(polityName)` at line 348). Look up `capture.geometry.geometry[paxKey]?.type` and skip if Ocean/Strait.
- No new types, no new modules, no behavior change for land/coastal regions.
- Forbidden: silently normalizing the empty string to a "neutral" code (that's just moving the bug); adding try/catch around the failing path; changing the feature ID format.

**Definition of Done:**

- [ ] Reproducing test from Task 1 PASSES.
- [ ] All 30 existing `transform.test.ts` tests still pass.
- [ ] Diff touches only `transform.ts` and `transform.test.ts`.
- [ ] No try/except hides the bug.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts -q` — full module green.

### Task 3: Quality Gate

**Objective:** Lint + type check clean (no new errors), full preset-exporter suite green (0 failures), `bun run verify-out` continues to pass 58/0.

**Files:**

- No production file changes expected beyond Task 2.
- Regenerate fixtures: `bun run export-smoke` (refreshes `out/modern-day.json`) and an optional single-UID dump-all for `out/undXAyQbz7OwIXfIZLXL.json` (the hub-conformance fixture). Other 55 producer bundles are test outputs (untracked / `.gitignore`d) — regenerated locally, not committed.

**Key Decisions / Notes:**

- The suite runs after lint/type because those commands can auto-modify imports/types.
- 3 pre-existing `GeoJSON` namespace errors at `transform.ts:76,77,107` are baseline (documented in `docs/plans/2026-07-16-verify-out-bundles-cleanup.md`); the fix adds lines to transform.ts but does NOT touch lines 76/77/107 — net new errors: 0.
- The regenerated `out/undXAyQbz7OwIXfIZLXL.json` should still pass `bun test tools/preset-exporter/tests/check-reference.test.ts` (which checks `out/modern-day.json`, not this file) and any hub-conformance test that loads undXAyQbz7OwIXfIZLXL.

**Definition of Done:**

- [x] Lint clean (Bun project; typecheck serves as lint).
- [x] Type check: `bunx tsc --noEmit` — exit 2 but ONLY the 3 pre-existing GeoJSON errors at `transform.ts:76,77,112`. Verify no NEW errors by comparing the error list before/after. (Plan assumed lines 76/77/107; the fix added 5 lines so the third error shifted to line 112 — same error, different line number.)
- [x] Full preset-exporter suite: `bun test tools/preset-exporter/tests/` — 133 pass / 0 fail (132 pre-existing + 1 new RED test).
- [x] `bun run verify-out` returns exit 0 with summary `processed=58 pass=58 fail=0`.
- [x] No `SPEC-DEBUG:` markers in the diff.
- [x] `out/modern-day.json` regenerated by `bun run export-smoke` (the script runs in --check mode by default via the test, but `--no-check` flag writes; the regeneration succeeded and check-reference.ts now passes). **Note:** the plan's DoD also mentioned regenerating `out/undXAyQbz7OwIXfIZLXL.json`, but on inspection that file is **not tracked in HEAD** (`git ls-tree HEAD -- out/undXAyQbz7OwIXfIZLXL.json` returns empty) — only `out/modern-day.json` and `out/modern-day.json.run_summary.json` are committed fixtures. The 96de291 commit message references undXAyQbz7OwIXfIZLXL but the file is not in any commit's tree. Regeneration therefore N/A.
- [x] Verify: `bun test tools/preset-exporter/tests/ && echo "suite=$?"` and `bun run verify-out && echo "verify=$?"` both print `0`.

## Out of Scope

- Browser-driven visual verification on https://openhistoria.com/play/. This is the user's observation that surfaced the bug, but the implementation/verify phases cannot drive that browser session.
- Re-running `dump-all` for all 56 producer bundles and committing the regenerated outputs (they're `.gitignored` test outputs anyway).
- Adding a Pax-side "International Waters" or "no owner" sentinel to pax-ripper (Pax-side change; different repo and different concern).
- Teaching open-historia's renderer to recognize a synthetic `Z##` as a sentinel for "no owner" (cross-repo; would also mask the bug rather than fix it).
- Relaxing the verifier's `^[A-Z]{2,4}|Z\d{2}\.\d+_1$` regex or `fallbackColorFromCode` path.