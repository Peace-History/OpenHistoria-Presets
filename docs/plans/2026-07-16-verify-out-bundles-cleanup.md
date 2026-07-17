# Verify-Out-Bundles Cleanup Fix Plan

Created: 2026-07-16
Author: john@local
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

> Investigating root causes for verify-out-bundles verification failures...

## Summary

**Symptom:** After the verify-out-bundles feature landed in working tree (11 files / ~1198 lines, uncommitted), running the test suite and `bun run verify-out` surfaces:
- 2 tests fail in `tools/preset-exporter/tests/check-reference.test.ts` ("reference bundle drifted")
- `bun run verify-out` returns 57 PASS / 1 FAIL — `out/modern-day.json` is the sole failure (UUID-suffix override keys + `backgroundData` block current transform no longer emits)

**Trigger:** `bun test` and `bun run verify-out` against the current working tree.

**Root Cause:** Two distinct root causes, both small:

1. **`out/modern-day.json` is stale fixture data.** It was committed at baseline `1c05863` alongside an *earlier* version of `transform.ts` that emitted Pax geometry feature keys verbatim into `regionOwnershipOverrides` override keys. Current `transform.ts:338-352` correctly enumerates `geometry.geometry` and assigns integer indices. The committed bundle still carries 29 UUID-suffix override keys (`EGY.f2a26fbd-e22d-4a88-b667-a5a8ff0809a4_1`, etc.) and a `backgroundData` block the current transform doesn't emit. The cache for its source UID `1Alm1zD4pXpGyfWwkch1/83/` is incomplete (no `geometry.json`), so regeneration via dump-all is blocked.

2. **Inline asset-key union rebuild in `scripts/verify-out-bundles.ts:137-143`.** The orchestrator hand-rolls a per-bundle asset-key union instead of reusing the existing `unionOfKeysAt(bundles, ["assets"])` helper at `src/conformance.ts:76`. No observable bug — both paths produce the same `Set` — but it's duplication and brittle to future changes.

**Out of scope:** Re-running capture against Pax (requires auth + a working capture path); relaxing the verifier regex; replacing `diffAgainstHubBundles` in `dump-all`; CI wiring.

## Investigation

### Defect A — stale `out/modern-day.json` (covers both test failures and the verify-out FAIL)

- `tools/preset-exporter/src/transform.ts:329` reads `capture.features?.regionOwnership`.
- `tools/preset-exporter/src/transform.ts:338-344` enumerates `Object.keys(capture.geometry.geometry)` and assigns each Pax key (integer-string OR UUID) a stable insertion-order integer index in `integerIndex`.
- `tools/preset-exporter/src/transform.ts:346-352` emits `${canonical.code}.${idx}_1`, skipping `idx === undefined` entries.
- `tools/preset-exporter/tests/transform.test.ts:331-365` ("normalizes UUID region keys in geometry/ownership to integers in override keys") validates this — all 30 transform tests pass.
- `out/modern-day.json` was committed at baseline `1c05863`. It contains:
  - 559 valid integer-suffix override keys (`GRC.1_1`, `USA.4_1`, … `EGY.871_1`) on lines 187-989
  - 29 stale UUID-suffix keys on lines 991-1019 (`EGY.f2a26fbd-..._1`, `IRQ.b5519e83-..._1`, etc.)
  - A `backgroundData: { fileName: "background.json", mode: "default" }` block the current transform no longer emits
- The capture cache `out/cache/1Alm1zD4pXpGyfWwkch1/83/` has only `features.json` + `preset.json` + `manifest.json` — no `geometry.json`. dump-all cannot regenerate the bundle without a fresh capture.
- `out/cache/BYp5Mv7IaFXAjoO8jGLK/89/geometry.json` confirms Pax really does emit UUID-keyed features (564 of them) — this is why the current transform's remap path exists and why the old transform emitted Pax keys verbatim.

### Defect B — inline asset-key union rebuild

