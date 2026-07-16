import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";

describe("cli", () => {
  it("--help prints usage and exits 0", () => {
    const out = execSync("bun run tools/preset-exporter/src/cli.ts --help", { encoding: "utf8" });
    expect(out).toContain("OpenHistoria-Presets preset exporter");
    expect(out).toContain("--preset");
    expect(out).toContain("--offline");
    expect(out).toContain("--output");
    expect(out).toContain("--no-overwrite-reference");
    expect(out).toContain("--force");
  });

  it("--help lists every required flag", () => {
    const out = execSync("bun run tools/preset-exporter/src/cli.ts --help", { encoding: "utf8" });
    for (const flag of [
      "--preset",
      "--presets",
      "--from-file",
      "--all",
      "--offline",
      "--output",
      "--mode",
      "--force",
      "--cookies-file",
      "--with-editor",
      "--with-game",
      "--no-game",
      "--no-features",
      "--features-only",
      "--limit",
      "--no-overwrite-reference",
      "--help",
    ]) {
      expect(out).toContain(flag);
    }
  });

  it("exits 3 on invalid --mode value", () => {
    try {
      execSync("bun run tools/preset-exporter/src/cli.ts --mode bogus", {
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e) {
      const err = e as { status?: number };
      expect(err.status).toBe(3);
    }
  });

  it("exits 3 on unknown flag", () => {
    try {
      execSync("bun run tools/preset-exporter/src/cli.ts --not-a-flag", {
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e) {
      const err = e as { status?: number };
      expect(err.status).toBe(3);
    }
  });

  it("exits 3 on negative --limit", () => {
    try {
      execSync("bun run tools/preset-exporter/src/cli.ts --limit -1", {
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e) {
      const err = e as { status?: number };
      expect(err.status).toBe(3);
    }
  });

  it("exits 3 on non-integer --limit", () => {
    try {
      execSync("bun run tools/preset-exporter/src/cli.ts --limit abc", {
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e) {
      const err = e as { status?: number };
      expect(err.status).toBe(3);
    }
  });
});