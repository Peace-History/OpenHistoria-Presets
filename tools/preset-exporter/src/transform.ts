// transform.ts - Pure PaxCapture to { bundle, assets } mapper.
// Always emits a tier-2 bundle (Pax regions are integer-indexed, never GADM).
// Reference: open-historia/src/Editor/exportPreset.js (normalizeRegionsForGame,
// buildCitiesForGame, detectCustomGeometry) and open-historia/src/runtime/web/libraryStore.js
// (importScenarioBundle).

import { canonicalize, usedCodes } from "./canonicalize";
import type {
  PaxCapture,
  PaxCity,
  PaxPolity,
  PaxRegion,
  ScenarioBundle,
  TransformResult,
  BundleAssets,
} from "./types";
import { TransformError } from "./types";
import type { Feature, FeatureCollection } from "geojson";

interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

type GeoJsonRegionGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

function parseRegionGeometry(raw: string, index: string): GeoJsonRegionGeometry {
  try {
    const parsed = JSON.parse(raw) as GeoJsonRegionGeometry;
    if (
      (parsed.type !== "Polygon" && parsed.type !== "MultiPolygon") ||
      !Array.isArray(parsed.coordinates)
    ) {
      throw new Error("not a Polygon or MultiPolygon");
    }
    return parsed;
  } catch (err) {
    throw new TransformError(
      `region ${index}: geometry payload is not a valid GeoJSON Polygon (${(err as Error).message})`,
    );
  }
}

function parseRegionCentroid(raw: string): GeoJsonPoint | null {
  try {
    const parsed = JSON.parse(raw) as GeoJsonPoint;
    if (parsed.type !== "Point" || !Array.isArray(parsed.coordinates)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) {
    console.warn(`[transform] hexToRgb: malformed hex '${hex}', falling back to grey`);
    return [128, 128, 128];
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function buildRegionsFeatureCollection(
  geometry: Record<string, PaxRegion>,
  ownership: Record<string, string>,
  regionIndex: Record<string, number>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [index, region] of Object.entries(geometry)) {
    // Water tiles (Ocean/Strait) have no real owner; Pax's regionOwnership
    // map has no entry for them, which would hash-mint a synthetic Z## code
    // (canonicalize("")) and produce an internally inconsistent bundle.
    // Skip them so they fall through to the renderer's baseColor fallback.
    if (region.type === "Ocean" || region.type === "Strait") continue;
    const polygon = parseRegionGeometry(region.geometry, index);
    const centroid = parseRegionCentroid(region.centroid);
    const polityName = ownership[index] ?? "";
    const canonical = canonicalize(polityName);
    // Canonical key: <ISO3-or-Z##>.{integer_index}_1. Pax region keys are
    // sometimes integer strings and sometimes UUIDs; we use the SHARED
    // regionIndex (water-inclusive) so the feature id suffix matches the
    // override key suffix for the same Pax region. The suffix matches the
    // hub schema `^[A-Z]{2,4}\.\d+_1$`.
    const idx = regionIndex[index];
    if (idx === undefined) {
      // Should be structurally impossible: index came from Object.keys(geometry)
      // and regionIndex was built from the same keys. Throw rather than
      // silently skip - a future refactor that decouples these sources would
      // otherwise drop features with no signal.
      throw new TransformError(
        `buildRegionsFeatureCollection: regionIndex missing key "${index}" (regionIndex and geometry are out of sync)`,
      );
    }
    const featureId = `${canonical.code}.${idx}_1`;
    features.push({
      type: "Feature",
      geometry: polygon,
      properties: {
        id: featureId,
        owner: canonical.code,
        name: polityName,
        country: canonical.name,
        typeId: region.type.toLowerCase(),
        gid0: canonical.code,
        ...(centroid ? { centroid: centroid.coordinates } : {}),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildCitiesFeatureCollection(cities: PaxCity[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cities.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: c.location },
      properties: { id: c.id, name: c.name, scale: c.scale ?? 1 },
    })),
  };
}

function buildColors(polities: PaxPolity[]): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const p of polities) {
    out[canonicalize(p.name).code] = hexToRgb(p.color);
  }
  return out;
}

function deriveContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/** Deterministic fallback color for synthetic Z## codes (no Pax polity color). */
function fallbackColor(code: string): string {
  // Hash the code to a stable RGB sextet. FNV-1a.
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0) & 0xffffff;
  return "#" + n.toString(16).padStart(6, "0");
}

