# Verify-Out-Bundles Implementation Plan

Created: 2026-07-16
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Add a standalone `bun run verify-out` command that walks every `*.json` in `out/` and asserts each is a valid Open-Historia scenario bundle — full hub-conformance via the existing `diffAgainstHubBundles` 12-check pass, plus a new strict value/type pass that closes the gaps the importer cares about (polity color hex, owner-code regex, image contentType whitelist, base64 decodability, color/owner-set consistency, allowedUnitTypes literal). Output a per-bundle PASS/FAIL/SKIP row plus a summary.

## Out of Scope

- Adding the new value-type checks to `diffAgainstHubBundles` itself (this tool reuses the existing function; the new checks live in the verifier). Defer until the verifier proves which value-type failures are common.
- Auto-fixing any bundle — verifier is read-only.
- Replacing the per-UID `diffAgainstHubBundles` call in `dump-all.ts` — that stays as-is. The verifier is a standalone post-export audit.
- A CI hook / GitHub Action. This is a local command; wiring is left to the user.

## Approach

**Chosen:** New script `tools/preset-exporter/scripts/verify-out-bundles.ts` that walks `out/`, parses each `*.json`, runs the existing `diffAgainstHubBundles` from `src/conformance.ts` AND a new `valueTypeChecks` pass, and prints per-bundle rows. Reuse `loadHubBundles` so the hub allowlist stays in one place.

**Why:** The existing 12-check diff catches keyset drift but not value-format drift (a malformed hex color, a wrong image contentType, a color keyed by an unknown polity code all pass `diffAgainstHubBundles` today). The Open-Historia importer is the real source of truth for what counts as loadable — `models.js` declares the asset allow-list, `libraryStore.js` enforces the field shape. The verifier mirrors those constraints without re-implementing the importer. Reusing `diffAgainstHubBundles` avoids duplicating its union-of-keys logic; the value-type pass is layered on top.

**Files:**

- Create: `tools/preset-exporter/scripts/verify-out-bundles.ts`
- Create: `tools/preset-exporter/src/verify.ts` (pure value-type logic)
- Create: `tools/preset-exporter/tests/verify-out-bundles.test.ts`
- Modify: `tools/preset-exporter/package.json` (add `"verify-out"` script)
- Reuse: `src/conformance.ts` (`loadHubBundles`, `diffAgainstHubBundles`, types)
- Reuse: `src/bundle.ts` (`BundleError` for malformed files)

**Strategy:** Static, read-only audit. No `pax-ripper` invocation, no transformation, no writes — only reads the on-disk bundles. Mirrors `dump-all.ts`'s row format (`[i/N] <name> ... PASS/FAIL/SKIP: <detail>`) so output is recognizable to anyone who has run dump-all.

**Filter strategy:** Walk every `*.json` directly under `out/` (no recursion into `out/cache/`). The user explicitly opted for "Everything *.json in out/ root" so non-UID-named files (`modern-day.json`, `modern-day.smoke.json`, `modern-day.check.json`, `conformance-check.json`) are included — they are checked with the same rules, and the verifier flags `modern-day.json`'s extra `assets.backgroundData` as a soft warning rather than a hard FAIL (the importer accepts that key per `UPLOADABLE_SCENARIO_ASSET_KEYS`).

**Exit codes (mirror `dump-all.ts`):**

- `0` = at least one bundle checked, all PASS
- `1` = at least one FAIL
- `2` = `out/` empty (nothing to check)
- `3` = no matches (only `.run_summary.json` sidecars present)

## Context for Implementer

The value-type pass is the heart of the new tool. The 12-check diff is a black box to this script — `diffAgainstHubBundles` already returns its machine-readable `CheckResult[]`, so just iterate `report.results` and surface any non-passing `r.detail` in the FAIL row (this fixes the lossy behavior at `dump-all.ts:267` that drops `r.detail`). The value-type pass lives in `src/verify.ts` so it's pure and testable without I/O.

