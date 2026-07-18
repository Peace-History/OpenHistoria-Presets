import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterUids, captureCacheLooksComplete, parseArgs, buildCaptureCmd, captureIncompleteReason } from "../scripts/dump-all";

describe("dump-all filter", () => {
  it("keeps 20-char base62 UIDs and drops label lines", () => {
    const input = [
      "modern_day",
      "WW2_Europe",
      "europe_1913_simple",
      "usa_civil_war",
      "BYp5Mv7IaFXAjoO8jGLK",
      "undXAyQbz7OwIXfIZLXL",
      "",
      "# a comment line",
      "Idla5VkKkNnJmTQjo2sa",
    ].join("\n");
    const result = filterUids(input);
    expect(result.uids).toEqual([
      "BYp5Mv7IaFXAjoO8jGLK",
      "undXAyQbz7OwIXfIZLXL",
      "Idla5VkKkNnJmTQjo2sa",
    ]);
    expect(result.skipped).toEqual([
      "modern_day",
      "WW2_Europe",
      "europe_1913_simple",
      "usa_civil_war",
    ]);
  });

  it("accepts UIDs as short as 16 chars (hedge against future Pax UID schemes)", () => {
    const input = "abcdefghijklmnop\nshort\nABCDEFGHIJKLMNOPQRST";
    const result = filterUids(input);
    expect(result.uids).toEqual(["abcdefghijklmnop", "ABCDEFGHIJKLMNOPQRST"]);
  });

  it("drops URL lines (filter only accepts raw slugs)", () => {
    const input = "https://paxhistoria.co/presets/BYp5Mv7IaFXAjoO8jGLK";
    const result = filterUids(input);
    expect(result.uids).toEqual([]);
    expect(result.skipped.length).toBe(1);
  });
});

