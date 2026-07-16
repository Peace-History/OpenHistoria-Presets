# Pax Historia Hub Submission Conformance Test

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

Supersedes (informational): `2026-07-16-paxhistoria-hub-alignment.md` (still PENDING;
the bulk of that plan was implemented in this session, but several oracle-shape
guesses turned out to be wrong when diffed against the **6 hub bundles** in
`Open-Historia/Open-historia-scenarios/bundles/` rather than against
`example.json` alone). This new plan closes the remaining gaps and adds the
hub-conformance test the user explicitly asked for.

## Summary

**Goal:** Run a full Pax→Open-Historia export for UID `undXAyQbz7OwIXfIZLXL`
("Better 1444 (The Original)" v136) and prove the resulting bundle is
shape-conformant with the canonical submission format hosted at
https://github.com/Open-Historia/Open-historia-scenarios/ (the 6 official
hub bundles under `bundles/`), so the bundle is acceptable for hub submission.

The hub is the submission target — `example.json` (Modern Day) is **not** the
authoritative shape, only one of the hub bundles. All hub bundles are
release-mirrored and importer-validated; the exporter must match them.

## Out of Scope

- Re-capturing UID `undXAyQbz7OwIXfIZLXL` from paxhistoria.co (requires a
  signed-in persistent browser profile that does not exist on this host).
  The existing `tests/fixtures/cold-war/` fixture (a real Pax capture
  of `1Alm1zD4pXpGyfWwkch1` v79) stands in as a fully-populated Pax
  capture with the same shape; the test asserts the transform produces
  a hub-conformant bundle from that fixture.
- Hub-side validation (no import-UI dry-run via the actual open-historia
  web app). Hub conformance is verified at the JSON-shape level (the
  format the importer parses). Live E2E import is called out in
  Goal Verification as a follow-up.
- Refresh of `canonicalize.ts`'s TABLE to map historical Pax polity
  names to historical 3-4 char codes (`ABBS`, `ARAG`, etc.). Hub bundles
  use historical codes; ours emit ISO-3. Today the contract test
  validates the export's codes are a stable, alphabetised subset of
  TABLE ∪ synthetic Z##; rewriting TABLE to historical codes is a
  separate plan (and would change import semantics).

## Approach

**Chosen:** Two-track fix + conformance script.

1. **Track A — shape fixes to `transform.ts`** (3 small surgical edits):
   - Re-add `round: 1` to `data.game` (the prior plan dropped it based
     on `example.json`; all 6 hub bundles carry `round: 1` as a number).
   - Move `difficulty`, `language` out of `data.world` — they belong in
     `data.game` only (the 6 hub `world` keys are exactly:
     `allowedUnitTypes, customCities, customRegions, ownerCodes,
     polityOverrides, regionOwnershipOverrides, simulationRules,
     startingTimelineText` — no `difficulty`/`language`/`author`/`mapCredit`).
   - Drop `world.author` and `world.mapCredit` from the emitted shape
     (hub bundles do not carry them; the importer falls back to its
     own defaults).

2. **Track B — conformance script**: a new
   `tools/preset-exporter/scripts/check-hub-conformance.ts` that
   - exports `tests/fixtures/cold-war/` → a temp bundle (via the CLI)
   - diffs the temp bundle against all 6 hub bundles on:
     - top-level keys (must equal: `schema, version, mode, exportedAt,
       scenario, data, assets`)
     - `scenario` keys (must be a subset of the 9 oracle keys)
     - `data` keys (must equal all 7 oracle keys)
     - `data.prompts` keys (must equal the 14 oracle keys)
     - `data.world` keys (must equal the 8 oracle keys after Track A)
     - `data.game` keys (must equal the 6 oracle keys after Track A)
     - `assets` keys (must equal the 7 oracle keys)
     - `data.world.regionOwnershipOverrides` first key matches
       `^[A-Z]{2,4}\.\d+_1$` (hub allows 2-4 char codes; our ISO-3 also passes)
     - `assets.regionsGeojson.contentType === "application/geo+json"`
     - `data.world.polityOverrides[code].{code,name,aliases,color,note}` shape
   - exits 0 if the export passes every check; non-zero otherwise.
   - prints a per-check PASS/FAIL summary so the result is human-readable.