- `tools/preset-exporter/scripts/verify-out-bundles.ts:137-143`:
  ```ts
  const union = new Set<string>();
  for (const b of hubBundles) {
    const a = (b.data as Record<string, unknown>).assets;
    if (a && typeof a === "object") for (const k of Object.keys(a)) union.add(k);
  }
  setHubUnionAssetKeys(union);
  ```
  This is a hand-rolled version of `unionOfKeysAt` at `tools/preset-exporter/src/conformance.ts:76`, which `diffAgainstHubBundles` already uses to compute `assetsUnion` at line 170. The helper is generic over any key path (e.g. `["assets"]`, `["data", "world"]`).
- `setHubUnionAssetKeys` is called before the `checkOne` loop runs, so the module `Set` is populated before any `valueTypeChecks` call — order is correct. The "brittleness" claim from the original brief does not apply here.
- No observable bug — both paths produce the same `Set`. But duplication is a real smell: future changes to `unionOfKeysAt` (e.g. handling nested objects differently) will not propagate to the orchestrator.

### Pre-existing test state (corrected from onboarding summary)

The earlier observation ("92/101 preset-exporter tests pass; the 9 failures are pre-existing") overstated the rot. Empirical run shows:

| File | Pass | Fail |
|------|------|------|
| `tests/cli.test.ts` | 6 | 0 |
| `tests/check-reference.test.ts` | 0 | 2 |
| `tests/refresh-canonicalize.test.ts` | 1 | 0 |

The 2 failures are caused by `out/modern-day.json` drift (Defect A), not by pax-ripper exit-code changes. None of the other 90 preset-exporter tests fail; the "9" framing came from a stale observation that conflates the 9 new/changed tests in the verify-out feature with newly-failing tests.

## Behavior Contract

**Given:** The verify-out-bundles feature is in the working tree, uncommitted. `out/modern-day.json` is the committed canonical reference. `src/conformance.ts` and `src/verify.ts` are the source of truth for hub-union key set semantics.

**When:** Running `bun test tools/preset-exporter/tests/` or `bun run verify-out`.

**Currently (bug):**
- 2 tests in `tools/preset-exporter/tests/check-reference.test.ts` fail with "reference bundle drifted" (exit 1 from `scripts/check-reference.ts:44`).
- `bun run verify-out` reports `[46/58] modern-day.json ... FAIL: ... bad key: EGY.f2a26fbd-..._1` and exits 1.
- `scripts/verify-out-bundles.ts:137-143` rebuilds the asset-key union inline (5-line loop) when `unionOfKeysAt` from `src/conformance.ts:76` already does this generically.

**Expected (fix):**
- All tests pass — including the 2 in `check-reference.test.ts`.
- `bun run verify-out` returns 58 PASS / 0 FAIL (modern-day.json is no longer the FAIL row).
- `scripts/verify-out-bundles.ts:137-143` is a single line: `setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]))`.
- All 27 `verify-out-bundles.test.ts` tests still pass.
- All 30 `transform.test.ts` tests still pass.

**Anti-regression:**
- 6 hub bundles at `/home/john/Projects/Open-historia-scenarios/bundles/*.json` still match the verifier's keyset expectations.
- The transform's UUID→integer remap invariant (covered by `transform.test.ts:331-365`) still holds.
- `valueTypeChecks` asset-key check still reports `WARN (importer-accepted): backgroundData` for modern-day-style bundles with extra importer-accepted keys (the soft-warn path stays intact).

## Fix Approach

**Chosen:** Two-source fix — refresh the stale fixture + collapse inline duplication.

**Why:**
- **Stale fixture:** `transform.ts` is already correct; the only way to clear the failing tests and the verifier FAIL is to bring `out/modern-day.json` in line with the current transform output. Manual patch is the only available path given the incomplete capture cache.
- **Inline duplication:** the helper exists, it's generic, and the inline loop is the only place in the repo that hand-rolls this. Collapse.

**Files:**

- **Modify:** `/home/john/Projects/OpenHistoria-Presets/out/modern-day.json`
  - Remove the 29 UUID-suffix override-key entries on lines 991-1019 (the stale ones like `EGY.f2a26fbd-..._1`).
  - Remove the `assets.backgroundData` block (the current transform no longer emits it).
- **Modify:** `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/conformance.ts`
  - Add `export` to `function unionOfKeysAt` (line 76).
