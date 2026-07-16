# Pax Historia → Open Historia Preset Exporter Implementation Plan

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

## Summary

**Goal:** After this plan lands, a user with a Pax Historia preset UID can run a CLI in this repo that captures the preset (Playwright + persistent Chrome profile) and emits a single JSON file at `out/<name>.json` that open-historia's `importScenarioBundle` accepts and renders identically to a Pax-hosted game — full tier-2 geometry, custom cities, embedded PMTiles overrides, and cover image.

PRD: `docs/prd/2026-07-16-paxhistoria-preset-exporter.md`.

## Approach

**Chosen:** Vendor `Peace-History/tools/pax-ripper/` as `OpenHistoria-Presets/tools/pax-ripper/`, then add a sibling `tools/preset-exporter/` that reuses pax-ripper's capture output (`preset.json`, `geometry.json`, `features.json`, `editor.json`, `landing.png`, `manifest.json`) and runs an additional `transform → bundle` step that emits one open-historia-importable JSON.

**Why:** Reusing pax-ripper's capture pipeline avoids re-implementing the Playwright, Play Now → country → game start, Firestore Listen extraction, and CDN-fetch logic that already works against `paxhistoria.co`. The transformation is a new, narrow concern (PaxCapture → scenario bundle) that's easier to test in isolation with a `--offline` mode.

**Vendored pax-ripper is dual-purpose:** it remains a callable CLI (`bun run tools/pax-ripper/src/index.ts …`) for users who want raw capture without bundling, AND its internal modules are imported as a library by `tools/preset-exporter`. Both entry points are first-class — Task 1 preserves the standalone `--help` DoD, and Task 6 invokes the modules directly (it does NOT spawn `tools/pax-ripper/src/index.ts` as a subprocess).

**Tier reality:** Pax regions are integer-indexed (`"0"`, `"1"`, …) and never match open-historia's GADM-tagged stock `regions.pmtiles`. Every Pax preset therefore ships as a **tier-2 bundle** (`regionsGeojson` + `citiesGeojson` + `customRegions: true` + `customCities: true`). The `--mode` flag stays in the CLI for forward-compat with the PRD, but `auto` always resolves to `full` today.

## Out of Scope

- Live game state import (chat, resolved actions, advisor notes). Per the PRD these become empty arrays — the open-historia bundle is a starting template, not a saved game.
- Reverse direction (open-historia → Pax export).
- Schema migration across `pax-historia-scenario-bundle` versions. Locked to `version: 1`.
- Continuous sync / watcher mode. One-shot CLI.
- Web UI. CLI only; open-historia already has the import UI.

## Context for Implementer

A few cross-task constraints that more than one task needs to respect:

- **All seven `data.*` keys must be present** (`actions, advisor, chat, events, game, prompts, world`). Per `libraryStore.js:735-740`, missing keys are coerced to `{}`/`[]` and **overwrite** the seeded defaults — a partial bundle yields an empty scenario, not a default-content scenario. Test the round-trip in Task 7.
- **`world.customRegions: true` + `assets.regionsGeojson.mode === "embedded"`** is required for the region layer to render (`Game/Map/Nations.jsx:374-394`). Test that the transformer always sets both.
- **`world.customCities: true` + `assets.citiesGeojson.mode === "embedded"`** mirrors the cities layer (`Game/Map/Cities.jsx:177-189`).
- **Owner codes** must align between `world.regionOwnershipOverrides` and `colors` (`assets.colors.data`). If a polity name in Pax's `regionOwnership` map can't be canonicalized, keep the original name string in both keys — open-historia will fall back to the name-based resolver (`models.js:97` `canonicalizeCountryRef` returns the raw value when no mapping exists).
- **Captured `regionOwnership` keys are integer strings.** Renaming them to `pax-<n>` is required because open-historia's region id space is open-ended strings, but the integer string is already non-colliding and shorter — leave them as is, with `owner` + `name` carried in the regions GeoJSON.

## Runtime Environment

- **Bun runtime** (matches open-historia + pax-ripper). No build step; both `tools/pax-ripper/src/index.ts` and `tools/preset-exporter/src/cli.ts` are run with `bun run`.
- **Playwright + Chromium** for capture (persistent profile at `~/.config/pax-ripper/browser-profile/`, identical to pax-ripper).
- **No server to start.** This is a CLI; nothing long-running.

## Assumptions