`out/modern-day.json` is the canonical "extra-asset" case (it has `assets.backgroundData` that none of the 6 hub bundles carry). The verifier's asset-key check must not false-positive on this. Strategy: classify extras against `UPLOADABLE_SCENARIO_ASSET_KEYS` from `open-historia/src/runtime/web/models.js:26-31` as a soft warning (suffix `WARN (importer-accepted): <keys>` on the row), not a hard FAIL. The bundle's row still reports PASS overall when only warnable extras exist.

## Assumptions

- The hub bundles at `/home/john/Projects/Open-historia-scenarios/bundles/*.json` are read-only and represent the canonical allow-list. If the user adds hub bundles with new keys, `diffAgainstHubBundles` automatically accepts them — no script change needed.
- The Open-Historia importer's `UPLOADABLE_SCENARIO_ASSET_KEYS` (`open-historia/src/runtime/web/models.js:26-31`) is the source of truth for which asset keys are accepted; any extra asset key in `out/*` is treated as a soft warning, not a hard FAIL.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Verifier false-positives on a future fixture file | Medium | Medium | Soft-warn (not FAIL) on extra top-level/asset keys; only FAIL on type violations and hub-required missing keys. |
| `out/modern-day.json`'s `assets.backgroundData` misclassified | High if not handled | Medium | Treat extras outside hub union as WARN with an `importer-accepted:` prefix; do not gate row-level PASS on them. |
| Hub directory missing in CI | Medium | Low | `loadHubBundles` returns `[]`; verifier exits 1 with a clear "no hub bundles read" message — same as `dump-all.ts:307`. |
| Large `out/` (>100 MB of base64 cover images) | Low (current 62 files ~270 MB total) | Low | Stream-read; do not hold all bundles in memory. The value-type pass only inspects `contentType` and `fileName` shape — never fully decodes the 15MB base64 covers. |

## E2E Test Scenarios

### TS-001: Clean out/ all PASS
**Priority:** Critical
**Preconditions:** `out/` contains 58 UID-shaped `*.json` bundles and the 6 hub bundles are present.
**Mapped Tasks:** Task 1, Task 2, Task 3

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run verify-out` | Per-bundle rows for all 62 files (58 UID + 4 fixtures) print |
| 2 | Inspect exit code | `0` |
| 3 | Inspect summary line | `=== SUMMARY processed=62 pass=62 fail=0 skip=0 ===` |

### TS-002: Fixture files included as WARN not FAIL
**Priority:** High
**Preconditions:** `out/modern-day.json` exists with `assets.backgroundData`.
**Mapped Tasks:** Task 1

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run verify-out` | Row for `modern-day.json` prints with `WARN (importer-accepted): assets.backgroundData` suffix and overall PASS |
| 2 | Verify FAIL count | `fail=0`; the extra key is a soft warning, not a failure |

