# Preset Export → Open-Historia Hub — Remaining Work Plan

Created: 2026-07-17
Status: PENDING
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

> Inventory of remaining work for the end-to-end flow: `paxhistoria.co/presets` → `out/<UID>.json` → submitted to `Open-Historia/Open-historia-scenarios`.

## Summary

**Goal:** Get from "a producer bundle sitting in `out/<UID>.json`" to "the same bundle installable in Open-Historia's Community tab". Concretely, three remaining items:

1. **Land the WIP** in the working tree (11 files modified, 5 added) — `verify-out-bundles-cleanup` Task 3 + the entire `basemap-capture` plan Tasks 2–4. None of this is committed yet; the verifier fails against the un-cleaned `out/modern-day.json`, and `assets.backgroundData` is never emitted so bundles lack their basemap.
2. **Establish the per-UID submission path** — one GitHub Issue per preset on `Open-Historia/Open-historia-scenarios` with the `scenario.yml` template, dragging the exported `.json` into the description. The exporter's output is already hub-conformant (per `check-hub-conformance.ts`); no further code is required to make it submit-ready.
3. **Operator-driven bulk capture** of the 1,230 UIDs in `IDs` via `bun run dump-all --limit N --resume` (60h naive; chunk across sessions). Each successful capture becomes one submission.

## What's already done (verified, committed, working)

| Plan | Status | What it delivered |
|------|--------|-------------------|
| `2026-07-16-paxhistoria-preset-exporter.md` | VERIFIED | pax-ripper vendored + `transform → bundle` pipeline emits `out/<UID>.json` matching the 6 hub bundles' shape |
| `2026-07-16-paxhistoria-hub-alignment.md` | VERIFIED | `<n>`-suffix parity fix, `round: 1` restored, `data.world` trimmed to 8 hub keys, `assets.backgroundData` shape decided (kind: vector) |
| `2026-07-16-dump-all-presets.md` | VERIFIED | `bun run dump-all` orchestrator with `--limit` / `--resume` / `--force`, per-UID PASS/FAIL row + summary |
| `2026-07-16-dump-all-capture-failures.md` | VERIFIED | Copy-popup retry, `manifest.incomplete` flag, tightened resume gate, inter-UID delay — three failure modes collapse to actionable rows |
| `2026-07-16-water-ownership-z26.md` | VERIFIED | Ocean/Strait regions filtered at both emission sites — no synthetic `Z##` on water, no `z26` red fallback in open-historia |
| `2026-07-16-verify-out-bundles.md` | VERIFIED | `bun run verify-out` walks `out/*.json`, runs `diffAgainstHubBundles` + 19 value-type checks, prints PASS/FAIL/SKIP per bundle |
| `2026-07-16-paxhub-conformance-test.md` | VERIFIED | `check-hub-conformance.ts` + `export-and-check.ts` — exporter's output diffed against the 6 hub bundles at 13 levels; UID-specific runner with `fixture proxy` sentinel for UIDs without on-disk captures |

End-to-end pipeline (committed code) is: **paxhistoria.co → pax-ripper capture → `transform.ts` → `bundle.ts` → `out/<UID>.json` → hub-conformant JSON** (verified via `bun run check-hub-conformance` against the cold-war fixture).

## What's in-flight in the working tree (NOT YET COMMITTED)

`git status --short` on the current branch shows ~16 modified files plus 5 additions. The two plan files this WIP belongs to are both marked VERIFIED in their plan bodies, but their Progress Tracking is incomplete:

### In-flight #1: `verify-out-bundles-cleanup.md`

- Tasks 1 + 2: DONE (RED tests + root-cause fix landed in working tree)
- Task 3 (Quality Gate): NOT DONE in the plan, though the underlying work may already be done — needs verification

The plan's "Post-Plan Operational Items (OUTSIDE this plan)" section says explicitly:

> 1. **Commit strategy decision.** Working tree has 11 files modified/added; `origin/main` reports `[gone]`. User must decide: commit on current `main`, or branch from `origin/main` first (will fail since `[gone]`), or some other flow.
> 2. **Commit + push.** After Task 3 passes and the user confirms commit strategy.

