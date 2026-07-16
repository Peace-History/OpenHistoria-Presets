# Dump All Presets Plan

Created: 2026-07-16
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** After this plan lands, a single command dumps every Pax UID listed
in `IDs` into a hub-conformant Open Historia bundle under `out/<uid>.json`,
running live Pax capture + transform + hub conformance check per UID, and
printing a PASS/FAIL row per UID plus a final summary. `--limit` and
`--resume` make the run chunkable across sessions.

## Out of Scope

- Resubmitting live captures to Pax (no new `pax-ripper` capture logic; we
  reuse `capturePreset` and `--preset` as-is).
- Per-UID HTML/UI verification in Open-Historia (covered by `check-hub-conformance`
  on the cold-war fixture; per-UID browser checks are out of scope for a 1,200-UID run).
- Re-running or replacing the conformance module itself — the existing
  `diffAgainstHubBundles` is reused.
- Parallelizing pax-ripper captures (Pax rate limits are unknown; deferred).

## Approach

**Chosen:** New thin orchestrator script `tools/preset-exporter/scripts/dump-all.ts`
that (1) filters `IDs` to Pax-UID-shaped lines, (2) verifies the auth cookies
file exists upfront, (3) per UID invokes `bun run rip --preset <uid> --output
./out/cache` for the capture step, finds the latest version dir, runs
`loadCaptureFromDir` + `transform` + `writeBundle`, then calls
`diffAgainstHubBundles` against the 6 hub bundles and prints one
PASS/FAIL row per UID. `--limit` caps how many UIDs are processed; `--resume`
skips UIDs whose `out/<uid>.json` already exists and passes conformance.

