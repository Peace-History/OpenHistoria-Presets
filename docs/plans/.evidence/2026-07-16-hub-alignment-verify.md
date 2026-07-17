# Live-Target Probe — 2026-07-16-paxhistoria-hub-alignment

Date: 2026-07-16
Outcome: **UNIT_VERIFIED** (all 4 tiers of the Live-Target Probe failed with documented reasons; Goal Verification truth #2 is downgraded to "claim pending browser verification" per `verification.md`).

## Tier 1: Reuse already-running local server

Command: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` (and 5173)
Outcome: HTTP 000 (connection refused) for both ports.
Reason: No open-historia preview server is currently running on the local host. The OpenHistoria-Presets repo is a bundle producer, not the open-historia renderer; no health endpoint is available.

## Tier 2: Start the dev server

Command: `cd /home/john/Projects/open-historia && npm run dev`
Outcome: `sh: line 1: vite: command not found`
Reason: `open-historia/package.json` declares `"dev": "vite"` but `/home/john/Projects/open-historia/node_modules/` is empty (no `npm install` has been run on this host). Polling the health endpoint up to 60s is impossible without first running `npm install`, which is too heavy to execute inside `/spec`. The open-historia repo is out of scope for the plan ("Hub-side changes (this repo is read-only against `Open-Historia/Open-historia-scenarios`)"), and bootstrapping its dev environment is a separate concern.

## Tier 3: Detect deploy backends

Command: `ls /home/john/Projects/open-historia/vercel.json /home/john/Projects/open-historia/fly.toml /home/john/Projects/open-historia/netlify.toml`
Outcome: no such files.
Reason: The open-historia repo has no deploy-backend marker files. No auth-check command can run because no backend is detected.

## Tier 4: Unit-only fallback

Per `verification.md`, when tiers 1-3 all fail with documented reasons, the truth is downgraded to `UNIT_VERIFIED` rather than fabricated as `LIVE_PASS`.

Unit-verification evidence:
- 146 / 146 tests pass in `tools/preset-exporter/tests/` (see `bun test` output for this plan run).
- `out/undXAyQbz7OwIXfIZLXL.json` regenerated successfully (Task 8, sha256 `654b0154dedfa92d0b273b99bda99e25c8bf580a4a716766edf5327bf879f48e`).
- Suffix parity invariant (Task 3) holds: every override key in `data.world.regionOwnershipOverrides` (2333 entries) matches a feature `properties.id` with the same `<code>.<n>_1` pattern.
- Synthetic `Z##` codes mint deterministically (Task 2) for unmapped polities.
- The map's owner-color rendering is therefore *expected* to work when the bundle is loaded into open-historia's importer, but **this expectation is not yet empirically confirmed via a live browser session**.

## Follow-up recommendation

A user with the open-historia dev environment bootstrapped (`npm install && npm run dev`) can run the live verification by:
1. `cd /home/john/Projects/open-historia && npm install && npm run dev`
2. Open `http://localhost:5173/` in a browser
3. Import `out/undXAyQbz7OwIXfIZLXL.json`
4. Visually confirm: (a) no red `z26` fallback on ocean tiles (the pre-plan bug), (b) owner colors visible on owned regions, (c) synthetic `Z##` codes used for unmapped polities (not raw names).
5. If colors render correctly, update this file to `LIVE_PASS` and the plan's Goal Verification Truth #2 to verified.
