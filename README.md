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

## Re-capturing with `--force`

`pax-ripper` is incremental: if `manifest.json` already exists in the capture
directory for a given `(UID, version)`, the capture short-circuits and returns
the existing files. **`--force` makes it overwrite that manifest and re-run
every step** (Play Now, features, extras, cover image, manifest). Use it when:

- Pax republished the preset and you want a fresh snapshot.
- A previous capture crashed mid-write and left a partial `manifest.json`.
- You changed capture code (e.g. updated `extractFromNextData.ts`) and want
  the new code to see real Pax data, not yesterday's cache.
- You switched `--with-editor` on/off and want the missing files filled in.

`--force` lives on both the exporter CLI and the pax-ripper CLI; the exporter
forwards it to pax-ripper.

```bash
# Re-capture a single preset from scratch, then re-export.
bun run export --preset 1Alm1zD4pXpGyfWwkch1 --force

# Same, but only re-capture the Pax side; transform from the cache afterwards.
bun run rip --preset 1Alm1zD4pXpGyfWwkch1 --force
bun run export --offline ./out/cache/1Alm1zD4pXpGyfWwkch1/79/ --output ./out/cold-war.json

# Re-capture + re-export every UID in ./IDs, bypassing --resume.
# (Use --force sparingly — it hits paxhistoria.co for every UID.)
bun run tools/preset-exporter/scripts/dump-all.ts --force --limit 5
```

What `--force` does NOT do:

- It does NOT clear `out/cache/`. The capture directory is overwritten
  in-place; old files for the same `(UID, version)` are replaced. To start
  from a truly clean slate, `rm -rf out/cache/<UID>/` first.
- It does NOT re-export the bundle if `out/<uid>.json` already exists.
  `dump-all --resume` will still SKIP a previously-exported bundle even after
  a forced re-capture. Combine `--force` with a manual `rm out/<uid>.json`
  when you want both the capture AND the exported bundle regenerated.
- It does NOT touch the committed `out/modern-day.json` reference unless
  `--no-overwrite-reference` is also dropped (the exporter refuses by
  default; pass `--force` to override).

Sanity check after a force run:

```bash
ls out/cache/<UID>/<version>/       # manifest.json, preset.json, geometry.json, features.json, ...
cat out/cache/<UID>/<version>/manifest.json   # captureAt should be recent
```

## Capturing the editor view (`--with-editor`)

The standard capture hits Pax's "Play Now" page (`/presets/{id}?versionID=N`).
That works for public data — preset metadata, geometry, features. But the
**map editor** at `/tools/map-editor?presetUID={id}` carries data Play Now
never exposes: full `extras`, the simulation rules text, advanced settings,
and the authoritative region/polity list the author actually saved.

`--with-editor` adds an editor-view capture step. It runs **before** Play Now;
on success it derives `features.json` from the editor data (a strict superset
of the Play Now state) and skips Play Now entirely unless you also pass
`--with-game`.

What the editor pass produces:

| File | Notes |
|---|---|
| `editor.json` | Full editor state (5–6 MB). Includes `extras`, `initialPresetData`, `mapGeometryDocumentID`, `advancedSettings.rulesText`, etc. |
| `editor_status.json` | Counts: submenus clicked, duration. For forensics. |
| `features.json` | Derived from `editor.json` when capture succeeds. |

Behaviour summary:

| Flags | Capture order | Fallback if editor fails |
|---|---|---|
| (default) | Play Now only | — |
| `--with-editor` | Editor → Play Now (only if editor didn't yield `features.json`) | Play Now runs (unless `--no-game`) |
| `--with-editor --no-game` | Editor only | **Hard fail** — no Play Now fallback |
| `--with-editor --with-game` | Editor AND Play Now | Play Now runs (always) |

The exporter needs editor-sourced data because:

- `data.world.simulationRules` comes from `editor.extras.initialPresetData.advancedSettings.rulesText`.
- `data.world.customRegions` / `customCities` are derived from the editor's
  full polity/region list, not the in-game state (which is post-resolution).
- The `polityOverrides` table can only be TABLE-matched against the
  authoritative Pax names; the editor's `extras.polities` is the source of
  truth.

### Editor capture without owning the preset

`pax-ripper` can only scrape the editor view of presets **you own** (Pax's
editor route requires author auth). For non-owned presets, `--with-editor`
runs a **Copy flow** first: it makes a private copy under your account, then
scrapes the copy. The copy is recorded in `manifest.editorSource` (e.g.
`copy:<newPaxID>`) so subsequent `--reuse-copy` runs don't re-copy.

The fresh copy is owner-only on Pax's Firestore REST API (even though
in-app navigation succeeds), so the auth check is skipped when
`copyFlow.copyCreated` is true — the in-app navigation itself proves auth
via Pax's Firebase ID token.