So the only blocker for this plan is a **commit decision** plus confirming Task 3's gate (`bun run verify-out` → exit 0, summary `processed=58 pass=58 fail=0`).

### In-flight #2: `basemap-capture.md`

- Task 1: DONE (PaxEditor.basemapGeometry typed + loadCaptureFromDir reads editor_state_raw.json)
- Tasks 2 + 3 + 4: NOT DONE — `transform.ts` does not yet emit `assets.backgroundData`; 3 existing tests still assert the absence of `backgroundData` and would break the moment Task 2 lands; the cold-war fixture lacks `editor_state_raw.json` so Task 3 needs a fabricated stub.

The plan is fully designed and ready to implement; it just hasn't been.

## What's NOT yet done (the user's literal ask)

### A. Producer-side — submit-ready JSON shape

Already done. `out/<UID>.json` matches the 6 hub bundles' shape at every level we diff. `bun run check-hub-conformance` exits 0 against the cold-war fixture. The hub submission form (`Open-Historia/Open-historia-scenarios/.github/ISSUE_TEMPLATE/scenario.yml`) accepts a `.json` drag-and-drop; no further producer code is required.

**One caveat** from `paxhub-conformance-test.md`'s Out of Scope: `data.world.ownerCodes` content is an open semantic gap — hub bundles use 3-4 char historical codes (`ABBS`, `ARAG`, `AYY`), ours emit ISO-3. The diff proves key-set membership; it does NOT prove the importer accepts the values. This is deferred until the user can verify in a live open-historia session (browser E2E).

### B. Submission-side — per-UID GitHub Issue