function deriveScenario(
  preset: PaxCapture["preset"],
  polities: PaxPolity[],
): {
  id: string;
  name: string;
  description: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  subtitle: string;
  accentColor: string;
  countryNameOverrides: Record<string, string>;
} {
  const countryNameOverrides: Record<string, string> = {};
  for (const p of polities) {
    const code = canonicalize(p.name).code;
    if (!(code in countryNameOverrides)) {
      countryNameOverrides[code] = p.name;
    }
  }
  return {
    id: preset.id,
    name: preset.title,
    description: preset.description,
    eyebrow: "Scenario",
    heroTitle: preset.title,
    heroSubtitle: "",
    subtitle: "",
    accentColor: "#7c3aed",
    countryNameOverrides,
  };
}

/** Oracle's six universal unit types, in the order example.json carries them. */
const ORACLE_UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"];

const ORACLE_Z_CODES = [
  "Z01",
  "Z02",
  "Z03",
  "Z04",
  "Z05",
  "Z06",
  "Z07",
  "Z08",
  "Z09",
] as const;

function deriveWorldExtras(
  polities: PaxPolity[],
  editor?: PaxCapture["editor"],
): {
  ownerCodes: string[];
  allowedUnitTypes: string[];
  simulationRules: string;
  startingTimelineText: string;
} {
  // ownerCodes = TABLE values + Z01-Z09 + export-used codes, sorted & deduped.
  const used = usedCodes();
  for (const z of ORACLE_Z_CODES) used.add(z);
  for (const p of polities) used.add(canonicalize(p.name).code);
  return {
    ownerCodes: [...used].sort(),
    allowedUnitTypes: [...ORACLE_UNIT_TYPES],
    simulationRules: editor?.advancedSettings?.rulesText ?? "",
    startingTimelineText: "",
  };
}

function deriveGame(
  polities: PaxPolity[],
  preset: PaxCapture["preset"],
  editor?: PaxCapture["editor"],
): Record<string, unknown> {
  const firstOwner = polities[0]?.name ?? "";
  // canonicalize falls through to syntheticCode() for unknown polities.
  const code = canonicalize(firstOwner).code;
  // startDate comes from editor.extras.initialPresetData.startDate when present.
  const initial =
    editor?.extras && typeof editor.extras === "object"
      ? (editor.extras as { initialPresetData?: { startDate?: string } }).initialPresetData
      : undefined;
  return {
    country: code,
    startDate: initial?.startDate ?? "",
    gameDate: "",
    round: 1,
    difficulty: "standard",
    language: "English",
    // (preset.id / publishedVersionID / title intentionally NOT included -
    // they're carried in the bundle's top-level .scenario and .exportedAt
    // fields, and the oracle has no place for them inside .game.)
  };
}

/**
 * Pax aiPrompts key -> open-historia role key. Derived from the captured
 * editor.json keys (`actions, autoJumpForward, catalystCreation,
 * catalystRunner, catalystSummarizer, chatWithAdvisor, chatWithUser,
 * descriptionToAction, eventConsolidator, gameMaster, jumpForward,
 * nextSpeaker`) against the open-historia role set observed in example.json.
 */
const PAX_TO_OPEN_HISTORIA_PROMPT_KEY: Record<string, string> = {
  chatWithUser: "advisor",
  chatWithAdvisor: "leader",
  actions: "actions",
  autoJumpForward: "autoJumpForward",
  catalystCreation: "catalystCreation",
  catalystRunner: "catalystExecutor",
  catalystSummarizer: "catalystSummary",
  descriptionToAction: "descriptionToAction",
  eventConsolidator: "eventConsolidator",
  gameMaster: "gameMaster",
  jumpForward: "jumpForward",
  nextSpeaker: "nextSpeaker",
};

/** Roles that should be emitted as plain strings in the bundle. */
const STRING_ROLES = [
  "advisor",
  "leader",
  "actions",
  "autoJumpForward",
  "catalystCreation",
  "catalystExecutor",
  "catalystSummary",
  "descriptionToAction",
  "eventConsolidator",
  "gameMaster",
  "jumpForward",
  "nextSpeaker",
] as const;

