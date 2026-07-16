# Pax Historia → Open Historia Hub Schema Alignment Plan

Created: 2026-07-16
Agent: Claude Code
Status: PENDING
Approved: No
Iterations: 0
Worktree: No
Type: Feature

Supersedes: `2026-07-16-paxhistoria-preset-exporter.md` (VERIFIED) — the prior plan
made a deliberate choice to keep integer-string `regionOwnershipOverrides` keys and
omit `scenario.accentColor`/`countryNameOverrides`. The audit on 2026-07-16 against
`/home/john/Projects/Open-historia-scenarios/bundles/*.json` (6 release-shipped
official bundles) and the in-repo oracle `/home/john/Projects/OpenHistoria-Presets/example.json`
shows both choices diverge from the importer-validated schema. The old plan stays
for reference but the new behavior implemented under this plan will supersede it.

## Summary

**Goal:** After this plan lands, the bundle emitted by `tools/preset-exporter/src/transform.ts`
is byte-shape-compatible with `example.json` (the oracle) and the 6 hub bundles
shipped in `Open-historia-scenarios/bundles/` — meaning any Pax UID captured and
exported today produces a bundle that the importer accepts and renders with the
same region ownership, owner colors, prompts, and game-start context as a hub
bundle.

Scope per Batch 1 alignment with the user:

- **Full match with oracle/hub** — every field in `example.json` + `medieval-1200.json`
  that we currently get wrong or omit gets fixed/added.
- **Keep both `--mode light` and `--mode full`** as separate flag values (no
  default change). `auto` still resolves to `full` (matches today's behavior).

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

**Chosen:** Minimal-patch refactor of `transform.ts` + `canonicalize.ts` +
`bundle.ts` so the emitted bundle aligns with the oracle shape. New helpers in
`canonicalize.ts` (synthetic `Z##` codes for unmapped polities), new mappers in
`transform.ts` (region keys, prompt roles, scenario extras), and an extended
world/scenario block derived from `preset.extras` + `editor.advancedSettings`
where available, defaulted where not.

**Why:** The exporter's current architecture (pure transform + bundle writer)
is sound. The shape drift is in three functions (`deriveGame`, `derivePrompts`,
the regionOwnership loop) and the asset emission block. Patching those plus
extending `ScenarioBundle` in `types.ts` is smaller than a broader rewrite and
preserves the fast ~100ms offline transform path.

## Context for Implementer

- **Schema oracle is `example.json` + the 6 hub bundles, not the prior plan.**
  Hub bundles (`/home/john/Projects/Open-historia-scenarios/bundles/*.json`) are
  release-mirrored and maintained by open-historia — they are the canonical
  shape. Our `example.json` is one of them (Modern Day scenario); use it as
  the primary reference, hub bundles as cross-checks across modes/eras.
- **Region ownership key format is the key rendering fix.** The current
  `regionOwnershipOverrides[index]` (bare int-string) does not match the
  importer's expectation; the importer matches ownership keys against
  GeoJSON `Feature.properties.id` to color the map. Our GeoJSON features set
  `properties.id` to the same int-string, so internal consistency holds —
  but the importer internally expects `<ISO3>.<n>_<v>`. Setting the canonical
  key format **in both places** (override key + feature id) is what makes
  the map render with owner colors.
- **Editor data is captured but mostly ignored by the transform.** The Pax
  capture writes `editor.json` (4.5MB for `undXAyQbz7OwIXfIZLXL`). Its
  `editor.aiPrompts` keys are Pax-specific (e.g. `chatWithUser`); open-historia
  uses different keys (`advisor`). `editor.advancedSettings.rulesText` is the
  source of `world.simulationRules`. Reading these is the gap.
- **Synthetic codes for unknown polities must be deterministic.** If "Habsburg
  Monarchy" is unmapped, it must get the same code across runs (same preset →
  same bundle, modulo `exportedAt`). Use `Z##` (Z01, Z02, …) seeded by a hash
  of the polity name so the same name always maps to the same code in the
  same export, with collision avoidance by scanning the canonical code set.
  This mirrors the `Z02`/`Z03` style seen in `example.json`'s `polityOverrides`.

