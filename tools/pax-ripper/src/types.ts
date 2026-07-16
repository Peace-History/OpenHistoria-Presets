// Shared types for pax-ripper.
//
// All on-disk shapes are explicit so the rest of the code can lean on
// static types. __NEXT_DATA__ payloads are not fully typed (Pax's API
// surface is large and partly undocumented) so we type the *fields we
// care about* and pass the rest through as `Record<string, unknown>`.

export type RegionType = 'Coastal' | 'Land' | 'Ocean' | 'Strait';

export interface GeometryRegion {
  /** Stringified GeoJSON Polygon/MultiPolygon */
  geometry: string;
  /** Stringified GeoJSON Point */
  centroid: string;
  adjacencies: string[];
  type: RegionType;
}

export interface GeometryData {
  name: string;
  /** Edit-log array, NOT a tag taxonomy */
  tags: string[];
  community: boolean;
  geometry: Record<string, GeometryRegion>;
}

export interface Polity {
  id: string;
  name: string;
  color?: string;
  leaderName?: string;
  // ...whatever the game state exposes; keep loose.
  [k: string]: unknown;
}

export interface City {
  id: string;
  name: string;
  /** [lat, lng] or [lng, lat] — depends on source; we keep it opaque */
  location: number[];
  ownerPolityId?: string;
  [k: string]: unknown;
}

export interface Landmark {
  id: string;
  name: string;
  type: string;
  location: number[];
  [k: string]: unknown;
}

export interface Battalion {
  id: string;
  ownerPolityId: string;
  location: number[];
  count?: number;
  [k: string]: unknown;
}

export interface MapFeatures {
  polities: Polity[];
  cities: City[];
  landmarks: Landmark[];
  battalions: Battalion[];
  /** regionId (string) -> polityId */
  regionOwnership: Record<string, string>;
  capturedAt: string;
}

export type FeaturesFailureReason =
  | 'no_play_button'
  | 'play_disabled'
  | 'timeout'
  | 'parse_error'
  | 'exception'
  | 'skipped_via_flag'
  /** Editor data was used to derive features.json (replaces Play Now). */
  | 'derived_from_editor'
  /** Editor capture was requested but failed; we fall back to Play Now
   *  unless --no-game is set. */
  | 'editor_failed'
  /** --no-game prevented Play Now from running. */
  | 'no_game_flag';

export interface FeaturesStatus {
  attempted: boolean;
  success: boolean;
  reason?: FeaturesFailureReason;
  durationMs?: number;
  /** For 'exception' — short error message */
  error?: string;
}

export interface PresetData {
  /** 20-char Pax ID from the URL */
  id: string;
  /** Pax's publishedVersionID integer */
  publishedVersionID: number;
  title: string;
  description: string;
  coverImageURL?: string;
  landingImageURL?: string;
  /** Direct CDN URL for the geometry JSON */
  geometryURL?: string;
  authorUID?: string;
  tags: string[];
  roundsPlayed: number;
  gamesStarted: number;
  /** Pax's `slug` (often missing for community presets) */
  slug?: string;
  /** Any extra fields the API returned — kept for forward-compat */
  extras: Record<string, unknown>;
}

export interface CaptureFileSet {
  preset?: string;
  geometry?: string;
  cover?: string;
  landing?: string;
  features?: string;
  editor?: string;
}

export interface CaptureManifest {
  paxID: string;
  version: number;
  sourceURL: string;
  capturedAt: string;
  files: CaptureFileSet;
  featuresStatus: FeaturesStatus;
  /** 'original' when --with-editor scraped the source preset directly,
   *  'copy:<paxID>' when we copied the preset to capture it, undefined
   *  when --with-editor wasn't used. */
  editorSource?: 'original' | `copy:${string}`;
}

export interface RunSummary {
  runAt: string;
  total: number;
  captured: number;
  skipped: number;
  failed: number;
  featuresSucceeded: number;
  featuresFailed: number;
  /** Per-preset error messages (for diagnostics) */
  failures: { paxID: string; reason: string }[];
}

