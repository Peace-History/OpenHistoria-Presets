// capture.ts - Thin wrapper around pax-ripper's library-callable modules.
// Reads a captured preset directory back into a PaxCapture the transform can consume.

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PaxCapture } from "./types";

export async function loadCaptureFromDir(captureDir: string): Promise<PaxCapture> {
  const entries = await readdir(captureDir);
  const jsonName = (n: string) => entries.find((e) => e === n);
  const presetPath = jsonName("preset.json");
  const geometryPath = jsonName("geometry.json");
  const featuresPath = jsonName("features.json");
  const editorPath = jsonName("editor.json");
  if (!presetPath) throw new Error(`preset.json missing in ${captureDir}`);
  if (!geometryPath) throw new Error(`geometry.json missing in ${captureDir}`);

  const preset = JSON.parse(await readFile(join(captureDir, presetPath), "utf8"));
  const geometry = JSON.parse(await readFile(join(captureDir, geometryPath), "utf8"));
  const features = featuresPath
    ? JSON.parse(await readFile(join(captureDir, featuresPath), "utf8"))
    : { polities: [], cities: [], regionOwnership: {} };
  const editor = editorPath
    ? JSON.parse(await readFile(join(captureDir, editorPath), "utf8"))
    : undefined;

  let cover: Uint8Array | undefined;
  const coverEntry = entries.find((e) => e === "landing.png" || e === "cover.png");
  if (coverEntry) {
    cover = new Uint8Array(await readFile(join(captureDir, coverEntry)));
  }

  return { preset, geometry, features, editor, cover, coverName: coverEntry };
}

// pax-ripper writes to <outputBaseDir>/<uid>/<versionID>/ where versionID is a numeric string.
// After a live capture the CLI does not know the versionID, so pick the highest numeric
// child directory that contains a manifest.json (the latest capture wins).
export async function pickLatestVersionDir(uidCacheDir: string): Promise<string | undefined> {
  if (!existsSync(uidCacheDir)) return undefined;
  const children = await readdir(uidCacheDir);
  let best: { version: number; dir: string } | undefined;
  for (const child of children) {
    const dir = join(uidCacheDir, child);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    const version = Number(child);
    if (!Number.isFinite(version)) continue;
    if (!best || version > best.version) best = { version, dir };
  }
  return best?.dir;
}