describe("dump-all captureCacheLooksComplete", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = join(tmpdir(), `dump-all-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratch, { recursive: true });
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns false when the UID cache dir does not exist", () => {
    expect(captureCacheLooksComplete(join(scratch, "missing"))).toBe(false);
  });

  it("returns false when no version subdir exists", () => {
    const uidDir = join(scratch, "uid");
    mkdirSync(uidDir);
    expect(captureCacheLooksComplete(uidDir)).toBe(false);
  });

  it("returns true when <uid>/<latest-version>/manifest.json + non-empty preset.json + geometry.json exist", () => {
    const uidDir = join(scratch, "uid");
    const v1 = join(uidDir, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), "{}");
    writeFileSync(join(v1, "preset.json"), "{\"id\":\"x\"}");
    writeFileSync(join(v1, "geometry.json"), "{}");
    expect(captureCacheLooksComplete(uidDir)).toBe(true);
  });

  it("picks the lexicographically latest version when multiple are present", () => {
    const uidDir = join(scratch, "uid");
    const v89 = join(uidDir, "89");
    const v136 = join(uidDir, "136");
    mkdirSync(v136, { recursive: true });
    mkdirSync(v89, { recursive: true });
    // v89 has a complete capture but v136 is half-written (missing preset.json).
    // The latest version's manifest+preset must BOTH exist; otherwise re-capture.
    writeFileSync(join(v89, "manifest.json"), "{}");
    writeFileSync(join(v89, "preset.json"), "{}");
    writeFileSync(join(v136, "manifest.json"), "{}");
    expect(captureCacheLooksComplete(uidDir)).toBe(false);
  });

  it("returns false when manifest.json exists but preset.json is empty", () => {
    const uidDir = join(scratch, "uid");
    const v1 = join(uidDir, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), "{}");
    writeFileSync(join(v1, "preset.json"), "");
    expect(captureCacheLooksComplete(uidDir)).toBe(false);
  });

  it("returns false when geometry.json is missing (editor pass incomplete)", () => {
    const uidDir = join(scratch, "uid");
    const v1 = join(uidDir, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), "{}");
    writeFileSync(join(v1, "preset.json"), "{\"id\":\"x\"}");
    expect(captureCacheLooksComplete(uidDir)).toBe(false);
  });

  it("returns true when manifest.json, preset.json, and geometry.json all exist", () => {
    const uidDir = join(scratch, "uid");
    const v1 = join(uidDir, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), "{}");
    writeFileSync(join(v1, "preset.json"), "{\"id\":\"x\"}");
    writeFileSync(join(v1, "geometry.json"), "{}");
    expect(captureCacheLooksComplete(uidDir)).toBe(true);
  });
});

describe("dump-all parseArgs", () => {
  it("rejects --limit 0 (must be positive integer)", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
  });

  it("rejects --limit with non-numeric value", () => {
    expect(() => parseArgs(["--limit", "abc"])).toThrow(/--limit/);
  });

  it("rejects --limit -1", () => {
    expect(() => parseArgs(["--limit", "-1"])).toThrow(/--limit/);
  });

  it("accepts --limit 1", () => {
    expect(parseArgs(["--limit", "1"]).limit).toBe(1);
  });

  it("accepts --limit 100", () => {
    expect(parseArgs(["--limit", "100"]).limit).toBe(100);
  });
});

describe("dump-all buildCaptureCmd", () => {
  // Without --with-editor pax-ripper's --preset flow skips the editor view,
  // geometry.json is never downloaded, and the transform throws. This test
  // pins the orchestrator's choice of flags so a future cleanup can't drop it.
  it("always forwards --with-editor so geometry.json is captured", () => {
    const cmd = buildCaptureCmd("fakeUID", "/tmp/cache", false);
    expect(cmd).toContain("--with-editor");
    expect(cmd).toContain("--preset");
    expect(cmd).toContain("fakeUID");
    expect(cmd).toContain("/tmp/cache");
  });

  it("appends --force only when force is true", () => {
    expect(buildCaptureCmd("u", "/c", false)).not.toContain("--force");
    expect(buildCaptureCmd("u", "/c", true)).toContain("--force");
  });
});

describe("dump-all captureIncompleteReason", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = join(tmpdir(), `dump-all-incomplete-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratch, { recursive: true });
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns undefined when manifest.json has no incomplete field", () => {
    const v1 = join(scratch, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), JSON.stringify({ status: "captured" }));
    expect(captureIncompleteReason(v1)).toBeUndefined();
  });

  it("returns the incomplete reason string from manifest.json", () => {
    const v1 = join(scratch, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), JSON.stringify({ incomplete: "editor_walk_no_polities" }));
    expect(captureIncompleteReason(v1)).toBe("editor_walk_no_polities");
  });

  it("returns undefined when manifest.json does not exist", () => {
    const v1 = join(scratch, "1");
    mkdirSync(v1, { recursive: true });
    expect(captureIncompleteReason(v1)).toBeUndefined();
  });

  it("returns undefined when manifest.json is malformed JSON", () => {
    const v1 = join(scratch, "1");
    mkdirSync(v1, { recursive: true });
    writeFileSync(join(v1, "manifest.json"), "not json {");
    expect(captureIncompleteReason(v1)).toBeUndefined();
  });
});

describe("dump-all classifyIncompleteReason", () => {
  it("returns null for undefined reason (use generic FAIL)", () => {
    expect(
      (dumpAllFilter as unknown as { classifyIncompleteReason(r?: string): unknown })
        .classifyIncompleteReason(undefined),
    ).toBeNull();
  });

  it("returns null for copy_blocked (a real failure, not a transient)", () => {
    expect(
      (dumpAllFilter as unknown as { classifyIncompleteReason(r?: string): unknown })
        .classifyIncompleteReason("copy_blocked"),
    ).toBeNull();
  });

  it("returns null for copy_popup_timeout (real failure, not transient)", () => {
    expect(
      (dumpAllFilter as unknown as { classifyIncompleteReason(r?: string): unknown })
        .classifyIncompleteReason("copy_popup_timeout"),
    ).toBeNull();
  });

  it("returns SKIP with day detail for copy_protected:Nd reason", () => {
    const result = (dumpAllFilter as unknown as {
      classifyIncompleteReason(r?: string): { status: string; detail: string } | null;
    }).classifyIncompleteReason("copy_protected:7d");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("SKIP");
    expect(result!.detail).toContain("7");
  });

  it("returns SKIP for copy_protected:1d", () => {
    const result = (dumpAllFilter as unknown as {
      classifyIncompleteReason(r?: string): { status: string; detail: string } | null;
    }).classifyIncompleteReason("copy_protected:1d");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("SKIP");
  });
});

// Late-bound import so we can keep the public exports as the test target.
import * as dumpAllFilter from "../scripts/dump-all";