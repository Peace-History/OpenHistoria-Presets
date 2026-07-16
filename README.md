# OpenHistoria-Presets

Convert [Pax Historia](https://www.paxhistoria.co/presets) presets into
[Open Historia](https://openhistoria.com/) scenario bundles. The output is a
single `.json` file in Open Historia's `pax-historia-scenario-bundle` schema that
you can drop into Open Historia's import UI.

## What this is

- `tools/pax-ripper/` — vendored copy of `pax-ripper` (Playwright + Firestore REST
  scraper for Pax Historia). MIT-licensed; see `tools/pax-ripper/VENDORED.md` for
  the upstream commit and dual-purpose contract.
- `tools/preset-exporter/` — the transformer. Reads a captured preset directory
  and emits an Open Historia scenario bundle.
- `out/modern-day.json` — a committed reference bundle produced from a real Pax
  capture (`1946: Dawn of Cold War`). Use it as a shape oracle.

## Quick Start

```bash
# 1. Install deps (uses bun workspaces).
bun install

# 2. (First-time only) Bootstrap the persistent Chrome profile used by pax-ripper.
#    Sign in to paxhistoria.co in the opened browser window, then close it.
bun run rip --presets

# 3. Capture a single preset (writes capture to out/cache/<UID>/<version>/).
bun run rip --preset 1Alm1zD4pXpGyfWwkch1

# 4. Convert the captured preset into an Open Historia bundle.
bun run export --preset 1Alm1zD4pXpGyfWwkch1 --output ./out/cold-war.json

# 5. Drop ./out/cold-war.json into Open Historia's import UI.
```

## CLI flag reference (preset-exporter)

```
--preset <uid>              Capture a single preset by Pax UID
--presets                   List preset UIDs (no capture)
--from-file <path>          Bulk: one UID per line in <path>
--all                       Capture everything
--offline <dir>             Skip Playwright; transform from <dir> instead
--output <path>             Write bundle to <path> (default: ./out/<uid>.json)
--mode <auto|light|full>    Bundle shape (default: auto; Pax is always full today)
--force                     Re-capture even when manifest.json exists
--cookies-file <path>       Cookies JSON for editor auth (HttpOnly OK)
--with-editor               Scrape the editor view in addition to Play Now
--with-game                 Force BOTH editor and Play Now flows
--no-game                   Skip Play Now even if editor fails
--no-features               Skip map-features capture
--features-only             Re-run features step only
--limit <n>                 Cap the number of presets in bulk mode
--no-overwrite-reference    Refuse to write to out/modern-day.json unless --force
--help                      Show the help text
```

Examples:

```bash
# Offline re-convert after the transformer changes
bun run export --offline out/cache/1Alm1zD4pXpGyfWwkch1/79/ --output ./out/cold-war.json

# Bulk with a UID list
bun run export --from-file uids.txt --output ./out --limit 5

# Refresh the committed reference (maintainers only)
bun run export-smoke

# CI gate against schema drift
bun run check-reference
```

## Output format

The emitted JSON has the shape open-historia's `libraryStore.js:729-758`
importScenarioBundle expects, aligned with `example.json` (the in-repo
reference bundle) and the 6 official bundles under
`Open-Historia/Open-historia-scenarios/bundles/`:

```jsonc
{
  "schema": "pax-historia-scenario-bundle",   // constant
  "version": 1,                                // constant; locked to 1 today
  "mode": "full",                              // "full" (with embedded GeoJSON) or "light"
  "exportedAt": "2026-07-16T13:36:42.962Z",
  "scenario": {
    "id": "1Alm1zD4pXpGyfWwkch1",
    "name": "1946: Dawn of Cold War",
    "description": "...",
    "eyebrow": "Scenario",
    "heroTitle": "1946: Dawn of Cold War",
    "heroSubtitle": "",
    "subtitle": "",
    "accentColor": "#7c3aed",
    "countryNameOverrides": { "USA": "United States", ... }
  },
  "data": {                                    // ALL 7 keys MUST be present;
    "actions": [],                              // importer coerces missing keys to
    "advisor": [],                              // {} / [] which OVERWRITE seeded defaults
    "chat":    [],
    "events":  {},
    "game":    {                                  // exactly 5 oracle keys
      "country": "USA",
      "startDate": "1946-01-01",
      "gameDate": "",
      "difficulty": "standard",
      "language": "English"
    },
    "prompts": {                                  // 12 string roles + 2 nested maps
      "advisor": "...",
      "leader": "...",
      "actions": "...",
      "autoJumpForward": "...",
      "catalystCreation": "...",
      "catalystExecutor": "...",
      "catalystSummary": "...",
      "descriptionToAction": "...",
      "eventConsolidator": "...",
      "gameMaster": "...",
      "jumpForward": "...",
      "nextSpeaker": "...",
      "helpers": { "ALL_ADVISOR_MESSAGES": "...", ... },  // Record<string,string>
      "tasks":   { "actions": "...", ... }                 // Record<string,string>
    },
    "world":   {
      "customRegions": true,                       // required for the region layer to render
      "customCities":  true,                       // required for cities to render
      "regionOwnershipOverrides": {                 // keys are <code>.<pax_index>_1
        "USA.0_1": "USA",
        "RUS.3_1": "RUS"
      },
      "polityOverrides": {                          // oracle-shape, per code
        "USA": { "code": "USA", "name": "United States",
                 "aliases": [], "color": "#3C3B6E", "note": "" },
        "Z01": { "code": "Z01", "name": "Z01",
                 "aliases": [], "color": "#abc123", "note": "" }
      },
      "ownerCodes": ["AFG", "AGO", ..., "ZWE", "Z01", ..., "Z09"],   // sorted, deduped
      "allowedUnitTypes": ["infantry", "armor", "air",
                           "naval", "artillery", "garrison"],
      "simulationRules": "<from editor.advancedSettings.rulesText>",
      "startingTimelineText": "",
      "difficulty": "standard",
      "language": "English",
      "author": "",
      "mapCredit": ""
    }
  },
  "assets": {
    "cover":          { "mode": "embedded", "fileName": "cover.png",
                        "contentType": "image/png", "encoding": "base64",
                        "data": "<base64>" },
    "colors":         { "mode": "embedded", "data": "<base64 of {code:[r,g,b]}>" },
    "regionsGeojson": { "mode": "embedded", "fileName": "regions.geojson",
                        "contentType": "application/geo+json", "encoding": "base64",
                        "data": "<base64 of FeatureCollection>" },
    "citiesGeojson":  { "mode": "embedded", "fileName": "cities.geojson",
                        "contentType": "application/geo+json", "encoding": "base64",
                        "data": "<base64 of FeatureCollection>" },
    "backgroundData": { "mode": "default", "fileName": "background.json" },
    "cities":     { "mode": "default", "fileName": "cities.pmtiles" },     // or "embedded" if fetched
    "countries":  { "mode": "default", "fileName": "countries.pmtiles" },
    "regions":    { "mode": "default", "fileName": "regions.pmtiles" }
  }
}
```

Owner code conventions:

- **Region keys** are `<code>.<n>_<v>` where `<n>` is the Pax integer region
  index from `geometry.json` and `<v>` defaults to `1`.
- **Codes** are TABLE-matched ISO-3 strings (e.g. `USA`, `RUS`); unmapped Pax
  polities get deterministic synthetic `Z##` codes (`Z01`..`Z99`) seeded by
  an FNV-1a hash of the polity name, with collision avoidance against the
  current TABLE and oracle-observed Z01-Z09.

A `_run_summary.json` is written next to each bundle capturing paxID, version,
mode, transform duration, and PMTiles byte counts.

## Hub submission

Bundles are validated against the 6 official hub bundles in
`Open-Historia/Open-historia-scenarios/bundles/` (release-mirrored, importer-validated).
Before submitting a PR:

- `bun run check-hub-conformance` — exports the cold-war fixture and runs the diff against all 6 hub bundles (12 checks, must all PASS).
- `bun run export-and-check <UID> <version>` — exports a real Pax UID and runs the same diff; exits 0 on PASS, 1 on FAIL, 2 on fixture-proxy PASS (capture not on disk).
- `bun test tests/hub-conformance.test.ts` — in-process bun:test wrapper (no subprocess) using the same diff against the real hub bundles.

Schema drift in any future hub bundle is auto-detected (union-of-keys), so a new
required field surfaces as a FAIL rather than a silent mismatch.

## How it works

1. **Capture** — `pax-ripper` uses a persistent Chrome profile
   (`~/.config/pax-ripper/browser-profile/`) to log in to paxhistoria.co, then
   Playwright + Firestore Listen channels extract `preset.json`, `geometry.json`,
   `features.json`, `editor.json`, and a cover image. The vendored copy at
   `tools/pax-ripper/` works as either a standalone CLI (`bun run rip`) or as a
   library imported by `tools/preset-exporter`.
2. **Transform** — `tools/preset-exporter/src/transform.ts` reads a capture
   directory and emits a `{bundle, assets}` pair. It uses
   `canonicalize.ts` (a 200+ entry polity-name to ISO-3 table) to align Pax
   polity names with Open Historia owner codes. Polities not in the table get
   a deterministic synthetic `Z##` code (e.g. `Z42`), seeded by an FNV-1a hash
   of the polity name with collision avoidance against the TABLE and
   oracle-observed `Z01`-`Z09`. The bundle's `polityOverrides` carries one
   entry per code (with color + aliases); `scenario.countryNameOverrides` maps
   the synthetic code back to the original Pax display name so the importer
   can show it correctly.
3. **Bundle** — `bundle.ts` validates the shape (all 7 `data.*` keys present,
   `schema === "pax-historia-scenario-bundle"`, `version === 1`) and writes
   pretty-printed JSON + a `_run_summary.json`.
4. **PMTiles** — `pmtiles.ts` discovers the Pax geometry CDN path from
   `editor.extras.initialPresetData.mapGeometryDocumentID` and fetches
   `cities/countries/regions.pmtiles` from `https://map-geometry.paxhistoria.co/...`.
   Missing keys are silently skipped — Open Historia falls back to its stock
   tiles (`getScenarioPmtilesOverride` returns null).

## Development

```bash
bun install                  # install deps
bun test                     # run all hermetic tests
bun run typecheck            # tsc on preset-exporter + pax-ripper
bun run check-reference      # CI gate; verifies the committed reference still matches
```

Fixtures live under `tools/preset-exporter/tests/fixtures/`:
- `modern-day/` — synthetic single-region fixture, exercises all 7 data keys.
- `cold-war/` — full snapshot of the Pax "1946: Dawn of Cold War" capture,
  used by the reference-bundle scripts.

Refresh `canonicalize.ts` against new captures:

```bash
bun run tools/preset-exporter/scripts/refresh-canonicalize.ts
```

The script prints a diff (observed names vs. table entries); humans apply the
diff to `canonicalize.ts` after review. It does NOT auto-rewrite the source.

## Troubleshooting

- **"Not signed in" error** — Run `bun run rip --presets` once; a browser opens
  to paxhistoria.co. Sign in, close the window; subsequent runs reuse the
  profile at `~/.config/pax-ripper/browser-profile/`.
- **Empty features / cities** — Pax returns no features for some presets
  (no game-data yet). The transformer emits a valid bundle with empty
  `regionOwnershipOverrides`; Open Historia renders an uncolored but valid
  geometry layer.
- **PMTiles fetch fails** — `pmtiles.ts` logs the failure and omits the key.
  The bundle stays valid and Open Historia falls back to its stock tiles.
- **Bundle won't import in Open Historia** — Confirm `jq '.data | keys' <file>`
  prints all 7 keys (no missing → importer coerces to empty and overwrites
  defaults; the import succeeds but renders blank).

## Licensing

`tools/pax-ripper/` is MIT-licensed upstream. The exporter code in
`tools/preset-exporter/` is MIT-licensed in this repo. See
`tools/pax-ripper/VENDORED.md` for the upstream commit hash.