# Post-Completion Status — Export → Hub

Created: 2026-07-17
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

> Status check: what's left after `2026-07-17-preset-export-completion.md` VERIFIED.

## Context

The user invoked `/spec` with the same task description they used for the previous plan (`Whats left to work on for our exporting of presets from https://www.paxhistoria.co/presets ...`). That plan landed in commit `e0b6640` and was verified. This plan is the status-after-that-work check.

The previous plan's `## What's NOT yet done` section already enumerated the remaining work. This plan repeats that inventory with current-state annotations so the user has a single document to act on.

## Current state (verified by commit `e0b6640` + 146/0 tests + verify-out 4/4 PASS + typecheck clean)

| Item | Status | What it is |
|------|--------|------------|
| Producer-side JSON shape | ✅ DONE | `out/<UID>.json` matches the 6 hub bundles' shape at every level we diff (12 checks + 19 value-type checks). |
| `check-hub-conformance` exit 0 | ✅ DONE | `bun run check-hub-conformance` exits 0 against the cold-war fixture; UID-specific `bun run export-and-check <UID>` exits 0 (real capture) or 2 (fixture-proxy). |
| `assets.backgroundData` (vector basemap) | ✅ DONE | Emitted when `capture.editor?.basemapGeometry` is present; cold-war fixture has a 2-region stub so the emit path is exercised end-to-end. |
| `verify-out-bundles` value-type checks | ✅ DONE | 19 checks cover hex colors, image contentTypes, base64 decodability, allowedUnitTypes literal, color/owner-code consistency, asset-key allow-list. |
| Per-UID submission docs | ✅ DONE | `README.md` "Submitting to the hub" section + `.claude/rules/preset-submission.md` explain the GitHub-Issues-as-Content workflow. |

## What's left

### A. Bulk capture of all 1,230 UIDs (operator-driven, no code)

The `IDs` file at repo root lists all known Pax UIDs. Each successful capture becomes one submission.

```
bun run dump-all --limit 20 --resume   # chunk across sessions
# ... wait hours, possibly handle Copy-popup or editor-walk failures ...
bun run dump-all --limit 20 --resume   # picks up where last run left off
```

**Estimated wall-clock**: ~60h naive (Pax rate limits unknown; `--limit 20` and `--resume` make this resumable across sessions). **No code change required** — `bun run dump-all` already exists, was verified by `dump-all-presets.md`.

**Why it's operator-driven**: live Pax capture requires auth cookies at the pax-ripper default path (`~/.config/pax-ripper/browser-profile/`); no automated pipeline can satisfy Pax's auth requirement on the user's behalf.

### B. Per-UID GitHub Issue submission (operator-driven, no code)

Each captured `out/<UID>.json` becomes one GitHub Issue on `Open-Historia/Open-historia-scenarios`. The workflow:

1. Open `https://github.com/Open-Historia/Open-historia-scenarios/issues/new?template=scenario.yml`
2. Drag `out/<UID>.json` into the description box (GitHub uploads it and inserts the download link)
3. Submit — the form auto-applies the `scenario` label
4. The post appears in the in-game **Community → Scenarios** browser

**Why it's operator-driven**: GitHub Issues require a human session (or a personal-access-token CI). The hub README explicitly documents the manual workflow.

### C. Live browser E2E (deferred, requires open-historia dev env)

`docs/plans/.evidence/2026-07-16-hub-alignment-verify.md` records `UNIT_VERIFIED` for the bundle-renders-correctly claim — all 4 tiers of the Live-Target Probe failed on this host (no running server, no installed deps, no deploy backends).

**Action required**: A user with a bootstrapped `open-historia` dev env (`npm install && npm run dev`) can:
1. Open `http://localhost:5173/` in a browser
2. Import `out/undXAyQbz7OwIXfIZLXL.json` via the in-game import UI
3. Confirm: (a) no red `z26` fallback on ocean tiles, (b) owner colors visible on owned regions, (c) synthetic `Z##` codes used for unmapped polities
4. Update `docs/plans/.evidence/2026-07-16-hub-alignment-verify.md` to `LIVE_PASS`

**Why it's deferred**: the open-historia repo (`/home/john/Projects/open-historia/`) is unbootstrapped on this host. The plan's previous attempts documented each failed tier; the only fix is a human with `npm install`.

### D. Deferred code ideas (none urgent)

From `2026-07-17-preset-export-completion.md` Deferred Ideas:

- **GitHub API automation for bulk submission** — would open Issues via API. Manual workflow suffices at 1-20 submissions; defer until volume justifies the engineering.
- **Backfilling 53 caches with `baseMapGeometry` in `editor_state_raw.json`** — re-capture picks it up naturally; no scheduled backfill needed.
- **Refreshing `canonicalize.ts` TABLE with Pax historical codes** (`ABBS`, `ARAG`, etc.) so `data.world.ownerCodes` matches hub values. Would require a Pax-side code source we don't currently capture.
- **Per-UID open-historia browser E2E at scale** — once the open-historia dev env is bootstrapped, run for each captured UID.

## Approach (recommendation)

**Recommended next action**: nothing code-wise. The user's stated goal (`exporting of presets from paxhistoria.co/presets ... in a format that can be submitted to Open-historia-scenarios`) is fully enabled by the committed code + docs. The remaining items are operator actions or follow-up code work that's already been deferred with rationale.

If the user wants to pursue any of the deferred items, each is its own self-contained follow-up plan. None of them is small enough to bundle into a single `/spec` cycle.

## Tasks

This plan intentionally has zero implementation tasks. The work is done; the remaining items are operator-driven or deferred.

- [x] Task 1: Surface current state and remaining items

## Goal Verification

### Truths

1. **The producer-side export pipeline is fully working.** Verified by 146/0 tests + `bun run verify-out` 4/4 PASS + `bun run check-hub-conformance` exit 0 + typecheck clean.
2. **The submission path is documented.** Verified by README section + `.claude/rules/preset-submission.md`.
3. **The remaining work is operator-driven or deferred.** This plan is the inventory; the actual remaining actions (bulk capture, per-UID submission, live E2E, deferred code ideas) are enumerated in the "What's left" section above.

## Out of Scope

Re-affirmed from `2026-07-17-preset-export-completion.md`:
- Re-capturing UID `undXAyQbz7OwIXfIZLXL` from paxhistoria.co (already in `out/undXAyQbz7OwIXfIZLXL.json`)
- Hub-side validation changes (the `Open-Historia/Open-historia-scenarios` repo is read-only from this project's POV)
- Open-historia renderer changes (separate repo, different concern)

## Open Questions

None at the plan level. Open operational questions are deferred to the operator session that does the bulk capture (chunk size, timing, Pax auth state, etc.).

## Deferred Ideas

Same as `2026-07-17-preset-export-completion.md` — listed in the "What's left / D" section above.