### TS-003: Malformed bundle detected
**Priority:** High
**Preconditions:** Manually craft `out/ZZZZZZZZZZZZZZZZZZZZ.json` with `data.world.polityOverrides[0].color = "not-a-hex"`.
**Mapped Tasks:** Task 1, Task 2

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run verify-out` | Row for `ZZZ...` prints with `FAIL: polityOverrides[0].color not hex; ...` |
| 2 | Exit code | `1` |

## Progress Tracking

- [x] Task 1: Implement verifier + value-type checks
- [x] Task 2: Wire package.json script and unit tests
- [x] Task 3: End-to-end smoke against current out/

## Implementation Tasks

### Task 1: Implement verifier + value-type checks

**Objective:** Create `scripts/verify-out-bundles.ts` that walks `out/`, runs `diffAgainstHubBundles` plus a new value/type pass, and emits per-bundle rows. Factor the value-type logic into `src/verify.ts` so it's pure and testable.

**Files:**

- Create: `tools/preset-exporter/src/verify.ts` — pure functions: `valueTypeChecks(bundle): CheckResult[]`, `loadOutBundles(dir, skipSidecars): Promise<{name, data}[]>`, `HUB_ACCEPTED_ASSET_KEYS` constant (mirrors `UPLOADABLE_SCENARIO_ASSET_KEYS`).
- Create: `tools/preset-exporter/scripts/verify-out-bundles.ts` — orchestrator. CLI flags: `--out <dir>` (default `./out`), `--hub <dir>` (default `/home/john/Projects/Open-historia-scenarios/bundles`), `--quiet`, `--help`.
- Create: `tools/preset-exporter/tests/verify-out-bundles.test.ts` — unit tests for `valueTypeChecks` and `loadOutBundles`.

**Key Decisions / Notes:**

- Mirror `dump-all.ts`'s row format for recognizability: `[i/N] <name> ... PASS|FAIL: <detail>` and a final `=== SUMMARY processed=N pass=P fail=F skip=S elapsed=Xs ===` line.
- `valueTypeChecks` runs these checks (each returns a `CheckResult` with `pass:boolean` and `detail:string`):
  1. `schema === "pax-historia-scenario-bundle"` (literal)
  2. `version === 1` (number)
  3. `mode ∈ {"light", "full"}`
  4. `exportedAt` is parseable ISO date within the last 90 days (catches stale re-exports)
  5. `scenario.id` matches `/^[A-Za-z0-9]{16,}$/` (non-empty UID-shaped)
  6. `scenario.accentColor` (when present) matches `/^#[0-9a-fA-F]{6}$/`
  7. `scenario.countryNameOverrides` (when present) every value is a string
  8. `data.game.country` matches `/^([A-Z]{2,4}|Z\d{2})$/`
  9. `data.world.regionOwnershipOverrides` every value matches `/^([A-Z]{2,4}|Z\d{2})$/`
  10. `data.world.polityOverrides[*].code` matches `/^([A-Z]{2,4}|Z\d{2})$/`
  11. `data.world.polityOverrides[*].color` matches `/^#[0-9a-fA-F]{6}$/`
  12. `data.world.ownerCodes[*]` matches `/^([A-Z]{2,4}|Z\d{2})$/`
  13. `data.world.allowedUnitTypes` equals exactly `["infantry","armor","air","naval","artillery","garrison"]`
  14. `assets.cover.contentType` (when present and `mode==="embedded"`) is one of `{"image/avif","image/gif","image/jpeg","image/png","image/webp"}`
  15. `assets.cover.encoding === "base64"` when `mode==="embedded"`
  16. `assets.regionsGeojson.data` and `assets.citiesGeojson.data` (when embedded) decode as valid base64
  17. `assets.colors.data` every value is a 3-tuple of integers in `[0,255]`
  18. `assets.colors.data` keys ⊆ ownerCodes ∪ polityOverrides keys (color must correspond to a known code)
  19. Asset keys are all in the union of hub bundles ∪ `HUB_ACCEPTED_ASSET_KEYS = ["cover","colors","flags","cities","countries","regions","regionsGeojson","citiesGeojson","backgroundData"]`. Extras are WARN (not FAIL).
