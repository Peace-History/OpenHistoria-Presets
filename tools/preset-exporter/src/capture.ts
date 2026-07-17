// capture.ts - Thin wrapper around pax-ripper's library-callable modules.
// Reads a captured preset directory back into a PaxCapture the transform can consume.

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PaxCapture, PaxRegion } from "./types";

export async function loadCaptureFromDir(captureDir: string): Promise<PaxCapture> {
  const entries = await readdir(captureDir);
  const jsonName = (n: string) => entries.find((e) => e === n);
  const presetPath = jsonName("preset.json");
  const geometryPath = jsonName("geometry.json");
  const featuresPath = jsonName("features.json");
  const editorPath = jsonName("editor.json");
  const manifestPath = jsonName("manifest.json");
  if (!presetPath) throw new Error(`preset.json missing in ${captureDir}`);
  if (!geometryPath) throw new Error(`geometry.json missing in ${captureDir}`);

  // Surface the editor-capture failure reason from manifest.incomplete so dump-all
  // can print a specific FAIL row (e.g. "editor walk incomplete: ..." instead of
  // the generic "geometry.json missing" once the orchestrator wires this through).
  if (manifestPath) {
    try {
      const manifest = JSON.parse(await readFile(join(captureDir, manifestPath), "utf8")) as Record<string, unknown>;
      if (typeof manifest.incomplete === "string" && manifest.incomplete.length > 0) {
        throw new Error(`capture incomplete: ${manifest.incomplete}`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // malformed manifest -- fall through to the existing geometry/preset checks
      } else {
        throw e;
      }
    }
  }

  const preset = JSON.parse(await readFile(join(captureDir, presetPath), "utf8"));
  const geometry = JSON.parse(await readFile(join(captureDir, geometryPath), "utf8"));
  const features = featuresPath
    ? JSON.parse(await readFile(join(captureDir, featuresPath), "utf8"))
    : { polities: [], cities: [], regionOwnership: {} };
  const editor = editorPath
    ? JSON.parse(await readFile(join(captureDir, editorPath), "utf8"))
    : {};

  // Basemap geometry lives in api_responses/editor_state_raw.json under
  // state.baseMapGeometry.geometry. pax-ripper's vendored shaper drops it from
  // editor.json's basemapMetadata, so we read it from the raw file ourselves.
  // Tolerate missing file, missing state.baseMapGeometry, and malformed shapes.
  // Read editor_state_raw.json independently of whether editor.json exists.
  // Tolerate missing api_responses/ dir, missing raw file, missing
  // state.baseMapGeometry, and malformed shapes.
  if (existsSync(join(captureDir, "api_responses"))) {
    try {
      const rawPath = join(captureDir, "api_responses", "editor_state_raw.json");
      if (existsSync(rawPath)) {
        const raw = JSON.parse(await readFile(rawPath, "utf8")) as Record<string, unknown>;
        const state = (raw.state ?? raw) as Record<string, unknown>;
        const baseMapGeometry = state.baseMapGeometry as Record<string, unknown> | undefined;
        const geometryObj = baseMapGeometry?.geometry as Record<string, unknown> | undefined;
        if (geometryObj && typeof geometryObj === "object" && !Array.isArray(geometryObj)) {
          const basemapGeometry: Record<string, PaxRegion> = {};
          for (const [key, region] of Object.entries(geometryObj)) {
            if (region && typeof region === "object" && !Array.isArray(region)) {
              const r = region as Record<string, unknown>;
              basemapGeometry[key] = {
                geometry: typeof r.geometry === "string" ? r.geometry : "",
                centroid: typeof r.centroid === "string" ? r.centroid : "",
                adjacencies: Array.isArray(r.adjacencies) ? (r.adjacencies as string[]) : [],
                type: typeof r.type === "string" ? r.type : "Land",
              };
            }
          }
          if (Object.keys(basemapGeometry).length > 0) {
            (editor as { basemapGeometry?: Record<string, PaxRegion> }).basemapGeometry = basemapGeometry;
          }
        }
      }
    } catch {
      // Malformed raw file or IO error -- leave basemapGeometry undefined.
      // The transform step will treat absence as "no basemap" and skip emission.
    }
  }

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

// Sync, "cache looks reusable" check used by dump-all's resume gate. Same
// numeric sort as pickLatestVersionDir so a "10" version does not get
// treated as smaller than "2" (the bug a duplicate sort risked).
// Also requires preset.json to exist and be non-empty so loadCaptureFromDir
// won't fail on a half-written capture, AND geometry.json (whose absence
// means the editor pass died before ripPreset.ts could download it).
export function latestCaptureDirLooksComplete(uidCacheDir: string): string | undefined {
  if (!existsSync(uidCacheDir)) return undefined;
  const children = readdirSync(uidCacheDir);
  let best: { version: number; dir: string } | undefined;
  for (const child of children) {
    const dir = join(uidCacheDir, child);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    const version = Number(child);
    if (!Number.isFinite(version)) continue;
    if (!best || version > best.version) best = { version, dir };
  }
  if (!best) return undefined;
  const presetPath = join(best.dir, "preset.json");
  if (!existsSync(presetPath)) return undefined;
  if (statSync(presetPath).size === 0) return undefined;
  if (!existsSync(join(best.dir, "geometry.json"))) return undefined;
  return best.dir;
}