**Why:** Reuses every proven primitive (`loadCaptureFromDir`, `transform`,
`writeBundle`, `diffAgainstHubBundles`, `pickLatestVersionDir` from
`../src/capture`) and adds zero new capture or diff logic. The per-UID
conformance mirrors exactly what `scripts/export-and-check.ts` does for
one UID. Single-UID `--preset` is the only safe per-UID capture invocation
(combining `--preset` with `--from-file` is not a documented combination
in pax-ripper's parser).

## Context for Implementer

- pax-ripper reads a UID list via `--from-file <path>` and writes captures
  to `<output>/<uid>/<version>/manifest.json`. The script does NOT use
  `--from-file` at the per-UID layer — it uses `--preset <uid>` for each
  UID so a per-UID failure doesn't poison the rest of the batch. The
  orchestrator's `--limit` slices the filtered list BEFORE the loop.
- `parseIdsFile` in `tools/pax-ripper/src/index.ts:170-203` accepts any
  `^[A-Za-z0-9_-]+$` line as a UID; labels like `modern_day` pass the
  regex and fail at Firestore 404. Our filter
  `^[A-Za-z0-9_-]{16,}$` is stricter and runs before pax-ripper sees
  the file. The 16-char floor is conservative (observed UIDs in this
  repo are 20 chars); 16 lets a future Pax UID scheme slip through
  instead of silently dropping.
- Live Pax capture requires auth cookies at the default pax-ripper path
  (see `tools/pax-ripper/README.md` and `cli.ts:56`). The script checks
  for cookies upfront and aborts with a clear error if missing — better
  than 1,230 FAIL rows later.
- The 6 hub bundles live at `/home/john/Projects/Open-historia-scenarios/bundles/`;
  `loadHubBundles` reads them. The same env override (`HUB_BUNDLES_DIR`)
  applies.
- Pax captures take minutes each (Playwright + Firestore REST). 1,230 UIDs
  × ~3 min = ~60h naive wall-clock. `--limit` and `--resume` let operators
  chunk across sessions. Sequential by design (Pax rate-limit policy is
  unknown).

## Assumptions

- pax-ripper's existing capture pipeline is unchanged — the orchestrator
  is the only new code. If capture breaks for unrelated reasons, the
  existing per-UID `bun run rip --preset <uid>` path still works.
- Hub bundles are still at `/home/john/Projects/Open-historia-scenarios/bundles/`
  with 6 official entries; `loadHubBundles` handles them as today.
- `IDs` does not contain URLs (only short slugs and 20-char alphanumeric UIDs).
  No URL parsing needed.
- Operators run `dump-all` interactively or in chunks via `--limit` /
  `--resume`. There is no expectation of a single end-to-end run on
  1,230 UIDs.
- `loadCaptureFromDir` + `transform` + `writeBundle` work end-to-end on
  freshly-captured pax-ripper output for real UIDs (verified for the
  cold-war fixture; Task 2's verification step confirms this on the
  first 3 real UIDs from `IDs` before scaling up).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Capture invocation `--preset + --from-file` not supported by pax-ripper | High | Per-UID step fails with "unknown flag" | Use single-UID `--preset <uid>` only. The orchestrator's `--limit` slices the filtered UID list BEFORE the loop. |
| `--resume` skips a half-written `out/<uid>.json` after a crash | Medium | Stale or missing bundle is silently treated as "already exported" | Resume check: `out/<uid>.json` must exist, be > 1 KB, and `JSON.parse` cleanly. Capture dir resume check: `manifest.json` AND at least one non-empty capture artifact (e.g. `preset.json` or `geometry.json`) must exist. Add `--force` flag to bypass both. |
| Missing cookies file on a fresh checkout | Medium | 1,230 FAIL rows with no actionable cause | Pre-flight check before the per-UID loop: confirm the pax-ripper cookies file exists at the default path; abort with a one-line error pointing at `tools/pax-ripper/README.md`. |
| Filter regex `^...{20,}$` drops future longer UIDs | Low | Silently skipped (no FAIL — bypasses pax-ripper) | Relaxed to `{16,}` (covers observed 20-char UIDs and shorter plausible schemes). |
| `out/.dump-presets.txt` accidentally committed | Low | Repo pollution (not secret) | After capture, delete the file. Alternative if deletion is awkward: write to `os.tmpdir()` and let the OS clean up. The dotfile-under-`out/` trick was wrong; verify with `git check-ignore` or skip it entirely. |
| Exit-code 2 (no captures succeeded) unreachable with `--resume` | Medium | Operator can't distinguish "nothing to do" from "everything failed" | Add exit 3 = "no work performed" (all UIDs skipped via `--resume`). Document full exit-code matrix in `--help`. |
| One UID takes forever and blocks the queue | Medium | Hours lost to a stuck capture | pax-ripper's per-UID `capturePreset` already has its own timeout. Add a per-UID wall-clock warning (e.g. > 10 min → log + continue without aborting). |

## Goal Verification

### Truths

1. **A single `bun run dump-all` call iterates `IDs`, captures each UID via
   pax-ripper's single-UID `--preset` path, transforms it to a
   hub-conformant bundle, runs the existing `diffAgainstHubBundles` check,
   and writes a PASS/FAIL row per UID plus a final summary.** No new
   capture or diff logic; only orchestration glue.
2. **`--limit` and `--resume` make the run resumable across sessions.**
   Re-running the script after a partial run does NOT re-capture UIDs
   whose full pipeline already succeeded (per the resume check: bundle
   file exists, is > 1 KB, parses as JSON). A second invocation against
   the same input does not duplicate work.

## Progress Tracking

- [x] Task 1: Implement `dump-all.ts` orchestrator (filter + per-UID loop + --limit + --resume + summary)
- [x] Task 2: README docs + package.json wiring

## Implementation Tasks

### Task 1: Implement `dump-all.ts` orchestrator

**Objective:** Single new file `tools/preset-exporter/scripts/dump-all.ts`
that walks `IDs`, captures each UID, transforms it, runs the hub
conformance check, prints per-UID PASS/FAIL rows, and prints a final
summary. Supports `--limit N`, `--resume`, and `--force` (bypass resume
checks). Aborts upfront if the pax-ripper cookies file is missing.

**Files:**

- Create: `tools/preset-exporter/scripts/dump-all.ts`

**Key Decisions / Notes:**

- Filter regex: `^[A-Za-z0-9_-]{16,}$`. Verified against `IDs`:
  all 1,230 actual UIDs match (20-char base62); all 11 labels
  (`modern_day`, `WW2_Europe`, `europe_1913_simple`, `usa_civil_war`,
  `Fall_of_the_Roman_Empire`, `French_Revolution`, `seven_years_war`,
  `thirty_years_war`, `Three_Kingdoms`, `ides_of_march`) fail. Floor
  of 16 (not 20) is a deliberate hedge against future Pax UID schemes.
- Transient UID file: write the filtered list to
  `os.tmpdir()/dump-all-uids.txt` (or a `mktemp`-style path) and `unlink`
  it after the run. **Do NOT** write to `out/.dump-presets.txt` — that
  trick relies on gitignore behavior the plan didn't verify. Tmpdir +
  explicit delete is unambiguous.
- Capture invocation per UID:
  `bun run tools/pax-ripper/src/index.ts --preset <uid> --output ./out/cache`.
  Single-UID; combine with orchestrator-side `--limit` slicing.
- Resume check (per candidate UID, before capture):
  - Skip capture + transform + check if `out/<uid>.json` exists AND
    `Buffer.byteLength(...) > 1024` AND `JSON.parse(...)` succeeds.
    Emit row: `SKIP <uid>: already exported`.
  - Otherwise: attempt capture. After capture, before transform: skip
    capture (re-use cache) if `out/cache/<uid>/<v>/manifest.json` exists
    AND `out/cache/<uid>/<v>/preset.json` exists and is non-empty.
- `--force`: bypass the resume checks above; always re-capture + re-export.
- Auth pre-flight: read the pax-ripper cookies path (see
  `tools/pax-ripper/src/config.ts` and its README) and `fs.existsSync`
  it before the loop. If absent, print a one-line error pointing at
  `tools/pax-ripper/README.md` and exit 1.
- Imports from `../src/capture` (`loadCaptureFromDir`, `pickLatestVersionDir`),
  `../src/transform` (`transform`), `../src/bundle` (`writeBundle`), and
  `../src/conformance` (`diffAgainstHubBundles`, `loadHubBundles`).
- Per-UID row format: `PASS <uid>` or `FAIL <uid>: <short reason>`
  or `SKIP <uid>: already exported`. One line, machine-greppable.
- Per-UID wall-clock log: print `<uid> started` and `<uid> finished in
  Xs` so an operator can spot a stuck UID (> 10 min → log a warning but
  continue).
- Final summary line: `processed=N pass=K fail=M skip=R elapsed=Xs`.
  Always printed.
- Exit code matrix:
  - `0` = at least one UID processed and all PASS.
  - `1` = at least one FAIL.
  - `2` = no UIDs processed at all (input was empty after filter, or
    every UID errored before any per-UID work began).
  - `3` = `--resume` skipped every UID (nothing to do).
- Errors: `try/catch` around each UID's full pipeline; on caught error
  print `FAIL <uid>: <error message>` and continue.

**Definition of Done:**

- [ ] Running with a 2-UID stub list (both with captures already on disk
  under `out/cache/<uid>/<version>/`) emits 2 PASS rows and exits 0.
- [ ] Running with one UID missing its capture emits 1 PASS + 1 FAIL
  with a clear "capture missing" reason, exits 1, and still emits the
  PASS for the other UID.
- [ ] `--limit 3` against a 5-UID stub processes exactly 3 UIDs.
- [ ] `--resume` on a 2-UID list where one already has a valid
  `out/<uid>.json` emits `SKIP <uid>: already exported` + `PASS <uid>`
  and exits 0.
- [ ] Running with no cookies file present exits 1 with a one-line
  error pointing at the pax-ripper README — before entering the per-UID
  loop.
- [ ] Running against the first 3 real UIDs from `IDs` produces 3
  PASS rows (or a documented FAIL with the same `out/<uid>.json` that
  `bun run export --preset <uid>` would produce — confirming the
  orchestrator's transform matches the proven single-UID path).
- [ ] `bun run typecheck` clean.

### Task 2: README docs + package.json wiring

**Objective:** Document the new script in `README.md` under a new
"Dumping all presets" subsection, and add a `dump-all` script alias in
`tools/preset-exporter/package.json`.

**Files:**

- Modify: `README.md`
- Modify: `tools/preset-exporter/package.json`

**Key Decisions / Notes:**

- README: add a short subsection near `## Hub submission` listing the
  command, the per-UID PASS/FAIL output format, the exit-code matrix,
  and the resume semantics. Keep it ≤ 12 lines — operators already
  know what capture + export do.
- `package.json`: add `"dump-all": "bun run scripts/dump-all.ts"` next
  to `check-hub-conformance` and `export-and-check`. No new deps.

**Definition of Done:**

- [ ] `bun run dump-all --help` works from the repo root.
- [ ] README subsection is added; no other docs change.
- [ ] Verify: `bun run typecheck` clean.

## Deferred Ideas

- Parallelizing capture across N Chromium instances. Out of scope; Pax's
  per-user rate limits are unknown, and parallelizing Playwright sessions
  is its own project. The README should explicitly state "sequential by
  design — use `--limit` to chunk across multiple machines".
- Uploading the resulting `out/*.json` files to `Open-Historia/Open-historia-scenarios`
  automatically. Out of scope — the user still controls the PR.