Each `out/<UID>.json` becomes one GitHub Issue on `Open-Historia/Open-historia-scenarios`. The workflow (per the hub's README):

1. Open `https://github.com/Open-Historia/Open-historia-scenarios/issues/new?template=scenario.yml`
2. Drag the exported `.json` into the description box
3. The form auto-applies the `scenario` label
4. Submit — appears in the in-game Community tab

This is operator-driven (no code). It does NOT require `bundles/` to be updated in the Open-historia-scenarios repo — official bundles live as release assets on the `bundles` release, while submitted scenarios live as Issues with `scenario` label.

### C. Bulk capture of all 1,230 UIDs

The `IDs` file at repo root lists all known Pax UIDs. `bun run dump-all` walks them with per-UID capture + transform + conformance check. Estimated wall-clock ~60h naive (Pax rate limits unknown). The operator runs in chunks:

```
bun run dump-all --limit 20 --resume
# ... wait hours, possibly handle Copy-popup or editor-walk failures ...
bun run dump-all --limit 20 --resume  # picks up where last run left off
```

After capture, each successful `out/<UID>.json` becomes one Issue (per the B path above).

### D. Browser E2E in open-historia (deferred, recorded)

`docs/plans/.evidence/2026-07-16-hub-alignment-verify.md` records `UNIT_VERIFIED` for the bundle-renders-correctly claim — all 4 tiers of the Live-Target Probe failed on this host (no running server, no installed deps, no deploy backends). The follow-up recommendation is for a user with a bootstrapped open-historia dev env to verify visually and downgrade the truth to `LIVE_PASS`. This is **out of scope** for every plan in this repo and remains the only outstanding empirical question.

## Out of Scope

- **Backfilling 53 caches with `baseMapGeometry` in `editor_state_raw.json`.** Re-capture picks it up automatically on next `dump-all`. Per `basemap-capture.md` Open Questions, defer to natural re-capture.
- **Refreshing `canonicalize.ts` TABLE with Pax historical 3-4 char codes.** Deferred per `paxhub-conformance-test.md` Out of Scope — would change import semantics; needs a Pax-side code source we don't currently capture.
- **A live `open-historia.com/play/` browser session on this host.** The open-historia repo is unbootstrapped (`npm install` not run); all four Live-Target Probe tiers fail with documented reasons in `2026-07-16-hub-alignment-verify.md`.
- **Replacing the `--with-editor` capture dependency.** Per `dump-all-capture-failures.md` Out of Scope — large refactor.
- **Public-page geometry-response interception fallback in `ripPreset.ts`.** Per `dump-all-capture-failures.md` Out of Scope — broader fix; deferred unless the surgical fix leaves too many UIDs un-exported.

## Approach

**Chosen:** Three sequenced tasks — finish the two in-flight plans, then document the per-UID submission path in `README.md` and `.claude/rules/preset-submission.md`. The bulk capture (`bun run dump-all`) is operator-driven and lives outside the plan's task list.

**Why:** The producer-side code is already hub-conformant; the remaining producer work is finishing two partially-implemented plans whose contracts are already pinned by tests in the working tree. The submission path is a documented operator workflow, not a code change — putting it in `README.md` makes it discoverable without expanding scope. Defer the bulk capture to operator sessions (it does not benefit from being in this plan's task list; it IS the post-plan operational step).

## Context for Implementer

- **Commit strategy is a hard prerequisite for Task 1 below.** Per `verify-out-bundles-cleanup.md` Post-Plan Operational Items #1, `origin/main` reports `[gone]` (the upstream remote is no longer reachable from this host). The user must decide whether to commit on current `main`, branch first, or some other flow. Task 1 cannot land until this is resolved — `git commit` requires explicit permission per `~/.claude/rules/development-practices.md` Git Operations rules, and the user has not yet given it.
- **The WIP tree is internally consistent.** `verify-out-bundles-cleanup.md` Task 1's RED tests already exist in the working tree (`regress-modern-day-fixture.test.ts`, `union-of-keys-export.test.ts`) and Task 2's fix (modern-day.json refreshed, `unionOfKeysAt` exported, `verify-out-bundles.ts` collapsed) is also in the tree. `basemap-capture.md` Task 1's capture.ts + types.ts + tests are also in the tree. So once the user picks a commit strategy, `git add` the relevant files and the in-flight work is half-done.
- **`assets.backgroundData` shape depends on basemap geometry on disk.** `basemap-capture.md` Task 3 needs `tests/fixtures/cold-war/api_responses/editor_state_raw.json` to exist before the cold-war fixture can exercise the new emission path end-to-end. The plan's chosen option (A) fabricates a minimal stub. The fixture currently has no `editor_state_raw.json` (verified via `ls tests/fixtures/cold-war/`); Task 3.1 is the first step.
- **Hub submission form expects a single `.json` file.** Open-Historia's scenario.yml form takes one attachment (the `.json`). Bundles with custom basemaps use `.zip` (per the hub README), but our exporter emits basemap geometry into `assets.backgroundData` (kind: vector), which is embedded in the same `.json` — no separate `.zip` needed unless the operator wants to publish the basemap as a standalone basemap post too (separate `basemap.yml` form).
- **The `IDs` file is the canonical UID list.** 1,230 entries, 20-char base62 + 11 label lines (skipped by `dump-all.ts`'s `^[A-Za-z0-9_-]{16,}$` filter). Verified against `IDs` content in `dump-all-presets.md` Task 1.
- **`origin/main` is `[gone]`** — the upstream remote reference is dangling. New commits will create a new branch reference; the user may need to `git remote set-url origin <new-url>` or branch off a local commit. This is the "Post-Plan Operational Item" from `verify-out-bundles-cleanup.md`.

## Assumptions

- The user has access to a paxhistoria.co account with cookies at the pax-ripper default path (`~/.config/pax-ripper/browser-profile/`). Without it, `bun run dump-all` cannot capture new UIDs — only the pre-captured UIDs under `out/cache/` are transformable offline.
- The user has write access to `Open-Historia/Open-historia-scenarios` (or a fork) to open Issues. If they have only read access, Issues still create submissions (the `scenario` label is auto-applied by the form), but `bundles/` PRs require write.
- The 6 hub bundles' shape is stable. `check-hub-conformance.ts` reads them at run time; if a hub bundle gains a new key, the script reports schema drift rather than silently passing.
- The basemap geometry shape (`state.baseMapGeometry.geometry` in `editor_state_raw.json`) is stable. `basemap-capture.md` Task 2's emit path tolerates empty/null/non-object geometry and falls through to "no basemap"; the same shape is in 53/77 existing caches today.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `verify-out-bundles-cleanup.md` Task 3 fails (test suite red, `verify-out` still 1 FAIL) | Low | Plan blocked | Task 3's DoD is verification-only (run existing tests, run `bun run verify-out`); if it fails, the failure is a regression to surface in the next plan iteration, not silent. |
| `basemap-capture.md` Task 2 breaks the 3 existing tests | Certain (by plan design) | Plan blocked | The 3 test updates are part of Task 2's body (`transform.test.ts:102`, `regress-modern-day-fixture.test.ts:24`, `contract.test.ts:55`); Task 2's DoD includes the updates. |
| User cannot reach `origin/main` to branch off | High (already `[gone]`) | Commit strategy stalls | The plan's Approach surfaces this as a hard prerequisite for Task 1; user decides the strategy before Task 1 starts. |
| Live `open-historia.com/play/` browser verification on this host | N/A | Goal Verification Truth #2 stays `UNIT_VERIFIED` | Already documented in `2026-07-16-hub-alignment-verify.md`; not blocking any task in this plan. |
| Hub-side semantic gap (ISO-3 vs historical codes) surfaces during issue submission | Medium | Submission may import with wrong owner-color rendering | Document in the submission PR/issue; defer to a follow-up plan that refreshes `canonicalize.ts` TABLE with Pax historical codes. Out of scope here. |

## Progress Tracking

- [ ] Task 1: Land in-flight WIP (verify-out-bundles-cleanup Task 3 + basemap-capture Tasks 2-4)
- [x] Task 2: Document the per-UID submission path
- [ ] Task 3: Verify and mark plan complete

## Implementation Tasks

### Task 1: Land in-flight WIP

**Objective:** Finish `verify-out-bundles-cleanup.md` Task 3 (Quality Gate) and `basemap-capture.md` Tasks 2, 3, 4 in the working tree, then commit per the user's chosen strategy. After this task, `git status` shows no uncommitted changes to tracked files; all 7 producer plans are at full Progress Tracking completion; `bun run verify-out` exits 0.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/src/transform.ts` (basemap-capture Task 2 — emit `assets.backgroundData` when `editor.basemapGeometry` present)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/transform.test.ts` (basemap-capture Task 2 — add RED test for basemap emission; update line 102 to allow `backgroundData`)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/regress-modern-day-fixture.test.ts` (basemap-capture Task 2 — update line 24 to conditional on fixture cache contents)
- Modify: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/contract.test.ts` (basemap-capture Task 2 — update line 55 to allow `backgroundData` when basemap present)
- Create: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/fixtures/cold-war/api_responses/editor_state_raw.json` (basemap-capture Task 3.1 — stub `state.baseMapGeometry.geometry` with 2 regions: Land + Ocean)
- Create: `/home/john/Projects/OpenHistoria-Presets/tools/preset-exporter/tests/fixtures.test.ts` (basemap-capture Task 3.2 — fixture-loader sanity test)
- Modify: `/home/john/Projects/OpenHistoria-Presets/docs/plans/2026-07-16-basemap-capture.md` (mark Tasks 2-4 complete)
- Modify: `/home/john/Projects/OpenHistoria-Presets/docs/plans/2026-07-16-verify-out-bundles-cleanup.md` (mark Task 3 complete)
- Modify: `/home/john/Projects/OpenHistoria-Presets/docs/plans/.evidence/2026-07-16-hub-alignment-verify.md` (no change unless browser verification becomes possible)
- `git add` + `git commit` per user-chosen strategy

**Key Decisions / Notes:**

- **Commit strategy first.** The implementer MUST surface the user's choice before any `git commit` (per `~/.claude/rules/development-practices.md` Git Operations rules — write commands need explicit user permission). Present the three options inline:
  1. **Commit on current `main`** — simplest; `git add -A && git commit -m "feat: ..."`. Works because the WIP is internally consistent.
  2. **Branch from the latest local commit** (`git checkout -b feat/wip-land <sha>`) — keeps main clean. Use `git log --oneline -5` to show the user the candidates.
  3. **Wait for user to fix `origin/main` reference** — if they want to push to a remote, they need to update `git remote set-url origin <url>` first.
- **verify-out-bundles-cleanup Task 3 is mostly verification.** Run `bun test tools/preset-exporter/tests/` (expect 0 failures), `bun run verify-out` (expect exit 0, `processed=58 pass=58 fail=0`), and `bunx tsc --noEmit` (expect exit 2 with ONLY the 3 pre-existing `GeoJSON` namespace errors at `transform.ts:76,77,112`). If new errors appear, fix only the gap; do NOT rewrite working code.
- **basemap-capture Task 2 emits backgroundData only when present.** `assets.backgroundData = { mode: "embedded", fileName: "basemap.geojson", contentType: "application/geo+json", encoding: "base64", data: <base64> }`. No `kind` field — open-historia's `useCustomBackground.js` infers vector from `contentType`.
- **basemap-capture Task 3.1 fixture stub.** Minimal valid GeoJSON: 2 stub regions (one Land, one Ocean) with valid polygon strings. ~30 lines of JSON. Stub geometry: a small rectangle for Land, a slightly different rectangle for Ocean. Sufficient to exercise the emit path; not a real capture.
- **basemap-capture Task 4 is also verification.** Same gate commands as verify-out-bundles-cleanup Task 3 — full suite green, `verify-out` exit 0, typecheck clean (modulo the 3 GeoJSON errors). After Task 2 emits `backgroundData` for any capture that has `editor.basemapGeometry`, `verify-out-bundles.ts` will accept it as a `WARN (importer-accepted)` (per `verify.ts:259`'s soft-warn path) — no legitimate FAIL expected.
- **One commit or two?** Either: (a) two commits (one per plan, easier to bisect), or (b) one combined commit (simpler history). Default to one combined commit unless the user asks otherwise.
- **Skip browser verification.** Do not attempt the Live-Target Probe — it failed all 4 tiers in `2026-07-16-hub-alignment-verify.md`; trying again with the same constraints will yield the same outcome.

**Definition of Done:**

- [ ] `bun test tools/preset-exporter/tests/` exits 0 (0 failures)
- [ ] `bun run verify-out` exits 0 with summary `processed=58 pass=58 fail=0`
- [ ] `bunx tsc --noEmit` exits 2 with EXACTLY the 3 pre-existing `GeoJSON` namespace errors (line numbers may shift; the count and message must match)
- [ ] `git status` clean for tracked files (no `M ` or `MM` entries; untracked `out/cache/`, `out/<UID>.json` are expected and gitignored)
- [ ] All 7 producer plans' Progress Tracking shows `[x]` for every task
- [ ] `git log` shows one (or two) new commits with the WIP message; user-approved commit strategy executed

### Task 2: Document the per-UID submission path

**Objective:** Add a "Submitting to the hub" section to `README.md` so contributors can find the workflow without re-deriving it. Also drop a short note in `.claude/rules/` so future /spec invocations know about the submission form.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/README.md` (add "Submitting to the hub" section near the existing "Output format" section)
- Create: `/home/john/Projects/OpenHistoria-Presets/.claude/rules/preset-submission.md` (one-page rule: how to submit, how to bulk-capture, what NOT to file as a new bug)

**Key Decisions / Notes:**

- **README section content:** 6 bullets — (1) "Each `out/<UID>.json` is one submission"; (2) "Open `https://github.com/Open-Historia/Open-historia-scenarios/issues/new?template=scenario.yml`"; (3) "Drag the JSON into the description box"; (4) "The form auto-applies the `scenario` label"; (5) "For bulk: `bun run dump-all --limit N --resume`, then submit each `out/<UID>.json` that PASSes"; (6) "Live E2E verification requires `open-historia` dev env bootstrapped — out of scope on this host".
- **No script changes.** The hub submission is a manual GitHub Issues workflow; automation would need the GitHub API + a label-management plan, both explicitly out of scope.
- **`.claude/rules/preset-submission.md` content:** mirror the README section but framed for an agent — "If the user asks 'how do I submit', point at this. If they ask 'is there a CLI for it', answer no, it's a manual GitHub Issues workflow. If they ask 'why doesn't the bundle just appear in open-historia.com', explain the Issues-as-Content pattern from the hub's README."
- **No rule change for global CLAUDE.md.** This rule is project-specific, lives under `.claude/rules/preset-submission.md` per `~/.claude/CLAUDE.md` project-rule convention.

**Definition of Done:**

- [ ] `README.md` "Submitting to the hub" section exists with the 6 bullets above (or close paraphrase — match the project's existing section style)
- [ ] `.claude/rules/preset-submission.md` exists with the agent-facing guidance
- [ ] Total README diff ≤ 12 lines (parsimony — same convention as `dump-all-presets.md` Task 2)

### Task 3: Verify and mark plan complete

**Objective:** Confirm the producer pipeline is still green after the docs additions (no regression), and flip this plan's Status to COMPLETE. The verify-out-bundles-cleanup Task 3 and basemap-capture Task 4 work in Task 1 already covered the suite green; Task 3 just confirms no regression from Task 2's doc edits.

**Files:**

- Modify: `/home/john/Projects/OpenHistoria-Presets/docs/plans/2026-07-17-preset-export-completion.md` (this plan — flip `Status: COMPLETE`)

**Key Decisions / Notes:**

- Docs-only task; no production code changes. The full preset-exporter suite should still be green (no code path touched).
- No browser verification attempted (same reasoning as Task 1).
- After this plan flips to COMPLETE, `spec-verify` is the natural next step — but the user may choose to skip verification given the producer side is already verified by Tasks 1 + 2's gate commands and the docs are read-only.

**Definition of Done:**

- [ ] `bun test tools/preset-exporter/tests/` exits 0
- [ ] `bun run verify-out` exits 0
- [ ] `bunx tsc --noEmit` exits 2 with the 3 pre-existing GeoJSON errors only
- [ ] This plan's `Status:` flipped from `PENDING` to `COMPLETE`
- [ ] `~/.pilot/bin/pilot register-plan "<plan_path>" "COMPLETE"` invoked

## Goal Verification

### Truths

1. **All in-flight producer work is committed and green.** Task 1's DoD includes suite green + verify-out exit 0 + typecheck clean modulo baseline errors. After Task 1, `git log` shows the WIP work landed and `git status` is clean for tracked files.
2. **The per-UID submission path is documented.** Task 2's DoD includes a README section + a project rule. A contributor reading either file can find the workflow without asking.

## Open Questions

- **Commit strategy.** `origin/main` reports `[gone]` on this host. The user must decide: commit on current `main`, branch first, or wait for the remote to be reachable. Task 1 cannot proceed until this is resolved.
- **Bulk capture cadence.** The `IDs` file lists 1,230 UIDs (~60h naive). The user has not specified whether to capture all, a representative subset, or only specific UIDs. Defer to operator — capture happens in post-plan sessions, not in this plan's tasks.

## Deferred Ideas

- **Backfilling 53 caches with `baseMapGeometry` in `editor_state_raw.json`.** Re-capture picks it up naturally; no scheduled backfill needed. (From `basemap-capture.md` Open Questions.)
- **Refreshing `canonicalize.ts` TABLE with Pax historical codes** (`ABBS`, `ARAG`, etc.) so `data.world.ownerCodes` matches hub values. Out of scope here; would require a Pax-side code source we don't currently capture. (From `paxhub-conformance-test.md` Deferred Ideas.)
- **GitHub API automation for bulk submission** — would need a script that opens Issues per `out/<UID>.json` via the API. Out of scope; manual workflow suffices at 1-20 submissions; deferred until volume justifies the engineering. (New — surfaced by this plan.)
- **Live `open-historia.com/play/` browser verification** — would require bootstrapping the open-historia repo on this host. Deferred per `2026-07-16-hub-alignment-verify.md`. (From `paxhistoria-hub-alignment.md` Deferred Ideas.)