### Authentication: persistent profile vs `--cookies-file`

Two ways to authenticate the editor pass:

1. **Persistent Chrome profile** (default; recommended for repeated use):
   `~/.config/pax-ripper/browser-profile/`. Bootstrap once with
   `bun run rip --presets`, sign in to paxhistoria.co in the opened window,
   close it. Every subsequent run reuses the profile — no cookies file
   needed.

2. **`--cookies-file <path>`** (one-shot, headless-friendly): a
   Firefox-style `cookies.json` export. Use this when running on a server
   without a display, in CI, or when you want to share a single cookies
   file across multiple machines. Format:

   ```json
   [
     { "name": "__session", "value": "<jwt>", "domain": ".paxhistoria.co",
       "path": "/", "httpOnly": true, "secure": true, "sameSite": "Lax" }
   ]
   ```

   `httpOnly: true` is supported (the editor capture path uses the raw
   cookie value for the Firestore REST call, not the browser JS API). The
   export can be produced from Firefox via "Cookie Quick Manager" or
   `cookies.txt`-to-JSON tools.

   ```bash
   # One-shot editor capture with a Firefox cookies export.
   bun run export --preset <UID> --with-editor --cookies-file ./pax-cookies.json

   # Same, but force the Play Now pass too.
   bun run export --preset <UID> --with-editor --with-game --cookies-file ./pax-cookies.json

   # Editor-only (no Play Now fallback on failure).
   bun run export --preset <UID> --with-editor --no-game --cookies-file ./pax-cookies.json
   ```

   If the editor pass hits a "not authenticated" page, pax-ripper prints
   `no auth — injecting cookies from <path> and retrying` and re-runs the
   page navigation with the injected cookies.

### End-to-end editor workflow

