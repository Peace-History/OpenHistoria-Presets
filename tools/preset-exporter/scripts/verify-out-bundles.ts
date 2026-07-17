#!/usr/bin/env bun
// verify-out-bundles.ts - Audit every bundle in out/ against the Open-Historia
// hub format. Reuses diffAgainstHubBundles (12 keyset/shape checks) and adds
// a value/type pass (19 field-level checks) that closes the importer gap
// diffAgainstHubBundles cannot see (bad hex colors, wrong image contentTypes,
// inconsistent color/owner codesets, etc).
//
// Flags:
//   --out <dir>    Bundle output dir (default: ./out)
//   --hub <dir>    Hub bundles dir (default: /home/john/Projects/Open-historia-scenarios/bundles)
//   --quiet        Suppress per-bundle rows (summary only)
//   --help         Show this help
//
// Exit codes:
//   0 = at least one bundle checked, all PASS
//   1 = at least one FAIL (including all-malformed out/)
//   2 = out/ is empty (nothing to check)
//   3 = out/ contains only *.run_summary.json sidecars

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { diffAgainstHubBundles, HUB_ACCEPTED_ASSET_KEYS, loadHubBundles, unionOfKeysAt, type HubBundle } from "../src/conformance";
import { isHubUnionAssetKey, loadOutBundles, setHubUnionAssetKeys, valueTypeChecks } from "../src/verify";

const ROOT = new URL("../../..", import.meta.url).pathname;

type Args = {
  help: boolean;
  outDir: string;
  hubDir: string;
  quiet: boolean;
};

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    help: false,
    outDir: join(ROOT, "out"),
    hubDir: process.env.HUB_BUNDLES_DIR ?? "/home/john/Projects/Open-historia-scenarios/bundles",
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (flag: string): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`${flag} requires a value (got ${v === undefined ? "end of args" : v})`);
      }
      return v;
    };
    switch (a) {
      case "--help":
      case "-h": out.help = true; break;
      case "--out": out.outDir = resolve(take("--out")); break;
      case "--hub": out.hubDir = resolve(take("--hub")); break;
      case "--quiet": out.quiet = true; break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(
    [
      "Usage: bun run verify-out-bundles [--out <dir>] [--hub <dir>] [--quiet]",
      "",
      "Audit every *.json in --out against the Open-Historia hub format.",
      "Runs the 12-check diffAgainstHubBundles pass AND a 19-check value/type",
      "pass on every file. Prints one row per file plus a final summary.",
      "",
      "Flags:",
      "  --out <dir>    Bundle output dir (default: ./out)",
      "  --hub <dir>    Hub bundles dir (default: /home/john/Projects/Open-historia-scenarios/bundles)",
      "  --quiet        Suppress per-bundle rows (summary only)",
      "  --help         Show this help",
      "",
      "Exit codes:",
      "  0 = at least one bundle checked, all PASS",
      "  1 = at least one FAIL (including all-malformed out/)",
      "  2 = out/ is empty (nothing to check)",
      "  3 = out/ contains only *.run_summary.json sidecars",
    ].join("\n"),
  );
}

type Row = { name: string; status: "PASS" | "FAIL"; detail: string; elapsedMs: number };

async function checkOne(
  name: string,
  data: Record<string, unknown>,
  hubBundles: HubBundle[],
): Promise<Row> {
  const started = Date.now();
  const diff = diffAgainstHubBundles(data, hubBundles);
  const valueResults = valueTypeChecks(data);
  const all = [...diff.results, ...valueResults];

  // Soft-warn the bundle when it carries asset keys that are importer-accepted
  // but absent from the hub union (e.g. `backgroundData`). The string match
  // is intentional: only keys in HUB_ACCEPTED_ASSET_KEYS that are NOT in the
  // hub union qualify. Truly unknown keys (not in either set) are surfaced
  // by the parallel `assets.* keys are subset of hub union + importer
  // allow-list` check in valueTypeChecks - they FAIL, never get labelled
  // "importer-accepted".
  const assetKeys = new Set<string>(
    Object.keys(((data.assets ?? {}) as Record<string, unknown>)),
  );
  const importerExtras = [...assetKeys]
    .filter((k) => !isHubUnionAssetKey(k))
    .filter((k) => HUB_ACCEPTED_ASSET_KEYS.has(k))
    .sort();
  const softWarn = importerExtras.length > 0
    ? `WARN: importer-accepted extras: ${importerExtras.join(",")}`
    : "";
  const realFails = all.filter((r) => !r.pass);

  if (realFails.length === 0) {
    const detail = softWarn;
    return { name, status: "PASS", detail, elapsedMs: Date.now() - started };
  }

  const detail = realFails
    .slice(0, 3)
    .map((r) => `${r.check}: ${r.detail}`)
    .join("; ");
  const more = realFails.length > 3 ? ` (+${realFails.length - 3} more)` : "";
  return { name, status: "FAIL", detail: (softWarn ? softWarn + "; " : "") + detail + more, elapsedMs: Date.now() - started };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const hubBundles = await loadHubBundles(args.hubDir);
  if (hubBundles.length === 0) {
    console.error(`error: no hub bundles read from ${args.hubDir} (set HUB_BUNDLES_DIR to override)`);
    return 1;
  }

  // Seed the importer-allowlist vs hub-union distinction for asset key checks.
  setHubUnionAssetKeys(unionOfKeysAt(hubBundles, ["assets"]));

  if (!existsSync(args.outDir)) {
    console.error(`error: out dir not found at ${args.outDir}`);
    return 2;
  }
  const { bundles, malformed } = await loadOutBundles(args.outDir);

  if (malformed.length > 0) {
    console.error(`error: ${malformed.length} malformed bundle(s) skipped: ${malformed.sort().join(",")}`);
  }

  if (bundles.length === 0) {
    // Distinguish "empty" from "only sidecars" by checking the dir contents directly.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(args.outDir);
    const realBundles = entries.filter((f) => f.endsWith(".json") && !f.endsWith(".run_summary.json"));
    if (realBundles.length === 0) {
      // Truly empty (or only sidecars): not a data-loss signal.
      console.error(`error: out/ contains no *.json bundles at ${args.outDir}`);
      return entries.length === 0 ? 2 : 3;
    }
    // Real *.json bundles existed but every one was malformed: this IS a
    // data-loss signal - exit 1 (FAIL), not 3 ("only sidecars").
    return 1;
  }

  console.log(`hub bundles: ${hubBundles.length} (${hubBundles.map((b) => b.name).join(", ")})`);
  const rows: Row[] = [];
  const startedAll = Date.now();
  for (let i = 0; i < bundles.length; i++) {
    const { name, data } = bundles[i];
    const row = await checkOne(name, data, hubBundles);
    rows.push(row);
    if (!args.quiet) {
      const label = `[${i + 1}/${bundles.length}]`;
      const tail = row.status === "PASS"
        ? (row.detail ? `PASS (${row.detail})` : `PASS (${row.elapsedMs}ms)`)
        : `FAIL: ${row.detail}`;
      console.log(`${label} ${name} ... ${tail}`);
    }
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const elapsed = ((Date.now() - startedAll) / 1000).toFixed(1);
  console.log(`=== SUMMARY processed=${rows.length} pass=${pass} fail=${fail} elapsed=${elapsed}s ===`);
  if (fail > 0) return 1;
  if (pass === 0) return 2;
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`error: ${(err as Error).message}`);
      process.exit(1);
    });
}
