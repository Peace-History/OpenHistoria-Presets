import { describe, it, expect, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REFERENCE = join(ROOT, "out/modern-day.json");
const REFERENCE_SUMMARY = `${REFERENCE}.run_summary.json`;

describe("export-smoke", () => {
  // Snapshot the current reference + summary so we can restore after the test.
  const backupJson = readFileSync(REFERENCE, "utf8");
  const backupSummary = existsSync(REFERENCE_SUMMARY)
    ? readFileSync(REFERENCE_SUMMARY, "utf8")
    : null;

  afterAll(() => {
    writeFileSync(REFERENCE, backupJson, "utf8");
    if (backupSummary !== null) {
      writeFileSync(REFERENCE_SUMMARY, backupSummary, "utf8");
    }
  });

  it("writes both out/modern-day.json and its run_summary sidecar", () => {
    // Force-regenerate via export-smoke; the CLI writes <output>.run_summary.json
    // next to the bundle, and the smoke script must mirror that to the reference path.
    execSync("bun run export-smoke", { encoding: "utf8" });
    expect(existsSync(REFERENCE)).toBe(true);
    expect(existsSync(REFERENCE_SUMMARY)).toBe(true);

    // Run summary is parseable JSON with the documented fields.
    const summary = JSON.parse(readFileSync(REFERENCE_SUMMARY, "utf8"));
    expect(summary.paxID).toBeDefined();
    expect(summary.outputBundlePath).toBe(REFERENCE);
  }, 60000);

  it("does not overwrite the reference when --check passes a clean tree", () => {
    // After the regen test above, reference and fresh output match modulo timestamps.
    // Copy the reference aside, run --check, verify nothing changed.
    const sentinel = join(ROOT, "out", ".export-smoke-sentinel.json");
    copyFileSync(REFERENCE, sentinel);
    try {
      execSync("bun run export-smoke --check", { encoding: "utf8" });
      expect(readFileSync(REFERENCE, "utf8")).toBe(readFileSync(sentinel, "utf8"));
    } finally {
      execSync(`rm -f ${sentinel}`, { encoding: "utf8" });
    }
  }, 60000);
});