## Assumptions

- The Pax capture files (`preset.json`, `editor.json`, `features.json`,
  `geometry.json`) are unchanged from what we just verified — extend
  `types.ts` readers rather than re-running pax-ripper for this plan.
  (Tasks 1–3 depend on this.)
- The importer treats absent `world.simulationRules` / `world.allowedUnitTypes`
  / `world.startingTimelineText` / `world.ownerCodes` as "use defaults"
  rather than as missing-field errors. Hub bundles carry them; ours will
  too where we have data, omit where we don't. (If this assumption is wrong,
  Task 8's last DoD falls back to investigating importer source for
  per-field semantics.)
- `scenario.countryNameOverrides` can be empty `{}` for presets where every
  polity canonicalizes to a known code — the oracle ships an empty
  `countryNameOverrides` for Modern Day (Modern Day's polities are
  real-world ISO-3 resolvable already).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Synthetic `Z##` codes collide with `TABLE` entries we just edited | Low | A known polity's owner color disappears | Task 2 seeds from SHA-1 of name mod 100, then linearly scans increasing digits until unused; test asserts uniqueness against current `TABLE` |
| `editor.aiPrompts` role keys don't line up with oracle (Pax `chatWithUser` ≠ open-historia `advisor`) | Certain (we already know) | Bundle imports but prompts are unparsed | Task 4 enumerates the role map (`chatWithUser→advisor`, `chatWithUser→leader`, `actions→actions`, etc.) covered by tests; missing Pax prompts become empty strings in the bundle so the importer's default kicks in |
| `editor.extras.initialPresetData.startDate` not present in all presets | High | `game.startDate` and `world.startingTimelineText` will be empty for some bundles | Plan §Context declares this acceptable; hub bundles with empty strings are still valid imports (Modern Day captures it but Bronze 1200BC may not); test covers the empty-string path |
| Hub mode `light` ≠ exporter mode `light` (importer may route them differently) | Medium | Bundles produced by `--mode light` may still render uncolored | Task 1 only adjusts `transform.ts` mode value label, not the tier semantics (full-tier still emits full GeoJSON payloads); the test in Task 6 verifies `--mode light` and `--mode full` both produce importable shapes against `example.json` |
| Plan supersession breaks downstream tooling that depended on the old plan's bundled structure | Low | Other tools reading `out/<uid>.json` reject the new fields | Old plan's `bundle.ts` validation is a SUPERSET now (more keys allowed, fewer missing); old consumers should be fine. Document the change in README.md |

## File Structure

No new files — all changes are in existing modules:

- `tools/preset-exporter/src/types.ts` (modify) — extend `ScenarioBundle` shape to include `scenario.{eyebrow, heroTitle, heroSubtitle, subtitle, accentColor, countryNameOverrides}`, `data.game.{round}`, `data.world.{ownerCodes, allowedUnitTypes, simulationRules, startingTimelineText, difficulty, language, author, mapCredit}`.
- `tools/preset-exporter/src/canonicalize.ts` (modify) — add `syntheticCode(name, usedCodes) → "Z##"` and `TABLE` lookup unchanged. New table entries added as needed.
- `tools/preset-exporter/src/transform.ts` (modify) — `deriveGame`, `derivePrompts`, `deriveScenario`, `deriveWorldExtras`, `buildRegionOwnershipOverrides` (new), synthetic code integration in `buildRegionsFeatureCollection` and `deriveGame`.
- `tools/preset-exporter/src/bundle.ts` (no structural change) — `validateBundle` already passes (allowed keys are non-strict).
- `tools/preset-exporter/tests/transform.test.ts` (extend) — add cases for unknown polity synthetic code, prompt mapping, region-override format, scenario extras.
- `tools/preset-exporter/tests/contract.test.ts` (extend) — assert emitted bundle matches `example.json` `data.world.regionOwnershipOverrides` key format (first key matches `<ISO3>\.<n>_<1>`) and `data.prompts` is flat role-keyed.
- `README.md` (modify) — `## Output Format` block reflect oracle shape; `scenario` block shows new fields; cite `/home/john/Projects/Open-historia-scenarios/bundles/*.json` as canonical schema reference.