export interface CliArgs {
  presets: boolean;
  geometry: boolean;
  flags: boolean;
  covers: boolean;
  all: boolean;
  presetUid: string | null;
  fromFile: string | null;
  output: string | null;
  force: boolean;
  limit: number | null;
  noFeatures: boolean;
  featuresOnly: boolean;
  withEditor: boolean;
  /** Skip Play Now entirely. When false (default), Play Now still runs as
   *  the fallback path for `--with-editor` failures or when editor is off. */
  noGame: boolean;
  /** When re-running with --force, reuse a previously-recorded copy of the
   *  preset (from a prior manifest's `editorSource`) instead of creating a
   *  fresh one. Default false. */
  reuseCopy: boolean;
  /** Run Play Now AND --with-editor (both captures). Default false. */
  withGame: boolean;
  cookiesFile: string | null;
}

// ---- Editor-view capture types ----
//
// Field names below were reverse-engineered from `tools/pax-ripper/preset_editor.mitm`
// (the 83 MB mitm dump captured during manual editor navigation). The dump's
// Firestore Listen channel exposed the following top-level collections:
//   - promptStore/                   — 345 docs (each = one AI prompt + its config)
//   - templateHelpers/               — 98 distinct helper docs
//   - simpleGames/                   — per-game config (consolidation, mode, …)
//   - userPublicProfiles/            — author profile + stats
//   - simplePresets/{id}             — preset metadata (incl. draft fields)
//   - simplePresets/{id}/versions/{n}              — regionData (name + tags per region)
//   - simplePresets/{id}/versions/{n}/rounds/0     — mapFeatures (cities/landmarks/...)

/** Polity flag metadata (mirrors `countryDescriptions[name].flag` in the wire data). */
export interface PolityFlag {
  id?: string;
  isSensitive?: boolean;
  height?: number;
  width?: number;
  imageURL?: string;
  compressedImageURL?: string;
  iconImageURL?: string;
  /** Zoom-into-flag crop: { zoom, cx, cy }. */
  icon?: { zoom?: number; cx?: number; cy?: number };
  extras: Record<string, unknown>;
}

/** Full Polity metadata from the editor (richer than the player-visible
 * Polity we get from `countryDescriptions` on the game page). */
export interface PolityDefinition {
  /** Polity name (also the mapValue key inside `countryDescriptions`). */
  name: string;
  color?: string;
  additionalNames?: string[];
  tags?: string[];
  regionsOwned?: string[];
  flag?: PolityFlag;
  /** Some polities expose a flag URL via `extras.flagURLFromExtras`
   *  rather than the structured `flag` object. Preserved as a typed
   *  field so callers don't need to drill into `extras`. */
  flagURLFromExtras?: string;
  /** Full record as found — for forward-compat with fields we haven't typed. */
  extras: Record<string, unknown>;
}

/** Map feature geographic location (mirrors `location` in the wire data). */
export interface MapFeatureLocation {
  longitude?: number;
  latitude?: number;
  regionID?: string;
}

/** Full Map Feature definition. Fields verified against the dump for
 *  coordinate-typed features (cities, landmarks). Other types may carry
 *  additional fields — kept in `raw`. */
export interface MapFeatureDefinition {
  /** 8-char Pax feature ID (e.g. "461d85ma"). */
  id: string;
  name?: string;
  description?: string;
  /** "coordinate" | "polygon" | …  (drives whether `location` or `geom` is used) */
  type?: string;
  displaySymbol?: string;
  labelPlacement?: string;
  scale?: number;
  tags?: string[];
  location?: MapFeatureLocation;
  /** Stringified GeoJSON (non-coordinate features only — none seen in this dump
   *  but preserved here for completeness). */
  geom?: string;
  /** The full record as we found it (for forward-compat). */
  raw: Record<string, unknown>;
}

/** Region definition (geographic, not ownership). Mirrors `regionData` from
 *  `simplePresets/{id}/versions/{n}` — sparse: just name + tags. */
export interface RegionDefinition {
  /** Stringified region index ("0", "1", …). */
  index: string;
  name?: string;
  tags?: string[];
  /** Full record as found — for forward-compat with owner/adjacency fields. */
  extras: Record<string, unknown>;
}

/** A single AI prompt stage. Mirrors the `promptConfig` subdoc inside a
 *  `promptStore/{uuid}` document (and the per-prompt entry inside
 *  `simpleGames/{id}/prompts/{name}`). */