/** Extract a string prompt from either a raw string or a Pax `firstStage.template` object. */
function extractPromptText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "firstStage" in value) {
    const fs = (value as { firstStage?: unknown }).firstStage;
    if (fs && typeof fs === "object" && "template" in fs) {
      const t = (fs as { template?: unknown }).template;
      if (typeof t === "string") return t;
    }
  }
  return "";
}

function derivePrompts(
  editor?: PaxCapture["editor"],
): Record<string, string | Record<string, string>> {
  const prompts: Record<string, string | Record<string, string>> = {};

  // 1. String roles - initialize all known roles to "", then overlay any
  //    Pax aiPrompts we have a mapping for. Keeps the bundle shape stable
  //    even when the capture is sparse.
  for (const role of STRING_ROLES) {
    prompts[role] = "";
  }
  const src = editor?.aiPrompts ?? {};
  for (const [key, value] of Object.entries(src)) {
    const mapped = PAX_TO_OPEN_HISTORIA_PROMPT_KEY[key];
    if (!mapped) {
      console.warn(`derivePrompts: unmapped Pax prompt key "${key}" dropped`);
      continue;
    }
    if (!STRING_ROLES.includes(mapped as (typeof STRING_ROLES)[number])) continue;
    prompts[mapped] = extractPromptText(value);
  }

  // 2. Nested helpers/tasks - source = editor.templateHelpers / templateTasks.
  //    Oracle's data.prompts.helpers carries ALL_ADVISOR_MESSAGES, etc.
  prompts.helpers = editor?.templateHelpers ?? {};
  prompts.tasks = editor?.templateTasks ?? {};

  return prompts;
}