```bash
# 1. One-time: bootstrap the persistent profile (or skip if you'll use --cookies-file).
bun run rip --presets

# 2. Capture a preset you own, including the editor view.
bun run export --preset 1Alm1zD4pXpGyfWwkch1 --with-editor --output ./out/cold-war.json

# 3. For a preset you DON'T own, pax-ripper copies first; --force is needed
#    only if you want to re-make the copy or re-scrape after Pax republished.
bun run export --preset <SOMEONE_ELSES_UID> --with-editor --output ./out/copy.json

# 4. To re-run JUST the editor step against an existing capture (e.g. after
#    pax-ripper added new editor fields), delete the manifest and re-run.
rm out/cache/<UID>/<version>/manifest.json
bun run rip --preset <UID> --with-editor
bun run export --offline out/cache/<UID>/<version>/ --output ./out/<UID>.json
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

# Force re-capture of a single preset (manifest.json is overwritten)
bun run export --preset 1Alm1zD4pXpGyfWwkch1 --force

# Editor capture with an explicit cookies file (headless / CI)
bun run export --preset 1Alm1zD4pXpGyfWwkch1 --with-editor --cookies-file ./pax-cookies.json

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

## Dumping all presets

For exporting every UID listed in `IDs` (1,230 actual UIDs after the 11
label lines are filtered out) into hub-conformant bundles:

```bash
cd tools/preset-exporter && bun run dump-all
```

Per-UID output: `PASS <uid>`, `FAIL <uid>: <reason>`, or `SKIP <uid>: already exported`.
Final summary line: `processed=N pass=K fail=M skip=R elapsed=Xs`.

Flags: `--limit N` (cap how many UIDs), `--resume` (skip already-exported UIDs),
`--force` (bypass resume + re-capture), `--ids <path>`, `--output <dir>`,
`--cache <dir>`, `--hub <dir>`.

Exit codes: `0` = at least one UID processed and all PASS; `1` = any FAIL;
`2` = no UIDs processed; `3` = `--resume` and every UID was skipped.

`--force` and `--resume` interact as follows:

- `--resume` alone → SKIP any UID whose `out/<uid>.json` exists, parses, and
  is >1KB. Capture is reused without re-checking.
- `--force` alone → re-capture AND re-export every UID, ignoring the resume
  gate.
- `--resume --force` → `--force` wins. The resume check is bypassed and every
  UID is re-captured from scratch; the existing `out/<uid>.json` is
  overwritten.

Sequential by design (Pax rate limits are unknown) — use `--limit` to chunk
across multiple machines. Requires the persistent browser profile at
`~/.config/pax-ripper/browser-profile/` (bootstrap once with `bun run rip --presets`).
The editor flow is **not** triggered by `dump-all`; it captures the Play Now
view only. To run the editor pass over many UIDs, loop `bun run export
--preset <UID> --with-editor` yourself, or extend the script.

## Verifying exports

To audit every bundle already written under `out/` against the Open-Historia
hub format without re-running capture or transform:

```bash
cd tools/preset-exporter && bun run verify-out
```

Per-bundle rows: `PASS`, `FAIL: <detail>` (with the first 3 failing check names),
or `PASS WARN: importer-accepted extras: <keys>` (soft warning for assets like
`backgroundData` that the importer accepts but the hub bundles don't carry).
Final summary line: `processed=N pass=K fail=M elapsed=Xs`.

Flags: `--out <dir>` (default `./out`), `--hub <dir>` (default
`/home/john/Projects/Open-historia-scenarios/bundles`), `--quiet` (summary only).

Exit codes mirror `dump-all`: `0` = all PASS, `1` = any FAIL, `2` = empty
`out/`, `3` = only sidecars.

The verifier runs two passes per bundle: the 12 keyset/shape checks from
`diffAgainstHubBundles` (`src/conformance.ts`) plus a 19-check value/type pass
(`src/verify.ts`) that catches what the keyset diff cannot see (bad hex colors,
wrong image contentTypes, color/owner-codes inconsistency, base64
decodability, allowedUnitTypes literal, etc).

## How it works

1. **Capture** — `pax-ripper` uses a persistent Chrome profile
   (`~/.config/pax-ripper/browser-profile/`) to log in to paxhistoria.co, then
   Playwright + Firestore Listen channels extract `preset.json`, `geometry.json`,
   `features.json`, `editor.json` (opt-in via `--with-editor`), and a cover
   image. The vendored copy at `tools/pax-ripper/` works as either a standalone
   CLI (`bun run rip`) or as a library imported by `tools/preset-exporter`.
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
  profile at `~/.config/pax-ripper/browser-profile/`. For headless / CI runs
  without a profile, pass `--cookies-file ./pax-cookies.json` (Firefox
  `cookies.json` export; HttpOnly supported).
- **Editor pass fails with "no auth"** — The persistent profile's session
  expired. Either re-run `bun run rip --presets` to refresh, or pass
  `--cookies-file` with a fresh export.
- **`--with-editor` copies a preset you don't own** — Expected. The Copy
  flow records the new Pax ID in `manifest.editorSource`. To skip the copy
  on a re-run, add `--reuse-copy` to the ripper invocation (the export CLI
  does not currently forward this — invoke pax-ripper directly).
- **Empty features / cities** — Pax returns no features for some presets
  (no game-data yet). The transformer emits a valid bundle with empty
  `regionOwnershipOverrides`; Open Historia renders an uncolored but valid
  geometry layer.
- **PMTiles fetch fails** — `pmtiles.ts` logs the failure and omits the key.
  The bundle stays valid and Open Historia falls back to its stock tiles.
- **Bundle won't import in Open Historia** — Confirm `jq '.data | keys' <file>`
  prints all 7 keys (no missing → importer coerces to empty and overwrites
  defaults; the import succeeds but renders blank).
- **`--force` didn't change the output** — Two possible reasons: (1) the
  capture was already current (Pax republished after the last run, or
  nothing changed) and the transform is deterministic, or (2) the
  exporter's `--resume` gate skipped the export step. Delete
  `out/<uid>.json` and re-run with `--force` to regenerate the bundle.

## Licensing

`tools/pax-ripper/` is MIT-licensed upstream. The exporter code in
`tools/preset-exporter/` is MIT-licensed in this repo. See
`tools/pax-ripper/VENDORED.md` for the upstream commit hash.