3. **Track C — UID-specific smoke (the user's literal ask)**: a second
   script `tools/preset-exporter/scripts/export-and-check.ts` that
   - if `presets/undXAyQbz7OwIXfIZLXL/<version>/` exists on disk, runs
     `bun run export --offline <path> --output ./out/<UID>.json`
     then runs the conformance script against that bundle
   - otherwise, prints `presets/<UID>/ not found on disk — running against
     tests/fixtures/cold-war/ as proxy. To run against the real UID,
     re-capture with: bun run rip --preset <UID>` and proceeds with
     the cold-war fixture.
   - this is what the user means by "run a test against ID
     undXAyQbz7OwIXfIZLXL and confirm it matches expected format."

## Context for Implementer

- **The 6 hub bundles (`Open-Historia/Open-historia-scenarios/bundles/`)
  are the canonical shape.** `example.json` (Modern Day) is a special
  case (it has `startDate: "1946-01-01"` and `customCities: false`-ish —
  hub bundles have `customCities: true`). Verify against the hub repo,
  not against `example.json`, when in doubt.
- **`data.game.round: 1` is required.** All 6 hub bundles carry it as
  a **number**, not a string. Verified 2026-07-16 by
  `jq '.data.game'` on each hub bundle:
  ```
  bronze-1200bc:    {"country":"EGYP","startDate":"1200 BCE","gameDate":"1200 BCE","round":1,"difficulty":"standard","language":"English"}
  colonial-1650:    {"country":"GBR","startDate":"1650-01-01","gameDate":"1650-01-01","round":1,"difficulty":"standard","language":"English"}
  medieval-1200:    {"country":"HRE","startDate":"1200-01-01","gameDate":"1200-01-01","round":1,"difficulty":"standard","language":"English"}
  mongol-1300:      {"country":"YUAN","startDate":"1300-01-01","gameDate":"1300-01-01","round":1,"difficulty":"standard","language":"English"}
  roman-117:        {"country":"ROM","startDate":"0117-01-01","gameDate":"0117-01-01","round":1,"difficulty":"standard","language":"English"}
  wwii-1939:        {"country":"GER","startDate":"1939-09-01","gameDate":"1939-09-01","round":1,"difficulty":"standard","language":"English"}
  ```
  `round` is the literal integer `1` in every bundle (not `"1"`).
  The prior plan dropped it based on `example.json` only — that
  was wrong. Restore it.
- **`data.world` canonical keys (8):** `allowedUnitTypes,
  customCities, customRegions, ownerCodes, polityOverrides,
  regionOwnershipOverrides, simulationRules, startingTimelineText`. Our
  current emit adds 4 more (`difficulty`, `language`, `author`,
  `mapCredit`); the importer falls back gracefully if absent, but for
  shape parity with the hub submission target they should be omitted.
  (`difficulty` and `language` already live in `data.game` — that's the
  right place per the hub.)
- **`ownerCodes` contents differ between ours and the hub.** Hub
  bundles use 3-4 char historical codes (`ABBS`, `ARAG`, `AYY`); ours
  use ISO-3 + Z##. The conformance script does NOT assert code-content
  equality — only that the `ownerCodes` array exists and contains
  strings. Bridging that gap is deferred (Out of Scope).
- **UID `undXAyQbz7OwIXfIZLXL` capture is gone from disk** — the
  `presets/<UID>/` directory was cleaned up between sessions. The
  fixture-based proxy is the realistic option; the user can re-capture
  with `bun run rip --preset undXAyQbz7OwIXfIZLXL` (requires signed-in
  Pax profile) when ready.

## Assumptions

- The 6 hub bundles' shape is stable (no breaking schema change in
  flight). Verified 2026-07-16: all 6 share identical key sets at the
  levels we diff (top-level, scenario, data, data.prompts, data.world,
  data.game, assets). (Tasks 1, 2 depend on this; if a hub bundle
  changes shape, the conformance script fails loudly.)
- The cold-war fixture is a real Pax capture with full editor +
  features + geometry payloads. Verified earlier: 168K features, 2.6M
  geometry, 196K preset, plus the `editor.json` and cover image. The
  transform + bundle code paths are exercised end-to-end on it.