export function transform(capture: PaxCapture, opts: { mode: "light" | "full" }): TransformResult {
  if (!capture.geometry?.geometry || typeof capture.geometry.geometry !== "object") {
    throw new TransformError("geometry.geometry is missing or not an object");
  }
  if (Object.keys(capture.geometry.geometry).length === 0) {
    throw new TransformError("geometry.geometry is empty - no regions to render");
  }

  const ownership = capture.features?.regionOwnership ?? {};

  // Pax region keys are sometimes integer strings ("3", "83") and sometimes
  // UUIDs ("f2a26fbd-..."). The hub schema requires the override key suffix
  // to be \d+ (regex `^[A-Z]{2,4}\.\d+_1$`), so enumerate geometry once and
  // map each Pax key to a stable integer index (insertion order). This
  // single shared index is used by both buildRegionsFeatureCollection
  // (feature id suffix) and the override map below (key suffix) so the two
  // counters agree on the integer <n> for the same Pax region. Without this
  // shared counter, water regions would cause the feature-id and override-key
  // suffixes to diverge, silently breaking the importer's owner-color lookup.
  const regionIndex: Record<string, number> = {};
  {
    let i = 0;
    for (const key of Object.keys(capture.geometry.geometry)) {
      regionIndex[key] = i++;
    }
  }

  const regionsFC = buildRegionsFeatureCollection(
    capture.geometry.geometry,
    ownership,
    regionIndex,
  );
  const citiesFC = buildCitiesFeatureCollection(capture.features?.cities ?? []);
  const colors = buildColors(capture.features?.polities ?? []);

  const overrides: Record<string, string> = {};
  for (const [paxKey, polityName] of Object.entries(ownership)) {
    // Defense-in-depth: skip water regions even if Pax's regionOwnership
    // somehow carries an entry for them (would otherwise mint a synthetic
    // Z## owner for a tile that has no real owner).
    const regionType = capture.geometry.geometry[paxKey]?.type;
    if (regionType === "Ocean" || regionType === "Strait") continue;
    const canonical = canonicalize(polityName);
    const idx = regionIndex[paxKey];
    if (idx === undefined) continue; // ownership references a region with no geometry - skip
    overrides[`${canonical.code}.${idx}_1`] = canonical.code;
  }

  const polities = capture.features?.polities ?? [];

  // polityOverrides = Record<code, PolityOverride>: full oracle shape.
  // For TABLE-matched polities, color comes from the Pax capture. For synthetic
  // Z## codes (no Pax polity to read from), use the deterministic fallback.
  const polityByCode = new Map<string, PaxPolity>();
  for (const p of polities) {
    const code = canonicalize(p.name).code;
    if (!polityByCode.has(code)) polityByCode.set(code, p);
  }
  const polityOverrides: Record<
    string,
    { code: string; name: string; aliases: string[]; color: string; note: string }
  > = {};
  for (const [code, p] of polityByCode) {
    polityOverrides[code] = {
      code,
      name: p.name,
      aliases: [],
      color: p.color ?? fallbackColor(code),
      note: "",
    };
  }
  // Ensure any owner present in overrides but without a Pax polity entry
  // (e.g. regions owned by a non-Pax-listed name) still gets a polityOverrides
  // entry, with a synthetic fallback color.
  for (const code of new Set(Object.values(overrides))) {
    if (!(code in polityOverrides)) {
      polityOverrides[code] = {
        code,
        name: code,
        aliases: [],
        color: fallbackColor(code),
        note: "",
      };
    }
  }

  const scenario = deriveScenario(capture.preset, polities);
  const worldExtras = deriveWorldExtras(polities, capture.editor);

  const game = deriveGame(capture.features?.polities ?? [], capture.preset, capture.editor);
  const prompts = derivePrompts(capture.editor);

  const bundle: ScenarioBundle = {
    schema: "pax-historia-scenario-bundle",
    version: 1,
    mode: opts.mode === "light" ? "light" : "full",
    exportedAt: new Date().toISOString(),
    scenario,
    data: {
      actions: [],
      advisor: [],
      chat: [],
      events: {},
      game,
      prompts,
      world: {
        customRegions: true,
        customCities: true,
        regionOwnershipOverrides: overrides,
        polityOverrides,
        ...worldExtras,
      },
    },
  };

  const coverBytes = capture.cover;
  const coverName = capture.coverName ?? "cover.png";
  const coverContentType = deriveContentType(coverName);

  // Basemap FeatureCollection -- emitted only when editor capture supplied
  // the underlying map geometry. Feature IDs use the BASEMAP_<n> namespace
  // so they don't collide with post-game <CODE>.<n>_1 IDs in regionsGeojson.
  // No `owner` property -- the basemap is ownerless (it's the layer UNDER the regions).
  const basemapGeometry = capture.editor?.basemapGeometry;
  let basemapFC: FeatureCollection | null = null;
  if (basemapGeometry && Object.keys(basemapGeometry).length > 0) {
    const features: Feature[] = [];
    let idx = 0;
    for (const [key, region] of Object.entries(basemapGeometry)) {
      const r = region as PaxRegion;
      const polygon = parseRegionGeometry(r.geometry, key);
      const centroid = parseRegionCentroid(r.centroid);
      features.push({
        type: "Feature",
        geometry: polygon,
        properties: {
          id: `BASEMAP_${idx}`,
          typeId: r.type.toLowerCase(),
          ...(centroid ? { centroid: centroid.coordinates } : {}),
        },
      });
      idx++;
    }
    basemapFC = { type: "FeatureCollection", features };
  }

  const assets: BundleAssets = {
    cover: coverBytes
      ? {
          mode: "embedded",
          fileName: coverName,
          contentType: coverContentType,
          encoding: "base64",
          data: Buffer.from(coverBytes).toString("base64"),
        }
      : { mode: "default", fileName: coverName },
    colors: {
      mode: "embedded",
      fileName: "colors.json",
      data: colors,
    },
    regionsGeojson: {
      mode: "embedded",
      fileName: "regions.geojson",
      encoding: "base64",
      contentType: "application/geo+json",
      data: Buffer.from(JSON.stringify(regionsFC), "utf8").toString("base64"),
    },
    citiesGeojson: {
      mode: "embedded",
      fileName: "cities.geojson",
      encoding: "base64",
      contentType: "application/geo+json",
      data: Buffer.from(JSON.stringify(citiesFC), "utf8").toString("base64"),
    },
    cities: { mode: "default", fileName: "cities.pmtiles", droppedOverride: false },
    countries: { mode: "default", fileName: "countries.pmtiles", droppedOverride: false },
    regions: { mode: "default", fileName: "regions.pmtiles", droppedOverride: false },
    ...(basemapFC
      ? {
          backgroundData: {
            mode: "embedded" as const,
            fileName: "basemap.geojson" as const,
            encoding: "base64" as const,
            contentType: "application/geo+json" as const,
            data: Buffer.from(JSON.stringify(basemapFC), "utf8").toString("base64"),
          },
        }
      : {}),
  };

  return { bundle, assets };
}