- **Modify:** `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/scripts/verify-out-bundles.ts`
  - Import `unionOfKeysAt` alongside the existing `loadHubBundles` import (line 22).
  - Replace lines 137-143 (5-line inline loop) with `setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]))`.

**Tests:**
- **Create:** `tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` — pins the invariants modern-day.json must hold:
  - Zero UUID-suffix override keys in `regionOwnershipOverrides` (regex `/[0-9a-f]{8}-[0-9a-f]{4}-/` on key suffix)
  - Zero `assets.backgroundData` block (transform no longer emits it)
- **Create:** `tools/preset-exporter/tests/union-of-keys-export.test.ts` — pins the export + use contract:
  - `unionOfKeysAt` is callable from `scripts/verify-out-bundles.ts` (i.e., is exported, not just module-internal)
  - `setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]))` followed by `isHubUnionAssetKey(k)` round-trips correctly

**Defense-in-depth:** The transform's UUID-remap invariant is already covered by `transform.test.ts:331-365` (regression-prevention layer 1). The new fixture-pinning test adds layer 2 (catches fixture drift even if transform regresses silently). The new `unionOfKeysAt` export-pinning test prevents future regressions where someone makes `unionOfKeysAt` module-private again.

## Verification Scenario (skip — non-UI)

This plan covers CLI/tool changes only. No browser verification needed.

## Tasks

> Three tasks below, scaled to bundle 3 distinct fixes (per user choice). The `- [ ]` checkboxes immediately under this heading are the progress tracker; the `### Task N:` blocks hold the bodies.

- [x] Task 1: Write Reproducing Tests (RED)
- [x] Task 2: Apply Fixes at Root Cause
- [x] Task 3: Quality Gate

### Task 1: Write Reproducing Tests (RED)

**Objective:** Encode the Behavior Contract as failing tests BEFORE any fix code lands. Three RED tests covering the three observable symptoms (modern-day.json UUID drift, modern-day.json backgroundData drift, unionOfKeysAt export contract).

**Files:**

- Create: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/regress-modern-day-fixture.test.ts`
- Create: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/union-of-keys-export.test.ts`

**Key Decisions / Notes:**

- The 2 `check-reference.test.ts` failures already serve as RED tests for Defect A — they are existing tests that currently fail. Do NOT recreate them; the existing failures ARE the RED.
- The new `regress-modern-day-fixture.test.ts` is a *characterization* test that pins invariants on the committed fixture — it currently FAILS (29 UUID keys present, backgroundData present). After fixture refresh in Task 2, it PASSES.
- The new `union-of-keys-export.test.ts` is a *characterization* test that pins the export/use contract — it currently FAILS because `unionOfKeysAt` is not exported from `src/conformance.ts`. After the export is added in Task 2, it PASSES.
- Test naming follows the project convention: TS uses `describe("regression: …")` + `it("…")`; no class wrappers.

**Definition of Done:**

- [ ] `regress-modern-day-fixture.test.ts` exists with two `it()` blocks: one asserting zero UUID-suffix override keys, one asserting zero `assets.backgroundData`. Both currently fail.
- [ ] `union-of-keys-export.test.ts` exists with one `it()` block: `setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]))` round-trips correctly via `isHubUnionAssetKey`. Currently fails (import error — `unionOfKeysAt` is not exported).
- [ ] Verify: `bun test tools/preset-exporter/tests/regress-modern-day-fixture.test.ts tools/preset-exporter/tests/union-of-keys-export.test.ts` — RED, expected failures.
- [ ] Verify: `bun test tools/preset-exporter/tests/check-reference.test.ts` — still RED (existing failures unchanged).

### Task 2: Apply Fixes at Root Cause

