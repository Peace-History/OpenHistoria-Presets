import { describe, it, expect } from "bun:test";
import { transform } from "../src/transform";
import type { PaxCapture } from "../src/types";

const SAMPLE: PaxCapture = {
  preset: {
    id: "TEST",
    publishedVersionID: "1",
    title: "Sample Title",
    description: "Sample description",
    landingImageURL: "https://example.com/landing.png",
    coverImageURL: "https://example.com/cover.png",
    authorUID: "author",
    tags: ["test"],
    roundsPlayed: 0,
    gamesStarted: 0,
    slug: "sample",
    extras: {},
  },
  geometry: {
    name: "Sample",
    geometry: {
      "0": {
        geometry: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
        centroid: '{"type":"Point","coordinates":[0.5,0.5]}',
        adjacencies: ["1"],
        type: "Land",
      },
      "1": {
        geometry: '{"type":"Polygon","coordinates":[[[1,0],[2,0],[2,1],[1,1],[1,0]]]}',
        centroid: '{"type":"Point","coordinates":[1.5,0.5]}',
        adjacencies: ["0"],
        type: "Coastal",
      },
    },
    community: true,
    tags: [],
  },
  features: {
    polities: [
      { id: "Land of A", name: "Land of A", color: "#FF0000" },
      { id: "Land of B", name: "Land of B", color: "#00FF00" },
    ],
    cities: [
      { id: "c1", name: "Alpha", location: [0.5, 0.5], scale: 1 },
      { id: "c2", name: "Beta", location: [1.5, 0.5], scale: 1 },
    ],
    landmarks: [],
    battalions: [],
    regionOwnership: {
      "0": "Land of A",
      "1": "Land of B",
    },
    capturedAt: "2026-07-16T00:00:00Z",
  },
  editor: {
    aiPrompts: { chatWithUser: "be nice", actions: "be bold" },
    extras: { initialPresetData: { mapGeometryDocumentID: "r2:map-geometry/test/test_1_0" } },
  },
  cover: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

describe("transform", () => {
  it("produces a valid pax-historia-scenario-bundle", () => {
    const result = transform(SAMPLE, { mode: "full" });
    expect(result.bundle.schema).toBe("pax-historia-scenario-bundle");
    expect(result.bundle.version).toBe(1);
    expect(result.bundle.mode).toBe("full");
    expect(typeof result.bundle.exportedAt).toBe("string");
  });

  it("includes all 7 data.* keys (per libraryStore.js:735-740)", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const keys = Object.keys(bundle.data).sort();
    expect(keys).toEqual(["actions", "advisor", "chat", "events", "game", "prompts", "world"]);
  });

  it("sets world.customRegions=true and world.customCities=true", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    expect(bundle.data.world.customRegions).toBe(true);
    expect(bundle.data.world.customCities).toBe(true);
  });

  it("embeds regionsGeojson with mode='embedded'", () => {
    const { assets } = transform(SAMPLE, { mode: "full" });
    if (assets.regionsGeojson.mode !== "embedded") throw new Error("not embedded");
    expect(typeof assets.regionsGeojson.data).toBe("string");
    const decoded = JSON.parse(Buffer.from(assets.regionsGeojson.data, "base64").toString("utf8"));
    expect(decoded.type).toBe("FeatureCollection");
    expect(Array.isArray(decoded.features)).toBe(true);
    expect(decoded.features.length).toBe(2);
  });

  it("embeds citiesGeojson with mode='embedded'", () => {
    const { assets } = transform(SAMPLE, { mode: "full" });
    if (assets.citiesGeojson.mode !== "embedded") throw new Error("not embedded");
    const decoded = JSON.parse(Buffer.from(assets.citiesGeojson.data, "base64").toString("utf8"));
    expect(decoded.type).toBe("FeatureCollection");
    expect(decoded.features.length).toBe(2);
  });

  it("does NOT emit backgroundData (none of the 6 hub bundles carry it; importer falls back to its built-in)", () => {
    const { assets } = transform(SAMPLE, { mode: "full" });
    expect(assets).not.toHaveProperty("backgroundData");
  });

  it("derives colors from polities (hex -> [r,g,b]) keyed by canonical/synthetic code", () => {
    const { assets } = transform(SAMPLE, { mode: "full" });
    expect(assets.colors.mode).toBe("embedded");
    const colors = assets.colors.data;
    expect(typeof colors).toBe("object");
    // SAMPLE polities 'Land of A' and 'Land of B' are not in TABLE, so each
    // gets a synthetic Z## code; the color dictionary is keyed by that code.
    const keys = Object.keys(colors).sort();
    expect(keys).toHaveLength(2);
    for (const k of keys) {
      expect(k).toMatch(/^Z\d{2}$/);
    }
    expect(colors[keys[0]]).toEqual([255, 0, 0]);
    expect(colors[keys[1]]).toEqual([0, 255, 0]);
  });

  it("emits cities/countries/regions assets with droppedOverride: false", () => {
    const { assets } = transform(SAMPLE, { mode: "full" });
    expect(assets.cities.droppedOverride).toBe(false);
    expect(assets.countries.droppedOverride).toBe(false);
    expect(assets.regions.droppedOverride).toBe(false);
  });

  it("maps Pax aiPrompts keys to open-historia prompt keys", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      editor: {
        aiPrompts: {
          chatWithUser: "be terse",
          chatWithAdvisor: "advise tactically",
          actions: "respond as diplomat",
        },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.prompts.advisor).toBe("be terse");
    expect(bundle.data.prompts.leader).toBe("advise tactically");
    expect(bundle.data.prompts.actions).toBe("respond as diplomat");
  });

  it("maps Pax catalystRunner/Summarizer to catalystExecutor/Summary", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      editor: {
        aiPrompts: {
          catalystRunner: "execute",
          catalystSummarizer: "summarize",
        },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.prompts.catalystExecutor).toBe("execute");
    expect(bundle.data.prompts.catalystSummary).toBe("summarize");
  });

  it("passes through editor.templateHelpers to prompts.helpers", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      editor: {
        templateHelpers: {
          ALL_ADVISOR_MESSAGES: "${advisorMessages}",
          TRIGGER_AI_DIRECTIVE: "be diplomatic",
        },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    const helpers = bundle.data.prompts.helpers as Record<string, string>;
    expect(typeof helpers).toBe("object");
    expect(helpers.ALL_ADVISOR_MESSAGES).toBe("${advisorMessages}");
    expect(helpers.TRIGGER_AI_DIRECTIVE).toBe("be diplomatic");
  });

  it("emits empty {} for helpers/tasks when capture lacks them", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    expect(bundle.data.prompts.helpers).toEqual({});
    expect(bundle.data.prompts.tasks).toEqual({});
  });

  it("tolerates object-form aiPrompts (firstStage.template)", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      editor: {
        aiPrompts: {
          chatWithUser: { firstStage: { template: "be terse" } },
        } as never,
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.prompts.advisor).toBe("be terse");
  });

  it("emits empty string roles when editor.aiPrompts is missing", () => {
    const sample: PaxCapture = { ...SAMPLE, editor: {} };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.prompts.advisor).toBe("");
    expect(bundle.data.prompts.actions).toBe("");
    expect(bundle.data.prompts.gameMaster).toBe("");
    expect(bundle.data.prompts.helpers).toEqual({});
  });

  it("emits regionOwnershipOverrides keyed in <code>.<n>_1 format (ISO3 or Z##)", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const overrides = bundle.data.world.regionOwnershipOverrides;
    expect(typeof overrides).toBe("object");
    // Both Pax region indices ("0" and "1") must be present, formatted as <code>.<n>_1.
    const keys = Object.keys(overrides);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const k of keys) {
      // Code prefix: ISO3 (USA, RUS, ...) OR synthetic Z## (Z01..Z99).
      expect(k).toMatch(/^([A-Z]{3}|Z\d{2})\.\d+_1$/);
    }
    // Sample's polities ('Land of A', 'Land of B') aren't in TABLE, so each
    // gets its own synthetic Z## code (Task 2). The same Z## backs the region
    // and the polityOverrides entry.
    expect(keys[0]).toMatch(/\.0_1$/);
    expect(keys[1]).toMatch(/\.1_1$/);
  });

  it("emits Z## synthetic code for unmapped polities (no raw-name leak)", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      features: {
        ...SAMPLE.features,
        polities: [{ id: "Atlantis", name: "Atlantis", color: "#123456" }],
        regionOwnership: { "0": "Atlantis" },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    const overrides = bundle.data.world.regionOwnershipOverrides;
    const keys = Object.keys(overrides);
    expect(keys).toHaveLength(1);
    const key = keys[0];
    const code = overrides[key];
    expect(code).toMatch(/^Z\d{2}$/);
    expect(code).not.toBe("Atlantis");
  });

  it("emits deriveGame with the 6 hub oracle keys (country, startDate, gameDate, round, difficulty, language)", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const keys = Object.keys(bundle.data.game).sort();
    expect(keys).toEqual(["country", "difficulty", "gameDate", "language", "round", "startDate"]);
    expect(bundle.data.game.round).toBe(1);
    expect(typeof bundle.data.game.round).toBe("number");
  });

  it("deriveGame.country uses synthetic Z## for unmapped first polity", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      features: {
        ...SAMPLE.features,
        polities: [{ id: "Atlantis", name: "Atlantis", color: "#123456" }],
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.game.country).toMatch(/^Z\d{2}$/);
    expect(bundle.data.game.country).not.toBe("Atlantis");
  });

  it("deriveGame.difficulty defaults to 'standard' and language to 'English'", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    expect(bundle.data.game.difficulty).toBe("standard");
    expect(bundle.data.game.language).toBe("English");
  });

  it("emits data.world with only the 8 hub-canonical keys (no author/mapCredit/difficulty/language)", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const keys = Object.keys(bundle.data.world).sort();
    expect(keys).toEqual(
      [
        "allowedUnitTypes",
        "customCities",
        "customRegions",
        "ownerCodes",
        "polityOverrides",
        "regionOwnershipOverrides",
        "simulationRules",
        "startingTimelineText",
      ],
    );
    expect(bundle.data.world).not.toHaveProperty("author");
    expect(bundle.data.world).not.toHaveProperty("mapCredit");
    expect(bundle.data.world).not.toHaveProperty("difficulty");
    expect(bundle.data.world).not.toHaveProperty("language");
  });

  it("emits scenario.* with the 9 oracle keys (accentColor, countryNameOverrides, ...)", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const keys = Object.keys(bundle.scenario).sort();
    expect(keys).toEqual(
      [
        "accentColor",
        "countryNameOverrides",
        "description",
        "eyebrow",
        "heroSubtitle",
        "heroTitle",
        "id",
        "name",
        "subtitle",
      ].sort(),
    );
    expect(bundle.scenario.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof bundle.scenario.countryNameOverrides).toBe("object");
    expect(bundle.scenario.countryNameOverrides).not.toBeNull();
  });

  it("scenario.countryNameOverrides maps synthetic Z## to original polities", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      features: {
        ...SAMPLE.features,
        polities: [{ id: "Atlantis", name: "Atlantis", color: "#123456" }],
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    const overrides = bundle.scenario.countryNameOverrides as Record<string, string>;
    const entries = Object.entries(overrides);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.map(([_, name]) => name)).toContain("Atlantis");
    // The key for Atlantis must be the synthetic Z## code.
    const code = entries.find(([_, name]) => name === "Atlantis")![0];
    expect(code).toMatch(/^Z\d{2}$/);
  });

  it("normalizes UUID region keys in geometry/ownership to integers in override keys", () => {
    // Geometry capture mixes integer + UUID region keys; the hub format
    // requires the override key suffix to be \d+, so we must remap UUID keys
    // to a stable integer index before formatting.
    const sample: PaxCapture = {
      ...SAMPLE,
      geometry: {
        ...SAMPLE.geometry,
        geometry: {
          ...SAMPLE.geometry.geometry,
          "f2a26fbd-e22d-4a88-b667-a5a8ff0809a4": {
            geometry: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
            centroid: '{"type":"Point","coordinates":[0.5,0.5]}',
            adjacencies: [],
            type: "1",
          },
        },
      },
      features: {
        ...SAMPLE.features,
        regionOwnership: {
          ...SAMPLE.features.regionOwnership,
          "f2a26fbd-e22d-4a88-b667-a5a8ff0809a4": SAMPLE.features.polities[0]?.name ?? "",
        },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    const overrides = bundle.data.world.regionOwnershipOverrides;
    for (const key of Object.keys(overrides)) {
      expect(key).toMatch(/^([A-Z]{2,4}|Z\d{2})\.\d+_1$/);
      // No UUID can leak into the suffix.
      const suffix = key.split(".")[1].split("_")[0];
      expect(suffix).toMatch(/^\d+$/);
    }
  });

  it("emits no Ocean/Strait features into regionsGeojson or regionOwnershipOverrides", () => {
    // Pax data shape: water tiles (Ocean/Strait) exist in geometry but have
    // no entry in regionOwnership. Before the fix, buildRegionsFeatureCollection
    // would assign a synthetic Z## owner to water tiles (canonicalize("") ->
    // hash-mint), and the FeatureCollection would emit features with
    // properties.owner === "Z##" -- but the override emission loop wouldn't
    // add them to regionOwnershipOverrides. Result: internally inconsistent
    // bundle; openhistoria.com/play renders the ocean red and labels it "z26".
    // Fix: skip water regions at both emission sites.
    const sample: PaxCapture = {
      ...SAMPLE,
      geometry: {
        ...SAMPLE.geometry,
        geometry: {
          // Land + coastal regions from SAMPLE, indexed 0 and 1.
          ...SAMPLE.geometry.geometry,
          // Water regions -- geometry entries with NO regionOwnership entries.
          "2": {
            geometry: '{"type":"Polygon","coordinates":[[[2,0],[3,0],[3,1],[2,1],[2,0]]]}',
            centroid: '{"type":"Point","coordinates":[2.5,0.5]}',
            adjacencies: [],
            type: "Ocean",
          },
          "3": {
            geometry: '{"type":"Polygon","coordinates":[[[3,0],[4,0],[4,1],[3,1],[3,0]]]}',
            centroid: '{"type":"Point","coordinates":[3.5,0.5]}',
            adjacencies: [],
            type: "Strait",
          },
          "4": {
            geometry: '{"type":"Polygon","coordinates":[[[4,0],[5,0],[5,1],[4,1],[4,0]]]}',
            centroid: '{"type":"Point","coordinates":[4.5,0.5]}',
            adjacencies: [],
            type: "Coastal",
          },
        },
      },
      // regionOwnership deliberately has NO entries for water regions "2" or "3".
      // Coastal region "4" stays mapped so we cover the filter boundary.
      features: {
        ...SAMPLE.features,
        regionOwnership: {
          ...SAMPLE.features.regionOwnership,
          "4": "Land of A",
        },
      },
    };
    const result = transform(sample, { mode: "full" });
    const { bundle, assets } = result;

    // assets.regionsGeojson.data is base64-encoded JSON; decode to access features.
    // Narrow the discriminated union first.
    if (assets.regionsGeojson.mode !== "embedded") {
      throw new Error("expected embedded regionsGeojson");
    }
    type GeoFeature = { type: "Feature"; properties: { typeId: string; owner: string; id: string } };
    const fcDecoded = JSON.parse(
      Buffer.from(assets.regionsGeojson.data, "base64").toString("utf8"),
    ) as { type: "FeatureCollection"; features: GeoFeature[] };
    const fcFeatures: GeoFeature[] = fcDecoded.features;

    // (a) No water features in the FeatureCollection.
    const waterFeatures = fcFeatures.filter(
      (f) => f.properties.typeId === "ocean" || f.properties.typeId === "strait",
    );
    expect(waterFeatures).toEqual([]);

    // (b) regionOwnershipOverrides has no entries corresponding to water regions.
    // Since water regions are filtered out of the FeatureCollection entirely,
    // their Pax keys (2, 3) MUST NOT appear as override suffixes.
    const overrideKeys = Object.keys(bundle.data.world.regionOwnershipOverrides);
    for (const k of overrideKeys) {
      // suffix is everything between the dot and "_1".
      const suffix = k.split(".")[1].split("_")[0];
      // Pax key "2" -> idx 2; "3" -> idx 3. Coastal "4" -> idx 4 (kept, owned).
      expect(["2", "3"]).not.toContain(suffix);
    }

    // (c) The kept Coastal region "4" still appears -- confirms we didn't over-filter.
    const coastalKey = overrideKeys.find((k) => k.startsWith("Z") && k.endsWith(".4_1"))
      ?? overrideKeys.find((k) => k.endsWith(".4_1"));
    expect(coastalKey).toBeDefined();
  });

  it("emits polityOverrides as Record<code, {code, name, aliases, color, note}>", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const overrides = bundle.data.world.polityOverrides;
    expect(overrides).toBeDefined();
    for (const [code, entry] of Object.entries(overrides!)) {
      expect(code).toMatch(/^Z\d{2}$/);
      expect(entry.code).toBe(code);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.aliases).toEqual([]);
      expect(typeof entry.color).toBe("string");
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.note).toBe("");
    }
  });

  it("world.ownerCodes includes Z01-Z09 plus export-used codes", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    const ownerCodes = bundle.data.world.ownerCodes;
    expect(ownerCodes).toBeDefined();
    expect(ownerCodes).toContain("Z01");
    expect(ownerCodes).toContain("Z09");
    // Sorted, no duplicates.
    const sorted = [...ownerCodes!].sort();
    expect(ownerCodes).toEqual(sorted);
    expect(new Set(ownerCodes).size).toBe(ownerCodes!.length);
  });

  it("world.allowedUnitTypes is the six universal types", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    expect(bundle.data.world.allowedUnitTypes).toEqual([
      "infantry",
      "armor",
      "air",
      "naval",
      "artillery",
      "garrison",
    ]);
  });

  it("world.simulationRules pulls from editor.advancedSettings.rulesText when present", () => {
    const sample: PaxCapture = {
      ...SAMPLE,
      editor: {
        ...SAMPLE.editor,
        advancedSettings: { rulesText: "no nukes in 1444" },
      },
    };
    const { bundle } = transform(sample, { mode: "full" });
    expect(bundle.data.world.simulationRules).toBe("no nukes in 1444");
  });

  it("world.simulationRules defaults to '' when editor lacks rulesText", () => {
    const { bundle } = transform(SAMPLE, { mode: "full" });
    expect(bundle.data.world.simulationRules).toBe("");
  });

  it("succeeds with empty features (empty polities/cities/ownership) - emits valid bundle", () => {
    const empty: PaxCapture = {
      ...SAMPLE,
      features: {
        ...SAMPLE.features,
        polities: [],
        cities: [],
        regionOwnership: {},
      },
    };
    const result = transform(empty, { mode: "full" });
    expect(result.bundle.schema).toBe("pax-historia-scenario-bundle");
    expect(result.bundle.data.world.customRegions).toBe(true);
    if (result.assets.regionsGeojson.mode !== "embedded") throw new Error("not embedded");
    const regionsDecoded = JSON.parse(
      Buffer.from(result.assets.regionsGeojson.data, "base64").toString("utf8"),
    );
    expect(regionsDecoded.features.length).toBe(2);
    expect(Object.keys(result.bundle.data.world.regionOwnershipOverrides).length).toBe(0);
  });

  it("throws TransformError on unrecoverable input (empty geometry.geometry)", () => {
    const broken: PaxCapture = {
      ...SAMPLE,
      geometry: {
        ...SAMPLE.geometry,
        geometry: {} as PaxCapture["geometry"]["geometry"],
      },
    };
    expect(() => transform(broken, { mode: "full" })).toThrow(/TransformError|geometry/);
  });
});