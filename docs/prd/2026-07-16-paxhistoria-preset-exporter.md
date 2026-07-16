# Pax Historia → Open Historia Preset Exporter

Created: 2026-07-16
Agent: Claude Code
Category: Integration
Status: Draft
Research: None

## Problem Statement

Open Historia and Pax Historia are forks of the same history-simulator concept, but their scenario formats diverged. Open Historia reads a `pax-historia-scenario-bundle` JSON (schema id defined in `open-historia/src/runtime/web/models.js:12`) consumed by `importScenarioBundle` in `libraryStore.js`. Pax Historia stores presets in a totally different shape on Firestore + R2 (`simplePresets/{id}`, `map-geometry.paxhistoria.co/{...}.json`, etc.), surfaced in the browser via Next.js / RSC payloads.

A user who finds a preset on `paxhistoria.co/presets` cannot load it into open-historia today. We need a tool that takes a Pax preset and emits an open-historia scenario bundle — preserving geometry (re-ownership when possible, custom geometry when needed), AI prompts, polities, colors, and a cover image.

The work has already started in `Peace-History/tools/pax-ripper/` — a Playwright + Firestore REST scraper that captures `preset.json`, `geometry.json`, `features.json`, `editor.json` for a single Pax preset into `presets/{paxID}/{version}/`. What is missing is the **transformation layer** that maps those captures into the `pax-historia-scenario-bundle` shape, plus the bundling/output step that produces an open-historia-importable file.

## Core User Flows

### Flow 1: Convert a single Pax preset to an open-historia bundle
1. User opens a terminal in `OpenHistoria-Presets/`.
2. They run `bun run export -- <paxID> --output ./out/<name>.json` (or `--output .zip` for full mode).
3. The tool detects whether the captured geometry is stock GADM regions (→ tier 1 / light) or contains custom `reg_*` IDs / merges (→ tier 2 / full).
4. The tool reuses the existing Chrome profile at `~/.config/pax-ripper/browser-profile/` to authenticate against paxhistoria.co when needed.
5. The tool runs the existing pax-ripper capture pipeline (skipping any steps already cached in `presets/{paxID}/{version}/manifest.json`).
6. After capture, a transformer maps `preset.json + geometry.json + features.json + editor.json` → the scenario bundle shape, then either writes a single light `.json` or a `.zip` containing the data JSON + cover image + PMTiles overrides.
7. The user drags the resulting `.json` (or `.zip`) into open-historia's "Import Scenario Bundle" UI; the scenario appears in the library.

### Flow 2: Bulk / batch export of many presets
1. User runs `bun run export --all` or `bun run export --from-file uids.txt`.
2. The tool reuses pax-ripper's `ripPresets` discovery (`/api/presets/search` paginated) to enumerate UIDs.
3. For each, it runs Flow 1 (skipping already-captured presets unless `--force`).
4. Outputs are written to `out/<paxID>/<name>.json` (or `.zip`), with a `_run_summary.json` matching pax-ripper's existing run-summary convention.

### Flow 3: Re-convert an already-ripped preset (no network)
1. User points the tool at `presets/{paxID}/{version}/` they already have.
2. Tool skips the Playwright phase entirely and runs only the transformer + bundle step.
3. Useful for re-emitting a bundle after a transformer update.

## Scope