- `bun run rip --preset <UID>` is available as a re-capture command
  even though it is not exercised by this plan (no signed-in Pax
  profile on this host per the troubleshooting README). The
  Track C script just records the command and proceeds with the proxy.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hub shape changes between this plan and verification | Low | Conformance script falsely passes or fails | Script reads the hub bundles at run time (no baked-in key list) and diffs key *sets*; if a hub bundle gains a new key, the script reports "schema drift in hub bundle X" and exits 1 |
| `data.game.round: 1` is treated as a string by some importers | Low | Numeric-vs-string regression | The hub bundles emit `round: 1` as a number — match exactly. If the importer coerces, no harm; if it doesn't, ours won't import |
| Removing `world.author` breaks some consumer | Very Low | A downstream tool depended on it | The hub does not carry it; the importer falls back. If a third-party tool breaks, it was depending on a non-canonical field. Document in README. |
| `presets/undXAyQbz7OwIXfIZLXL/` is re-captured mid-task and shape drifts | Low | The user's "run a test against UID" output is stale | Track C script captures the version it ran against in `_run_summary.json` (already done by `bundle.ts`); the conformance script reports it |

## File Structure

- `tools/preset-exporter/src/transform.ts` (modify) — restore
  `data.game.round: 1`; remove `data.world.{difficulty, language,
  author, mapCredit}` (they live in `data.game` or are dropped).
- `tools/preset-exporter/src/types.ts` (modify) — drop the optional
  fields that are no longer emitted (`world.author`, `world.mapCredit`,
  `world.difficulty`, `world.language`). `world.difficulty` and
  `world.language` were never hub-canonical; this is the cleanup.
- `tools/preset-exporter/scripts/check-hub-conformance.ts` (create)
  — the new conformance script (Track B).
- `tools/preset-exporter/scripts/export-and-check.ts` (create) — the
  UID-targeted runner (Track C).
- `tools/preset-exporter/tests/hub-conformance.test.ts` (create) —
  bun:test wrapper that invokes both scripts and asserts exit 0;
  runs as part of `bun test`.
- `package.json` (modify) — add `check-hub-conformance` and
  `export-and-check` scripts.
- `README.md` (modify) — replace the "Output format" block's oracle
  reference (currently cites `example.json` alone) with a cite of the
  6 hub bundles; mention the conformance test under "Development".

## Implementation Tasks

### Task 1: Restore `data.game.round: 1` (number, not string)

**Objective:** Add `round: 1` (a number) as a key in `data.game` so the
emitted bundle matches all 6 hub bundles' `data.game` shape.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`

**Key Decisions / Notes:**

- The prior plan dropped `round` claiming `example.json` (5 keys) is
  the oracle. **It isn't** — `example.json` is a single hub bundle
  whose game happens to lack `round`; the 6 hub bundles in
  `Open-Historia/Open-historia-scenarios/bundles/` all carry
  `round: 1` (number).
- Insert in `deriveGame` (transform.ts:222-245). Position: after
  `language`, before `difficulty`, OR keep the existing order. The
  conformance script asserts key SET membership, not insertion order,
  so position is cosmetic.
- Type: number (`round: 1`), not string (`"1"`). The hub uses number.
- The previous oracle-only reasoning in the prior plan (5 keys, drop
  round) was a misread. This task reverses it.

**Definition of Done:**

- [ ] `data.game` has all 6 hub keys: `country, startDate, gameDate, round, difficulty, language` (set membership).
- [ ] `data.game.round === 1` (number, not string).
- [ ] `bun run typecheck` passes.
- [ ] **`tools/preset-exporter/tests/transform.test.ts:245-249` updated from a 5-key set `[country, difficulty, gameDate, language, startDate]` to the 6-key set `[country, difficulty, gameDate, language, round, startDate]`.** This assertion is intentionally being superseded: it was based on `example.json` only (which has 5 keys), and the 6 hub bundles all carry `round` (verified 2026-07-16). The test as written today asserts the wrong oracle; updating it is the fix, not breaking it.
- [ ] Existing tests still pass after the assertion update.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 2: Drop non-canonical `data.world` extras

