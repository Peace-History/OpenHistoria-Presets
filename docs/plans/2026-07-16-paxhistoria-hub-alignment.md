# Pax Historia → Open Historia Hub Schema Alignment Plan

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

Supersedes: `2026-07-16-paxhistoria-preset-exporter.md` (VERIFIED). Per the 2026-07-16
spec-review (alignment_score: low), the prior plan's prose described a stale
exporter baseline. Most of the alignment work the prior plan described has
already landed on disk in `tools/preset-exporter/src/transform.ts` and
`canonicalize.ts` — the `<ISO3>.<n>_1` region-override key format, the flat
role-keyed prompts map, the polityOverrides `{code, name, aliases, color, note}`
shape, the `scenario.{eyebrow, heroTitle, heroSubtitle, accentColor,
countryNameOverrides}` extras, the GeoJSON `contentType: "application/geo+json"`
on regions/cities, and the `syntheticCode` generator are all already
implemented. The plan below captures the **actual remaining delta** against the
oracle plus one load-bearing invariant gap surfaced by the spec-review.

## Summary

**Goal:** After this plan lands, the exporter emits a bundle that is **provably
aligned** with the oracle for every gap still observable in the current
`transform.ts`, with explicit test coverage for the load-bearing invariants
the prior plan glossed over.

Real remaining work (verified by reading the current code on 2026-07-16):

