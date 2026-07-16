import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("check-reference", () => {
  it("exits 0 when the reference matches the latest transform", () => {
    const out = execSync("bun run check-reference", { encoding: "utf8" });
    expect(out).toContain("reference bundle matches");
  }, 60000);

  it("exits non-zero when the committed reference drifts", async () => {
    // Corrupt the committed reference, run check-reference, restore it.
    const path = join(process.cwd(), "out/modern-day.json");
    const original = await readFile(path, "utf8");
    const corrupted = original.replace('"version": 1', '"version": 999');
    await writeFile(path, corrupted, "utf8");
    try {
      let exited = 0;
      try {
        execSync("bun run check-reference", { encoding: "utf8" });
      } catch (e) {
        exited = (e as { status?: number }).status ?? 1;
      }
      expect(exited).not.toBe(0);
    } finally {
      await writeFile(path, original, "utf8");
      // Verify the restore is back to matching.
      const out = execSync("bun run check-reference", { encoding: "utf8" });
      expect(out).toContain("reference bundle matches");
    }
  }, 120000);
});