## Implementation Tasks

### Task 1: Extend `ScenarioBundle` type to cover oracle fields

**Objective:** Add the missing `scenario.*` and `data.world.*` fields from
`example.json` to `ScenarioBundle` in `types.ts` so downstream tasks can
populate them without further type changes. Mark all new fields as optional
on the input side; the bundle writer will pass them through.

**Files:**

- Modify: `tools/preset-exporter/src/types.ts`

**Key Decisions / Notes:**

- Fields to add to `scenario`: `eyebrow?: string`, `heroTitle?: string`,
  `heroSubtitle?: string`, `subtitle?: string`, `accentColor?: string`,
  `countryNameOverrides?: Record<string, string>`.
- Fields to add to `data.world`: `ownerCodes?: string[]`,
  `allowedUnitTypes?: string[]`, `simulationRules?: string`,
  `startingTimelineText?: string`, `difficulty?: string`,
  `language?: string`, `author?: string`, `mapCredit?: string`.
- **Drop** any mention of `data.game.round`. The oracle
  (`example.json:22-28`) carries `country, startDate, gameDate,
  difficulty, language` and nothing else. A previous audit version of this
  plan claimed the oracle wanted `round: 1`; that was wrong — the
  spec-review flagged it as a fabrication, and a `jq '.data.game | keys'`
  confirms only the 5 oracle keys exist.
- `data.prompts` becomes `Record<string, string | Record<string, string>>`
  — values are strings OR nested role→string maps (for `helpers` /
  `tasks` / similar nested entries; oracle carries these in some bundles
  but not all, and missing keys must coerce to `{}` rather than be dropped).
- `data.world.polityOverrides` changes from
  `Record<string, { name: string }>` to
  `Record<string, { code: string; name: string; aliases: string[]; color: string; note: string }>`
  — the oracle's full shape. The current `{code: {name}}` form cannot
  carry per-polity color and was identified by spec-review as the
  load-bearing gap for unmapped-polity rendering.
- `PaxEditor` (the capture-side interface) must gain
  `advancedSettings?: { rulesText?: string; raw?: Record<string, unknown>;
  consolidationSettings?: unknown }` and `aiPrompts` becomes
  `Record<string, string | { firstStage?: { template?: string };
  templateHelpers?: Record<string, string> }>` so Task 4 / Task 6 read
  paths typecheck rather than silently fail at runtime.
- Do not change types on existing fields — purely additive where
  possible; the `polityOverrides` and `prompts` shape changes are
  breaking and need a contract-test update.

**Definition of Done:**

- [ ] `ScenarioBundle` type compiles under `bun run typecheck` with all new optional fields.
- [ ] Existing `transform.test.ts` and `bundle.test.ts` still pass without modification (additive-only).
- [ ] Verify: `bun run typecheck`.

### Task 2: Add synthetic `Z##` code generator to `canonicalize.ts`

**Objective:** When `canonicalize(polityName)` doesn't find a match, return a
deterministic synthetic `Z##` code (e.g. `Z42`) seeded by the polity name's
hash, confirmed unused in the current `TABLE` + all polities observed in
this export. Expose a separate `syntheticCode(name, usedCodes)` for direct
use by the transformer.

**Files:**

- Modify: `tools/preset-exporter/src/canonicalize.ts`
- Test: `tools/preset-exporter/tests/canonicalize.test.ts`

**Key Decisions / Notes:**

- Implementation: hash the name (SHA-1 → mod 99 + 1 → "Z" + 2-digit).
  On collision (already in `usedCodes`), increment until unused.
  `usedCodes` is built from `TABLE` values + this export's already-seen
  polity codes.
- `canonicalize()` returns `{ code, name }` (unchanged shape) — but
  `code` is now `Z##` for unmapped names. The transformer treats the
  return value the same.
- Add `tableSize()` already exists — extend `usedCodes()` helper to return
  `new Set(Object.values(TABLE))`.

**Definition of Done:**

