#!/usr/bin/env bun
// export-and-check.ts - End-to-end conformance test for a single Pax preset UID
// against the canonical Open-Historia hub shape. Defaults to the UID requested
// for the current submission (undXAyQbz7OwIXfIZLXL = "Better 1444 The Original",
// v136); when that capture isn't present on disk, falls back to the cold-war
// fixture and labels the output "fixture proxy" so a CI run is distinguishable
// from a real-UID PASS.
//
// Exit codes:
//   0 = real UID capture, all checks PASS
//   1 = real UID capture, FAIL
//   2 = fixture proxy (capture missing), all checks PASS
//
// Usage:
//   bun run export-and-check                  # undXAyQbz7OwIXfIZLXL or fallback
//   bun run export-and-check <UID>            # override UID
//   bun run export-and-check <UID> <version>  # override UID + version

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "bun";

const ROOT = new URL("../../..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "tools/preset-exporter/tests/fixtures/cold-war");
const DEFAULT_UID = "undXAyQbz7OwIXfIZLXL";
const DEFAULT_VERSION = "136";

const uid = process.argv[2] ?? DEFAULT_UID;
const version = process.argv[3] ?? DEFAULT_VERSION;
const captureDir = join(ROOT, "presets", uid, version);

let isFixtureProxy = false;
let sourcePath: string;
if (existsSync(captureDir)) {
  sourcePath = captureDir;
} else if (existsSync(FIXTURE)) {
  isFixtureProxy = true;
  sourcePath = FIXTURE;
} else {
  console.error(`neither capture nor fixture available:`);
  console.error(`  capture: ${captureDir}`);
  console.error(`  fixture: ${FIXTURE}`);
  process.exit(1);
}

const OUT = join(ROOT, "out/conformance-check.json");
const flag = "--offline";
const proc = spawn({
  cmd: ["bun", "run", join(ROOT, "tools/preset-exporter/src/cli.ts"), flag, sourcePath, "--output", OUT],
  stdio: ["inherit", "inherit", "inherit"],
});
const cliCode = await proc.exited;
if (cliCode !== 0) {
  console.error(`cli exited with code ${cliCode}`);
  process.exit(1);
}

const { diffAgainstHubBundles, loadHubBundles } = await import("../src/conformance");
const { readFile } = await import("node:fs/promises");

const hubDir = process.env.HUB_BUNDLES_DIR ?? "/home/john/Projects/Open-historia-scenarios/bundles";
const hubBundles = await loadHubBundles(hubDir);

const bundle = JSON.parse(await readFile(OUT, "utf8"));
const report = diffAgainstHubBundles(bundle, hubBundles);

const label = isFixtureProxy ? "fixture proxy" : "real UID";
console.log(`=== Conformance for UID ${uid} v${version} (${label}) ===`);
console.log(`source: ${sourcePath}`);
console.log(`hub bundles read: ${report.hubBundleCount}`);
for (const r of report.results) {
  const tag = r.pass ? "PASS" : "FAIL";
  console.log(`  ${tag.padEnd(4)}  ${r.check}: ${r.detail}`);
}
console.log(`=== RESULT: ${report.pass ? "PASS" : "FAIL"} (${label}) ===`);

if (!report.pass) process.exit(1);
process.exit(isFixtureProxy ? 2 : 0);