export interface AIPromptStage {
  /** Stable identifier (e.g. "chatWithUser", "actions", "gameMaster",
   *  "autoJumpForward", "jumpForward"). */
  promptKey: string;
  /** Whether the prompt is enabled for this preset. */
  enabled?: boolean;
  /** Model identifier (e.g. "claude-…" / "gpt-…"). */
  aiModel?: string;
  /** Which helper is invoked first. */
  firstStage?: string;
  maxThinkingTokens?: number;
  maxOutputTokens?: number;
  /** JSON schema describing the prompt's expected output structure. */
  schema?: Record<string, unknown>;
  /** The actual prompt template body (~11 KB on the wire). */
  template?: string;
  /** UUID back-reference to the promptStore doc (or the originating game). */
  promptSource?: string;
  /** Inline map of helper UUID → TemplateHelper (embedded inside promptConfig). */
  templateHelpers?: Record<string, TemplateHelper>;
  /** Any other per-stage config. */
  extras: Record<string, unknown>;
}

/** A Template Helper — referenced from `promptConfig.templateHelpers`.
 *  Field names verified against `templateHelpers/{uuid}` docs in the dump. */
export interface TemplateHelper {
  /** UUID (the doc id). */
  uid: string;
  /** Human-readable identifier (e.g. "WORLD_BEFORE_ROUND_ONE_TEXT",
   *  "ALL_EVENTS_WITH_CONSOLIDATION"). */
  name: string;
  description?: string;
  tags?: string[];
  functionBody?: string;
  authorUID?: string;
  isPublished?: boolean;
  forkedFromUID?: string;
  forkedFromUpdatedAt?: number;
  /** ms epoch. */
  updatedAt?: number;
  /** Game-data schema version this helper targets. */
  forGameDataVersion?: number;
  extras: Record<string, unknown>;
}

/** Per-game advanced settings. Mirrors `simpleGames/{id}` fields beyond
 *  the `prompts` map. (The editor surfaces these as "Advanced Settings" in
 *  the preset view; they live on the per-game doc rather than the preset doc.) */
export interface AdvancedSettings {
  /** Free-form buckets mirroring the simpleGames doc shape. */
  consolidationSettings?: Record<string, unknown>;
  consolidationChunkSize?: number;
  eventConsolidations?: Record<string, unknown>;
  /** Game-mode identifier. */
  mode?: string;
  thinking?: boolean | string;
  startsOnRound?: number;
  lastRoundCompleted?: number;
  difficulty?: string;
  rulesText?: string;
  advisor?: Record<string, unknown>;
  /** Full simpleGames doc for forward-compat. */
  raw: Record<string, unknown>;
}

/** 24-field map editor state (one entry per tool/setting). */
export type RegionEditorState = Record<string, unknown>;

/** Per-preset version metadata. Mirrors the per-version subdoc inside
 *  `simplePresets/{id}` plus the `simplePresets/{id}/versions/{n}` metadata. */
export interface VersionMetadata {
  versionID?: number;
  isPublished?: boolean;
  isMutating?: boolean;
  banAppeal?: string;
  changeLog?: string;
  /** ISO timestamp or epoch ms, depending on source. */
  createdAt?: string;
  /** ISO timestamp or epoch ms. */
  lastEdited?: string;
  versionName?: string;
  /** Source key the metadata came from (e.g. "versionMetadata", "version"). */
  extras: Record<string, unknown>;
}

/** Author profile + public stats. Mirrors `userPublicProfiles/{uid}`. */
export interface AuthorProfile {
  /** Firebase Auth UID. */
  uid: string;
  displayName?: string;
  photoURL?: string;
  profileDescription?: string;
  region?: string;
  /** ms epoch. */
  createdAt?: string;
  /** ms epoch. */
  lastActive?: string;
  /** Lifetime USD spend on Pax. */
  lifetimeSpendingUSD?: number;
  /** Aggregate gameplay stats. */
  roundsPlayed?: number;
  gamesStarted?: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  nationsDestroyed?: number;
  regionsConquered?: number;
  numberOfClaims?: number;
  publishedFlagsCount?: number;
  favorites?: number;
  /** Map of authored preset UID → display title. */
  authoredPresetTitles?: Record<string, string>;
  /** UIDs of presets the author has featured. */
  featuredPresetUIDs?: string[];
  /** Per-preset selection-frequency counters (uid → count). */
  presetSelectionFrequency?: Record<string, number>;
  /** Per-country selection-frequency counters. */
  countrySelectionFrequency?: Record<string, number>;
  /** True if the user has dismissed the tutorial. */
  turnedOffTutorial?: boolean;
  /** Full record for forward-compat. */
  extras: Record<string, unknown>;
}

