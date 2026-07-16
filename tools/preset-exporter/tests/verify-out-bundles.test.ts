import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { valueTypeChecks, loadOutBundles, HUB_ACCEPTED_ASSET_KEYS } from "../src/verify";

function goodBundle(): Record<string, unknown> {
  return {
    schema: "pax-historia-scenario-bundle",
    version: 1,
    mode: "full",
    exportedAt: new Date().toISOString(),
    scenario: {
      id: "ABCDEFGHIJKLMNOPQRST",
      name: "Test",
      description: "A test scenario",
      accentColor: "#ff0000",
      countryNameOverrides: { USA: "United States" },
    },
    data: {
      actions: [],
      advisor: [],
      chat: [],
      events: {},
      game: { country: "USA", startDate: "2024-01-01", gameDate: "2024-01-01", round: 1, difficulty: "normal", language: "en" },
      prompts: {
        actions: "", advisor: "", autoJumpForward: "", catalystCreation: "",
        catalystExecutor: "", catalystSummary: "", descriptionToAction: "",
        eventConsolidator: "", gameMaster: "", helpers: {}, jumpForward: "",
        leader: "", nextSpeaker: "", tasks: {},
      },
      world: {
        allowedUnitTypes: ["infantry","armor","air","naval","artillery","garrison"],
        customCities: true,
        customRegions: true,
        ownerCodes: ["USA","GBR"],
        polityOverrides: {
          USA: { code: "USA", name: "United States", aliases: [], color: "#ff0000", note: "" },
        },
        regionOwnershipOverrides: { "USA.0_1": "USA" },
        simulationRules: {},
        startingTimelineText: "",
      },
    },
    assets: {
      cover: { mode: "default", fileName: "cover.jpg" },
      colors: { mode: "embedded", fileName: "colors.json", data: { USA: [255, 0, 0] } },
      regionsGeojson: { mode: "default", fileName: "regions.geojson" },
      citiesGeojson: { mode: "default", fileName: "cities.geojson" },
      cities: { mode: "default", fileName: "cities.pmtiles", droppedOverride: false },
      countries: { mode: "default", fileName: "countries.pmtiles", droppedOverride: false },
      regions: { mode: "default", fileName: "regions.pmtiles", droppedOverride: false },
    },
  };
}