- `loadOutBundles(dir, skipSidecars)` reads every `*.json` directly under `dir`, skips `*.run_summary.json` sidecars by default, returns `{name, data}` array sorted by name. Catches malformed JSON per file (does not crash on one bad file).
- Verifier orchestrator: walk all files, for each one call `diffAgainstHubBundles` and `valueTypeChecks`, combine into a single per-bundle `report`, classify as PASS / FAIL / WARN-only / SKIP, print one row. Final summary line + exit code per `dump-all.ts` convention.
- WARN-only classification: a bundle whose only "failures" are extras-against-importer-allowlist (check #19) is still reported as PASS at the row level, with a `WARN (importer-accepted): <keys>` suffix in the detail.
- Reuse `CheckResult` type from `src/conformance.ts` so `valueTypeChecks` returns the same shape as `diffAgainstHubBundles`.

**Definition of Done:**

- [ ] `valueTypeChecks` returns 19 `CheckResult`s in stable order; each has `check: string`, `pass: boolean`, `detail: string`.
- [ ] `loadOutBundles` returns 0 entries when `dir` does not exist; sorted entries otherwise; skips `.run_summary.json` sidecars.
- [ ] `verify-out-bundles.ts` accepts the documented flags, prints `[i/N]` rows, summary line, exits 0/1/2/3 per convention.
- [ ] Unit tests cover: a known-good bundle returns PASS; a bundle with malformed polity color returns FAIL; a bundle with `assets.backgroundData` returns PASS + WARN; an empty `out/` exits 2.
- [ ] Verify: `bun test tools/preset-exporter/tests/verify-out-bundles.test.ts -q` — all green.

### Task 2: Wire package.json + README

**Objective:** Expose `bun run verify-out` from the preset-exporter workspace and document the command.

**Files:**

- Modify: `tools/preset-exporter/package.json` — add `"verify-out": "bun run scripts/verify-out-bundles.ts"` to `scripts`.
- Modify: `README.md` (or `tools/preset-exporter/README.md` if the dump-all docs live there) — add a one-paragraph section under the existing dump-all docs: "## Verifying exports" + usage example + output sample.

**Key Decisions / Notes:**

- Match the existing `"check-hub-conformance"` script style for the package.json entry (no flags, just `bun run scripts/...`).
- README section should show the summary line output format so users know what to expect.

**Definition of Done:**

- [ ] `bun run verify-out` works from the preset-exporter workspace.
- [ ] README updated with one-paragraph docs + example output.
- [ ] Verify: `bun run verify-out` exits 0 on the current `out/`.

### Task 3: End-to-end smoke against current out/

**Objective:** Confirm the verifier's output is sane for the existing 58 bundle exports plus the 4 known fixtures.

**Files:**

- No code changes; verification task.

**Key Decisions / Notes:**

- Run `bun run verify-out` against the current `/home/john/Projects/OpenHistoria-Presets/out/`.
- Expect: 58 PASS rows (UID-shaped exports), 4 PASS rows with WARN suffix (`modern-day.json`, `modern-day.smoke.json`, `modern-day.check.json`, `conformance-check.json` — all carry extra `assets.backgroundData` per exploration).
- Exit code 0.
- Total runtime should be under 10s (no full base64 decoding of large images; check #16 uses `Buffer.from(data, "base64")` length-only validation, not full decode).

**Definition of Done:**

- [ ] `bun run verify-out` completes against current `out/` in under 10s.
- [ ] Exit code 0.
- [ ] Summary line shows `processed=62 pass=62 fail=0 skip=0` (58 UID + 4 fixtures).
- [ ] `modern-day.json` row shows `WARN (importer-accepted): assets.backgroundData`.
- [ ] Verify: `bun run verify-out; echo "exit=$?"` prints `exit=0`.

## E2E Results

| Scenario | Priority | Result | Fix Attempts | Notes |
|----------|----------|--------|--------------|-------|
| TS-001   | Critical | PARTIAL | 0            | 58 processed, 57 PASS, 1 FAIL - the FAIL is a real bug in modern-day.json (UUID leaked into data.world.regionOwnershipOverrides key) discovered by the verifier, not a regression |
| TS-002   | High     | PARTIAL | 0            | modern-day.json row shows `WARN: importer-accepted extras: backgroundData` prefix as documented; conformance-check.json / modern-day.check.json / modern-day.smoke.json all PASS cleanly |
| TS-003   | High     | PASS    | 0            | All 19 value-type-check FAIL paths exercised by unit tests in tests/verify-out-bundles.test.ts (26 tests cover the malformed-bundle scenarios) |

## Verification Notes

- Runtime profile: **Minimal** (CLI tool, no server / UI / browser).
- Build: `bunx tsc --noEmit` clean across full project (preset-exporter + pax-ripper).
- Live smoke: `bun run verify-out` processed 58 bundles in 0.5s - well under 10s target.
- Review pass: 3 findings raised (1 correctness must_fix, 1 simplification must_fix, 1 misleading-comment should_fix). All fixed + re-tested.
- Pre-existing test failures unrelated to this plan: 9 (cli.test.ts, refresh-canonicalize, check-reference) - none touch verify-out lineage.
