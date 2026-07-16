#!/usr/bin/env bun
// check-hub-conformance.ts - Compare the exported bundle's shape against all 6
// hub bundles under Open-Historia/Open-historia-scenarios/bundles/. Exits 0
// on full conformance, 1 on any failure.
//
// Usage:
//   bun run check-hub-conformance
//
// The diff logic lives in src/conformance.ts (pure, no I/O). This script is
// a thin wrapper: load hub bundles, run the transform against the cold-war
// fixture, print PASS/FAIL table.

import { spawn } from "bun";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadCaptureFromDir } from "../src/capture";
import { transform } from "../src/transform";
import { diffAgainstHubBundles, type HubBundle } from "../src/conformance";

const ROOT = new URL("../../..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "tools/preset-exporter/tests/fixtures/cold-war");
const TEMP_OUT = join(ROOT, "out/conformance-check.json");

/** Resolve the directory holding hub bundles:
 *  1. $HUB_BUNDLES_DIR env var
 *  2. walk upward from ROOT for an Open-historia-scenarios/bundles/ sibling
 *  3. hardcoded absolute fallback (this host only)
 */
async function resolveHubBundlesDir(): Promise<string | null> {
  if (process.env.HUB_BUNDLES_DIR) {
    if (existsSync(process.env.HUB_BUNDLES_DIR)) return process.env.HUB_BUNDLES_DIR;
    return null;
  }
  let dir = ROOT;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "Open-historia-scenarios", "bundles");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Host-specific fallback (this dev machine).
  const host = "/home/john/Projects/Open-historia-scenarios/bundles";
  if (existsSync(host)) return host;
  return null;
}

async function loadHubBundles(dir: string): Promise<HubBundle[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: HubBundle[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    out.push({ name, data });
  }
  return out;
}

async function exportFixture(): Promise<Record<string, unknown>> {
  await mkdir(join(ROOT, "out"), { recursive: true });
  const proc = spawn({
    cmd: ["bun", "run", join(ROOT, "tools/preset-exporter/src/cli.ts"), "--offline", FIXTURE, "--output", TEMP_OUT],
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cli exited with code ${code}`);
  return JSON.parse(await readFile(TEMP_OUT, "utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const hubDir = await resolveHubBundlesDir();
  if (!hubDir) {
    console.error("hub bundles not found. Set $HUB_BUNDLES_DIR or clone Open-Historia/Open-historia-scenarios as a sibling directory.");
    process.exit(1);
  }
  const hubBundles = await loadHubBundles(hubDir);
  if (hubBundles.length === 0) {
    console.error(`no hub bundles found in ${hubDir}`);
    process.exit(1);
  }
  const bundle = await exportFixture();
  const report = diffAgainstHubBundles(bundle, hubBundles);

  console.log("=== Hub Conformance ===");
  console.log(`hub bundles read: ${report.hubBundleCount} (${report.hubBundles.join(", ")})`);
  console.log(`source: ${FIXTURE}`);
  for (const r of report.results) {
    const tag = r.pass ? "PASS" : "FAIL";
    console.log(`  ${tag.padEnd(4)}  ${r.check}: ${r.detail}`);
  }
  console.log(`=== RESULT: ${report.pass ? "PASS" : "FAIL"} ===`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});