- [ ] `syntheticCode("Habsburg Monarchy", new Set(["USA","FRA"]))` returns `"Z42"`-style (any `Z\d{2}`) and not in the input set.
- [ ] Same name twice yields the same code (deterministic).
- [ ] Collision case: with `usedCodes = {"Z01","Z02"}` and `name = "X"`, output is `"Z03"` or later, never one of the used.
- [ ] Collision case against full oracle set: with
  `usedCodes = new Set([...Object.values(TABLE), "Z01","Z02","Z03","Z04",
  "Z05","Z06","Z07","Z08","Z09"])` (the oracle-observed Z## codes), the
  returned synthetic code is NOT in that set.
- [ ] Existing canonicalize tests still pass (unchanged behavior for mapped names).
- [ ] Verify: `bun test tools/preset-exporter/tests/canonicalize.test.ts`.

### Task 3: Build region ownership + GeoJSON feature IDs in canonical `<ISO3>.<n>_<v>` format

**Objective:** Replace `buildRegionsFeatureCollection`'s integer-string `id`
and `regionOwnershipOverrides`'s integer-string key with the
`<ISO3>.<n>_<v>` format where `<n>` is the Pax region index from
`geometry.json` (the integer string the capture already keys by, e.g.
`"3"`, `"83"`) and variant `<v>` defaults to `1`. Verified against the
oracle: `example.json:3730+` shows `AFG.10_1, AFG.11_1, ..., RUS.3_1,
RUS.83_1` — those suffixes are the Pax integer region indices, NOT a
sequential per-owner counter (AFG owns 30+ regions, not just `1`).
The importer matches override keys against `Feature.properties.id`;
both must use the same Pax index.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- `buildRegionsFeatureCollection` writes
  `properties.id = \`${canonical.code}.${index}_1\`` and the override map
  uses the same string as the key with `canonical.code` as the value.
- The Pax `index` is the original integer-string from `geometry.json`'s keys.
  Use it as the `<n>` component.
- For polities whose canonical name fails the `TABLE` lookup, rely on the
  new `syntheticCode` from Task 2 — owners get a `Z##` code, which is what
  the oracle uses (`polityOverrides["Z02"] = {...}` style).
- The `colors` data and `polityOverrides` map must also use the synthetic
  code when present, so a region's lookup against `colors[code]` resolves.

**Definition of Done:**

- [ ] Each key in `data.world.regionOwnershipOverrides` matches `^[A-Z]{3}\.\d+_1$` (regex).
- [ ] Each `assets.regionsGeojson` Feature `properties.id` matches the same regex.
- [ ] Each override key value equals `regionFeature.properties.owner`.
- [ ] When the Pax first polity is unmapped (e.g. "Electorate of Cologne"), the synthetic `Z##` is used, not the raw name.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 4: Map `editor.aiPrompts` to flat open-historia role keys

**Objective:** Rewrite `derivePrompts` so `data.prompts` aligns with the
oracle: a map where each value is **either a `string` (role prompts like
`advisor`, `actions`, `gameMaster`) OR a nested `Record<string,string>`
(`helpers`, `tasks`)**. The Pax `editor.aiPrompts` keys (verified at
`presets/undXAyQbz7OwIXfIZLXL/136/editor.json`: `actions, autoJumpForward,
catalystCreation, catalystRunner, catalystSummarizer, chatWithAdvisor,
chatWithUser, descriptionToAction, eventConsolidator, gameMaster,
jumpForward, nextSpeaker`) need to be mapped to the open-historia role
set observed in `example.json`: `advisor, leader, actions, autoJumpForward,
catalystCreation, catalystExecutor, catalystSummary, descriptionToAction,
eventConsolidator, gameMaster, jumpForward, nextSpeaker, helpers, tasks`.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Modify: `tools/preset-exporter/src/types.ts` (Task 1 widened `prompts` to `Record<string, string | Record<string, string>>`)
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- Pax-key → open-historia role map (derived from observed Pax keys vs.
  observed oracle keys):
  `chatWithUser → advisor`, `chatWithAdvisor → leader`, `actions → actions`,
  `autoJumpForward → autoJumpForward`, `catalystCreation → catalystCreation`,
  `catalystRunner → catalystExecutor`, `catalystSummarizer → catalystSummary`,
  `descriptionToAction → descriptionToAction`,
  `eventConsolidator → eventConsolidator`, `gameMaster → gameMaster`,
  `jumpForward → jumpForward`, `nextSpeaker → nextSpeaker`.
- The Pax prompt value is typically a string (per the capture), but the
  `PaxEditor` interface should accept either `string` or a nested object
  with `firstStage.template`; tolerate both. Extract the joined template
  string. If neither path yields a string, emit `""`.
- Roles without a Pax counterpart (`helpers`, `tasks`, plus any oracle
  role whose Pax source is absent) get `{}` (for `helpers`/`tasks`) or
  `""` (for plain string roles) — the importer falls back to its built-in
  template for that role.
- The oracle's `data.prompts.helpers` and `data.prompts.tasks` are nested
  `Record<string, string>` maps (e.g. `helpers.ALL_ADVISOR_MESSAGES`,
  `tasks.actions`). These are NOT derived from Pax — the source is
  `editor.templateHelpers` (verified in `editor.json`) which has the same
  key shape (`ALL_ADVISOR_MESSAGES`, etc.). Pass those through to
  `prompts.helpers` and `prompts.tasks`. If absent, both emit `{}`.

**Definition of Done:**

- [ ] `data.prompts` keys are a subset of the 14 observed open-historia role names (12 string roles + `helpers` + `tasks`).
- [ ] String roles have `string` values; `helpers` and `tasks` have `Record<string,string>` values (or `{}` if capture has none).
- [ ] When `editor.aiPrompts.chatWithUser === "You are..."`, `data.prompts.advisor === "You are..."`.
- [ ] When `editor.templateHelpers.ALL_ADVISOR_MESSAGES === "${advisorMessages}"`, `data.prompts.helpers.ALL_ADVISOR_MESSAGES === "${advisorMessages}"`.
- [ ] When `editor.aiPrompts` is missing entirely, all 12 string roles emit `""` and `helpers`/`tasks` emit `{}`.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 5: Trim `deriveGame` to the oracle's 5 keys, use synthetic codes

**Objective:** Make `deriveGame` produce the same keys as the oracle —
exactly `country`, `startDate`, `gameDate`, `difficulty`, `language` (5
keys, NO `round`) — and drop the extras we currently add (`presetID`,
`presetVersion`, `title`) which the oracle doesn't carry. Use the
synthetic code generator when the first polity is unmapped so
`data.game.country` is always a code.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- The oracle has no `round` key (verified by `jq '.data.game | keys'
  example.json` returning exactly those 5). A previous plan version
  invented `round: 1`; spec-review flagged this as fabrication, and the
  task now drops it.
- Always emit exactly 5 keys: `country`, `startDate`, `gameDate`,
  `difficulty`, `language`. The exporter's current emit drops `startDate`,
  `gameDate`, `difficulty`; restore them (read from
  `preset.extras.initialPresetData` where present, else `""`).
- `country` continues to come from `canonicalize(firstPolity).code` —
  but with Task 2's synthetic-code path, unknown polities now yield a
  `Z##` code, never a raw name.
- `language` defaults to `"English"`; `difficulty` defaults to `"standard"`.

**Definition of Done:**

- [ ] `data.game` has exactly these 5 keys: `country`, `startDate`, `gameDate`, `difficulty`, `language` (in that order or any stable order — assertion is on key set, not insertion).
- [ ] `data.game` has NO `round`, `presetID`, `presetVersion`, or `title` keys.
- [ ] For unmapped first polity, `data.game.country` is `Z##` not the raw name.
- [ ] For "United States" first polity, `data.game.country === "USA"`.
- [ ] Existing tests still pass.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 6: Add scenario + world extras (accentColor, countryNameOverrides, ownerCodes, etc.)

**Objective:** Populate the optional fields added in Task 1 with values
derived from the capture. Defaults where data is absent (the importer
falls back to its built-ins). Most importantly: rewrite
`data.world.polityOverrides` from the current `{code: {name}}` shape to
the oracle's `{code: {code, name, aliases, color, note}}` shape — the
load-bearing field for owner-color rendering on unmapped polities.

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Modify: `tools/preset-exporter/src/types.ts` (the Task 1 type change covers this)
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- New helper `deriveScenario(preset, polities, reverseLookup)` →
  `{ eyebrow: "Scenario", heroTitle: preset.title, heroSubtitle: "",
  subtitle: "", id: preset.id, name: preset.title,
  description: preset.description, accentColor: "#7c3aed",
  countryNameOverrides: { code: displayName } }`.
- `accentColor` default to `#7c3aed` (the value the oracle's Modern Day
  uses; the importer has a built-in fallback if absent, so the exact
  default doesn't matter — pick something neutral).
- `countryNameOverrides` built from polities: each Pax polity maps to
  `code → polity.name`; for unmapped polities the code is the synthetic
  `Z##` and the value is the original name. Empty `{}` for presets
  where every polity canonicalizes.
- New helper `deriveWorldExtras(polities, editor)` →
  `{ ownerCodes: [unique codes], allowedUnitTypes: ["infantry","armor",
  "air","naval","artillery","garrison"] (the oracle's six),
  simulationRules: editor?.advancedSettings?.rulesText ?? "",
  startingTimelineText: "", difficulty: "standard", language: "English",
  author: "", mapCredit: "" }`.
- `ownerCodes` is the sorted unique list of all canonical codes used in
  this export, **plus** the `Z01-Z09` codes observed in `example.json`'s
  `world.ownerCodes` array (so the importer's validation list stays
  stable even when our export has no synthetic Z## entries). Use
  `Array.from(new Set([...Object.values(TABLE), "Z01","Z02","Z03","Z04",
  "Z05","Z06","Z07","Z08","Z09", ...exportUsedCodes])).sort()`.
- `allowedUnitTypes` always emitted (the importer lists these as the
  universal six — match the oracle exactly).
- `author` defaults to `""` (we don't have the Pax author's display name
  without scraping the profile; `preset.authorUID` is a UID, not a name).
- **`polityOverrides` rewrite** (the main fix from this task): emit
  `{ code: { code: <canonical>, name: <polity.name>,
  aliases: <string[]> (Pax carries none — emit `[]`),
  color: <p.color ?? fallback grey>,
  note: "" } }` for every canonical code that appears in
  `regionOwnershipOverrides.values()` OR `countryNameOverrides` OR the
  capture's polities list. The current
  `{ code: { name: string } }` shape is insufficient — the importer
  reads `polityOverrides[code].color` and `.aliases` for unmapped
  polities. For Pax-captured polities, `color` comes from
  `p.color` (verified: `features.json` polities carry
  `{ id, name, color, leaderName }`); for synthetic Z## codes, derive a
  deterministic color by hashing the code to RGB (or use a shared
  neutral `#888888` fallback — the importer has its own fallback if
  absent).

**Definition of Done:**

- [ ] `scenario` has all 9 oracle keys (`accentColor`, `countryNameOverrides`, `description`, `eyebrow`, `heroSubtitle`, `heroTitle`, `id`, `name`, `subtitle`).
- [ ] `scenario.countryNameOverrides` is a `Record<string,string>` (never null), keyed by canonical code; test asserts `Object.values(countryNameOverrides).includes("Electorate of Cologne")` when the Pax capture has that polity.
- [ ] `world.polityOverrides` is `Record<string, { code, name, aliases, color, note }>` (every entry has all 5 keys; `aliases` is `[]`, `note` is `""`).
- [ ] `world.ownerCodes` includes `Z01` through `Z09` plus all canonical codes used in this export.
- [ ] `world.allowedUnitTypes` is exactly `["infantry","armor","air","naval","artillery","garrison"]`.
- [ ] `world.simulationRules` equals `editor.advancedSettings.rulesText` when present, else `""` (verified `rulesText` exists in the capture).
- [ ] Existing transform tests still pass after type widening.
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`.

### Task 7: Add `contentType` and `encoding: "base64"` to GeoJSON asset entries

**Objective:** Bring `assets.regionsGeojson` and `assets.citiesGeojson` to
parity with the oracle, which carries `mode`, `fileName`, `encoding`,
`contentType`, `data` (5 keys) on every embedded geojson asset. Today we
emit 4 of those (missing `contentType`).

**Files:**

- Modify: `tools/preset-exporter/src/transform.ts`
- Test: `tools/preset-exporter/tests/contract.test.ts`

**Key Decisions / Notes:**

- GeoJSON is always `application/geo+json` (per RFC 7946, the documented
  type). `deriveContentType` already exists for image files; add a
  constant for geojson or inline `"application/geo+json"`.
- The `types.ts` `BundleAssets` type already encodes `encoding` for
  geojson — no type change needed.

**Definition of Done:**

- [ ] `assets.regionsGeojson` has exactly these keys: `mode, fileName, encoding, contentType, data`.
- [ ] `assets.regionsGeojson.contentType === "application/geo+json"`.
- [ ] Same for `assets.citiesGeojson`.
- [ ] Existing `contract.test.ts` "cover has encoding+contentType" test still passes (unchanged cover behavior).
- [ ] Round-trip test: decode `assets.regionsGeojson.data` (base64) → JSON.parse → assert first feature `properties.id` matches `^[A-Z]{3}\.\d+_1$` and the FeatureCollection parses as valid GeoJSON (has `type === "FeatureCollection"` and `features` array).
- [ ] Verify: `bun test tools/preset-exporter/tests/contract.test.ts`.

### Task 8: Regenerate the two committed bundles + verify against hub shape

**Objective:** End-to-end smoke: regenerate `out/undXAyQbz7OwIXfIZLXL.json`
(and `out/modern-day.json` if applicable — see notes) from the existing
on-disk capture, then run a contract-style validation asserting the new
bundle's shape matches `example.json` for every key the oracle has.

**Files:**

- Regenerate: `out/undXAyQbz7OwIXfIZLXL.json` (via `bun run export --offline presets/undXAyQbz7OwIXfIZLXL/136/ --output ./out/undXAyQbz7OwIXfIZLXL.json --force`)
- Optionally regenerate: `out/modern-day.json` (only if a capture exists at
  `presets/1Alm1zD4pXpGyfWwkch1/79/`; this plan does NOT re-run the capture)
- Test: extend `tools/preset-exporter/tests/contract.test.ts` with a hub-conformance test

**Key Decisions / Notes:**

- The new contract test reads `medieval-1200.json` from
  `/home/john/Projects/Open-historia-scenarios/bundles/` (a real hub
  bundle), asserts that our emitted bundle's `data.game`, `data.prompts`
  sample (advisor key, type=string), and
  `data.world.regionOwnershipOverrides` key format match.
- If a `out/modern-day.json` capture doesn't exist on disk, skip the
  regeneration of that artifact; the regenerated
  `out/undXAyQbz7OwIXfIZLXL.json` is enough to prove the path works.
- After regeneration, manually re-verify in browser via open-historia's
  import UI per the prior plan's Live-Target Probe — out of scope for
  unit tests; noted in Goal Verification.

**Definition of Done:**

- [ ] `out/undXAyQbz7OwIXfIZLXL.json` regenerated from the on-disk capture.
- [ ] `bun run check-reference` passes (if a reference fixture exists).
- [ ] `bun test tools/preset-exporter/tests/` passes 0 failures.
- [ ] New contract test asserts top-level `data.world.regionOwnershipOverrides` first key matches `^[A-Z]{3}\.\d+_1$` and `data.prompts.advisor` is a string.

## Goal Verification

### Truths

1. **Pax-derived bundle is byte-shape compatible with the oracle.**
   `out/undXAyQbz7OwIXfIZLXL.json` regenerated after this plan lands and
   its top-level keys, `data.*` keys, and `assets.*` keys match
   `example.json` (modulo `mode` value when `--mode full`). Verified by the
   extended `contract.test.ts` + a one-shot `jq`-driven diff.
2. **The map renders with owner colors after import.** The prior plan's M2
   finding (bare integer keys, map rendered uncolored) is gone because the
   override keys match the GeoJSON feature ids in the new format. Verified
   by importing the regenerated bundle in open-historia's play screen
   (manual E2E follow-up; out of scope for unit verification but called
   out so the next spec knows to confirm in browser).
3. **Unknown polities get a deterministic synthetic code.** A Pax capture
   where the first polity is "Electorate of Cologne" produces a bundle
   whose `data.game.country` is `"Z42"`-style and whose
   `scenario.countryNameOverrides["Z##"]` is `"Electorate of Cologne"`.
   No `game.country === "Electorate of Cologne"` raw-name leak.

## E2E Test Scenarios

(Existing TS-001 / TS-002 / TS-003 from the prior plan remain valid. Add
TS-004 below.)

### TS-004: Hub conformance — emitted bundle matches a hub bundle's shape

**Priority:** Critical
**Preconditions:** A `presets/<UID>/<version>/` capture exists (use the
`undXAyQbz7OwIXfIZLXL/136/` capture from the earlier session).
**Mapped Tasks:** Tasks 3, 4, 5, 6, 7, 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run export --offline presets/undXAyQbz7OwIXfIZLXL/136/ --output ./out/undXAyQbz7OwIXfIZLXL.json` | Exit 0; `out/undXAyQbz7OwIXfIZLXL.json` exists. |
| 2 | `jq '.data.world.regionOwnershipOverrides | keys[0]' ./out/undXAyQbz7OwIXfIZLXL.json` | Matches `^[A-Z]{3}\.\d+_1$` (e.g. `"TUR.13_1"`) |
| 3 | `jq '.data.prompts | keys' ./out/undXAyQbz7OwIXfIZLXL.json` | Subset of `[advisor, leader, actions, autoJumpForward, catalystCreation, catalystExecutor, catalystSummary, descriptionToAction, eventConsolidator, gameMaster, jumpForward, nextSpeaker, helpers, tasks]` |
| 4 | `jq '.data.game | keys' ./out/undXAyQbz7OwIXfIZLXL.json` | Exactly `[country, startDate, gameDate, difficulty, language]` (5 keys, no `round`) |
| 5 | `jq '.scenario | keys' ./out/undXAyQbz7OwIXfIZLXL.json` | Contains `accentColor, countryNameOverrides` |
| 6 | `jq '.assets.regionsGeojson | keys' ./out/undXAyQbz7OwIXfIZLXL.json` | Contains `contentType` |
| 7 | `jq '.data.world.polityOverrides | to_entries[0].value | keys' ./out/undXAyQbz7OwIXfIZLXL.json` | Exactly `[code, name, aliases, color, note]` |
| 8 | `jq '[.data.game | keys, .scenario | keys, .data.world | keys] | add' ./out/undXAyQbz7OwIXfIZLXL.json` | Superset of `example.json`'s `data.game` ∪ `scenario` ∪ `world` keys — every oracle key present in the emitted bundle. (The Pax capture may lack some world extras; the assertion is on the shape, not completeness.) |
| 9 | `bun test tools/preset-exporter/tests/` | All tests pass; new hub-conformance contract test passes |

## Progress Tracking

- [ ] Task 1: Extend `ScenarioBundle` type
- [ ] Task 2: Synthetic `Z##` codes
- [ ] Task 3: Region ownership + GeoJSON feature IDs in canonical format
- [ ] Task 4: Flat role-keyed prompts
- [ ] Task 5: `deriveGame` polish (round, drop extras)
- [ ] Task 6: Scenario + world extras
- [ ] Task 7: GeoJSON `contentType`/`encoding` on assets
- [ ] Task 8: Regenerate + verify against hub

## Implementation Tasks

(see per-task detail above)

## Deferred Ideas

- `world.simulationRules` and `world.startingTimelineText` may benefit from
  richer per-preset templates derived from editor data — capture this as a
  follow-up if `editor.advancedSettings.rulesText` proves insufficient in
  practice. Out of scope here.
- Hub bundles carry `world.polityOverrides` as `{code, name, aliases, color,
  note}`-shaped; our `polityOverrides` is `{code: {name}}`. The richer shape
  is also derivable from Pax polities (each has color + name) — flagged for
  a follow-up plan when `world.polityOverrides` shape becomes a contract.
