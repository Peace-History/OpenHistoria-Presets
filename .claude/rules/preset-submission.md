# Preset Submission — Project Rule

How presets get from this repo into the Open-Historia Community hub.

## Source of truth

- **Hub repository**: <https://github.com/Open-Historia/Open-historia-scenarios>
- **Hub README** at that repo: explains the GitHub-Issues-as-Content pattern.
  Every preset is one Issue with the `scenario` label; the in-game Community
  tab queries `issues?labels=scenario` and reads the attached `.json`.
- **Hub format spec**: 6 official bundles at
  `Open-Historia/Open-historia-scenarios/bundles/*.json` are the canonical
  shape. `example.json` (in-repo) is **one of them** — it is not the oracle.
- **Conformance gate**: `bun run check-hub-conformance` (cold-war fixture) and
  `bun run export-and-check <UID>` (real UID or fixture proxy) are the
  authoritative pre-submission checks.

## Submission workflow (operator-driven, NOT a CLI)

There is **no `bun run submit`**. Each `out/<UID>.json` becomes one GitHub
Issue on the hub repo:

1. `bun run export-and-check <UID>` — confirm conformance (exit 0 = real
   capture PASS, exit 2 = fixture-proxy PASS, exit 1 = FAIL).
2. Open
   <https://github.com/Open-Historia/Open-historia-scenarios/issues/new?template=scenario.yml>.
3. Drag `out/<UID>.json` into the description box. GitHub uploads it and
   inserts the download link — without that link the in-game Community tab
   cannot import the scenario.
4. Submit. The form auto-applies the `scenario` label.

## Bulk capture

For all 1,230 UIDs in `IDs`:

```bash
bun run dump-all --limit 20 --resume   # chunk across sessions
```

Naive wall-clock ~60h (Pax rate limits unknown). `--resume` skips
already-exported UIDs. Each successful `out/<UID>.json` becomes one Issue.

## What NOT to file

If a user reports "the bundle won't import", do NOT open a new Issue on the
hub repo. The hub is for end-user submissions, not bug reports. Bug fixes
happen in **this** repo (`OpenHistoria-Presets`); the user (or the next /spec
invocation) handles them via the bugfix workflow.

## Live E2E verification — out of scope

Visual confirmation that a bundle imports with correct owner colors requires
the open-historia dev env (`/home/john/Projects/open-historia`) bootstrapped
with `npm install && npm run dev`. On this host the open-historia repo's
`node_modules/` is empty and the Live-Target Probe fails all four tiers —
documented in `docs/plans/.evidence/2026-07-16-hub-alignment-verify.md`. Do
NOT attempt live E2E here; record it as `UNIT_VERIFIED` and let a user with
a bootstrapped dev env downgrade to `LIVE_PASS`.

## Reference

- Hub README: `/home/john/Projects/Open-historia-scenarios/README.md`
- Conformance scripts:
  - `tools/preset-exporter/scripts/check-hub-conformance.ts`
  - `tools/preset-exporter/scripts/export-and-check.ts`
- Hub conformance test: `tools/preset-exporter/tests/hub-conformance.test.ts`
- Plan: `docs/plans/2026-07-17-preset-export-completion.md` Task 2 added this
  rule.
