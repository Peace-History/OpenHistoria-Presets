import { describe, it, expect } from "bun:test";
import { loadCaptureFromDir } from "../src/capture";
import { transform } from "../src/transform";
import { writeBundle } from "../src/bundle";
import { join } from "node:path";
import { readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("fixtures: modern-day (synthetic)", () => {
  it("transforms the synthetic modern-day fixture into a valid bundle", async () => {
    const capture = await loadCaptureFromDir(join(FIXTURES, "modern-day"));
    const { bundle, assets } = transform(capture, { mode: "full" });
    expect(bundle.scenario.name).toBe("Modern Day");
    expect(bundle.data.world.regionOwnershipOverrides["USA.0_1"]).toBe("USA");
    const colors = assets.colors.data;
    expect(colors.USA).toEqual([0x3c, 0x3b, 0x6e]);
  });
});

describe("fixtures: cold-war (real Pax capture)", () => {
  it("transforms the cold-war real capture without throwing", async () => {
    const capture = await loadCaptureFromDir(join(FIXTURES, "cold-war"));
    expect(capture.preset.title).toContain("Cold War");
    const { bundle, assets } = transform(capture, { mode: "full" });
    expect(bundle.schema).toBe("pax-historia-scenario-bundle");
    expect(Object.keys(bundle.data.world.regionOwnershipOverrides).length).toBeGreaterThan(100);
    expect(bundle.data.world.customRegions).toBe(true);
    if (assets.regionsGeojson.mode !== "embedded") throw new Error("not embedded");
    const regionsDecoded = JSON.parse(Buffer.from(assets.regionsGeojson.data, "base64").toString("utf8"));
    expect(regionsDecoded.features.length).toBeGreaterThan(100);
    // At least one region must have a non-empty owner (real Pax regions that are
    // unowned map to empty-string ownership; the assertion targets the populated
    // subset to keep the test meaningful).
    const owned = regionsDecoded.features.filter((f: { properties: { owner: string } }) => f.properties.owner);
    expect(owned.length).toBeGreaterThan(100);
  });

  it("round-trips a real cold-war capture through writeBundle", async () => {
    const capture = await loadCaptureFromDir(join(FIXTURES, "cold-war"));
    const { bundle, assets } = transform(capture, { mode: "full" });
    const dir = join(tmpdir(), `fixture-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: capture.preset.id, version: "1" });
      const parsed = JSON.parse(await readFile(outPath, "utf8"));
      expect(parsed.data.world.customRegions).toBe(true);
      expect(parsed.data.world.customCities).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});