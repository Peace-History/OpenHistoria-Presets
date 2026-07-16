import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCaptureFromDir } from "../src/capture";
import { transform } from "../src/transform";
import { diffAgainstHubBundles, loadHubBundles } from "../src/conformance";

const ROOT = new URL("../../..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "tools/preset-exporter/tests/fixtures/cold-war");
const HUB_DIR = process.env.HUB_BUNDLES_DIR ?? "/home/john/Projects/Open-historia-scenarios/bundles";

describe("hub conformance (in-process)", () => {
  it("emitted bundle from the cold-war fixture matches the 6 hub bundles' shape", async () => {
    const hubBundles = await loadHubBundles(HUB_DIR);
    // If the hub bundles aren't on this host (CI without the sidecar checkout),
    // skip rather than fail - the conformance module has its own exhaustive
    // tests with synthetic fixtures.
    if (hubBundles.length === 0) {
      console.warn(`hub bundles not found in ${HUB_DIR} - skipping live conformance test`);
      return;
    }
    expect(hubBundles.length).toBeGreaterThanOrEqual(6);
    const capture = await loadCaptureFromDir(FIXTURE);
    const { bundle, assets } = transform(capture, { mode: "full" });
    // The conformance module compares against the on-disk shape (bundle +
    // assets at top level), mirroring what scripts/export-and-check.ts reads
    // back from disk.
    const report = diffAgainstHubBundles(
      { ...bundle, assets },
      hubBundles,
    );
    if (!report.pass) {
      const fails = report.results.filter((r) => !r.pass).map((r) => `${r.check}: ${r.detail}`);
      throw new Error("hub conformance failed:\n" + fails.join("\n"));
    }
    expect(report.pass).toBe(true);
  });

  it("end-to-end: emitted bundle is loadable JSON matching the cold-war fixture's scenario id", async () => {
    const capture = await loadCaptureFromDir(FIXTURE);
    const { bundle } = transform(capture, { mode: "full" });
    // Sanity: the bundle round-trips through JSON without loss.
    const roundTrip = JSON.parse(JSON.stringify(bundle));
    expect(roundTrip.scenario.id).toBe(bundle.scenario.id);
    expect(roundTrip.data.game.round).toBe(1);
    expect(Object.keys(roundTrip.data.world.regionOwnershipOverrides).length).toBeGreaterThan(0);
    // Every override key matches the hub-canonical format.
    for (const k of Object.keys(roundTrip.data.world.regionOwnershipOverrides)) {
      expect(k).toMatch(/^([A-Z]{2,4}|Z\d{2})\.\d+_1$/);
    }
  });
});