import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { writeBundle } from "../src/bundle";
import { transform } from "../src/transform";
import type { PaxCapture } from "../src/types";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXAMPLE = "/home/john/Projects/OpenHistoria-Presets/example.json";

function minimalCapture(): PaxCapture {
  return {
    preset: { id: "X", publishedVersionID: "1", title: "T", description: "" },
    geometry: {
      geometry: {
        "0": {
          geometry: JSON.stringify({
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          }),
          centroid: "0.5,0.5",
          adjacencies: [],
          type: "Land",
        },
      },
    },
    features: {
      polities: [{ id: "p0", name: "United States", color: "#FF0000" }],
      cities: [{ id: "c0", name: "New York", location: [-74, 40.7] }],
      regionOwnership: { "0": "United States" },
    },
    cover: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
}

describe("contract: emitted bundle matches example.json shape", () => {
  it("top-level keys are exactly the example.json keys", async () => {
    const example = JSON.parse(await readFile(EXAMPLE, "utf8"));
    const expected = Object.keys(example).sort();
    const dir = join(tmpdir(), `contract-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(Object.keys(written).sort()).toEqual(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("assets object keys are a subset of the 6 hub bundles' union (backgroundData is example.json-only, not in the hub)", async () => {
    // The 6 hub bundles (bronze-1200bc, colonial-1650, medieval-1200, mongol-1300,
    // roman-117, wwii-1939) are the importer-validated canonical shape; example.json
    // is one of the older bundles with extra keys like backgroundData that the importer
    // ignores. The contract is against the hub union, not example.json.
    const dir = join(tmpdir(), `contract-test-${Date.now()}-assets`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      const exportAssets = Object.keys(written.assets).sort();
      const hubAssets = ["cities", "citiesGeojson", "colors", "countries", "cover", "regions", "regionsGeojson"];
      // Hub bundles never carry backgroundData (only example.json does, and it's ignored).
      expect(exportAssets).not.toContain("backgroundData");
      // Every exported asset key must be in the hub union.
      for (const k of exportAssets) expect(hubAssets).toContain(k);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cover asset has encoding: 'base64' when embedded", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-cover`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(written.assets.cover.encoding).toBe("base64");
      expect(written.assets.cover.mode).toBe("embedded");
      expect(typeof written.assets.cover.data).toBe("string");
      expect(typeof written.assets.cover.contentType).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("colors.data is a DICT (not base64 string)", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-colors`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(typeof written.assets.colors.data).toBe("object");
      expect(written.assets.colors.data).not.toBeNull();
      expect(Array.isArray(written.assets.colors.data)).toBe(false);
      const keys = Object.keys(written.assets.colors.data);
      expect(keys.length).toBeGreaterThan(0);
      const v = written.assets.colors.data[keys[0]];
      expect(Array.isArray(v)).toBe(true);
      expect(v).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("assets.colors has exactly 3 keys (data, fileName, mode) matching the hub oracle", async () => {
    // Verified against /home/john/Projects/Open-historia-scenarios/bundles/*.json
    // and example.json: all 7 bundles carry {data, fileName, mode} with NO
    // encoding or contentType field. The current emission already matches.
    const dir = join(tmpdir(), `contract-test-${Date.now()}-colors-shape`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(Object.keys(written.assets.colors).sort()).toEqual([
        "data",
        "fileName",
        "mode",
      ]);
      expect(written.assets.colors.mode).toBe("embedded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cities/countries/regions assets include droppedOverride: false", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-drop`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(written.assets.cities).toHaveProperty("droppedOverride", false);
      expect(written.assets.countries).toHaveProperty("droppedOverride", false);
      expect(written.assets.regions).toHaveProperty("droppedOverride", false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("regionsGeojson has contentType: application/geo+json", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-geojson`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      expect(written.assets.regionsGeojson.contentType).toBe("application/geo+json");
      expect(written.assets.citiesGeojson.contentType).toBe("application/geo+json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("regionsGeojson and citiesGeojson have exactly 5 keys (mode, fileName, encoding, contentType, data)", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-geojson-shape`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      for (const assetName of ["regionsGeojson", "citiesGeojson"] as const) {
        const a = written.assets[assetName];
        expect(a.mode).toBe("embedded");
        expect(Object.keys(a).sort()).toEqual([
          "contentType",
          "data",
          "encoding",
          "fileName",
          "mode",
        ]);
        expect(a.encoding).toBe("base64");
        expect(a.contentType).toBe("application/geo+json");
        // Round-trip: base64 decode -> JSON.parse -> valid GeoJSON FeatureCollection.
        const decoded = JSON.parse(Buffer.from(a.data, "base64").toString("utf8"));
        expect(decoded.type).toBe("FeatureCollection");
        expect(Array.isArray(decoded.features)).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("regionsGeojson round-trips through base64 to a valid GeoJSON FeatureCollection", async () => {
    const dir = join(tmpdir(), `contract-test-${Date.now()}-roundtrip`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      const capture = minimalCapture();
      const { bundle, assets } = transform(capture, { mode: "full" });
      await writeBundle({ bundle, assets }, { outputPath: outPath, paxID: "X", version: "1" });
      const written = JSON.parse(await readFile(outPath, "utf8"));
      const decoded = JSON.parse(
        Buffer.from(written.assets.regionsGeojson.data, "base64").toString("utf8"),
      );
      expect(decoded.type).toBe("FeatureCollection");
      expect(Array.isArray(decoded.features)).toBe(true);
      expect(decoded.features.length).toBeGreaterThan(0);
      // First feature's id must be in canonical <code>.<n>_1 form.
      expect(decoded.features[0].properties.id).toMatch(/^([A-Z]{3}|Z\d{2})\.\d+_1$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});