/** Basemap tile config (sparse — surface area on the wire is limited). */
export interface BasemapMetadata {
  id: string;
  name?: string;
  tileUrl?: string;
  attribution?: string;
  extras: Record<string, unknown>;
}

/** Top-level shape of `editor.json` (additive to preset.json/features.json).
 *  Slot names mirror the Firestore collection / subdoc structure surfaced by
 *  the dump, so a future reader can map `editor.json` keys → live Firestore
 *  paths 1-to-1. */
export interface EditorData {
  /** Polity list (from `countryDescriptions` plus the editor's enriched view). */
  polities: PolityDefinition[];
  /** "Recommended Polities" / "Picks" — separate from the polity list. */
  recommendedPolities: PolityDefinition[];
  /** All map features (cities/landmarks/battalions/…), keyed by 8-char ID. */
  mapFeatures: MapFeatureDefinition[];
  /** Region definitions (name + tags), keyed by region index string. */
  regionMap: Record<string, RegionDefinition>;
  /** AI prompt stages — keyed by `promptKey` (e.g. "chatWithUser"). */
  aiPrompts: Record<string, AIPromptStage>;
  /** All template helpers (from `templateHelpers/` top-level collection). */
  templateHelpers: TemplateHelper[];
  /** Per-game advanced settings (from `simpleGames/{id}`). */
  advancedSettings?: AdvancedSettings;
  /** Map editor state — 24 fields, one per tool/setting. */
  regionEditorState: RegionEditorState;
  /** Counts of regions by `RegionType` ("Coastal" | "Land" | "Ocean" | "Strait"). */
  regionCountsByType: Record<string, number>;
  versionMetadata?: VersionMetadata;
  basemapMetadata?: BasemapMetadata;
  authorProfile?: AuthorProfile;
  /** Raw `promptStore/{uuid}` docs keyed by UUID (for offline iteration). */
  promptStoreRaw?: Record<string, Record<string, unknown>>;
  /** Raw `simpleGames/{id}` doc (full, for offline iteration). */
  simpleGameRaw?: Record<string, unknown>;
  /** Anything else the editor exposed that didn't fit a typed slot. */
  extras: Record<string, unknown>;
  /** Display symbols scraped from editor DOM (map feature ID → symbol name). */
  displaySymbols?: Record<string, string>;
  /** Flag URLs scraped from editor DOM (polity name → flag URL). */
  flagURLs?: Record<string, string>;
  /** Polity images scraped from editor DOM (polity name → image URL). */
  polityImages?: Record<string, string>;
}

export type EditorFailureReason =
  | 'auth_invalid'
  | 'auth_invalid_even_with_cookies'
  | 'still_loading'
  | 'not_owner'
  | 'parse_error'
  | 'timeout'
  | 'exception'
  /** The user isn't the author AND we couldn't create a copy
   *  (Copy button missing / disabled / popup never appeared). */
  | 'copy_blocked';

export interface EditorCaptureStatus {
  attempted: boolean;
  captured: boolean;
  reason?: EditorFailureReason;
  error?: string;
  durationMs: number;
  submenusClicked: number;
  /** When auth_failed and we tried to inject cookies from --cookies path */
  cookiesInjected?: boolean;
  /** URL we ended on when capture succeeded/aborted */
  finalUrl?: string;
  /** The Pax ID we actually scraped (== originalPaxID for owners, copy
   *  Pax ID otherwise). Always set on success. */
  sourcePreset?: string;
  /** The Pax ID the user requested. Set by `ensureCopyOfPreset`. */
  originalPreset?: string;
  /** The version the user requested. Set by `ensureCopyOfPreset`. */
  originalVersion?: number;
}