- The Pax team has not changed the `simplePresets/{id}` Firestore REST shape or the `map-geometry.paxhistoria.co` URL pattern since pax-ripper was last validated (June 2026). If the shape changes, only `transform.ts` and `pmtiles.ts` need to change — Tasks 1, 6, 8 are unaffected.
- pax-ripper's existing TS modules continue to work when invoked as a library (their entry points already accept Playwright `Page` objects; the wrapper at `src/index.ts` is one-shot CLI glue we can skip).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pax changes auth/copy flow → capture silently fails to produce `features.json` | Medium | Bundle ships without cities/polities/ownership | Task 3's transformer **always emits regionsGeojson even when features are empty** (from geometry.json alone, with empty `regionOwnershipOverrides`); the bundle still imports, the user just gets a less detailed map. CI in Task 7 validates the empty-features path explicitly. |
| PMTiles CDN returns 403/404 | Medium | Bundle ships without label/country PMTiles overrides; falls back to open-historia stock | Task 4 treats each of `cities/countries/regions` PMTiles as optional; PMTiles fetcher logs and skips missing keys; bundle still imports. Test 4 covers this. |
| Large bundle (~5 MB+ base64) exceeds open-historia's import size limit if it exists | Low | Import fails | Out-of-scope to investigate (no import size limit found in `libraryStore.js`). If reached, address in a follow-up plan (split into `.zip` per `bundleZip.js`). |
| Canonicalization table missing for "Kingdom of Greece"-style names | Certain (the table is incomplete) | Owner codes remain polity-name strings; game treats them as opaque ids | Transformer preserves the original name in `polityOverrides[<code>].name` so display is correct; the fallback path is documented and tested. A 50-entry starter table covers names observed in `/home/john/Projects/Peace-History/presets/`. |

## Goal Verification

### Truths