**Objective:** Apply the two-source fix: refresh `out/modern-day.json` to match current `transform.ts` output, and collapse the inline asset-key union rebuild to use `unionOfKeysAt`.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/out/modern-day.json` (data-only edit — remove 29 UUID keys + `backgroundData` block)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/conformance.ts` (add `export` to `unionOfKeysAt`)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/scripts/verify-out-bundles.ts` (collapse lines 137-143)
- Test: `tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` (from Task 1)
- Test: `tools/preset-exporter/tests/union-of-keys-export.test.ts` (from Task 1)

**Key Decisions / Notes:**

- **modern-day.json patch:** use `Edit` with a small Python script (read JSON, filter UUID-suffix keys from `regionOwnershipOverrides`, delete `assets.backgroundData`, write back) since the file is 915KB and a manual line-by-line delete is error-prone. Atomic edit — preserve all other content.
- **Patch invariants:** UUID-key deletion criterion: `/[0-9a-f]{8}-[0-9a-f]{4}-/` appears in the key string (matches UUID v4 shape). Integer keys (`GRC.1_1`) stay. `assets.backgroundData` removal is a single-property delete.
- **conformance.ts export:** add `export` keyword to `function unionOfKeysAt` (line 76). No body change.
- **verify-out-bundles.ts collapse:** add `unionOfKeysAt` to the existing `import { ... } from "../src/conformance"` at line 22. Replace lines 137-143 with `setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]));`.
- **No try/except wrappers:** the patch script does NOT catch errors and rethrow with a different message; failures abort the task and surface clearly.

**Definition of Done:**

- [ ] Reproducing tests from Task 1 PASS:
  - `bun test tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` — green
  - `bun test tools/preset-exporter/tests/union-of-keys-export.test.ts` — green
- [ ] Pre-existing failing tests now pass:
  - `bun test tools/preset-exporter/tests/check-reference.test.ts` — green (both tests)
- [ ] Diff touches only the four files listed above (no collateral).
- [ ] No try/except hides a bad patch (if the patch script fails, the task halts visibly).

### Task 3: Quality Gate

**Objective:** Lint + type check + full preset-exporter suite green; `bun run verify-out` returns 58 PASS / 0 FAIL.

**Files:**

- No production file changes expected; update this plan's progress and status.

**Key Decisions / Notes:**

- The suite runs here after lint/type because those commands can auto-modify imports, types, or formatting.
- `bun run verify-out` is the authoritative end-to-end signal — the user-observable test that the verify-out-bundles feature works against the cleaned fixture.

**Definition of Done:**

- [ ] Lint clean (project uses Bun; no separate lint command — typecheck serves as lint).
- [ ] Type check clean: `cd tools/preset-exporter && bunx tsc --noEmit` — exit 0. **EXCEPTION:** 3 pre-existing `error TS2503: Cannot find namespace 'GeoJSON'` errors at `src/transform.ts:76,77,107` are baseline bugs (verified by stashing the working tree and re-running tsc — errors persist). They are out of scope for this plan per the lineage test (not introduced by any of the 5 issues); document as a separate cleanup ticket.
- [ ] Full preset-exporter suite green: `bun test tools/preset-exporter/tests/` — 0 failures.
- [ ] `bun run verify-out` returns exit 0 with summary `processed=58 pass=58 fail=0 skip=0` (or `pass=57 fail=1 skip=0` if a previously-passing bundle was affected by the patch — investigate and resolve).
- [ ] No `SPEC-DEBUG:` markers in the diff.
- [ ] Verify: `bun test tools/preset-exporter/tests/ && echo "suite=$?"` and `bun run verify-out && echo "verify=$?"` both print `0`.

## Post-Plan Operational Items (OUTSIDE this plan)

These items are not bug fixes — they are operational decisions and actions that follow plan verification. They are surfaced here so the user sees them but are NOT tasks in this plan:

1. **Commit strategy decision.** Working tree has 11 files modified/added; `origin/main` reports `[gone]`. User must decide: commit on current `main`, or branch from `origin/main` first (will fail since `[gone]`), or some other flow. **Requires explicit user instruction before any `git commit` / `git push`** per `verification.md` git operations rules.

2. **Commit + push.** After Task 3 passes and the user confirms commit strategy. The verify-out-bundles feature (`docs/plans/2026-07-16-verify-out-bundles.md`) flips from `COMPLETE` to `VERIFIED` once `bun run verify-out` returns 58 PASS / 0 FAIL and all tests are green. **Not auto-executed** — explicit user permission required.