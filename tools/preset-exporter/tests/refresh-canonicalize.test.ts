import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";

describe("refresh-canonicalize script", () => {
  it("runs and emits JSON with the expected top-level keys", () => {
    const out = execSync("bun run tools/preset-exporter/scripts/refresh-canonicalize.ts", {
      encoding: "utf8",
    });
    const data = JSON.parse(out);
    expect(typeof data.currentEntries).toBe("number");
    expect(typeof data.observedDistinct).toBe("number");
    expect(typeof data.mappedObserved).toBe("number");
    expect(Array.isArray(data.missing)).toBe(true);
    expect(data.currentEntries).toBeGreaterThan(0);
  }, 30000);
});