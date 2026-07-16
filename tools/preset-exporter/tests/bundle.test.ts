import { describe, it, expect } from "bun:test";
import { writeBundle } from "../src/bundle";
import { TransformResult, BundleError } from "../src/types";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(): TransformResult {
  return {
    bundle: {
      schema: "pax-historia-scenario-bundle",
      version: 1,
      mode: "full",
      exportedAt: "2026-07-16T12:00:00.000Z",
      scenario: { id: "X", name: "Test", description: "" },
      data: {
        actions: [],
        advisor: [],
        chat: [],
        events: {},
        game: { country: "USA" },
        prompts: { chatWithUser: "hi" },
        world: {
          customRegions: true,
          customCities: true,
          regionOwnershipOverrides: { "0": "USA" },
        },
      },
    },
    assets: {
      cover: {
        mode: "embedded",
        fileName: "cover.png",
        contentType: "image/png",
        encoding: "base64" as const,
        data: "aGVsbG8=",
      },
      colors: { mode: "embedded" as const, fileName: "colors.json", data: { Mock: [1, 2, 3] } },
      regionsGeojson: {
        mode: "embedded" as const,
        fileName: "regions.geojson",
        encoding: "base64" as const,
        contentType: "application/geo+json" as const,
        data: Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [] })).toString("base64"),
      },
      citiesGeojson: {
        mode: "embedded" as const,
        fileName: "cities.geojson",
        encoding: "base64" as const,
        contentType: "application/geo+json" as const,
        data: Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [] })).toString("base64"),
      },
      backgroundData: { mode: "default" as const, fileName: "background.json" },
      cities: { mode: "default" as const, fileName: "cities.pmtiles", droppedOverride: false },
      countries: { mode: "default" as const, fileName: "countries.pmtiles", droppedOverride: false },
      regions: { mode: "default" as const, fileName: "regions.pmtiles", droppedOverride: false },
    },
  };
}

describe("writeBundle", () => {
  it("writes a JSON file with the exact top-level keys", async () => {
    const dir = join(tmpdir(), `bundle-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      await writeBundle(fixture(), { outputPath: outPath, paxID: "X", version: "1" });
      const parsed = JSON.parse(await readFile(outPath, "utf8"));
      expect(Object.keys(parsed).sort()).toEqual(
        ["assets", "data", "exportedAt", "mode", "schema", "scenario", "version"].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a base64 cover", async () => {
    const dir = join(tmpdir(), `bundle-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      await writeBundle(fixture(), { outputPath: outPath, paxID: "X", version: "1" });
      const parsed = JSON.parse(await readFile(outPath, "utf8"));
      expect(parsed.assets.cover.mode).toBe("embedded");
      expect(Buffer.from(parsed.assets.cover.data, "base64").toString("utf8")).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws BundleError when a required data.* key is missing (before write)", async () => {
    const dir = join(tmpdir(), `bundle-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    const broken = fixture();
    const fixedBundle: TransformResult["bundle"] = {
      ...broken.bundle,
      data: { ...broken.bundle.data, prompts: {} as Record<string, string> },
    };
    delete (fixedBundle.data as Record<string, unknown>).prompts;
    try {
      expect(
        writeBundle({ bundle: fixedBundle, assets: broken.assets }, {
          outputPath: outPath,
          paxID: "X",
          version: "1",
        }),
      ).rejects.toThrow(BundleError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes _run_summary.json next to the bundle", async () => {
    const dir = join(tmpdir(), `bundle-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      await writeBundle(fixture(), {
        outputPath: outPath,
        paxID: "X",
        version: "1",
        mode: "full",
        transformDurationMs: 12,
      });
      const summary = JSON.parse(await readFile(`${outPath}.run_summary.json`, "utf8"));
      expect(summary.paxID).toBe("X");
      expect(summary.version).toBe("1");
      expect(summary.mode).toBe("full");
      expect(summary.transformDurationMs).toBe(12);
      expect(typeof summary.runAt).toBe("string");
      expect(summary.outputBundlePath).toBe(outPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exportedAt is a parseable ISO date string", async () => {
    const dir = join(tmpdir(), `bundle-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, "out.json");
    try {
      await writeBundle(fixture(), { outputPath: outPath, paxID: "X", version: "1" });
      const parsed = JSON.parse(await readFile(outPath, "utf8"));
      expect(typeof parsed.exportedAt).toBe("string");
      const ms = Date.parse(parsed.exportedAt);
      expect(Number.isFinite(ms)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});