describe("valueTypeChecks", () => {
  it("returns 19 checks for a known-good bundle, all pass", () => {
    const results = valueTypeChecks(goodBundle());
    expect(results.length).toBe(19);
    expect(results.every((r) => r.pass)).toBe(true);
  });

  it("flags a wrong schema literal", () => {
    const b = goodBundle();
    (b as Record<string, unknown>).schema = "wrong";
    const r = valueTypeChecks(b);
    expect(r[0].check).toBe("schema = pax-historia-scenario-bundle");
    expect(r[0].pass).toBe(false);
  });

  it("flags a non-numeric version", () => {
    const b = goodBundle();
    (b as Record<string, unknown>).version = "1";
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("version"))?.pass).toBe(false);
  });

  it("flags a mode outside {light,full}", () => {
    const b = goodBundle();
    (b as Record<string, unknown>).mode = "bogus";
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("mode"))?.pass).toBe(false);
  });

  it("flags a stale exportedAt (older than 90 days)", () => {
    const b = goodBundle();
    const d = new Date();
    d.setDate(d.getDate() - 100);
    (b as Record<string, unknown>).exportedAt = d.toISOString();
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("exportedAt"))?.pass).toBe(false);
  });

  it("flags a malformed scenario.id (too short)", () => {
    const b = goodBundle();
    (b.scenario as Record<string, unknown>).id = "short";
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("scenario.id"))?.pass).toBe(false);
  });

  it("flags a non-hex accentColor", () => {
    const b = goodBundle();
    (b.scenario as Record<string, unknown>).accentColor = "red";
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("accentColor"))?.pass).toBe(false);
  });

  it("flags non-string countryNameOverrides values", () => {
    const b = goodBundle();
    (b.scenario as Record<string, unknown>).countryNameOverrides = { USA: 42 };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("countryNameOverrides"))?.pass).toBe(false);
  });

  it("flags a data.game.country not matching the code regex", () => {
    const b = goodBundle();
    (b.data as Record<string, unknown>).game = {
      country: "bad", startDate: "2024-01-01", gameDate: "2024-01-01", round: 1, difficulty: "normal", language: "en",
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("data.game.country"))?.pass).toBe(false);
  });

  it("flags a bad regionOwnershipOverrides value code", () => {
    const b = goodBundle();
    ((b.data as Record<string, unknown>).world as Record<string, unknown>).regionOwnershipOverrides = { "USA.0_1": "bad" };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("regionOwnershipOverrides values"))?.pass).toBe(false);
  });

  it("flags a bad polityOverride code", () => {
    const b = goodBundle();
    ((b.data as Record<string, unknown>).world as Record<string, unknown>).polityOverrides = {
      bad: { code: "bad", name: "Bad", aliases: [], color: "#ff0000", note: "" },
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("polityOverrides[*].code"))?.pass).toBe(false);
  });

  it("flags a non-hex polityOverride color", () => {
    const b = goodBundle();
    ((b.data as Record<string, unknown>).world as Record<string, unknown>).polityOverrides = {
      USA: { code: "USA", name: "United States", aliases: [], color: "red", note: "" },
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("polityOverrides[*].color"))?.pass).toBe(false);
  });

  it("flags a bad ownerCodes entry", () => {
    const b = goodBundle();
    ((b.data as Record<string, unknown>).world as Record<string, unknown>).ownerCodes = ["USA", "bad"];
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("ownerCodes"))?.pass).toBe(false);
  });

  it("flags wrong allowedUnitTypes list", () => {
    const b = goodBundle();
    ((b.data as Record<string, unknown>).world as Record<string, unknown>).allowedUnitTypes = ["infantry"];
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("allowedUnitTypes"))?.pass).toBe(false);
  });

  it("flags a bad cover contentType", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).cover = {
      mode: "embedded", fileName: "cover.bin", contentType: "application/octet-stream", encoding: "base64", data: "AA==",
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("cover.contentType"))?.pass).toBe(false);
  });

  it("flags a cover with mode=embedded but wrong encoding", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).cover = {
      mode: "embedded", fileName: "cover.jpg", contentType: "image/jpeg", encoding: "utf8", data: "",
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("cover.encoding"))?.pass).toBe(false);
  });

  it("flags non-base64 regionsGeojson data when embedded", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).regionsGeojson = {
      mode: "embedded", fileName: "regions.geojson", contentType: "application/geo+json",
      encoding: "base64", data: "not-base64!!!",
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("regionsGeojson + citiesGeojson.data"))?.pass).toBe(false);
  });

  it("flags non-tuple colors.data values", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).colors = {
      mode: "embedded", fileName: "colors.json", data: { USA: [255, 0] },
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("colors.data"))?.pass).toBe(false);
  });

  it("flags a color keyed by an unknown code", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).colors = {
      mode: "embedded", fileName: "colors.json", data: { USA: [255, 0, 0], ZZZ: [0, 0, 0] },
    };
    const r = valueTypeChecks(b);
    expect(r.find((c) => c.check.includes("colors keys"))?.pass).toBe(false);
  });

  it("does NOT fail on extra asset keys in the importer allowlist (backgroundData)", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).backgroundData = { mode: "default", fileName: "background.json" };
    const r = valueTypeChecks(b);
    const assetCheck = r.find((c) => c.check.includes("assets.* keys"));
    expect(assetCheck).toBeDefined();
    expect(assetCheck?.pass).toBe(true);
    expect(assetCheck?.detail).toContain("backgroundData");
  });

  it("treats scenario.countryNameOverrides = null as absent (no crash)", () => {
    const b = goodBundle();
    (b.scenario as Record<string, unknown>).countryNameOverrides = null;
    const r = valueTypeChecks(b);
    const cnoCheck = r.find((c) => c.check.includes("countryNameOverrides"));
    expect(cnoCheck).toBeDefined();
    expect(cnoCheck?.pass).toBe(true);
    expect(cnoCheck?.detail).toBe("absent");
  });

  it("flags asset keys outside the union + importer allowlist", () => {
    const b = goodBundle();
    (b.assets as Record<string, unknown>).nonsense = { x: 1 };
    const r = valueTypeChecks(b);
    const assetCheck = r.find((c) => c.check.includes("assets.* keys"));
    expect(assetCheck?.pass).toBe(false);
  });

  it("exposes HUB_ACCEPTED_ASSET_KEYS including backgroundData", () => {
    expect(HUB_ACCEPTED_ASSET_KEYS).toContain("backgroundData");
    expect(HUB_ACCEPTED_ASSET_KEYS).toContain("cover");
  });
});

describe("loadOutBundles", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = join(tmpdir(), `verify-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratch, { recursive: true });
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns [] when the directory does not exist", async () => {
    expect(await loadOutBundles(join(scratch, "missing"))).toEqual([]);
  });

  it("returns sorted *.json files, skipping sidecars", async () => {
    writeFileSync(join(scratch, "AAAA.json"), JSON.stringify(goodBundle()));
    writeFileSync(join(scratch, "BBBB.json"), JSON.stringify(goodBundle()));
    writeFileSync(join(scratch, "AAAA.json.run_summary.json"), "{}");
    const out = await loadOutBundles(scratch);
    expect(out.map((b) => b.name)).toEqual(["AAAA.json", "BBBB.json"]);
  });

  it("skips malformed JSON instead of crashing", async () => {
    writeFileSync(join(scratch, "AAAA.json"), JSON.stringify(goodBundle()));
    writeFileSync(join(scratch, "BBBB.json"), "{not json");
    const out = await loadOutBundles(scratch);
    expect(out.map((b) => b.name)).toEqual(["AAAA.json"]);
  });
});