**Objective:** Remove `difficulty`, `language`, `author`, `mapCredit`
from the emitted `data.world` shape — none of the 6 hub bundles carry
them (they belong in `data.game` or are dropped). After this task,
`data.world` keys match the hub exactly: `allowedUnitTypes,
customCities, customRegions, ownerCodes, polityOverrides,
regionOwnershipOverrides, simulationRules, startingTimelineText` (8).

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Modify: `tools/preset-exporter/src/types.ts`
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- `deriveWorldExtras` (transform.ts:193-220) currently returns 8 keys:
  `ownerCodes, allowedUnitTypes, simulationRules, startingTimelineText,
  difficulty, language, author, mapCredit`. Trim to the 5 hub-canonical
  ones (`ownerCodes, allowedUnitTypes, simulationRules,
  startingTimelineText`); the 4 extras are removed.
- `data.world.difficulty` and `data.world.language` are redundant —
  they already exist in `data.game`. The hub does not duplicate them.
- `data.world.author` and `data.world.mapCredit` have no
  upstream-data source in our captures; emitting `""` for both is
  cargo-cult. Drop.
- `types.ts`: remove the optional `difficulty?`, `language?`,
  `author?`, `mapCredit?` from `WorldExtras` (or `World` — whichever
  interface carries them; the prior plan added them). Since the hub
  shape is the contract, an emitted field that the hub never carries
  is dead weight.

**Definition of Done:**

- [ ] `data.world` keys are exactly: `allowedUnitTypes, customCities, customRegions, ownerCodes, polityOverrides, regionOwnershipOverrides, simulationRules, startingTimelineText` (8 keys; no `difficulty`/`language`/`author`/`mapCredit`).
- [ ] `types.ts` `World` / `WorldExtras` interface no longer declares the 4 dropped optional fields.
- [ ] `bun run typecheck` passes.
- [ ] Existing `transform.test.ts` still passes (any test that asserts the dropped fields is updated to expect their absence).
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 3: Add `check-hub-conformance.ts` script

**Objective:** A standalone Bun script that runs the exporter against
`tests/fixtures/cold-war/` and asserts the emitted bundle's shape is
identical (key-set-wise) to the 6 hub bundles at every level we care
about. Exits 0 on full conformance, 1 on any failure, with a
human-readable PASS/FAIL summary.

**Files:**

- Create: `tools/preset-exporter/scripts/check-hub-conformance.ts`

**Key Decisions / Notes:**

- Read the 6 hub bundles from
  `$HUB_BUNDLES_DIR` if set, else from a sibling directory
  walk (`../Open-historia-scenarios/bundles/*.json`,
  `../../Open-historia-scenarios/bundles/*.json`, etc. — same
  upward-walk pattern as `check-reference.ts:13`'s
  `ROOT = new URL('../../..', import.meta.url).pathname`). The
  absolute path `/home/john/Projects/Open-historia-scenarios/bundles/`
  is the fallback only if `HUB_BUNDLES_DIR` is unset and no sibling
  is found. If fewer than 1 hub bundle exists, exit 1 with "no hub
  bundles found — set $HUB_BUNDLES_DIR or clone
  Open-Historia/Open-historia-scenarios as a sibling directory".
- Compute the **union** of hub keys at each level (top-level,
  scenario, data, data.prompts, data.world, data.game, assets).
  This guards against hub drift — if a single bundle is missing a
  key, the union still includes it, and the test fails clearly
  with "export missing key X that N hub bundles have".
- Diff points:
  - top-level keys ⊆ hub union
  - `scenario` keys ⊆ hub union (we may omit some that the importer
    fills in; assert subset, not equality)
  - `data` keys = hub union (must contain all 7)
  - `data.prompts` keys ⊆ hub union (14-key canonical set)
  - `data.world` keys = hub union (8-key canonical set after Task 2)
  - `data.game` keys = hub union (6-key canonical set after Task 1)
  - `assets` keys ⊆ hub union
  - `data.world.regionOwnershipOverrides` first key matches
    `^[A-Z]{2,4}\.\d+_1$` (2-4 char codes allowed; ISO-3 passes)
  - `assets.regionsGeojson.contentType === "application/geo+json"`
  - `data.world.polityOverrides[code]` shape: keys =
    `[code, name, aliases, color, note]`
  - `assets.cover.encoding === "base64"` if mode === "embedded"
  - `data.world.customRegions === true` and `customCities === true`
