# Vendored pax-ripper

This directory contains a copy of `pax-ripper` vendored from
`/home/john/Projects/Peace-History/tools/pax-ripper/`.

**Upstream commit:** `26b093f20779d01ecc3985431aafb1ca6cad8817`
**Vendor date:** 2026-07-16
**Upstream repo:** https://github.com/peace-history/pax-ripper (path: `tools/pax-ripper/`)

The source files (`src/*.ts`, `package.json`, `tsconfig.json`, `bun.lock`) are
copied byte-for-byte from upstream. They keep their original MIT attribution
in `README.md`. Any divergence from upstream must be documented here.

## Dual-purpose role in this repo

This vendored copy serves two first-class entry points:

1. **Standalone CLI** — `bun run tools/pax-ripper/src/index.ts …` (or
   `bun run rip`) for users who want raw capture without bundling.
2. **Library** — `tools/preset-exporter/src/capture.ts` imports the internal
   modules (`ripFeatures.ts`, `ripPreset.ts`, `ripPresets.ts`, etc.) directly
   and does NOT spawn `src/index.ts` as a subprocess.

All modules except `src/index.ts` are library-callable. Library safety was
verified with:

```bash
grep -L 'process\.argv\|main()' tools/pax-ripper/src/*.ts
```

That command returns all 16 non-`index.ts` modules. Only `src/index.ts`
contains `process.argv` / `main()` CLI glue, which is skipped when the
preset-exporter imports the modules directly.

## Sync policy

When upstream changes, copy-merge the modified files and update the
**Upstream commit** field above. The committed hash is the canonical record
of which upstream revision this copy corresponds to.