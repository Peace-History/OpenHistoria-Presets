import { describe, it, expect } from "bun:test";
import { diffAgainstHubBundles, type HubBundle } from "../src/conformance";

// A minimal hub bundle that matches the canonical shape.
function makeHubBundle(name: string, overrides: Partial<Record<string, unknown>> = {}): HubBundle {
  return {
    name,
    data: {
      schema: "pax-historia-scenario-bundle",
      version: 1,
      mode: "full",
      exportedAt: "2026-07-16T00:00:00.000Z",
      scenario: {
        id: "x",
        name: "x",
        description: "",
        eyebrow: "Scenario",
        heroTitle: "x",
        heroSubtitle: "",
        subtitle: "",
        accentColor: "#7c3aed",
        countryNameOverrides: {},
      },
      data: {
        actions: [],
        advisor: [],
        chat: [],
        events: {},
        game: { country: "USA", startDate: "", gameDate: "", round: 1, difficulty: "standard", language: "English" },
        prompts: { advisor: "" },
        world: { customRegions: true, customCities: true, regionOwnershipOverrides: {} },
      },
      assets: {
        cover: { mode: "default" },
        colors: { mode: "default" },
        regionsGeojson: { mode: "embedded", fileName: "r.geojson", encoding: "base64", contentType: "application/geo+json", data: "" },
        citiesGeojson: { mode: "embedded", fileName: "c.geojson", encoding: "base64", contentType: "application/geo+json", data: "" },
      },
      ...overrides,
    },
  };
}

describe("diffAgainstHubBundles", () => {
  it("returns pass when export matches a hub bundle exactly", () => {
    const hub = makeHubBundle("test.json");
    const exportBundle = hub.data;
    const report = diffAgainstHubBundles(exportBundle, [hub]);
    if (!report.pass) {
      const fails = report.results.filter((r) => !r.pass).map((r) => `${r.check}: ${r.detail}`);
      throw new Error("expected pass, got:\n" + fails.join("\n"));
    }
    expect(report.pass).toBe(true);
    expect(report.hubBundleCount).toBe(1);
  });

  it("schema-drift guard: fails when hub union adds a key the export lacks", () => {
    const hubA = makeHubBundle("a.json");
    const hubB = makeHubBundle("b.json", {
      data: {
        ...(hubA.data.data as Record<string, unknown>),
        // b.json adds a new data.* key that a.json doesn't have.
        brandNewDataKey: [],
      },
    });
    // The export only matches a.json's keys; the union of (a, b) keys includes
    // `brandNewDataKey` which the export lacks, so the diff must report it.
    const report = diffAgainstHubBundles(hubA.data, [hubA, hubB]);
    expect(report.pass).toBe(false);
    const dataResult = report.results.find((r) => r.check.startsWith("data.* keys"));
    expect(dataResult).toBeDefined();
    expect(dataResult?.pass).toBe(false);
    expect(dataResult?.detail).toContain("brandNewDataKey");
  });

  it("flags missing data.game.round", () => {
    const hub = makeHubBundle("test.json");
    const exportBundle = JSON.parse(JSON.stringify(hub.data));
    const exportGame = (exportBundle.data as Record<string, unknown>).game as Record<string, unknown>;
    delete exportGame.round;
    const report = diffAgainstHubBundles(exportBundle, [hub]);
    expect(report.pass).toBe(false);
    const roundResult = report.results.find((r) => r.check.includes("game.round"));
    expect(roundResult?.pass).toBe(false);
  });

  it("flags non-canonical world keys", () => {
    const hub = makeHubBundle("test.json");
    const exportBundle = JSON.parse(JSON.stringify(hub.data));
    const exportWorld = (exportBundle.data as Record<string, unknown>).world as Record<string, unknown>;
    exportWorld.author = "someone";
    const report = diffAgainstHubBundles(exportBundle, [hub]);
    expect(report.pass).toBe(false);
    const worldResult = report.results.find((r) => r.check.startsWith("data.world keys"));
    expect(worldResult?.detail).toContain("author");
  });
});