- Print a table:
  ```
  === Hub Conformance ===
  hub bundles read: 6 (bronze-1200bc, colonial-1650, ...)
  top-level:        PASS  (7 keys)
  scenario:         PASS  (9 keys)
  data:             PASS  (7 keys)
  data.prompts:     PASS  (14 keys)
  data.world:       PASS  (8 keys)
  data.game:        PASS  (6 keys)
  assets:           PASS  (7 keys)
  region key regex: PASS  (first key: USA.0_1)
  geojson contentType: PASS  (application/geo+json)
  polityOverrides shape: PASS
  cover encoding:   PASS
  customRegions:    PASS  (true)
  customCities:     PASS  (true)
  === RESULT: PASS ===
  ```
- Reuses the existing CLI invocation pattern from
  `scripts/check-reference.ts:18-27` (spawn the CLI with
  `--offline <fixture> --output <temp>`).

**Definition of Done:**

- [ ] `bun run tools/preset-exporter/scripts/check-hub-conformance.ts` exits 0 against the cold-war fixture (after Tasks 1 and 2 are landed).
- [ ] Script reads hub bundles dynamically (glob `/home/john/Projects/Open-historia-scenarios/bundles/*.json`); no hardcoded bundle paths.
- [ ] Each diff point prints PASS/FAIL with the offending value on FAIL.
- [ ] The script's stdout table matches the format above.
- [ ] If `out/` is missing, the script creates it for the temp export.
- [ ] Verify: `bun run tools/preset-exporter/scripts/check-hub-conformance.ts`.

### Task 4: Add `export-and-check.ts` script (UID-targeted)

**Objective:** A runner that takes a Pax UID (default
`undXAyQbz7OwIXfIZLXL`) and runs the export + conformance check
end-to-end. If the UID's capture is on disk, uses it; otherwise falls
back to the cold-war fixture and tells the user how to re-capture.

**Files:**

- Create: `tools/preset-exporter/scripts/export-and-check.ts`

**Key Decisions / Notes:**

