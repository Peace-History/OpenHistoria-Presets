#!/usr/bin/env bun
// check-reference.ts - Verify the committed reference bundle matches a fresh transform of
// the cold-war fixture (modulo exportedAt). Used as a CI gate against schema drift.
//
// Usage:
//   bun run check-reference

import { spawn } from "bun";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "tools/preset-exporter/tests/fixtures/cold-war");
const REFERENCE = join(ROOT, "out/modern-day.json");
const TEMP_OUT = join(ROOT, "out/modern-day.check.json");

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

async function main(): Promise<void> {
  if (!existsSync(REFERENCE)) {
    console.error(`reference missing: ${REFERENCE} - run \`bun run export-smoke\` first`);
    process.exit(1);
  }
  const generated = await regen();
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