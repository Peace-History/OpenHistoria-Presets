// verify.ts - Pure value/type checks for Open-Historia scenario bundles.
//
// Complements `diffAgainstHubBundles` (which checks keysets against the 6 hub
// bundles under /home/john/Projects/Open-historia-scenarios/bundles/) with the
// field-level constraints the Open-Historia importer relies on:
//   - regexes on IDs / codes
//   - hex color shape
//   - asset contentType whitelists
//   - base64 decodability for embedded payloads
//   - color/owner-codes consistency
//   - allowedUnitTypes literal
//
// All checks are pure: input is a parsed JSON object, output is a CheckResult[]
// in the same shape as diffAgainstHubBundles results. No I/O, no subprocess.

import type { CheckResult } from "./conformance";

/** Asset keys accepted by the Open-Historia importer (`UPLOADABLE_SCENARIO_ASSET_KEYS`).
 *  Mirrors open-historia/src/runtime/web/models.js:26-31 - keep in sync if the
 *  importer allow-list ever grows. */
export const HUB_ACCEPTED_ASSET_KEYS = new Set<string>([
  "cover",
  "colors",
  "flags",
  "cities",
  "countries",
  "regions",
  "regionsGeojson",
  "citiesGeojson",
  "backgroundData",
]);

/** Image content types accepted for `assets.cover`. Mirrors
 *  open-historia/src/runtime/web/models.js:45-47 SUPPORTED_IMAGE_CONTENT_TYPES. */
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set<string>([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** The exact allowedUnitTypes list baked into transform.ts. */
const ALLOWED_UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"] as const;

/** Bundle ID regex - same as dump-all.ts:53. */
const UID_RE = /^[A-Za-z0-9]{16,}$/;

/** Pax code regex - same as conformance.ts:181. */
const CODE_RE = /^([A-Z]{2,4}|Z\d{2})$/;

/** Hex color regex - `#rrggbb`. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isoWithinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - days * 86_400_000;
  return t >= cutoff;
}

function isBase64(v: string): boolean {
  // Length-only fast check; full decode of 15MB covers is too expensive here.
  // Bun's Buffer.from with "base64" silently strips invalid chars; check that
  // the cleaned length is a multiple of 4 (with padding) and the re-encode
  // round-trips. This rejects obvious garbage without materialising the buffer.
  if (v.length === 0) return false;
  if (v.length % 4 !== 0) return false;
  try {
    return Buffer.from(v, "base64").toString("base64").replace(/=+$/, "") === v.replace(/=+$/, "");
  } catch {
    return false;
  }
}

function rgbTupleOk(v: unknown): boolean {
  if (!Array.isArray(v) || v.length !== 3) return false;
  return v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255);
}

/** Run all 19 value/type checks against a parsed bundle. Returns results in
 *  stable order. Soft failures (extra asset keys inside the importer allow-list)
 *  are surfaced as `pass: true` with a detail suffix that downstream code can
 *  render as a WARN. */
export function valueTypeChecks(bundle: Record<string, unknown>): CheckResult[] {
  const r: CheckResult[] = [];

  r.push({
    check: "schema = pax-historia-scenario-bundle",
    pass: bundle.schema === "pax-historia-scenario-bundle",
    detail: `schema=${JSON.stringify(bundle.schema)}`,
  });

  r.push({
    check: "version = 1 (number)",
    pass: bundle.version === 1 && typeof bundle.version === "number",
    detail: `version=${JSON.stringify(bundle.version)} (${typeof bundle.version})`,
  });

  const mode = bundle.mode;
  r.push({
    check: "mode in {light, full}",
    pass: mode === "light" || mode === "full",
    detail: `mode=${JSON.stringify(mode)}`,
  });

  const exportedAt = bundle.exportedAt;
  r.push({
    check: "exportedAt parseable ISO date within 90 days",
    pass: isString(exportedAt) && isoWithinDays(exportedAt, 90),
    detail: `exportedAt=${JSON.stringify(exportedAt)}`,
  });

  const scenario = asObject(bundle.scenario);
  r.push({
    check: "scenario.id matches base62 UID regex",
    pass: isString(scenario.id) && UID_RE.test(scenario.id),
    detail: `scenario.id=${JSON.stringify(scenario.id)}`,
  });

  r.push({
    check: "scenario.accentColor (if present) is #rrggbb hex",
    pass: scenario.accentColor === undefined || (isString(scenario.accentColor) && HEX_COLOR_RE.test(scenario.accentColor)),
    detail: `scenario.accentColor=${JSON.stringify(scenario.accentColor)}`,
  });

  const overrides = scenario.countryNameOverrides;
  r.push({
    check: "scenario.countryNameOverrides values are strings",
    pass:
      overrides == null ||
      (typeof overrides === "object" &&
        Object.values(overrides as Record<string, unknown>).every(isString)),
    detail: overrides == null ? "absent" : `${Object.keys(overrides as object).length} entries`,
  });

  const data = asObject(bundle.data);
  const game = asObject(data.game);
  r.push({
    check: "data.game.country matches code regex",
    pass: isString(game.country) && CODE_RE.test(game.country),
    detail: `country=${JSON.stringify(game.country)}`,
  });

  const world = asObject(data.world);
  const regionOwnership = asObject(world.regionOwnershipOverrides);
  const badRegionValue = Object.entries(regionOwnership).find(([, v]) => !isString(v) || !CODE_RE.test(v));
  r.push({
    check: "data.world.regionOwnershipOverrides values match code regex",
    pass: badRegionValue === undefined,
    detail: badRegionValue ? `bad value: ${badRegionValue[0]}=${JSON.stringify(badRegionValue[1])}` : `${Object.keys(regionOwnership).length} ok`,
  });

  const polityOverrides = asObject(world.polityOverrides);
  const badPolityCode = Object.values(polityOverrides).find((v) => {
    const o = asObject(v);
    return !isString(o.code) || !CODE_RE.test(o.code);
  });
  r.push({
    check: "data.world.polityOverrides[*].code matches code regex",
    pass: badPolityCode === undefined,
    detail: badPolityCode ? `bad code in entry` : `${Object.keys(polityOverrides).length} ok`,
  });

  const badPolityColor = Object.entries(polityOverrides).find(([, v]) => {
    const o = asObject(v);
    return !isString(o.color) || !HEX_COLOR_RE.test(o.color);
  });
  r.push({
    check: "data.world.polityOverrides[*].color is #rrggbb hex",
    pass: badPolityColor === undefined,
    detail: badPolityColor ? `bad color on ${badPolityColor[0]}` : `${Object.keys(polityOverrides).length} ok`,
  });

  const ownerCodes = Array.isArray(world.ownerCodes) ? world.ownerCodes : [];
  const badOwnerCode = ownerCodes.find((c) => !isString(c) || !CODE_RE.test(c));
  r.push({
    check: "data.world.ownerCodes entries match code regex",
    pass: badOwnerCode === undefined,
    detail: badOwnerCode ? `bad code: ${JSON.stringify(badOwnerCode)}` : `${ownerCodes.length} ok`,
  });

  const allowedUnitTypes = world.allowedUnitTypes;
  const expected = ALLOWED_UNIT_TYPES;
  const autOk =
    Array.isArray(allowedUnitTypes) &&
    allowedUnitTypes.length === expected.length &&
    expected.every((u, i) => allowedUnitTypes[i] === u);
  r.push({
    check: "data.world.allowedUnitTypes is the canonical list",
    pass: autOk,
    detail: autOk ? "6 types ok" : `got=${JSON.stringify(allowedUnitTypes)}`,
  });

  const assets = asObject(bundle.assets);
  const cover = asObject(assets.cover);
  const coverMode = cover.mode;
  const coverCt = cover.contentType;
  r.push({
    check: "assets.cover.contentType (when embedded) is in image/* allow-list",
    pass:
      coverMode !== "embedded" ||
      (isString(coverCt) && SUPPORTED_IMAGE_CONTENT_TYPES.has(coverCt)),
    detail: `cover.mode=${String(coverMode)}; contentType=${String(coverCt)}`,
  });

  r.push({
    check: "assets.cover.encoding = base64 when cover.mode = embedded",
    pass: coverMode !== "embedded" || cover.encoding === "base64",
    detail: `cover.mode=${String(coverMode)}; encoding=${String(cover.encoding)}`,
  });

  const regionsGeo = asObject(assets.regionsGeojson);
  const citiesGeo = asObject(assets.citiesGeojson);
  const regionsData = regionsGeo.mode === "embedded" ? regionsGeo.data : undefined;
  const citiesData = citiesGeo.mode === "embedded" ? citiesGeo.data : undefined;
  const badRegions = regionsData !== undefined && (!isString(regionsData) || !isBase64(regionsData));
  const badCities = citiesData !== undefined && (!isString(citiesData) || !isBase64(citiesData));
  r.push({
    check: "assets.regionsGeojson + citiesGeojson.data decode as base64 (when embedded)",
    pass: !badRegions && !badCities,
    detail: `regions=${badRegions ? "bad" : "ok"}; cities=${badCities ? "bad" : "ok"}`,
  });

  const colors = asObject(assets.colors);
  const colorsData = asObject(colors.data);
  const badColor = Object.entries(colorsData).find(([, v]) => !rgbTupleOk(v));
  r.push({
    check: "assets.colors.data values are [r,g,b] integer tuples in [0,255]",
    pass: badColor === undefined,
    detail: badColor ? `bad tuple on ${badColor[0]}` : `${Object.keys(colorsData).length} ok`,
  });

  const knownCodes = new Set<string>([
    ...ownerCodes.filter(isString),
    ...Object.keys(polityOverrides),
  ]);
  const unknownColor = Object.keys(colorsData).find((k) => !knownCodes.has(k));
  r.push({
    check: "assets.colors keys are a subset of ownerCodes + polityOverrides",
    pass: unknownColor === undefined,
    detail: unknownColor ? `unknown color key: ${unknownColor}` : `${Object.keys(colorsData).length} ok`,
  });

  // Asset-key allow-list check: extras that are in the importer allow-list
  // (e.g. `backgroundData`) are reported as pass:true with a soft warning
  // detail; extras outside the allow-list fail the check.
  const assetKeyExtras: string[] = [];
  const assetKeySoft: string[] = [];
  for (const k of Object.keys(assets)) {
    if (HUB_ACCEPTED_ASSET_KEYS.has(k)) continue;
    if (isHubUnionAssetKey(k)) continue;
    assetKeyExtras.push(k);
  }
  // soft: hub-accepted-but-not-hub-unioned
  for (const k of Object.keys(assets)) {
    if (HUB_ACCEPTED_ASSET_KEYS.has(k) && !isHubUnionAssetKey(k)) assetKeySoft.push(k);
  }
  r.push({
    check: "assets.* keys are subset of hub union + importer allow-list",
    pass: assetKeyExtras.length === 0,
    detail:
      assetKeyExtras.length > 0
        ? `unknown: ${assetKeyExtras.sort().join(",")}`
        : assetKeySoft.length > 0
          ? `importer-accepted extras: ${assetKeySoft.sort().join(",")}`
          : "all canonical",
  });

  return r;
}

/** True if `key` is in the union of asset keys across the loaded hub bundles.
 *  Populated by `loadOutBundles` via `setHubUnionAssetKeys` - defaults to false
 *  if never set (caller is expected to set it before invoking valueTypeChecks
 *  in the orchestrator path; tests don't need it). */
let hubUnionAssetKeys: Set<string> = new Set();

export function setHubUnionAssetKeys(keys: Iterable<string>): void {
  hubUnionAssetKeys = new Set(keys);
}

export function isHubUnionAssetKey(k: string): boolean {
  return hubUnionAssetKeys.has(k);
}

/** Load every `*.json` directly under `dir`. Skips `*.run_summary.json` sidecars
 *  by default. Returns `[]` if `dir` does not exist. Malformed JSON files are
 *  skipped silently (the orchestrator decides how to surface that - a row is
 *  printed for each successful parse). */
export async function loadOutBundles(
  dir: string,
  opts: { skipSidecars?: boolean } = {},
): Promise<{ name: string; data: Record<string, unknown> }[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const skipSidecars = opts.skipSidecars ?? true;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const name of entries.filter((f) => f.endsWith(".json")).sort()) {
    if (skipSidecars && name.endsWith(".run_summary.json")) continue;
    try {
      const data = JSON.parse(await readFile(`${dir}/${name}`, "utf8")) as Record<string, unknown>;
      out.push({ name, data });
    } catch {
      // skip malformed
    }
  }
  return out;
}
