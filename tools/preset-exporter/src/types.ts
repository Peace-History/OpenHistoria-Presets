// Pax capture shape, mirrored from tools/pax-ripper/src/types.ts but narrowed
// to what the transformer consumes. We do NOT import pax-ripper's types directly
// because the vendored ripper is a sibling package and its types pull in
// playwright/browser globals that this module never touches.

export interface PaxPreset {
  id: string;
  publishedVersionID: string;
  title: string;
  description: string;
  landingImageURL?: string;
  coverImageURL?: string;
  authorUID?: string;
  tags?: string[];
  roundsPlayed?: number;
  gamesStarted?: number;
  slug?: string;
  extras?: Record<string, unknown>;
}

export interface PaxRegion {
  geometry: string;
  centroid: string;
  adjacencies: string[];
  type: string;
}

export interface PaxGeometry {
  name?: string;
  geometry: Record<string, PaxRegion>;
  community?: boolean | unknown;
  tags?: string[];
}

export interface PaxCity {
  id: string;
  name: string;
  location: [number, number];
  scale?: number;
}

export interface PaxPolity {
  id: string;
  name: string;
  color: string;
}

export interface PaxFeatures {
  polities: PaxPolity[];
  cities: PaxCity[];
  landmarks?: unknown[];
  battalions?: unknown[];
  regionOwnership: Record<string, string>;
  capturedAt?: string;
}

export interface PaxEditor {
  /** Pax stores each prompt as either a raw string or an object whose
   *  `firstStage.template` carries the actual text. We accept both shapes. */
  aiPrompts?: Record<
    string,
    string | { firstStage?: { template?: string }; templateHelpers?: Record<string, string> }
  >;
  /** Source for `world.simulationRules`. Verified present on the
   *  undXAyQbz7OwIXfIZLXL capture (Pax editor exposes
   *  `editor.advancedSettings.rulesText`). */
  advancedSettings?: {
    rulesText?: string;
    consolidationSettings?: unknown;
    raw?: Record<string, unknown>;
  } & Record<string, unknown>;
  /** Optional nested template-helpers that map onto `data.prompts.helpers`
   *  (oracle carries them as `helpers.ALL_ADVISOR_MESSAGES` etc.). */
  templateHelpers?: Record<string, string>;
  /** Optional nested template-tasks that map onto `data.prompts.tasks`. */
  templateTasks?: Record<string, string>;
  extras?: { initialPresetData?: { mapGeometryDocumentID?: string; startDate?: string } } & Record<string, unknown>;
}

export interface PaxCapture {
  preset: PaxPreset;
  geometry: PaxGeometry;
  features: PaxFeatures;
  editor?: PaxEditor;
  cover?: Uint8Array;
  coverName?: string;
}

export interface BundleAssets {
  cover:
    | { mode: "embedded"; fileName: string; contentType: string; encoding: "base64"; data: string }
    | { mode: "default"; fileName: string };
  colors: {
    mode: "embedded";
    fileName: string;
    data: Record<string, [number, number, number]>;
  };
  regionsGeojson:
    | {
        mode: "embedded";
        fileName: string;
        encoding: "base64";
        contentType: "application/geo+json";
        data: string;
      }
    | { mode: "default"; fileName: string };
  citiesGeojson:
    | {
        mode: "embedded";
        fileName: string;
        encoding: "base64";
        contentType: "application/geo+json";
        data: string;
      }
    | { mode: "default"; fileName: string };
  cities: { mode: "embedded" | "default"; fileName: string; droppedOverride: boolean };
  countries: { mode: "embedded" | "default"; fileName: string; droppedOverride: boolean };
  regions: { mode: "embedded" | "default"; fileName: string; droppedOverride: boolean };
}

/** Oracle-shape world block (see `example.json` `data.world`). */
export interface PolityOverride {
  code: string;
  name: string;
  aliases: string[];
  color: string;
  note: string;
}

export interface WorldExtras {
  customRegions: boolean;
  customCities: boolean;
  regionOwnershipOverrides: Record<string, string>;
  polityOverrides?: Record<string, PolityOverride>;
  /** Sorted unique owner codes: TABLE values + Z01-Z09 + export-used codes. */
  ownerCodes?: string[];
  /** The six universal types (see example.json world.allowedUnitTypes). */
  allowedUnitTypes?: string[];
  /** Source: editor.advancedSettings.rulesText. */
  simulationRules?: string;
  startingTimelineText?: string;
}

export interface ScenarioBundle {
  schema: "pax-historia-scenario-bundle";
  version: 1;
  mode: "light" | "full";
  exportedAt: string;
  scenario: {
    id: string;
    name: string;
    description: string;
    eyebrow?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    subtitle?: string;
    accentColor?: string;
    countryNameOverrides?: Record<string, string>;
  };
  data: {
    actions: unknown[];
    advisor: unknown[];
    chat: unknown[];
    events: Record<string, unknown>;
    /** Exactly the 5 oracle keys: country, startDate, gameDate, difficulty, language. */
    game: Record<string, unknown>;
    /** Flat string roles (advisor, leader, actions, ...) + nested role maps
     *  for `helpers` and `tasks`. */
    prompts: Record<string, string | Record<string, string>>;
    world: WorldExtras;
  };
}

export interface TransformResult {
  bundle: ScenarioBundle;
  assets: BundleAssets;
}

export class TransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransformError";
  }
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}