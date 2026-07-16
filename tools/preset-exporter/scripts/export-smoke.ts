#!/usr/bin/env bun
// export-smoke.ts - Regenerate the committed reference bundle `out/modern-day.json` from
// the local cold-war fixture. Run by maintainers only - the reference file is committed
// so downstream consumers have a known-good shape to compare against.
//
// Usage:
//   bun run export-smoke                  Regenerate out/modern-day.json in place.
//   bun run export-smoke --check          Refuse to overwrite; exit non-zero if the
//                                         would-be output differs from the committed file
//                                         (modulo exportedAt).

import { spawn } from "bun";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "tools/preset-exporter/tests/fixtures/cold-war");
const REFERENCE = join(ROOT, "out/modern-day.json");
const TEMP_OUT = join(ROOT, "out/modern-day.smoke.json");

async function regen(): Promise<string> {
  await mkdir(join(ROOT, "out"), { recursive: true });
  const proc = spawn({
    cmd: ["bun", "run", join(ROOT, "tools/preset-exporter/src/cli.ts"), "--offline", FIXTURE, "--output", TEMP_OUT],
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cli exited with code ${code}`);
  return await readFile(TEMP_OUT, "utf8");
}

function stripVolatile(json: string): string {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.exportedAt === "string") parsed.exportedAt = "<stripped>";
  return JSON.stringify(parsed, null, 2);
}

const STABLE_RUN_AT = "1970-01-01T00:00:00.000Z";

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const generated = await regen();

  if (!check) {
    await writeFile(REFERENCE, generated, "utf8");
    const tempSummary = `${TEMP_OUT}.run_summary.json`;
    const refSummary = `${REFERENCE}.run_summary.json`;
    try {
      const summary = JSON.parse(await readFile(tempSummary, "utf8")) as Record<string, unknown>;
      summary.outputBundlePath = REFERENCE;
      summary.runAt = STABLE_RUN_AT;
      await writeFile(refSummary, JSON.stringify(summary, null, 2) + "\n", "utf8");
    } catch {
      // temp run_summary missing - leave refSummary absent (do not fail the regen)
    }
    console.log(`wrote ${REFERENCE}`);
    return;
  }

  if (!existsSync(REFERENCE)) {
    console.error(`reference missing: ${REFERENCE}`);
    process.exit(1);
  }
  const committed = await readFile(REFERENCE, "utf8");
  if (stripVolatile(committed) !== stripVolatile(generated)) {
    console.error("reference bundle drifted from the latest transform output. Run `bun run export-smoke` to refresh.");
    process.exit(1);
  }
  console.log("reference bundle matches (modulo exportedAt)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});