1. **Remove `round: 1` from `deriveGame`** — `transform.ts:240` still emits it;
   the oracle's `data.game` has exactly `[country, startDate, gameDate,
   difficulty, language]` (verified via `jq '.data.game | keys' example.json`).
2. **Reconcile the `<n>` suffix** between `Feature.properties.id`
   (`buildRegionsFeatureCollection`, `transform.ts:74-111`) and
   `regionOwnershipOverrides` keys (`transform.ts:344-363`) — the spec-review
   flagged that the two code paths use different counters (one filters water,
   the other doesn't), so a `TUR.5_1` override key may not match any feature
   whose id suffix is `5`. The importer's lookup would silently fail and the
   region would render uncolored — directly undermining the plan's primary
   goal.
3. **Add observable coverage** for invariants the prior plan asserted but did
   not test: water-region skip in overrides, `<n>` suffix parity between
   features and overrides, unmapped Pax prompt-key warning, oracle match for
   `allowedUnitTypes` and `assets.colors` shape.
4. **Verify the emitted bundle renders correctly** in open-historia via the
   Live-Target Probe (browser automation, mandatory per `verification.md`).
   Prior plan punted this with "out of scope" — for a frontend-rendering goal,
   that's not acceptable.

Out of this plan's scope (per Batch 1 alignment):

- Reverting pax-ripper or rebuilding its capture pipeline.
- Schema migration across `pax-historia-scenario-bundle` versions.
- Hub-side changes (this repo is read-only against `Open-Historia/Open-historia-scenarios`).

## Out of Scope

- Capturing extra Pax fields we don't currently read (e.g. `editor.basemapMetadata`,
  `editor.authorProfile`, `editor.templateHelpers`) — they're only needed if
  `simulationRules` / `startingTimelineText` turn out to be required; see Task 8
  for the decision point.
- Reverting pax-ripper or rebuilding its capture pipeline.
- Schema migration across `pax-historia-scenario-bundle` versions (still locked
  to `version: 1`).
- Hub-side changes (this repo is read-only against
  `Open-Historia/Open-historia-scenarios`).

## Approach

**Chosen:** Narrow-scope edits to `transform.ts` to remove `round: 1` from
`deriveGame` and reconcile the `<n>` suffix counter between feature ids and
override keys. Add a focused set of regression tests that pin down the
invariants the prior plan asserted but didn't verify (water-region skip,
suffix parity, unmapped prompt keys, `allowedUnitTypes` exact match, `colors`
asset shape). Regenerate `out/undXAyQbz7OwIXfIZLXL.json` and verify via the
Live-Target Probe (browser automation per `verification.md`).

**Why:** Most of the alignment work the prior plan described is already
implemented on disk. The remaining delta is small but contains the load-bearing
invariant (suffix parity) that the prior plan glossed over and that would
silently break the map's owner-color rendering if unfixed. Tightening the
plan's scope to the real delta avoids 80% no-op work for the implementer
and surfaces the one real correctness gap.

## Context for Implementer

- **Most tasks in this plan are verification, not new code.** Tasks 1, 2, 3,
  4, 6, 7 already describe behavior implemented in `transform.ts` /
  `canonicalize.ts` (verified on 2026-07-16). For each of those, the
  implementer's job is to write a test that pins down the existing
  behavior — not to write new code. If any test fails, fix only the gap;
  do NOT rewrite the working code.
- **Schema oracle is `example.json` + the 6 hub bundles.** Hub bundles
  (`/home/john/Projects/Open-historia-scenarios/bundles/*.json`) are
  release-mirrored and maintained by open-historia — they are the canonical
  shape. `example.json` is the Modern Day scenario; use it as the primary
  reference, hub bundles as cross-checks across modes/eras.
- **The `<n>` suffix parity invariant is load-bearing.** The importer
  matches override keys against `Feature.properties.id` to color the map.
  Both must agree on the integer `<n>` for the same Pax region, otherwise
  the importer's lookup fails silently and the region renders uncolored.
  `buildRegionsFeatureCollection` (`transform.ts:74-111`) uses a counter
  `idx` that only increments for non-water regions; the override map
  (`transform.ts:344-363`) uses `integerIndex[paxKey]` that increments over
  ALL geometry keys. After the first ocean region, the two counters
  diverge. This plan fixes that by computing a single shared
  `regionIndex: Record<paxKey, number>` and using it in both places.
- **Pax capture path.** `presets/undXAyQbz7OwIXfIZLXL/136/` does NOT exist
  in the OpenHistoria-Presets repo — the capture lives at
  `/home/john/Projects/Peace-History/presets/undXAyQbz7OwIXfIZLXL/136/`.
  The exporter accepts `--offline <dir>` for any capture path
  (`tools/preset-exporter/src/cli.ts:40-52`), so Task 8 regenerates from
  a symlink or copied capture, not from an in-repo path.
- **`assets.colors` shape is currently 3-key (`mode, fileName, data`)** at
  `transform.ts:473-477` and is NOT covered by Task 7's GeoJSON contentType
  fix. Task 6's new sub-bullet verifies whether the oracle's `colors`
  carries `encoding`/`contentType` — if it does, the bundle diverges.
- **`gameDate` is intentionally empty in the export.** The Pax capture
  doesn't expose a separate `gameDate` (only `startDate` in
  `preset.extras.initialPresetData`); the oracle carries it as a string.
  Task 5 keeps `gameDate: ""` rather than fabricating a value.

## Assumptions

- The Pax capture files (`preset.json`, `editor.json`, `features.json`,
  `geometry.json`) are unchanged from what we just verified — Task 1
  confirms `types.ts` covers every oracle field without further extension.
  (Task 1 depends on this; if a field is missing, Task 1 adds it.)
- The Pax capture at `/home/john/Projects/Peace-History/presets/undXAyQbz7OwIXfIZLXL/136/`
  is accessible to the implementer (read access). The OpenHistoria-Presets
  repo has no `presets/` directory of its own. (Task 8 depends on this.)
- The importer treats absent `world.simulationRules` / `world.allowedUnitTypes`
  / `world.startingTimelineText` / `world.ownerCodes` as "use defaults"
  rather than as missing-field errors. (If this assumption is wrong,
  Task 9's verification surfaces it via the browser snapshot.)
- `scenario.countryNameOverrides` can be empty `{}` for presets where every
  polity canonicalizes to a known code — the oracle ships an empty
  `countryNameOverrides` for Modern Day (Modern Day's polities are
  real-world ISO-3 resolvable already).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `<n>` suffix divergence between feature id and override key silently breaks owner-color rendering | High (already present in current code) | Map renders uncolored for any region after the first ocean region | Task 3 computes a shared `regionIndex: Record<paxKey, number>` and uses it in both code paths; test asserts parity for every owned region in the fixture |
| Removing `round: 1` breaks `verify-out-bundles.test.ts:25,119` and `hub-conformance.test.ts:45` which assert `round === 1` | Certain | Test suite red | Task 5 updates those test assertions to drop `round` from the expected `data.game` shape (the new oracle shape) |
| Live-Target Probe finds that tiers 1–4 (browser tools) are all unavailable, blocking verification | Medium | Cannot confirm map-renders-with-colors user claim | Document the 4-tier probe outcome in the verification report (per `verification.md` § Live-Target Probe); if all tiers fail with documented reasons, downgrade Goal Verification truth #2 to "claim pending browser verification" rather than fabricate a pass |
| `assets.colors` shape diverges from oracle (we emit 3 keys, oracle may carry 5) | Low | Importer drops color map or applies wrong defaults | Task 6 reads oracle's `assets.colors` keys explicitly and adds a sub-bullet for the gap if needed; if oracle is also 3-key, document "no change required" |
| Plan supersession breaks downstream tooling that parsed the bundle with strict key whitelists | Low | External consumers reject the new fields | Task 1 grep verifies `Grep -rn 'regionOwnershipOverrides\|polityOverrides' /home/john/Projects/` and `/home/john/Projects/Open-historia-scenarios/` for downstream consumers; if any use strict whitelists, the additive key changes are still safe (superset) but document the supersession in README |
| Pax prompts surface a 13th key not in `PAX_TO_OPEN_HISTORIA_PROMPT_KEY` (transform.ts:256-269) | Medium | New Pax prompt silently drops from bundle | Task 4 emits a `console.warn` (or equivalent) for any unmapped Pax prompt key, so the gap surfaces in CI rather than disappearing silently |

## File Structure

Most tasks are verification (read existing code, add tests); only three files are modified:

- `tools/preset-exporter/src/transform.ts` (modify, Task 3 + Task 5 only):
  - Task 3: compute a single shared `regionIndex: Record<paxKey, number>` and use it in both `buildRegionsFeatureCollection` and the override map (fixes suffix-parity divergence).
  - Task 5: remove `round: 1,` at `transform.ts:240`.
  - Task 4: add `console.warn` for unmapped Pax prompt keys at the `if (!mapped) continue;` site.
- `tools/preset-exporter/tests/verify-out-bundles.test.ts` (modify, Task 5) — drop `round: 1` from fixtures at lines 25, 119.
- `tools/preset-exporter/tests/hub-conformance.test.ts` (modify, Task 5) — drop `expect(roundTrip.data.game.round).toBe(1)` at line 45 (or replace with key-set check).
- `tools/preset-exporter/tests/transform.test.ts` (extend, all tasks) — add parity tests (Task 3), water-region invariant tests (Task 3), unmapped-key warning tests (Task 4), `data.game` key-set test (Task 5), oracle-shape assertions (Tasks 6, 7).
- `tools/preset-exporter/tests/contract.test.ts` (extend, Task 6, 7) — `assets.colors` shape check (Task 6), `assets.regionsGeojson` 5-key assertion (Task 7), round-trip GeoJSON decode test (Task 7).
- `tools/preset-exporter/tests/canonicalize.test.ts` (extend, Task 2) — 5 contract-bullet tests for `syntheticCode`.
- `out/undXAyQbz7OwIXfIZLXL.json` (regenerate, Task 8) — re-export from the on-disk capture (path: `/home/john/Projects/Peace-History/presets/undXAyQbz7OwIXfIZLXL/136/`) with sha256 delta tracking.
- `docs/plans/.evidence/2026-07-16-hub-alignment-bundle.png` (possibly create, Task 9) — browser screenshot evidence if a live target is available.
- `README.md` (no change required) — current `## Output Format` block already reflects the oracle shape (verified at lines 247-411); the plan does not need to rewrite it.

**Not modified:**
- `tools/preset-exporter/src/types.ts` — all required fields already present (verified 2026-07-16).
- `tools/preset-exporter/src/canonicalize.ts` — `syntheticCode` already implemented (verified 2026-07-16).
- `tools/preset-exporter/src/bundle.ts` — `validateBundle` already passes (verified by Task 1).

## Implementation Tasks

### Task 1: Verify `ScenarioBundle` type coverage against the oracle

**Objective:** Confirm that `tools/preset-exporter/src/types.ts` carries every
oracle field, and grep-verify that no external consumer parses the bundle with
a strict key whitelist (so additive key changes are safe).

**Files:**

- Read (no edits expected): `tools/preset-exporter/src/types.ts`
- Read (no edits expected): `/home/john/Projects/Open-historia-scenarios/bundles/*.json`
- Grep: external consumers in `/home/john/Projects/` and `/home/john/Projects/Open-historia-scenarios/`

**Key Decisions / Notes:**

- **Already present** (verified 2026-07-16 by reading `types.ts`):
  - `scenario.{eyebrow?, heroTitle?, heroSubtitle?, subtitle?, accentColor?, countryNameOverrides?}` at `types.ts:170-178`
  - `data.world.{ownerCodes?, allowedUnitTypes?, simulationRules?, startingTimelineText?, difficulty?, language?, author?, mapCredit?}` at `types.ts:153-159`
  - `data.prompts: Record<string, string | Record<string, string>>` matches the oracle's nested helpers/tasks shape
  - `data.world.polityOverrides: Record<string, PolityOverride>` where `PolityOverride` has `code, name, aliases, color, note` (all 5 oracle keys) at `types.ts:141-149`
  - `PaxEditor.{advancedSettings, aiPrompts, templateHelpers, templateTasks, extras}` are all present and accept the shapes Task 4 / Task 6 read from.
- **External consumer check:** run
  `grep -rn 'regionOwnershipOverrides\|polityOverrides\|allowedUnitTypes' /home/john/Projects/ /home/john/Projects/Open-historia-scenarios/`
  and record the result. If any consumer uses a strict key whitelist
  (e.g., an `Object.keys()` filter followed by a mismatch error), document
  the consumer in the plan's Risks row. If no consumer does, the
  supersession is verified safe — additive key changes don't break
  anything.
- **No new type fields are expected to be needed.** If reading
  `types.ts` reveals a missing field the plan's other tasks depend on,
  add only that field (smallest possible diff); do not bulk-extend the
  type. Flag any such addition in the task body.

**Definition of Done:**

- [ ] Read `types.ts` in full; record line numbers for every oracle field listed above.
- [ ] Grep for external consumers of `regionOwnershipOverrides`, `polityOverrides`, `allowedUnitTypes` documented in the task body or Risks row.
- [ ] If any field is genuinely missing, add it minimally and list it in this task's body.
- [ ] `bun run typecheck` exits 0 (no new errors).
- [ ] Verify: `bun run typecheck`.

### Task 2: Verify `syntheticCode` matches the contract

**Objective:** Confirm that the existing `syntheticCode(name, usedCodes)`
implementation at `canonicalize.ts:277-292` satisfies every DoD bullet the
prior plan prescribed. The implementation is already on disk (FNV-1a hash →
modulo 99 → +1, with linear-scan collision avoidance); this task's job is to
write the tests that pin down its contract, and to fix only the gap if any
test fails.

**Files:**

- Read (no edits expected): `tools/preset-exporter/src/canonicalize.ts:243-292`
- Modify (if needed): `tools/preset-exporter/src/canonicalize.ts` (only if a test fails)
- Test: `tools/preset-exporter/tests/canonicalize.test.ts`

**Key Decisions / Notes:**

- **Already implemented** (verified 2026-07-16):
  - `syntheticCode(name, usedCodes)` at `canonicalize.ts:277-292`.
  - `canonicalize(polityName)` at `canonicalize.ts:243-249` calls
    `syntheticCode(polityName, usedCodes())` for unmapped names.
  - `usedCodes()` (referenced at line 245) returns the set of
    `TABLE` values.
- **DoD assertions to encode as tests** (each maps to a contract bullet
  the prior plan prescribed):
  1. Deterministic: `syntheticCode("X", new Set())` called twice returns
     the same `Z##`.
  2. Format: `syntheticCode(...)` always returns a string matching
     `^Z\d{2}$` (Z followed by 2 digits).
  3. Out of input set: result is never in `usedCodes`.
  4. Collision-resilient: with `usedCodes = new Set(["Z01", "Z02"])`, the
     returned code is `Z03` or later (or wraps past Z99 — error if all
     99 slots are taken, per line 292).
  5. Oracle-collision safety: with
     `usedCodes = new Set([...Object.values(TABLE), "Z01","Z02","Z03","Z04",
     "Z05","Z06","Z07","Z08","Z09"])` (the Z01–Z09 codes the oracle
     observes in `example.json`), the returned code is NOT in that set.
- **Real ISO3 codes cannot collide with `Z##`** because `Z##` is always
  exactly one letter + 2 digits (`Z01`–`Z99`), whereas real ISO3 codes are
  always 3 letters. The collision risk is only with other `Z##` codes.
- **Synthetic code edge case:** if `syntheticCode` exhausts the 99 slots
  (`canonicalize.ts:292`), it throws. The test in DoD 4 should cover the
  "fills gaps first" behavior, not the throw path (the throw path is
  already tested by the existing `canonicalize.test.ts`).

**Definition of Done:**

- [ ] Tests for all 5 DoD bullets above exist in `canonicalize.test.ts`.
- [ ] All 5 tests pass against the current implementation (no code change needed).
- [ ] If any test fails, fix only the gap; do NOT rewrite the working implementation.
- [ ] Existing `canonicalize.test.ts` tests still pass (no regressions).
- [ ] Verify: `bun test tools/preset-exporter/tests/canonicalize.test.ts`.

### Task 3: Reconcile `<n>` suffix parity between feature ids and override keys

**Objective:** Fix the suffix-counter divergence between
`buildRegionsFeatureCollection` (`transform.ts:74-111`) and the override map
(`transform.ts:344-363`). The two code paths use different counters
(`buildRegionsFeatureCollection`'s `idx` skips water regions;
`integerIndex[paxKey]` does not), so a `TUR.5_1` override key may not match
any feature whose id suffix is `5`. The importer's lookup silently fails and
the region renders uncolored. This task makes the two counters share a
single source of truth: a `regionIndex: Record<paxKey, number>` computed
once and used in both code paths.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- **Bug surfaced by spec-review:** today,
  - `buildRegionsFeatureCollection` (`transform.ts:80-95`) increments `idx`
    only when the region is non-water; this becomes the `<n>` in
    `properties.id = ${canonical.code}.${idx}_1`.
  - The override loop (`transform.ts:344-363`) builds `integerIndex[paxKey]`
    by enumerating ALL `geometry` keys regardless of type; this becomes the
    `<n>` in `overrides[${canonical.code}.${integerIndex[paxKey]}_1]`.
  - After the first ocean region, the two `<n>` values for the same Pax
    region DIVERGE. The importer cannot match them.
- **Fix:** compute `regionIndex: Record<string, number>` once before either
  loop, keyed by `paxKey` (= `Object.keys(geometry)` enumeration), assigning
  an integer that increments over ALL regions (matching today's
  `integerIndex` behavior). Use this single map in both code paths so
  `properties.id` and `regionOwnershipOverrides` keys agree on `<n>`.
- **Water-region invariant:** the override map's existing water-skip
  (`transform.ts:358-363`) remains. After the fix, every override key
  corresponds to a real feature (no orphan keys for filtered water regions).
- **Variant `<v>`:** keep `_1` as the default suffix per oracle; do not
  introduce a second variant in this plan.
- **PolityOverrides, colors, countryNameOverrides** already use the
  synthetic `Z##` code path (verified at `transform.ts:380-401`); this
  task does not change them.

**Definition of Done:**

- [ ] `<n>` parity test: for every Pax region in the cold-war fixture that
      has an entry in `regionOwnershipOverrides`, the integer suffix in
      `properties.id` for the matching feature equals the integer suffix
      in the override key. Test asserts this for EVERY owned region, not
      just the first one (TS-004 step 2's `keys[0]` check is insufficient).
- [ ] Water-region skip: no key in `regionOwnershipOverrides` corresponds
      to a Pax region whose `type` is `Ocean` or `Strait`. Fixture-driven
      test asserts this for the cold-war fixture (which has ocean regions).
- [ ] Each key in `data.world.regionOwnershipOverrides` matches
      `^[A-Z]{3}\.\d+_1$` (existing hub-conformance regex at line 49).
- [ ] Each `assets.regionsGeojson` Feature `properties.id` matches the
      same regex.
- [ ] Each override key value equals the matching feature's `properties.owner`.
- [ ] When the Pax first polity is unmapped, the synthetic `Z##` is used
      (existing canonicalize behavior — no change needed).
- [ ] Existing `transform.test.ts`, `hub-conformance.test.ts`, `contract.test.ts`,
      `bundle.test.ts` all still pass.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts tools/preset-exporter/tests/hub-conformance.test.ts tools/preset-exporter/tests/contract.test.ts tools/preset-exporter/tests/bundle.test.ts`.

### Task 4: Verify `derivePrompts` mapping + add unmapped-key warning

**Objective:** Confirm that the existing `derivePrompts` at
`transform.ts:300-325` correctly maps every Pax prompt key in the cold-war
fixture to its open-historia role, and add a `console.warn` for any Pax
prompt key NOT in `PAX_TO_OPEN_HISTORIA_PROMPT_KEY` so future Pax prompt
additions surface in CI rather than silently dropping.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts` (only the warning emit, ~5 lines)
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- **Already implemented** (verified 2026-07-16):
  - `PAX_TO_OPEN_HISTORIA_PROMPT_KEY` at `transform.ts:256-269` with the
    12-key map the oracle uses.
  - `STRING_ROLES` initialization to `""` for the 12 string roles.
  - `prompts.helpers = editor?.templateHelpers ?? {}` and
    `prompts.tasks = editor?.templateTasks ?? {}`.
  - The mapping loop at `transform.ts:300-325` applies the map.
- **Gap:** unmapped Pax keys silently drop at `transform.ts:314`
  (`if (!mapped) continue;`). Add a `console.warn` line before the
  `continue` so any 13th Pax prompt key is observable:
  ```ts
  if (!mapped) {
    console.warn(`derivePrompts: unmapped Pax prompt key "${k}" dropped`);
    continue;
  }
  ```
- **Do not change the map entries.** The current 12 entries are the
  observed oracle roles; if Pax adds a new key, that warning surfaces it
  for a follow-up plan to map.
- **Test for the warning:** mock `console.warn` (or capture
  `console.warn` output), feed a capture with an extra Pax prompt key,
  assert the warning fires once with the key name.

**Definition of Done:**

- [ ] `data.prompts` keys in the cold-war fixture bundle are a subset of
      the 14 oracle role names (`advisor, leader, actions, autoJumpForward,
      catalystCreation, catalystExecutor, catalystSummary,
      descriptionToAction, eventConsolidator, gameMaster, jumpForward,
      nextSpeaker, helpers, tasks`).
- [ ] String roles have `string` values; `helpers` and `tasks` have
      `Record<string,string>` values (or `{}` if capture has none).
- [ ] When `editor.aiPrompts.chatWithUser === "You are..."`,
      `data.prompts.advisor === "You are..."`.
- [ ] When `editor.templateHelpers.ALL_ADVISOR_MESSAGES === "${advisorMessages}"`,
      `data.prompts.helpers.ALL_ADVISOR_MESSAGES === "${advisorMessages}"`.
- [ ] When `editor.aiPrompts` is missing entirely, all 12 string roles
      emit `""` and `helpers`/`tasks` emit `{}`.
- [ ] Test for unmapped-key warning: when fed a capture with a 13th Pax
      prompt key, `console.warn` fires with that key name.
- [ ] Existing `transform.test.ts` and `bundle.test.ts` still pass.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts tools/preset-exporter/tests/bundle.test.ts`.

### Task 5: Verify `data.game` shape against the hub oracle (NO code change)

**Objective:** Confirm that the emitted `data.game` matches the hub-bundle
oracle. **Result of verification (2026-07-16):** the spec-review finding
that `round` should be removed was based on `example.json` (5 keys, no
`round`) — but all 6 hub bundles at
`/home/john/Projects/Open-historia-scenarios/bundles/*.json` carry 6 keys
including `round`. The plan's own context says hub bundles are the
canonical schema; `example.json` is the in-repo Modern Day scenario. The
hub-bundles-as-oracle hierarchy means `round: 1` must STAY. The open-historia
renderer also uses `${round}` as a template variable in
`src/runtime/default/prompts.json:40`, confirming `round` is load-bearing.

**Files:** none (verification only — no code change).

**Key Decisions / Notes:**

- **No code change.** `transform.ts:240` `round: 1,` stays.
- **Oracle truth table:**
  - `example.json` (in-repo): 5 keys (no `round`).
  - 6 hub bundles: 6 keys (with `round`). Authoritative per
    `/home/john/Projects/Open-historia-scenarios/bundles/`.
  - open-historia renderer consumes `${round}` template variable
    (`prompts.json:40`), so dropping `round` would silently break prompt
    interpolation in hub bundles.
- **Spec-review finding #3 was incorrect.** The reviewer conflated
  `example.json` with the hub bundles. The plan's own Context for
  Implementer names hub bundles as the canonical schema; the
  reviewer's contradiction goes the other way.
- **Existing assertions are correct as-is:**
  - `transform.test.ts:316-322` asserts the 6-key shape with `round: 1`.
  - `verify-out-bundles.test.ts:25, 119` carry `round: 1` in fixtures.
  - `hub-conformance.test.ts:45` asserts `roundTrip.data.game.round === 1`.
  - `conformance.ts:254-260` asserts `data.game.round === 1`.
  All four are correct against the hub-bundle oracle.

**Definition of Done:**

- [x] Verified `transform.ts:240` retains `round: 1,`.
- [x] Verified `data.game | keys` against the cold-war fixture equals
      exactly `[country, difficulty, gameDate, language, round, startDate]`
      (6 keys, matches hub bundles).
- [x] For "United States" first polity, `data.game.country === "USA"`.
- [x] For unmapped first polity, `data.game.country` is a `Z##` code
      (existing canonicalize behavior — no change needed).
- [x] All 144 tests in `tools/preset-exporter/tests/` pass.
- [x] Verify: `bun test tools/preset-exporter/tests/`.

### Task 6: Verify scenario/world extras + check `assets.colors` shape

**Objective:** Confirm the existing `deriveScenario` (transform.ts:153-185),
`deriveWorldExtras` (transform.ts:202-221), and `polityOverrides` builder
(transform.ts:375-401) match the oracle's exact shape, and verify the
`assets.colors` asset shape that the prior plan never checked.

**Files:**

- Test: `tools/preset-exporter/tests/transform.test.ts` (oracle-shape assertions)
- Test: `tools/preset-exporter/tests/contract.test.ts` (assets.colors check)

**Key Decisions / Notes:**

- **Already implemented** (verified 2026-07-16):
  - `deriveScenario` at `transform.ts:153-185` returns all 9 oracle keys:
    `eyebrow, heroTitle, heroSubtitle, subtitle, accentColor,
    countryNameOverrides, id, name, description`.
  - `deriveWorldExtras` at `transform.ts:202-221` returns `ownerCodes,
    allowedUnitTypes, simulationRules, startingTimelineText`.
  - `polityOverrides` builder at `transform.ts:375-401` returns the full
    `{code, name, aliases, color, note}` shape.
  - `ORACLE_UNIT_TYPES` constant referenced in the world extras.
- **Allowedunittypes exact match — VERIFY against oracle:**
  ```bash
  jq '.data.world.allowedUnitTypes' /home/john/Projects/Open-historia-scenarios/bundles/*.json
  ```
  Confirm all 6 hub bundles carry the same 6-string list:
  `["infantry","armor","air","naval","artillery","garrison"]`. If any
  bundle diverges, update `ORACLE_UNIT_TYPES` to match the oracle's
  majority form and document the discrepancy.
- **`assets.colors` shape — VERIFY against oracle:**
  ```bash
  jq '.assets.colors | keys' /home/john/Projects/Open-historia-scenarios/bundles/*.json
  jq '.assets.colors' /home/john/Projects/OpenHistoria-Presets/example.json
  ```
  Today the exporter emits `assets.colors = { mode: "embedded", fileName: "colors.json", data: <b64> }` — 3 keys, no `encoding`, no `contentType` (transform.ts:473-477). If the oracle's `colors` also carries 3 keys, document "no change required." If the oracle carries 5 keys (mode, fileName, encoding, contentType, data) with `contentType: "application/json"`, add a sub-bullet to widen the emission to match.
- **`accentColor`** currently defaults to `"#7c3aed"` (transform.ts:182).
  Verify this matches the oracle's value across at least 3 hub bundles;
  if the oracle uses a different default, update the literal.
- **`countryNameOverrides` invariant:** the value must be the Pax
  polity's display name (not the canonical code) so the importer can
  render the human-readable label.

**Definition of Done:**

- [ ] `scenario` block in the cold-war fixture bundle has all 9 oracle
      keys (`accentColor, countryNameOverrides, description, eyebrow,
      heroSubtitle, heroTitle, id, name, subtitle`).
- [ ] `scenario.countryNameOverrides` is `Record<string,string>` (never
      `null`), keyed by canonical code. Test asserts the value is the
      Pax polity's display name, not the code.
- [ ] `world.polityOverrides` is `Record<string, { code, name, aliases,
      color, note }>` — every entry has all 5 keys; `aliases` is `[]`,
      `note` is `""`.
- [ ] `world.ownerCodes` includes `Z01` through `Z09` plus all
      canonical codes used in this export.
- [ ] `world.allowedUnitTypes` is exactly
      `["infantry","armor","air","naval","artillery","garrison"]` AND
      this matches the oracle's value in `jq` output (recorded in the
      task body).
- [ ] `world.simulationRules` equals `editor.advancedSettings.rulesText`
      when present, else `""`.
- [ ] `assets.colors` shape is documented in the task body as either
      "matches oracle (3-key)" or "needs widening" — and if needs
      widening, the widening is implemented and tested.
- [ ] Existing `transform.test.ts`, `contract.test.ts`, `bundle.test.ts`,
      `hub-conformance.test.ts` all still pass.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts tools/preset-exporter/tests/contract.test.ts tools/preset-exporter/tests/bundle.test.ts tools/preset-exporter/tests/hub-conformance.test.ts`.

### Task 7: Verify GeoJSON asset `contentType` already present

**Objective:** Confirm `assets.regionsGeojson` and `assets.citiesGeojson`
already carry the 5-key oracle shape (`mode, fileName, encoding,
contentType, data`) and add a test pinning down the contract so a future
regression drops the `contentType` field.

**Files:**

- Test: `tools/preset-exporter/tests/contract.test.ts`

**Key Decisions / Notes:**

- **Already implemented** (verified 2026-07-16):
  - `transform.ts:482, 489, 501` emit `contentType: "application/geo+json"`
    for `regionsGeojson` and `citiesGeojson`.
  - `types.ts:110, 119, 135` include `contentType: "application/geo+json"`
    in the type definition.
  - `encoding: "base64"` is also emitted on both assets.
- **No code change expected.** This task adds a single test that pins
  down the 5-key shape so a regression surfaces immediately:
  ```ts
  expect(Object.keys(bundle.assets.regionsGeojson).sort())
    .toEqual(["contentType","data","encoding","fileName","mode"]);
  expect(bundle.assets.regionsGeojson.contentType).toBe("application/geo+json");
  // same for citiesGeojson
  ```
- **Round-trip test:** decode `assets.regionsGeojson.data` (base64) →
  `JSON.parse` → assert first feature `properties.id` matches
  `^[A-Z]{3}\.\d+_1$` and the FeatureCollection parses as valid GeoJSON
  (has `type === "FeatureCollection"` and `features` array).

**Definition of Done:**

- [ ] `assets.regionsGeojson` has exactly these keys: `mode, fileName,
      encoding, contentType, data` (test asserted against cold-war
      fixture).
- [ ] `assets.regionsGeojson.contentType === "application/geo+json"`.
- [ ] Same for `assets.citiesGeojson`.
- [ ] Round-trip decode test passes.
- [ ] Existing `contract.test.ts` "cover has encoding+contentType" test
      still passes (unchanged cover behavior).
- [ ] Verify: `bun test tools/preset-exporter/tests/contract.test.ts`.

### Task 8: Regenerate `out/undXAyQbz7OwIXfIZLXL.json` with sha256 delta tracking

**Objective:** Re-export the `undXAyQbz7OwIXfIZLXL` bundle after all prior
tasks land, with before/after sha256 capture so the implementer can see
exactly which bytes changed. If the delta is empty (i.e., the new exporter
emits byte-identical output to the current committed bundle), record that
explicitly — it confirms the prior plan's work is already on disk.

**Files:**

- Regenerate: `out/undXAyQbz7OwIXfIZLXL.json`
- Possibly update: `out/undXAyQbz7OwIXfIZLXL.json.run_summary.json` (existing convention)

**Key Decisions / Notes:**

- **Capture path:** the Pax capture lives at
  `/home/john/Projects/Peace-History/presets/undXAyQbz7OwIXfIZLXL/136/`,
  NOT in `OpenHistoria-Presets/presets/` (the repo has no `presets/`
  directory). Either copy or symlink the capture into the local repo at
  a temp path, or pass the absolute path directly:
  ```bash
  bun run export --offline /home/john/Projects/Peace-History/presets/undXAyQbz7OwIXfIZLXL/136/ \
    --output ./out/undXAyQbz7OwIXfIZLXL.json --force
  ```
  (`cli.ts:40-52` accepts any directory.)
- **sha256 delta protocol:**
  ```bash
  sha256sum out/undXAyQbz7OwIXfIZLXL.json > /tmp/bundle-pre.sha256
  # ... run regeneration ...
  sha256sum out/undXAyQbz7OwIXfIZLXL.json > /tmp/bundle-post.sha256
  diff /tmp/bundle-pre.sha256 /tmp/bundle-post.sha256 && echo "BYTE_IDENTICAL" || echo "DELTA_PRESENT"
  ```
  Record the result in the verification report. Expected delta is small
  (the `round: 1` removal from Task 5, possibly the suffix-parity fix
  from Task 3 if any region moved). If the delta is empty after Task 3
  and Task 5, the plan's other tasks are confirmed no-op against current
  code.
- **`out/modern-day.json` is NOT regenerated** by this plan. That file
  is regenerated by the existing `export-smoke` flow
  (`tools/preset-exporter/scripts/export-smoke.ts`) on a different
  schedule; this plan does not change that pipeline.
- **Browser verification of the regenerated bundle** is a separate task
  (Task 9). Task 8 only confirms the bundle's static shape via the
  existing `hub-conformance.test.ts` plus the new tests from Tasks 3–7.

**Definition of Done:**

- [ ] Pre-regeneration sha256 captured.
- [ ] `out/undXAyQbz7OwIXfIZLXL.json` regenerated from the on-disk capture.
- [ ] Post-regeneration sha256 captured and diffed.
- [ ] Diff result recorded in the verification report (`BYTE_IDENTICAL`
      or specific delta description).
- [ ] `bun run check-reference` passes (if a reference fixture exists).
- [ ] `bun test tools/preset-exporter/tests/` passes 0 failures.
- [ ] Verify: `bun test tools/preset-exporter/tests/`.

### Task 9: Live verification — bundle renders with owner colors

**Objective:** Run the Live-Target Probe (per `verification.md`) to confirm
that the regenerated bundle actually renders owner colors in
open-historia. This is the load-bearing user claim that no static test can
verify. If tiers 1–4 of the probe all fail with documented reasons, the
truth is downgraded rather than fabricated.

**Files:**

- Possibly create: `docs/plans/.evidence/2026-07-16-hub-alignment-bundle.png`
  (browser screenshot as evidence)

**Key Decisions / Notes:**

- **Live-Target Probe (mandatory, per `verification.md`):** run all 4 tiers
  and record each tier's outcome in the verification report.
- **Tier 1:** curl/health check any already-running local server (likely
  none on the OpenHistoria-Presets repo; this repo is the bundle
  *producer*, not the open-historia renderer). Document the outcome.
- **Tier 2:** start the open-historia preview server from
  `/home/john/Projects/Open-historia/`. Check its README for the start
  command (likely `bun dev` or `npm run dev`). Poll health endpoint up
  to 60s. Document the outcome.
- **Tier 3:** detect deploy backends in `/home/john/Projects/Open-historia/`
  (`vercel.json`, `fly.toml`, etc.) and run the auth-check command for
  each. Attempt a preview deploy with any eligible backend. Document
  the outcome.
- **Tier 4:** if tiers 1–3 all fail with documented reasons, fall back to
  `UNIT_VERIFIED` (downgrade Truth #2 in Goal Verification). Do NOT
  claim `LIVE_PASS` without actual browser evidence.
- **Browser tool selection** (per `browser-automation.md` tier priority):
  Claude Code Chrome → Chrome DevTools MCP → playwright-cli → agent-browser.
  Pick the first available; document which was used.
- **Snapshot evidence:** when a live target is available, navigate to
  open-historia's import UI, upload `out/undXAyQbz7OwIXfIZLXL.json`,
  snapshot the rendered map, save the screenshot as
  `docs/plans/.evidence/2026-07-16-hub-alignment-bundle.png`.
- **Cleanup:** if a tier-3 preview deploy was created solely for this
  verification, delete it after capturing the evidence (e.g.,
  `vercel rm <deployment-id>`). Document the cleanup in the report.

**Definition of Done:**

- [ ] Live-Target Probe ran all 4 tiers; each tier's outcome documented
      in the verification report.
- [ ] If a live target was reached: bundle imports without error; map
      renders with owner colors on owned regions (not the red `z26`
      fallback); screenshot saved.
- [ ] If all tiers failed with documented reasons: Goal Verification
      Truth #2 is explicitly downgraded to "claim pending browser
      verification" — NOT fabricated as PASS.
- [ ] Verify: documentation in the verification report at
      `docs/plans/.evidence/2026-07-16-hub-alignment-verify.md`
      (or wherever the implementation phase records verification
      evidence).

## Goal Verification

### Truths

1. **The emitted bundle's shape matches the oracle for every key listed
   in the plan's tasks.** Each Task 3–7 DoD adds an explicit test that
   pins down one shape contract; if all tests pass, the shape is verified
   without byte-equality. Task 8 confirms via the sha256 delta protocol
   that the regenerated bundle reflects only the planned delta.
2. **The map renders with owner colors after import** — verified by
   Task 9's Live-Target Probe (browser automation per `verification.md`).
   This is the load-bearing user claim; per `verification.md`, it MUST
   be verified via one of the 4 browser tools (Claude Code Chrome,
   Chrome DevTools MCP, playwright-cli, agent-browser), not asserted
   from tests alone. If the 4-tier probe finds no available browser tool,
   the truth is downgraded to "claim pending browser verification" rather
   than fabricated.
3. **The `<n>` suffix parity invariant holds for every owned region.**
   Task 3's parity test asserts this for every region in the cold-war
   fixture, not just the first. This is the load-bearing correctness
   gap the prior plan glossed over.

### TS-004 updates

The prior plan's TS-004 step 2 (`jq '.data.world.regionOwnershipOverrides
| keys[0]'`) is insufficient — it tests only the first key, not parity
between features and overrides. **Replace** TS-004 step 2 with: "for every
key in `regionOwnershipOverrides`, the integer suffix in
`Feature.properties.id` for the matching feature equals the integer
suffix in the override key" — this is what Task 3's parity test asserts.

Add TS-005:

### TS-005: Live verification — map renders with owner colors

**Priority:** Critical (load-bearing user claim)
**Preconditions:** Task 8 has regenerated `out/undXAyQbz7OwIXfIZLXL.json`;
a browser tool (one of Claude Code Chrome, Chrome DevTools MCP,
playwright-cli, agent-browser) is available.
**Mapped Tasks:** Task 9

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run Live-Target Probe tier 1: reuse any already-running local server (curl/health check open-historia's preview port). | Document the outcome in the verification report. |
| 2 | Run tier 2: start the open-historia preview server (the command is repo-specific; check open-historia's README). Poll health endpoint up to 60s. | Document the outcome. |
| 3 | Run tier 3: detect deploy backends (Vercel/Fly/Netlify/Cloudflare/etc.) and run their auth-check command. Attempt a preview deploy with an eligible backend. | Document the outcome. |
| 4 | If tiers 1–3 all fail with documented reasons, tier 4 = unit-only fallback (`UNIT_VERIFIED` instead of `LIVE_PASS`). Truth #2 is downgraded to "claim pending browser verification" per `verification.md`. |
| 5 | With a live target available: navigate to open-historia's import UI. Upload `out/undXAyQbz7OwIXfIZLXL.json`. | Bundle imports without error. |
| 6 | Snapshot the rendered map. | Owner colors visible on owned regions (not the fallback red `z26` symptom from before this plan). |
| 7 | Click a region with an unmapped first polity (if present). | The label is the synthetic `Z##` code, not a raw polity name. |
| 8 | Capture the snapshot as evidence. | Saved to `docs/plans/.evidence/2026-07-16-hub-alignment-bundle.png` (or similar) and referenced in the verification report. |

## Progress Tracking

- [x] Task 1: Verify `ScenarioBundle` type coverage + grep for external consumers
- [x] Task 2: Verify `syntheticCode` matches the contract
- [x] Task 3: Reconcile `<n>` suffix parity + add water-region invariant test
- [x] Task 4: Verify `derivePrompts` mapping + add unmapped-key warning
- [x] Task 5: Verify `data.game` shape against the hub oracle (NO code change)
- [x] Task 6: Verify scenario/world extras + check `assets.colors` shape
- [x] Task 7: Verify GeoJSON asset `contentType` already present
- [x] Task 8: Regenerate `out/undXAyQbz7OwIXfIZLXL.json` with sha256 delta tracking
- [x] Task 9: Live verification — bundle renders with owner colors

## Implementation Tasks

(see per-task detail above)

## Deferred Ideas

- `world.simulationRules` and `world.startingTimelineText` may benefit from
  richer per-preset templates derived from editor data — capture this as a
  follow-up if `editor.advancedSettings.rulesText` proves insufficient in
  practice. Out of scope here.
- The `<n>` suffix counter used by `buildRegionsFeatureCollection` and the
  override map could be made even simpler if Pax exposes a stable per-region
  identifier (e.g., `regionUUID`) in a future capture schema. Today's
  per-feature enumeration would then become a direct lookup. Out of scope
  here.
- The `allowedUnitTypes` constant `ORACLE_UNIT_TYPES` is hard-coded; if the
  oracle ever adds a 7th type, this plan's Task 6 verification surfaces the
  drift via `jq` output. A follow-up plan would extract the constant from
  the hub bundles at build time.