1. **A Pax preset UID round-trips through the CLI and an open-historia import**: importing the emitted `out/<name>.json` into open-historia produces a playable scenario with the same region geometry, owner colors, and city locations as the live Pax preset (verified visually in browser via open-historia's play screen).
2. **An already-captured preset (`out/cache/<paxID>/<version>/manifest.json` present) re-runs do not re-fetch from paxhistoria.co**: `--force` is needed to recapture; the offline transform is deterministic.

## E2E Test Scenarios

### TS-001: Single preset → importable JSON
**Priority:** Critical
**Preconditions:** A sample preset UID; no existing `out/` artifacts.
**Mapped Tasks:** Tasks 1, 2, 3, 4, 5, 6, 7, 8

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run tools/preset-exporter/src/cli.ts --preset <UID> --output ./out/<name>.json` | Exit 0; `out/<name>.json` exists; `out/<name>.json` validates against `schema === "pax-historia-scenario-bundle"` and `version === 1` |
| 2 | `jq '.data | keys' ./out/<name>.json` | List `[ "actions", "advisor", "chat", "events", "game", "prompts", "world" ]` (all 7 keys, none missing) |
| 3 | `jq '.world.customRegions' ./out/<name>.json` | `true` |
| 4 | `jq '.assets.regionsGeojson.mode' ./out/<name>.json` | `"embedded"` |
| 5 | Open `out/<name>.json` in open-historia's import UI | New scenario appears in library with the same regions/owners as on paxhistoria.co |

**Step 5 details (Live-Target Probe per `verification.md`):** The implementer must perform the 4-tier probe before claiming "I can't run live E2E": (1) reuse an already-running open-historia dev server, (2) start one via `bun run dev` per `open-historia/package.json` (Vite + Express), poll `http://localhost:5173` up to 60s, (3) attempt a Vercel/Wrangler backend deploy check (`open-historia/web-deploy.md` documents), (4) unit-only fallback acceptable if all three tiers fail. The Playwright assertion: navigate to open-historia's startup screen, click "Import Scenario", upload `out/<name>.json`, wait for the library to refresh, assert the new scenario appears with non-empty `data.world.regionOwnershipOverrides` and ≥ 100 features in the decoded `assets.regionsGeojson.data`. Acceptable as evidence even if the user's visual fidelity differs (the schema import is what the importer cares about).

### TS-002: Offline transform is hermetic (no Playwright)
**Priority:** Critical
**Preconditions:** A captured preset directory under `out/cache/<paxID>/<version>/` (can be from a prior real run or from the fixture copied in Task 7).
**Mapped Tasks:** Tasks 6, 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `bun run tools/preset-exporter/src/cli.ts --offline out/cache/<UID>/<ver>/ --output ./out/<name>.json` | Exit 0; output identical byte-for-byte (modulo `exportedAt`) to a prior run with the same inputs |
| 2 | `bun test tools/preset-exporter/tests/` | All transform/bundle tests pass; coverage of empty-features path and PMTiles-missing path verified |

### TS-003: Idempotency — re-run does not re-capture
**Priority:** High
**Preconditions:** A captured preset directory already exists.
**Mapped Tasks:** Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run the same `--preset <UID>` twice in a row without `--force` | Second run completes in < 2 s and emits a fresh `exportedAt` but does not contact `paxhistoria.co` (verify by capturing `~/.config/pax-ripper/browser-profile/` write time or by running offline-equivalent time) |

## File Structure

- `README.md` (create) — install, Chrome profile bootstrap, every CLI flag with example output paths, link to PRD.
- `.gitignore` (create) — `out/`, `cache/`, `node_modules/`, fixtures' `.png`/`.jpg` copies.
- `package.json` (create) — bun workspace root, scripts that reference `tools/preset-exporter/src/cli.ts`.
- `tools/pax-ripper/` (create, vendored verbatim) — MIT attribution in README, source files copied from `Peace-History/tools/pax-ripper/src/*.ts` (`auth.ts`, `browser.ts`, `config.ts`, `extractFromNextData.ts`, `firestoreCapture.ts`, `firestoreExtract.ts`, `index.ts`, `manifest.ts`, `ripCovers.ts`, `ripEditor.ts`, `ripExtras.ts`, `ripFeatures.ts`, `ripFlags.ts`, `ripGeometry.ts`, `ripPreset.ts`, `ripPresets.ts`, `types.ts`). `bun.lock` + `package.json` + `tsconfig.json` copied as-is.
- `tools/preset-exporter/src/cli.ts` (create) — argv parsing; orchestrates capture→transform→bundle in single/bulk/offline modes.
- `tools/preset-exporter/src/capture.ts` (create) — wraps `pax-ripper`'s capture functions; returns typed `PaxCapture`.
- `tools/preset-exporter/src/pmtiles.ts` (create) — CDN fetcher for Pax r2 PMTiles (`cities`, `countries`, `regions`), each fetched as raw bytes via `page.context().request.get` (matches `ripPreset.ts:866` `downloadTo`). Returns `pmtiles: { cities?, countries?, regions? }`.
- `tools/preset-exporter/src/canonicalize.ts` (create) — pure `polityName → ownerCode` table + reverse (`ownerCode → displayName`). 50-entry starter table for names observed in `Peace-History/presets/` (extract via grep during this task). Falls back to passthrough string for unknowns.
- `tools/preset-exporter/src/transform.ts` (create) — pure `PaxCapture → { bundle, assets }`. Embeds regionsGeojson by parsing stringified GeoJSON in `geometry.json`. Embeds citiesGeojson from `features.json`. Always sets `world.customRegions: true`, `world.customCities: true`. `game.country` set from first canonicalized owner. `prompts` mapped from `editor.aiPrompts` to open-historia keys when present; otherwise empty object.
- `tools/preset-exporter/src/bundle.ts` (create) — assembles final JSON: `{ schema, version, mode, exportedAt, scenario, data, assets }` per `libraryStore.js:721-727`. Validates. Writes `_run_summary.json` next to bundle.
- `tools/preset-exporter/src/encode.ts` (create) — base64 helper for cover, PMTiles.
- `tools/preset-exporter/tests/transform.test.ts` (create) — asserts bundle shape against fixture; covers the empty-features and PMTiles-missing paths.
- `tools/preset-exporter/tests/bundle.test.ts` (create) — asserts schema validation, asset base64 round-trip, all 7 `data.*` keys present.
- `tools/preset-exporter/tests/fixtures/modern-day/` (create) — synthetic Pax capture synthesized from `Peace-History/presets/1Alm1zD4pXpGyfWwkch1/79/` with editor.json dropped for determinism. ~600 KB total.
- `tools/preset-exporter/tests/fixtures/cold-war/` (create) — second synthetic capture from same source dir to validate that polygonal regions parse and emit valid GeoJSON (smoke for the geometry→FeatureCollection mapping).

## Progress Tracking

- [x] Task 1: Vendor pax-ripper and verify it runs
- [x] Task 2: Build canonicalize table + cross-check against real captures
- [x] Task 3: Implement core transformer (PaxCapture → bundle/assets)
- [x] Task 4: Implement PMTiles fetcher
- [x] Task 5: Implement bundle emitter + schema validation
- [x] Task 6: Wire CLI (single / bulk / offline / --force)
- [x] Task 7: Hermetic test fixtures + transform/bundle tests
- [x] Task 8: README + gitignore + end-to-end smoke + committed reference bundle

## Implementation Tasks

### Task 1: Vendor pax-ripper + verify import path

**Objective:** Copy `Peace-History/tools/pax-ripper/` (README, package.json, bun.lock, src/*.ts, tsconfig.json) into `OpenHistoria-Presets/tools/pax-ripper/` with its MIT attribution preserved, and verify the toolchain still runs in this repo.

**Files:**

- Create: `tools/pax-ripper/{README.md, package.json, bun.lock, tsconfig.json, src/*.ts}`
- Modify: `package.json` (new root, references `tools/pax-ripper` and `tools/preset-exporter` workspaces)

**Key Decisions / Notes:**

- Mirror `Peace-History/tools/pax-ripper/` byte-for-byte EXCEPT: do NOT bring `example.json` if any (the gold fixture stays in `OpenHistoria-Presets/example.json`). Do NOT bring `.codegraph/` or other hidden state.
- Add a `VENDORED.md` at `tools/pax-ripper/VENDORED.md` (or inlined note in its README) recording the upstream commit hash we vendored from, for future sync audits.
- Run `bun install` from the new root, then `bun --bun tools/pax-ripper/src/index.ts --help` (matches pax-ripper's own `rip` script). Capture stderr if it fails.

**Definition of Done:**

- [ ] `OpenHistoria-Presets/tools/pax-ripper/src/index.ts` lists the same CLI flags as `Peace-History/tools/pax-ripper/src/index.ts` (`--preset`, `--presets`, `--all`, `--force`, `--cookies-file`, `--with-editor`, etc.)
- [ ] Library-safe module surfaces verified: `grep -L 'process\.argv\|main()' tools/pax-ripper/src/*.ts` returns ONLY `index.ts` (the CLI entrypoint, which is NOT used as a library). Every other `src/*.ts` file is library-callable: `ripPreset.ts`, `ripFeatures.ts`, `ripPresets.ts`, `ripFlags.ts`, `ripCovers.ts`, `ripEditor.ts`, `ripExtras.ts`, `ripGeometry.ts`, `firestoreExtract.ts`, `firestoreCapture.ts`, `extractFromNextData.ts`, `manifest.ts`, `auth.ts`, `browser.ts`, `config.ts`, `types.ts`. Any file containing `process.argv` outside `index.ts` is documented in Task 6's capture.ts and either avoided or wrapped.
- [ ] `bun install` succeeds with no errors
- [ ] `bun --bun tools/pax-ripper/src/index.ts --help` exits 0
- [ ] `tools/pax-ripper/README.md` retains MIT attribution verbatim
- [ ] Verify: `bun install && bun --bun tools/pax-ripper/src/index.ts --help`

### Task 2: Build canonicalize.ts with starter table

**Objective:** Provide a pure `polityName → ownerCode` lookup table that the transformer uses to produce `regionOwnershipOverrides` keys that match open-historia's expected code space, plus a reverse `ownerCode → displayName` lookup.

**Files:**

- Create: `tools/preset-exporter/src/canonicalize.ts`
- Create: `tools/preset-exporter/scripts/refresh-canonicalize.ts`
- Test: `tools/preset-exporter/tests/canonicalize.test.ts`

**Key Decisions / Notes:**

- Starter table: 50 entries. Source: `grep -h '"<name>"' /home/john/Projects/Peace-History/presets/*/*/features.json | sort -u | head -200`, extract the first 50 distinct polity names, hand-map each to an ISO 3166-1 alpha-3 (e.g. `Kingdom of Greece → GRC`, `United States → USA`). Each unknown name passthrough-returns the input string and logs the miss (the log line is a diagnostic the transformer can prune later).
- The reverse table is `{[code]: name}` populated as a side-effect of the forward mapping (so the open-historia renderer's code-based resolver sees a display name).
- API: `canonicalize(name: string): { code: string; name: string }` — always returns a record, never throws.

**Definition of Done:**

- [ ] `canonicalize("Kingdom of Greece").code === "GRC"` and `.name === "Kingdom of Greece"`
- [ ] `canonicalize("Atlantis").code === "Atlantis"` (passthrough; logged)
- [ ] Reverse lookup table contains at least 30 entries
- [ ] `tools/preset-exporter/src/canonicalize.ts` includes a header comment block: (a) the exact grep command used to source the table (`grep -h 'polityName' /home/john/Projects/Peace-History/presets/*/*/features.json | sort -u`), (b) the date the table was generated, (c) the count of distinct polity names observed vs. the 50 mapped (e.g. `// 50 of 127 distinct names; unmapped names passthrough as of 2026-07-16`)
- [ ] `tools/preset-exporter/scripts/refresh-canonicalize.ts` runs the grep, prints a diff against the current table (names new since last refresh; codes that have been deleted), and exits 0. Does NOT auto-rewrite canonicalize.ts — humans apply the diff after review.
- [ ] Verify: `bun test tools/preset-exporter/tests/canonicalize.test.ts && bun run tools/preset-exporter/scripts/refresh-canonicalize.ts`

### Task 3: Implement core transformer

**Objective:** Implement the pure `PaxCapture → { bundle, assets }` mapping. The transformer is the heart of the plan; everything else is plumbing.

**Files:**

- Create: `tools/preset-exporter/src/transform.ts`
- Modify: `tools/preset-exporter/src/canonicalize.ts` (consumed here)
- Test: `tools/preset-exporter/tests/transform.test.ts`

**Key Decisions / Notes:**

- Mirror `exportPreset.js:39-103` for `normalizeRegionsForGame` and `buildCitiesForGame`, but inline (don't link open-historia). Per Pax's `geometry.json`, each region has `geometry` (stringified GeoJSON Polygon), `centroid`, `type` (`"Coastal" | "Land" | "Ocean" | "Strait"`); `properties.id = regionIndex`, `properties.owner = canonicalized polity name`, `properties.country = reverse-canonicalized display name`, `properties.typeId = region type lowercased`, `properties.gid0 = owner` (per `exportPreset.js:55`).
- Mirrors `exportPreset.js:67` `detectCustomGeometry`: always true here (Pax regions are always integer-indexed, never GADM). Document the fact and keep the helper for forward-compat.
- `colors`: derive a `{ [ownerCode]: [r, g, b] }` map from `features.polities[i].color` (Pax provides hex; convert). Always emit `assets.colors` (even if empty per Pax `customRegions=true` requirement).
- `game`: `{ country: canonicalize(firstOwner).code, startDate: '', gameDate: '', difficulty: '', language: 'English' }` — empty fields so open-historia's `buildFreshGameSeedFromScenario` (`models.js:200-220`) falls back to its defaults.
- `prompts`: if `editor?.aiPrompts` is present, map each Pax prompt-key (e.g. `chatWithUser`, `actions`) to its open-historia counterpart (e.g. `advisor`, `actions`) using a hand-coded 1-to-1 table at the top of the file. Missing prompts → empty string. Empty `prompts` allowed (importer coerces to `{}` per `libraryStore.js:738`).
- Region ownership owner code for `regionOwnershipOverrides`: from `features.regionOwnership[idx]` (polity name) → `canonicalize(name).code`.
- `actions/advisor/chat/events`: always `[]` / `{}` per PRD scope.
- Throws a single typed `TransformError` on unrecoverable input (missing required fields like empty `geometry.geometry`).

**Definition of Done:**

- [ ] `transform({ preset, geometry, features, ... }, { mode: 'full' })` returns `{ bundle: { schema: 'pax-historia-scenario-bundle', version: 1, mode: 'full', exportedAt: <ISO>, scenario: {...}, data: { actions:[], advisor:[], chat:[], events:{}, game:{...}, prompts:{...}, world:{...} } }, assets: { cover, colors, regionsGeojson, citiesGeojson, backgroundData } }` where `backgroundData: { mode: 'default', fileName: 'background.json' }` (Pax has no background file; the importer treats this as the no-op no-background preset)
- [ ] `assets.backgroundData.mode === "default"` always (no embedded background)
- [ ] `data.world.customRegions === true` and `data.world.customCities === true` in the output
- [ ] `assets.regionsGeojson.mode === "embedded"` and `data: <base64 string>`
- [ ] Regions FeatureCollection has one Feature per integer-indexed region in `geometry.geometry`
- [ ] Cities FeatureCollection has one Feature per city in `features.cities`
- [ ] `transform({ ... features: { ...empty polities/cities/regionOwnership } })` succeeds with an empty `regionOwnershipOverrides` and an empty colors map (empty-features path is valid)
- [ ] Verify: `bun test tools/preset-exporter/tests/transform.test.ts`

### Task 4: Implement PMTiles fetcher

**Objective:** Fetch Pax-hosted PMTiles (cities, countries, regions) when discoverable from `geometry.json` or `editor.json`, returning raw bytes per key. Missing keys silently skipped — the importer falls back to open-historia's stock pmtiles (`getScenarioPmtilesOverride` returns null).

**Files:**

- Create: `tools/preset-exporter/src/pmtiles.ts`
- Test: `tools/preset-exporter/tests/pmtiles.test.ts`

**Key Decisions / Notes:**

- Discovery: read `editor.extras.initialPresetData.mapGeometryDocumentID` (the same `r2:map-geometry/...` string `ripPreset.ts:754-764` uses). Strip the `r2:` prefix; the resulting `map-geometry.paxhistoria.co/{cdnPath}.json` serves the GeoJSON.
- For PMTiles: probe ONE URL pattern — `{cdnPath}.pmtiles` against `https://map-geometry.paxhistoria.co/{cdnPath}.pmtiles`. This is the same CDN transform that worked for the GeoJSON (per `ripPreset.ts:758`); apply it once for each of `cities`, `countries`, `regions`. If 200 with content-type `application/octet-stream`, take the bytes. Otherwise log + skip — never throw, never probe a second pattern.
- Test environment: tests inject a fake `fetch` function (matches pax-ripper's test pattern). Network is mocked.

**Definition of Done:**

- [ ] `fetchPmtiles({ geometry, editor }, fetcher)` returns `{ cities?: Uint8Array, countries?: Uint8Array, regions?: Uint8Array }` (any subset)
- [ ] Missing key (404 from fetcher) results in omission without an error
- [ ] All three keys returned as raw bytes (verified in test)
- [ ] Verify: `bun test tools/preset-exporter/tests/pmtiles.test.ts`

### Task 5: Implement bundle emitter + schema validation

**Objective:** Assemble the final JSON file per open-historia's importer contract and write it to disk with the user's chosen `--output` path. Add a `_run_summary.json` per pax-ripper's convention.

**Files:**

- Create: `tools/preset-exporter/src/bundle.ts`
- Modify: `tools/preset-exporter/src/encode.ts` (new helper)
- Test: `tools/preset-exporter/tests/bundle.test.ts`

**Key Decisions / Notes:**

- Reuses `encode.ts` for: `base64(Uint8Array) → string`, and `deriveContentType(filename)` for image content-type resolution.
- Validation (in `bundle.ts`): before write, assert `bundle.schema === "pax-historia-scenario-bundle"`, `bundle.version === 1`, all 7 `data.*` keys present (matches `libraryStore.js:729-758` truth-table: missing key = empty overwrite). On failure: throw `BundleError` (caller surfaces as exit code 3).
- Run summary written next to bundle: captures `runAt`, `paxID`, `version`, `outputBundlePath`, `mode`, `transformDurationMs`, `pmtilesBytes: { cities?, countries?, regions? }`.
- Output pretty-printed (2-space JSON) to match `libraryStore.js` formatting and the existing example.json.

**Definition of Done:**

- [ ] `writeBundle({ bundle, assets }, { outputPath, ... })` writes a JSON file whose top-level keys are exactly `{ schema, version, mode, exportedAt, scenario, data, assets }`
- [ ] `assets.cover`, `assets.colors`, `assets.regionsGeojson`, `assets.citiesGeojson`, `assets.cities`, `assets.countries`, `assets.regions` all present (any may be `{ mode: "default", fileName }` if empty)
- [ ] `assets.cover.mode === "embedded"` iff cover bytes were supplied
- [ ] A bundle missing `data.prompts` (and any other required key) throws `BundleError` BEFORE write
- [ ] `_run_summary.json` written next to bundle
- [ ] Verify: `bun test tools/preset-exporter/tests/bundle.test.ts` and inspect one output file matches the example.json gold fixture's top-level shape (modulo asset contents).

### Task 6: Wire CLI (single / bulk / offline / --force)

**Objective:** Wire `cli.ts` to dispatch single-preset, bulk, and offline transform modes; parse all flags; surface pax-ripper and transform errors as deterministic exit codes.

**Files:**

- Create: `tools/preset-exporter/src/cli.ts`
- Modify: `tools/preset-exporter/src/capture.ts` (new — orchestrates the capture side)
- Modify: `tools/preset-exporter/package.json` (adds `export` script)

**Key Decisions / Notes:**

- Capture step invokes pax-ripper's internal modules DIRECTLY (not `tools/pax-ripper/src/index.ts` as a subprocess). Specific imports in `capture.ts`:
  - `import { tryCaptureFeatures } from '../../pax-ripper/src/ripFeatures.js'` — signature `(page, targetDir) => FeaturesStatus` (verified library-safe per `ripFeatures.ts:35`)
  - `import { capturePreset } from '../../pax-ripper/src/ripPreset.js'` — signature `(page, opts) => CapturePresetResult` (verified library-safe per `ripPreset.ts:348`)
- `--no-overwrite-reference`: refuses to write to `out/modern-day.json` (the committed reference, see Task 8) unless explicitly passed with `--force`. Default behavior is to refuse overwriting that single path.
- Capture writes to `out/cache/<paxID>/<version>/`. `--force` re-captures; default skips Playwright when `manifest.json` already present.
- `--offline <dir>` mode skips pax-ripper entirely; reads `out/cache/...` and runs only `transform → bundle`.
- `--from-file uids.txt` mode: read UIDs one per line, dispatch in series (with `--limit N` cap), write `_run_summary.json` at the directory level (mirrors `peace-history/tools/pax-ripper/src/manifest.ts:writeRunSummary`).
- Exit codes: 0 ok / 2 capture failure / 3 transform or bundle failure (schema validation) / 4 missing dependency (e.g. Playwright not installed).
- Help text (`--help`) lists every flag and one example invocation per mode. Mocks up the example output bundle path.

**Definition of Done:**

- [ ] `bun run tools/preset-exporter/src/cli.ts --help` exits 0 and lists all 8 flags with one-line descriptions
- [ ] `bun run tools/preset-exporter/src/cli.ts --offline out/cache/<UID>/<ver>/ --output ./out/test.json` produces a valid bundle from the fixture dir (verified via Task 7's tests)
- [ ] Re-running the same `--preset` without `--force` finishes in < 2s (no Playwright activity) — TS-003
- [ ] Exit code 3 surfaces when an emitted bundle fails schema validation
- [ ] Verify: `bun run tools/preset-exporter/src/cli.ts --help` and `bun test tools/preset-exporter/tests/transform.test.ts`

### Task 7: Hermetic test fixtures + transform/bundle tests

**Objective:** Provide offline-only test fixtures (no Playwright) and tests that confirm the transformer's bundle shape matches open-historia's importer contract.

**Files:**

- Create: `tools/preset-exporter/tests/fixtures/modern-day/{preset,geometry,features,editor}.json` — full snapshot of `Peace-History/presets/1Alm1zD4pXpGyfWwkch1/79/`. The `editor.json` is NOT dropped: Task 3 reads `editor.aiPrompts` for the prompts mapping and Task 4 reads `editor.extras.initialPresetData.mapGeometryDocumentID` for PMTiles discovery. Fixture's editor.json holds at minimum `{"aiPrompts": {}, "extras": {"initialPresetData": {"mapGeometryDocumentID": "r2:map-geometry/test/test_1_0"}}}`
- Create: `tools/preset-exporter/tests/fixtures/cold-war/{preset,geometry,features,editor}.json` — second snapshot, validates geometry parsing at larger scale
- Create: `tools/preset-exporter/tests/transform.test.ts`
- Create: `tools/preset-exporter/tests/bundle.test.ts`
- Modify: `tools/preset-exporter/tests/pmtiles.test.ts` (added in Task 4)

**Key Decisions / Notes:**

- Fixture base: snapshot the canonical Pax capture's `preset.json`/`geometry.json`/`features.json` into the fixture dir at install time. The fixtures are deterministic — they pin the test against the actual Pax wire format we observed in July 2026.
- Test for the empty-features path is constructed by setting `features.polities = []`, `features.cities = []`, `features.regionOwnership = {}` and asserting the bundle still emits (test id `transform.test.ts > empty features emits valid bundle`).
- Test for PMTiles-missing is constructed by passing `pmtiles: {}` and asserting the bundle's `assets.cities.countries.regions` all use `mode: "default"`.

**Definition of Done:**

- [ ] `bun test tools/preset-exporter/tests/` runs all tests with no network calls
- [ ] `transform.test.ts` covers: (a) the modern-day fixture, (b) the cold-war fixture, (c) empty-features, (d) unknown polity name passthrough, (e) the all-7-`data.*`-keys-present contract
- [ ] `bundle.test.ts` covers: (a) base64 round-trip of a 2 KB cover, (b) `BundleError` when a required key is missing, (c) `exportedAt` is a parseable ISO date string
- [ ] `pmtiles.test.ts` covers: 200-with-bytes, 404-omitted, malformed-payload-omitted
- [ ] Verify: `bun test tools/preset-exporter/tests/`

### Task 8: README + .gitignore + end-to-end smoke + committed reference bundle

**Objective:** Make the repo user-friendly and prove the CLI works on a real Pax capture (when reachable) by committing a reference `out/modern-day.json`.

**Files:**

- Create: `README.md` (repo root)
- Create: `.gitignore`
- Create: `out/modern-day.json` (reference bundle; regenerated by Task 8 itself)
- Create: `tools/preset-exporter/scripts/check-reference.ts`
- Create: `docs/plans/.annotations/` (gitkeep)

**Key Decisions / Notes:**

- README sections: Quick Start (5 commands), How It Works (one-paragraph summary with link to `tools/pax-ripper/README.md`), Flag Reference (every CLI flag with example), Output Format (`pax-historia-scenario-bundle` schema with field-by-field notes), Troubleshooting (Chrome profile bootstrap, copy-block failure modes, PMTiles fetch failures), Development (test commands + fixture provenance), Licensing (MIT vendor notice for pax-ripper).
- `.gitignore`: `out/`, `cache/`, `node_modules/`, fixtures' `.png`/`.jpg` copies. Note: `out/modern-day.json` IS committed via `!out/modern-day.json`.
- End-to-end smoke: try `--preset <some-UID>` against paxhistoria.co; if it fails (no network, auth-expired), document the failure mode in the task summary but DO NOT block the plan on it. The hermetic tests are sufficient.

**Definition of Done:**

- [ ] `README.md` opens with a 3-line "What this is" summary and lists every CLI flag with one example. Documents the `--no-overwrite-reference` flag and the maintainer-only `out/modern-day.json` regeneration policy.
- [ ] `.gitignore` covers `out/cache/`, `out/runs/`, `node_modules/`, with `!out/modern-day.json` carve-out
- [ ] `tools/preset-exporter/scripts/check-reference.ts` regenerates `out/modern-day.json` to a temp path, diffs it against the committed version, and exits non-zero on schema drift (allowlist for `exportedAt` only)
- [ ] `package.json` exposes `bun run check-reference` (the script above) as a CI hook
- [ ] `bun test tools/preset-exporter/tests/` passes 0-failure
- [ ] `out/modern-day.json` is a valid `pax-historia-scenario-bundle` produced by the CLI (regenerated by a `bun run export-smoke` script in `package.json`)
- [ ] Verify: `bun test tools/preset-exporter/tests/`, `bun run check-reference`, and `bun run export-smoke` (or equivalent — script name documented in `package.json`)

## Open Questions

None at approval time. Resolved during planning: tier detection (always tier 2), PMTiles (ship as blobs), canonicalization scope (50-entry starter with passthrough). The fixture snapshot in Task 7 pins the test against the Pax wire format we observed in July 2026.

## Deferred Ideas

- A web UI for the exporter (drag-and-drop UID + output). Out of scope per PRD; one-shot CLI only.
- Reverse direction (open-historia → Pax export). Out of scope per PRD.
- Sync with upstream Peace-History/tools/pax-ripper via git subtree. Vendoring trade-off; revisit if pax-ripper changes frequently.
## Iteration 1 — Code-Review Findings (added 2026-07-16)

spec-verify surfaced critical defects via inline code review at effort high. Six of eight angle agents returned; the merged findings identify four blocking contract mismatches against example.json plus several non-blocking defects.

### Must-fix (correctness)

- [x] IT-1: cover asset missing `encoding: "base64"` field (example.json shows it required by importer)
- [x] IT-2: colors.data must be a DICT {"DEU": [r,g,b]}, NOT base64-encoded JSON string (open-historia renders colors via direct dict lookup)
- [x] IT-3: cities/countries/regions assets must include `droppedOverride: boolean` field; remove embedded pmtiles mode entirely (URL pattern is unverified — pax-ripper's verified pattern is {cdnPath}.json, not {cdnPath}/{key}.pmtiles). Plan said "ship as blobs" but only when reachable; reachability is not verified, so default-only.
- [x] IT-4: pmtiles.ts is now dead code in the emit path; remove or repurpose. Plan deferred this to a follow-up — the verified URL pattern is the single {cdnPath}.json fetch pax-ripper already does, not per-key pmtiles.

### Should-fix (quality)

- [x] IT-5: derivePrompts Pax→open-historia key map (chatWithUser→advisor, etc.) per plan §Task 3 (currently identity passthrough)
- [x] IT-6: deriveContentType for cover (jpg/png mapping by extension) per plan §Task 5 (currently hard-coded image/png)
- [x] IT-7: --offline mode must skip live fetch() entirely (currently calls fetch unconditionally)
- [x] IT-8: hexToRgb silent-grey fallback should warn on stderr
- [x] IT-9: export-smoke runAt stripping (docstring claim vs. actual behavior — fix docstring OR strip runAt from committed summary)
- [x] IT-10: WriteOptions.version typed strictly as string; coerce at CLI boundary
- [x] IT-11: canonicalize.ts reverseLookup — first-match collapse removed in favor of explicit TABLE; or remove the helper if unused

### Tasks status

- [x] Task 9: Fix asset shapes (IT-1, IT-2, IT-3)
- [x] Task 10: Remove dead pmtiles subsystem (IT-4)
- [x] Task 11: Apply remaining should_fix defects (IT-5 through IT-11)
- [x] Task 12: Add contract test asserting emitted bundle matches example.json shape