- Default UID: `undXAyQbz7OwIXfIZLXL` (the user's literal ask).
- Default version: latest on disk under `presets/<UID>/` (read the
  directory; pick the highest version subdirectory). If no version
  exists, error.
- Capture path resolution:
  ```
  presets/<UID>/<version>/
  ```
  If `presets/<UID>/` is empty or absent, print:
  ```
  presets/undXAyQbz7OwIXfIZLXL/ not found on disk — falling back to
  tests/fixtures/cold-war/ (a real Pax capture of UID
  1Alm1zD4pXpGyfWwkch1 v79). To run against the real UID:
    bun run rip --preset undXAyQbz7OwIXfIZLXL
  ```
  then proceed with the fixture.
- Invoke the CLI:
  ```
  bun run export --offline <capture-dir> --output ./out/<UID>.json --force
  ```
- After export, invoke the conformance script as a child process
  (or inline the diff logic by reading the file directly — script
  invocation keeps separation of concerns).
- Print a final summary that is **unambiguous about the source**:
  ```
  === Export + Conformance for undXAyQbz7OwIXfIZLXL ===
  source: presets/undXAyQbz7OwIXfIZLXL/<version>/         (real capture)
        OR
  source: tests/fixtures/cold-war/  (fixture proxy)
          re-capture via: bun run rip --preset undXAyQbz7OwIXfIZLXL
  output: ./out/undXAyQbz7OwIXfIZLXL.json
  conformance: PASS
            OR
  conformance: FAIL (<reason>)
  ```
  When the source is the fixture proxy, the literal substring
  `fixture proxy` MUST appear in stdout (DoD assertion). This
  prevents a user reading `conformance: PASS` from concluding
  their UID was tested when it wasn't.
- Exit codes:
  - `0` = real capture + conformance PASS
  - `1` = conformance FAIL (any source)
  - `2` = fixture proxy + conformance PASS (intentionally
    distinct from 0, so a wrapper can detect proxy runs and the
    CI never silently accepts a proxy-only result as a real PASS)

**Definition of Done:**

- [ ] `bun run tools/preset-exporter/scripts/export-and-check.ts` (no args) runs against `undXAyQbz7OwIXfIZLXL`, falls back to fixture, and prints the summary.
- [ ] `bun run tools/preset-exporter/scripts/export-and-check.ts <UID>` runs against the given UID with the same behavior.
- [ ] When the UID capture exists on disk, the script uses it (not the fixture).
- [ ] **When falling back to fixture, stdout contains the literal substring `fixture proxy`** (so the user is unambiguously told their UID wasn't tested).
- [ ] **Exit codes: `0` = real capture + PASS, `1` = conformance FAIL, `2` = fixture proxy + PASS.** A consumer can distinguish a proxy-only PASS from a real-capture PASS by the exit code.
- [ ] Verify: `bun run tools/preset-exporter/scripts/export-and-check.ts undXAyQbz7OwIXfIZLXL` — assert exit code is `2` (proxy) on this host, stdout contains `fixture proxy`, and conformance PASS line is present.

### Task 5: Wrap in a `bun test` integration test + package.json scripts

**Objective:** Wire the new scripts into the existing test runner
and add `package.json` shortcuts so `bun run check-hub-conformance`
and `bun run export-and-check` work from the repo root. Use an
**in-process** test pattern (matching the existing suite) — do NOT
spawn the CLI as a subprocess from inside `bun test`.

**Files:**

- Create: `tools/preset-exporter/tests/hub-conformance.test.ts`
- Modify: `package.json`

**Key Decisions / Notes:**

- **In-process pattern, not subprocess.** The conformance logic
  lives in a new pure module
  `tools/preset-exporter/src/conformance.ts` exporting
  `diffAgainstHubBundles(bundle, hubBundles): { pass: boolean;
  results: Array<{ check: string; pass: boolean; detail: string }> }`.
  - The `check-hub-conformance.ts` script imports this module,
    calls it on the live transform output, and formats results.
  - The `bun test` file imports the same module, calls it on
    `transform(coldWarFixture, {mode:"full"})` directly, and
    asserts `diffAgainstHubBundles(...).pass === true`. No
    `Bun.spawn`, no temp files, no disk write — fully hermetic.
- `export-and-check.ts` is a **manual/dev script only** — it
  does NOT have a `bun test` wrapper. It exists for the user's
  one-shot "run a test against UID X" workflow and is invoked
  via `bun run export-and-check undXAyQbz7OwIXfIZLXL`.
- `package.json` scripts:
  ```json
  "check-hub-conformance": "bun run tools/preset-exporter/scripts/check-hub-conformance.ts",
  "export-and-check": "bun run tools/preset-exporter/scripts/export-and-check.ts"
  ```
- Do NOT change the existing `check-reference` or `export-smoke`
  scripts (they're separate, fixture-only, still useful).
- Add a small test for the schema-drift guard (suggestion #7):
  one `it()` that calls `diffAgainstHubBundles` with a synthetic
  hub bundle containing an extra key and asserts the function
  reports `pass: false` with a "missing key" or "schema drift"
  detail. Proves the union-of-keys behavior works.

**Definition of Done:**

- [ ] `tools/preset-exporter/src/conformance.ts` (new) exports
  `diffAgainstHubBundles(bundle, hubBundles)` and is importable
  from both the script and the bun:test file.
- [ ] `tools/preset-exporter/scripts/check-hub-conformance.ts`
  imports the module (no inlined diff logic).
- [ ] `tools/preset-exporter/tests/hub-conformance.test.ts`
  contains exactly 2 tests (in-process): (a) cold-war fixture
  transform diffs against hub bundles; (b) schema-drift guard
  fires when a synthetic hub bundle has extra keys. Both pass.
- [ ] `bun run check-hub-conformance` works from the repo root.
- [ ] `bun run export-and-check undXAyQbz7OwIXfIZLXL` works from
  the repo root (manual, no bun:test wrapper).
- [ ] Existing `bun test` suite (69 tests) still passes; new
  file adds 2 tests for a total of 71.
- [ ] Verify: `bun test`.

### Task 6: Update README + plan status

**Objective:** Document the conformance script in README.md so
contributors know the hub is the authoritative shape (not
`example.json`) and how to run the conformance test.

**Files:**

- Modify: `README.md`

**Key Decisions / Notes:**

- "Output format" section: change the cite from "aligned with
  `example.json` (the in-repo reference bundle) and the 6 official
  bundles under `Open-Historia/Open-historia-scenarios/bundles/`"
  to **emphasize** the 6 hub bundles as canonical; `example.json`
  is one of them.
- "Development" section: add `bun run check-hub-conformance`
  next to `bun run check-reference`. Add a one-line description.
- Add a "Hub submission" subsection: explains the conformance test,
  how to run it for a UID, and what the user-facing PASS/FAIL means.

**Definition of Done:**

- [ ] README "Output format" cite order has hub bundles first
  (single-line edit; the 6 hub bundles are listed before
  `example.json`).
- [ ] README "Development" lists `bun run check-hub-conformance`
  on its own line next to `bun run check-reference` (one-line
  edit; no surrounding prose rewrite).
- [ ] New "Hub submission" subsection contains exactly 3 bullets:
  (a) "The 6 bundles under `Open-Historia/Open-historia-scenarios/bundles/`
  are the canonical submission shape; `example.json` is one of them."
  (b) "Run `bun run check-hub-conformance` to diff the exporter's
  output against all 6." (c) "Run `bun run export-and-check <UID>`
  for a single-UID smoke (returns exit 2 + 'fixture proxy' label
  if the UID's capture isn't on disk)."
- [ ] No other README sections touched. Total README diff ≤ 6 lines.

## Goal Verification

### Truths

1. **`out/undXAyQbz7OwIXfIZLXL.json` is shape-conformant with the 6 hub bundles at every level we diff** (top-level, scenario, data, data.prompts, data.world, data.game, assets). This is **necessary but not sufficient** for hub acceptance: `data.world.ownerCodes` content is an open semantic gap (hub uses 3-4 char historical codes; ours use ISO-3). A PASS proves keys/types match; it does not prove the importer accepts the values. The open semantic gap is recorded in Out of Scope; a follow-up plan would re-test after ownerCodes canonicalization lands. Verified by `bun run export-and-check undXAyQbz7OwIXfIZLXL` exiting 0 (real capture) or 2 (fixture proxy — the literal substring `fixture proxy` is in stdout) and `bun test tools/preset-exporter/tests/hub-conformance.test.ts` passing.
2. **`data.game.round: 1` (number) is present.** Verified by `jq '.data.game | keys' out/<UID>.json` showing exactly `["country","difficulty","gameDate","language","round","startDate"]` and `jq '.data.game.round' out/<UID>.json` returning `1` (not `"1"`).
3. **`data.world` carries only the 8 hub-canonical keys.** Verified by `jq '.data.world | keys' out/<UID>.json` showing exactly the 8 hub keys (no `author`/`difficulty`/`language`/`mapCredit`).

### E2E (deferred — recorded for the next spec cycle)

A live import into the open-historia web app at
`https://openhistoria.com/import` and visual confirmation that the map
renders with owner colors is **not in scope** for this plan (the host has
no signed-in Pax profile and the open-historia app is on a separate
domain). Recorded here so a follow-up spec knows to verify the final
visual rendering.

## Progress Tracking

- [x] Task 1: Restore `data.game.round: 1`
- [x] Task 2: Drop non-canonical `data.world` extras
- [x] Task 3: `check-hub-conformance.ts` script
- [x] Task 4: `export-and-check.ts` UID runner
- [x] Task 5: bun:test wrapper + package.json scripts
- [x] Task 6: README + plan status update
- [x] Task 7: Normalize UUID region keys to integers + drop `backgroundData` from assets

## Implementation Tasks

(see per-task detail above)

## Deferred Ideas

- **ISO-3 → historical-codes mapping in `canonicalize.ts`** — hub
  bundles use 3-4 char Pax-style codes (`ABBS`, `ARAG`, `ARM_C`,
  `AYY`); ours emit ISO-3. Bridging that gap would let
  `data.world.ownerCodes` carry hub-equivalent values. Out of scope
  here; would require a Pax-side code source we don't currently
  capture.
- **Live E2E in open-historia's import UI** — requires a browser
  session against `openhistoria.com` (out of scope per CLAUDE.md
  Live-Target Probe tier limits; we have no live target for the
  web app on this host). Next /spec cycle after this one should
  attempt tier-1/2 verification against a deployed open-historia
  instance if the user provides one.
- **CI integration** — add `bun run check-hub-conformance` to a
  GitHub Actions workflow against
  `Open-Historia/Open-historia-scenarios` cloned at the workflow's
  checkout step. Out of scope (no CI config in this repo today).