### In Scope
- **Bundled copy of pax-ripper** at `tools/pax-ripper/` (vendored — Peace-History is no longer cross-repo for this work). Source kept under its own MIT notice; package scripts preserved (`rip`, `rip:presets`, `rip:geometry`, `rip:flags`, `rip:covers`, etc.).
- **A new `tools/preset-exporter/` directory** with:
  - `src/cli.ts` — argv parsing, entry-point mirroring pax-ripper's index.ts.
  - `src/capture.ts` — thin wrapper that invokes pax-ripper's `capturePreset` / `ripPresets` to produce the per-preset directory.
  - `src/transform.ts` — the core mapper: `PresetData + GeometryData + MapFeatures + EditorData → ScenarioBundle`.
  - `src/tier.ts` — tier-1 vs tier-2 detection (mirrors `detectCustomGeometry` in open-historia's `exportPreset.js:67`).
  - `src/bundle.ts` — JSON / .zip emitter; uses JSZip (already an open-historia dep), mirrors `bundleZip.js` semantics for the .zip case.
  - `src/assetEnricher.ts` — derives `regionOwnershipOverrides`, `polityOverrides`, `colors`, `game`, and prompt templates from the Pax features/editor data.
  - `tests/transform.test.ts`, `tests/tier.test.ts`, `tests/bundle.test.ts` — unit tests using the existing `OpenHistoria-Presets/example.json` as the canonical gold fixture, plus synthetic Pax inputs.
- **Sample output**: a working `out/example-modern-day.json` regenerated from `example.json` to prove round-trip equivalence.
- **README** at the repo root documenting: dependency install, browser-profile bootstrap, `bun run export` invocations for single / bulk / offline modes, expected outputs.
- **`--mode light|full|auto`** (auto = tier-based detect).
- **`--cookies <path>`** to inject a `cookies.json` instead of opening the browser, matching pax-ripper's `--cookies-file`.
- **Idempotency** — the tool never re-captures `manifest.json` exists; `--force` re-captures.

### Explicitly Out of Scope
- **Reverse direction** (open-historia → Pax bundle export). One-way only.
- **Live game-state migration** — chat transcripts, resolved actions, advisor notes, etc. are imported as **empty** (the scenario is a static template; users start a fresh game in open-historia). The `data.actions/advisor/chat/events` arrays stay `[]`.
- **Re-emitting PMTiles for tier-2**. We re-use open-historia's `regions.pmtiles` shape. If Pax's R2 geometry is GeoJSON already, we convert it to the open-historia `regionsGeojson` FeatureCollection format (matching `normalizeRegionsForGame` in `exportPreset.js:39`). Cities GeoJSON gets the same treatment via `buildCitiesForGame`.
- **Cover image provenance** — we copy whatever the Pax preset's `landingImageURL` (or `coverImageURL`) resolves to. We do not re-host or transform.
- **Schema migration across pax-historia-scenario-bundle versions**. Locked to `version: 1` (matches `SCENARIO_BUNDLE_VERSION` in `open-historia/.../models.js:13`).
- **Continuous sync / watching** — one-shot CLI; no daemon mode.
- **Web UI**. CLI-only; the user already has the open-historia import UI.

## Technical Context

- **Target schema** lives in `open-historia/src/runtime/web/models.js:12-31` (`SCENARIO_BUNDLE_SCHEMA`, asset-key sets, upload order). The importer is `libraryStore.js:729-758` — it only accepts the bundle when `bundle.schema === "pax-historia-scenario-bundle"`; missing `bundle.data` fields are coerced to `{}` and **overwrite** the seeded default, so every required data key (`actions/advisor/chat/events/game/prompts/world`) must be present even if empty/empty-object.
- **Tier detection logic** mirrors `open-historia/src/Editor/exportPreset.js:67` (`detectCustomGeometry`): any non-GADM region ID (`/^reg_/`) or merged/edited feature ⇒ tier 2, otherwise tier 1.
- **Region canonicalization** uses `canonicalizeWorldCountryRefs` (`models.js:100`) — owner codes must be normalized against `COUNTRY_NAME_REGISTRY` so a Pax `RUS`-named polity becomes the open-historia code `RUS` in `regionOwnershipOverrides`.
- **Pax captures** are described in `Peace-History/tools/pax-ripper/src/types.ts` (`PresetData`, `MapFeatures`, `GeometryData`, `EditorData`). The transformer needs to handle the union of `initial_dom + firestore_rest + full_after_game` capture sources (see `ripPreset.ts:483-510`).
- **Pax URLs**:
  - `map-geometry.paxhistoria.co/{path-after-r2:}.json` (per `ripPreset.ts:759`)
  - Firestore REST: `simplePresets/{id}`, `simplePresets/{id}/versions/{n}/rounds/0`, `promptStore/{uuid}`, `templateHelpers/{uuid}`, `simpleGames/{id}`, `userPublicProfiles/{authorUID}`.
- **Auth**: persistent Chromium profile at `~/.config/pax-ripper/browser-profile/`, OR a `cookies.json` via `--cookies`. Reuse both flags' semantics from pax-ripper verbatim.
- **Output sizes**: the example.json gold fixture is ~915 KB with cover embedded as a 506 KB JPEG. Tier-2 .zips will be larger because they include GeoJSON + PMTiles; we expect tens of MB.

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Repo layout | Vendored copy of pax-ripper under `tools/pax-ripper/` | Self-contained repo; no cross-repo `file:` dependency for `bun install`; clean sync upstream via occasional copy-merge |
| Output formats | `--mode=light\|full\|auto` (auto = tier-derived) | Mirrors `exportScenarioBundle(scenarioId, mode)` in `library.js:322`; user controls payload size vs fidelity |
| Geometry handling | Tier 1 + tier 2 (auto-detect) | Re-ownership maps get the cheap path; custom Pax geometry round-trips losslessly via regionsGeojson |
| Auth | Playwright profile + cookies-file flag | Same UX pax-ripper already proved works; minimizes new failure modes |
| Language | TypeScript on Bun (matches open-historia + pax-ripper) | Single toolchain; reuses pax-ripper TS modules verbatim after copy |
| Idempotency | Reuse pax-ripper's manifest.json cache; `--force` to overwrite | Predictable re-runs; matches pax-ripper's existing semantics |
| Live game state | Imported as empty (`actions/advisor/chat/events = []`) | Avoids licensing/IP scope creep; the scenario is a starting template, not a saved game |
| Test posture | Unit tests on transformer + tier detection using example.json as gold fixture | Per CLAUDE.md testing rule — 1 unit class per production class; gold-fixture round-trip proves endian compatibility |

## Open Questions for /spec to confirm

- **Open-historia is the master** of the `pax-historia-scenario-bundle` schema. Should the PRD add an explicit round-trip test (export → open-historia import → open-historia export) as a CI gate? Or is the example.json fixture + the documented importer at `libraryStore.js:729` sufficient?
- **Upstream sync**: when pax-ripper changes in Peace-History, what's the cadence? (a) ad-hoc manual copy-merge (b) git subtree / submodule (c) `npm: '@pax-historia/ripper'` if Peace-History publishes it later.
- **Where do the test inputs come from?** The PRD assumes we'll synthesize Pax inputs from `Presets/web — Modern Day` captures already saved under `Peace-History/presets/` (if any exist) plus the example.json gold fixture for the importer side. Confirm whether `Peace-History/presets/` already has captured UIDs we can reuse, or whether test inputs should be synthetic.
