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

  it("cold-war fixture carries a fabricated basemap (editor_state_raw.json with state.baseMapGeometry.geometry)", async () => {
    // Sanity check: the cold-war fixture includes api_responses/editor_state_raw.json
    // with 2 stub regions. loadCaptureFromDir must surface them as editor.basemapGeometry.
    // If a future commit drops the file or edits the shape, this test catches it.
    const capture = await loadCaptureFromDir(join(FIXTURES, "cold-war"));
    expect(capture.editor?.basemapGeometry).toBeDefined();
    const keys = Object.keys(capture.editor!.basemapGeometry!);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    // At least one region must be Land or Coastal (typed regions from the stub).
    const types = new Set(keys.map((k) => capture.editor!.basemapGeometry![k].type));
    expect(types.has("Land") || types.has("Coastal")).toBe(true);
  });

  it("emits assets.backgroundData when cold-war fixture provides basemap geometry", async () => {
    const capture = await loadCaptureFromDir(join(FIXTURES, "cold-war"));
    const { assets } = transform(capture, { mode: "full" });
    expect(assets.backgroundData).toBeDefined();
    const bg = assets.backgroundData!;
    if (bg.mode !== "embedded") throw new Error("not embedded");
    expect(bg.contentType).toBe("application/geo+json");
    expect(bg.encoding).toBe("base64");
    expect(bg.fileName).toBe("basemap.geojson");
    const decoded = JSON.parse(Buffer.from(bg.data, "base64").toString("utf8")) as {
      type: "FeatureCollection";
      features: Array<{ properties: { id: string } }>;
    };
    expect(decoded.type).toBe("FeatureCollection");
    expect(decoded.features.length).toBeGreaterThanOrEqual(2);
    expect(decoded.features[0].properties.id).toMatch(/^BASEMAP_\d+$/);
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