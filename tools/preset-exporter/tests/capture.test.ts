import { describe, it, expect } from "bun:test";
import { loadCaptureFromDir, pickLatestVersionDir, latestCaptureDirLooksComplete } from "../src/capture";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadCaptureFromDir", () => {
  it("loads preset/geometry/features/editor from a directory", async () => {
    const dir = join(tmpdir(), `capture-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(
        join(dir, "preset.json"),
        JSON.stringify({ id: "TEST", publishedVersionID: "1", title: "T", description: "" }),
      );
      await writeFile(
        join(dir, "geometry.json"),
        JSON.stringify({ name: "g", geometry: { "0": { geometry: "{}", centroid: "{}", adjacencies: [], type: "Land" } }, community: false, tags: [] }),
      );
      await writeFile(
        join(dir, "features.json"),
        JSON.stringify({ polities: [], cities: [], regionOwnership: {}, capturedAt: "" }),
      );
      const capture = await loadCaptureFromDir(dir);
      expect(capture.preset.id).toBe("TEST");
      expect(capture.geometry.geometry["0"].type).toBe("Land");
      expect(capture.features.polities.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when preset.json is missing", async () => {
    const dir = join(tmpdir(), `capture-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      expect(loadCaptureFromDir(dir)).rejects.toThrow(/preset\.json missing/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces the manifest.incomplete reason when the editor pass failed", async () => {
    const dir = join(tmpdir(), `capture-test-${Date.now()}-incomplete`);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(join(dir, "preset.json"), JSON.stringify({ id: "X", publishedVersionID: "1", title: "t", description: "" }));
      await writeFile(join(dir, "geometry.json"), JSON.stringify({ name: "g", geometry: {}, community: false, tags: [] }));
      await writeFile(join(dir, "features.json"), JSON.stringify({ polities: [], cities: [], regionOwnership: {}, capturedAt: "" }));
      await writeFile(join(dir, "editor.json"), JSON.stringify({}));
      await writeFile(join(dir, "manifest.json"), JSON.stringify({ incomplete: "editor_walk_no_polities" }));
      await expect(loadCaptureFromDir(dir)).rejects.toThrow(/editor_walk_no_polities/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("latestCaptureDirLooksComplete", () => {
  it("returns undefined when geometry.json is missing (incomplete capture)", async () => {
    const root = join(tmpdir(), `complete-test-${Date.now()}-nogeom`);
    await mkdir(join(root, "1"), { recursive: true });
    await writeFile(join(root, "1", "manifest.json"), "{}");
    await writeFile(join(root, "1", "preset.json"), JSON.stringify({ id: "X" }));
    try {
      expect(latestCaptureDirLooksComplete(root)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the version dir when manifest+preset+geometry are present", async () => {
    const root = join(tmpdir(), `complete-test-${Date.now()}-ok`);
    await mkdir(join(root, "1"), { recursive: true });
    await writeFile(join(root, "1", "manifest.json"), "{}");
    await writeFile(join(root, "1", "preset.json"), JSON.stringify({ id: "X" }));
    await writeFile(join(root, "1", "geometry.json"), "{}");
    try {
      expect(latestCaptureDirLooksComplete(root)).toBe(join(root, "1"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("pickLatestVersionDir", () => {
  it("returns the highest-version child with a manifest.json", async () => {
    const root = join(tmpdir(), `pick-test-${Date.now()}`);
    await mkdir(join(root, "1"), { recursive: true });
    await mkdir(join(root, "79"), { recursive: true });
    await mkdir(join(root, "40"), { recursive: true });
    await writeFile(join(root, "1", "manifest.json"), "{}");
    await writeFile(join(root, "40", "manifest.json"), "{}");
    await writeFile(join(root, "79", "manifest.json"), "{}");
    try {
      expect(await pickLatestVersionDir(root)).toBe(join(root, "79"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips child directories without manifest.json", async () => {
    const root = join(tmpdir(), `pick-test-${Date.now()}`);
    await mkdir(join(root, "1"), { recursive: true });
    await mkdir(join(root, "79"), { recursive: true });
    await writeFile(join(root, "79", "manifest.json"), "{}");
    try {
      expect(await pickLatestVersionDir(root)).toBe(join(root, "79"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when no child has manifest.json", async () => {
    const root = join(tmpdir(), `pick-test-${Date.now()}`);
    await mkdir(join(root, "1"), { recursive: true });
    try {
      expect(await pickLatestVersionDir(root)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when the uid dir does not exist", async () => {
    const root = join(tmpdir(), `pick-test-${Date.now()}-missing`);
    expect(await pickLatestVersionDir(root)).toBeUndefined();
  });
});