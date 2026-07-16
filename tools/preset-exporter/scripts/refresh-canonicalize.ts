// Refresh tool: prints a diff between the canonicalize.ts table and the actual
// distinct polity names observed in /home/john/Projects/Peace-History/presets/.
//
// Usage:
//   bun run tools/preset-exporter/scripts/refresh-canonicalize.ts
//
// Output: stdout JSON { current: number, observed: number, missing: string[],
// stale: string[] }. Humans apply the diff to canonicalize.ts manually -
// this script does NOT auto-rewrite the source.

import { glob } from "node:fs/promises";
import { tableSize } from "../src/canonicalize";

const PRESETS_DIR = "/home/john/Projects/Peace-History/presets";

async function listObservedNames(): Promise<string[]> {
  const seen = new Set<string>();
  for await (const path of glob(`${PRESETS_DIR}/*/*/features.json`)) {
    const text = await Bun.file(path).text();
    try {
      const data = JSON.parse(text) as { polities?: Array<{ name?: string; id?: string }> };
      for (const p of data.polities ?? []) {
        const n = (p.name ?? p.id ?? "").trim();
        if (n) seen.add(n);
      }
    } catch {
      // skip malformed
    }
  }
  return [...seen].sort();
}

async function main(): Promise<void> {
  const observed = await listObservedNames();
  const { canonicalize } = await import("../src/canonicalize");
  const mapped = new Set<string>();
  for (const n of observed) {
    const r = canonicalize(n);
    if (r.code !== r.name) mapped.add(n);
  }

  const missing = observed.filter((n) => !mapped.has(n)).sort();
  const current = tableSize();

  const payload = {
    tableDate: "2026-07-16",
    currentEntries: current,
    observedDistinct: observed.length,
    mappedObserved: mapped.size,
    missing: missing.slice(0, 100),
    note: "missing = polity names observed in Pax captures but not in canonicalize.ts (passthrough as their own name). Review and add entries to canonicalize.ts if you want ISO codes for them.",
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});