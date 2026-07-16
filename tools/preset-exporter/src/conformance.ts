// conformance.ts - Pure diff: compare an exported bundle's shape against a set
// of hub-canonical bundles. Used by scripts/check-hub-conformance.ts,
// scripts/export-and-check.ts, and by tests/hub-conformance.test.ts. No I/O,
// no subprocess - the diff logic is pure; loadHubBundles is the only I/O
// helper and exists so callers don't need to write their own JSON loader.
//
// Canonical reference: the 6 bundles under
// /home/john/Projects/Open-historia-scenarios/bundles/*.json
// (release-mirrored, importer-validated). Schema drift is detected via the
// union-of-keys approach: any new key appearing in any hub bundle becomes
// part of the expected set; the exporter must include it.

export type HubBundle = {
  /** Bundle file basename for reporting. */
  name: string;
  /** Parsed JSON. */
  data: Record<string, unknown>;
};

export type CheckResult = {
  check: string;
  pass: boolean;
  detail: string;
};

export type DiffReport = {
  pass: boolean;
  hubBundleCount: number;
  hubBundles: string[];
  results: CheckResult[];
};

function keySet(value: unknown): Set<string> {
  return new Set(value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : []);
}

function sortedKeys(value: unknown): string[] {
  return [...keySet(value)].sort();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const k of small) if (!big.has(k)) return false;
  return true;
}

/** Read every `*.json` file in `dir` as a HubBundle, sorted by filename.
 *  Returns an empty array if `dir` is missing or empty (caller decides how
 *  to handle the empty case). */
export async function loadHubBundles(dir: string): Promise<HubBundle[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: HubBundle[] = [];
  for (const name of entries.filter((f) => f.endsWith(".json")).sort()) {
    const path = join(dir, name);
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      out.push({ name, data });
    } catch {
      // Skip malformed bundles rather than failing the whole run.
    }
  }
  return out;
}

/** Union of keys at `bundle.data.<path>` across all hub bundles (after descending one level via `parts`). */
export function unionOfKeysAt(bundles: HubBundle[], parts: string[]): Set<string> {
  const acc = new Set<string>();
  for (const { data } of bundles) {
    let cursor: unknown = data;
    for (const part of parts) {
      cursor = asObject(cursor)[part];
    }
    for (const k of keySet(cursor)) acc.add(k);
  }
  return acc;
}

export function diffAgainstHubBundles(bundle: Record<string, unknown>, hubBundles: HubBundle[]): DiffReport {
  const results: CheckResult[] = [];
  const dataObj = asObject(bundle.data);

  const hubNames = hubBundles.map((b) => b.name).sort();

  // 1. Top-level keys must be a subset of the hub union.
  const topUnion = unionOfKeysAt(hubBundles, []);
  const topKeys = keySet(bundle);
  results.push({
    check: "top-level keys subset of hub union",
    pass: isSubset(topKeys, topUnion),
    detail: topKeys.size === 0 ? "export has no top-level keys" : `export=${[...topKeys].sort().join(",")}; hub union=${[...topUnion].sort().join(",")}`,
  });

  // 2. data.* keys must equal the hub union (exporter MUST carry all 7).
  const dataUnion = unionOfKeysAt(hubBundles, ["data"]);
  const dataKeys = keySet(dataObj);
  const missingDataKeys = [...dataUnion].filter((k) => !dataKeys.has(k)).sort();
  const extraDataKeys = [...dataKeys].filter((k) => !dataUnion.has(k)).sort();
  results.push({
    check: "data.* keys = hub union",
    pass: missingDataKeys.length === 0 && extraDataKeys.length === 0,
    detail:
      missingDataKeys.length > 0
        ? `export missing data keys: ${missingDataKeys.join(",")}`
        : extraDataKeys.length > 0
          ? `export has non-canonical data keys: ${extraDataKeys.join(",")}`
          : `${dataKeys.size} keys match`,
  });

  // 3. data.prompts keys subset.
  const promptsUnion = unionOfKeysAt(hubBundles, ["data", "prompts"]);
  const promptsKeys = keySet(dataObj.prompts);
  results.push({
    check: "data.prompts keys subset of hub union",
    pass: isSubset(promptsKeys, promptsUnion),
    detail: promptsKeys.size === 0 ? "no prompts" : `export=${sortedKeys(dataObj.prompts).join(",")}; hub union=${[...promptsUnion].sort().join(",")}`,
  });

  // 4. data.world keys = hub union.
  const worldUnion = unionOfKeysAt(hubBundles, ["data", "world"]);
  const worldKeys = keySet(dataObj.world);
  const missingWorld = [...worldUnion].filter((k) => !worldKeys.has(k)).sort();
  const extraWorld = [...worldKeys].filter((k) => !worldUnion.has(k)).sort();
  results.push({
    check: "data.world keys = hub union",
    pass: missingWorld.length === 0 && extraWorld.length === 0,
    detail:
      missingWorld.length > 0
        ? `export missing world keys: ${missingWorld.join(",")}`
        : extraWorld.length > 0
          ? `export has non-canonical world keys: ${extraWorld.join(",")}`
          : `${worldKeys.size} keys match`,
  });

  // 5. data.game keys = hub union.
  const gameUnion = unionOfKeysAt(hubBundles, ["data", "game"]);
  const gameKeys = keySet(dataObj.game);
  const missingGame = [...gameUnion].filter((k) => !gameKeys.has(k)).sort();
  const extraGame = [...gameKeys].filter((k) => !gameUnion.has(k)).sort();
  results.push({
    check: "data.game keys = hub union",
    pass: missingGame.length === 0 && extraGame.length === 0,
    detail:
      missingGame.length > 0
        ? `export missing game keys: ${missingGame.join(",")}`
        : extraGame.length > 0
          ? `export has non-canonical game keys: ${extraGame.join(",")}`
          : `${gameKeys.size} keys match`,
  });

  // 6. scenario keys subset (some hubs omit optional ones).
  const scenarioUnion = unionOfKeysAt(hubBundles, ["scenario"]);
  const scenarioKeys = keySet(bundle.scenario);
  results.push({
    check: "scenario keys subset of hub union",
    pass: isSubset(scenarioKeys, scenarioUnion),
    detail: `export=${sortedKeys(bundle.scenario).join(",")}; hub union=${[...scenarioUnion].sort().join(",")}`,
  });

  // 7. assets keys subset.
  const assetsUnion = unionOfKeysAt(hubBundles, ["assets"]);
  const assetsKeys = keySet(bundle.assets);
  results.push({
    check: "assets keys subset of hub union",
    pass: isSubset(assetsKeys, assetsUnion),
    detail: `export=${sortedKeys(bundle.assets).join(",")}; hub union=${[...assetsUnion].sort().join(",")}`,
  });

  // 8. region ownership key format: <code>.<n>_<v> with code ∈ [A-Z]{2,4} or Z\d{2}.
  const overrides = asObject(asObject(dataObj.world).regionOwnershipOverrides);
  const regionKeys = Object.keys(overrides);
  const badRegionKey = regionKeys.find((k) => !/^([A-Z]{2,4}|Z\d{2})\.\d+_1$/.test(k));
  const sampleKey = regionKeys[0] ?? "(none)";
  results.push({
    check: "data.world.regionOwnershipOverrides keys match <code>.<n>_1",
    pass: regionKeys.length === 0 ? true : badRegionKey === undefined,
    detail:
      regionKeys.length === 0
        ? "no region overrides"
        : badRegionKey !== undefined
          ? `bad key: ${badRegionKey} (sample ok: ${sampleKey})`
          : `${regionKeys.length} keys (sample: ${sampleKey})`,
  });

  // 9. assets.regionsGeojson.contentType
  const assetsObj = asObject(bundle.assets);
  const regionsGeo = asObject(assetsObj.regionsGeojson);
  const citiesGeo = asObject(assetsObj.citiesGeojson);
  const ctRegions = regionsGeo.contentType;
  const ctCities = citiesGeo.contentType;
  results.push({
    check: "assets.*Geojson contentType = application/geo+json",
    pass: ctRegions === "application/geo+json" && ctCities === "application/geo+json",
    detail: `regions=${String(ctRegions)}; cities=${String(ctCities)}`,
  });

  // 10. polityOverrides entry shape = { code, name, aliases, color, note }.
  const polityOverrides = asObject(asObject(dataObj.world).polityOverrides);
  const polityEntryKeys = ["code", "name", "aliases", "color", "note"];
  const polityEntries = Object.entries(polityOverrides);
  const badPolityEntry = polityEntries.find(([, v]) => {
    const o = asObject(v);
    return !polityEntryKeys.every((k) => k in o);
  });
  results.push({
    check: "data.world.polityOverrides entries have {code, name, aliases, color, note}",
    pass: badPolityEntry === undefined,
    detail:
      polityEntries.length === 0
        ? "no polity overrides"
        : badPolityEntry !== undefined
          ? `bad entry: ${badPolityEntry[0]}`
          : `${polityEntries.length} entries ok`,
  });

  // 11. data.world.customRegions and customCities = true (when world exists).
  const customRegions = asObject(dataObj.world).customRegions;
  const customCities = asObject(dataObj.world).customCities;
  results.push({
    check: "data.world.customRegions + customCities = true",
    pass: customRegions === true && customCities === true,
    detail: `customRegions=${String(customRegions)}; customCities=${String(customCities)}`,
  });

  // 12. data.game.round = 1 (number).
  const gameObj = asObject(dataObj.game);
  results.push({
    check: "data.game.round = 1 (number)",
    pass: gameObj.round === 1 && typeof gameObj.round === "number",
    detail: `round=${JSON.stringify(gameObj.round)} (${typeof gameObj.round})`,
  });

  const allPass = results.every((r) => r.pass);
  return { pass: allPass, hubBundleCount: hubBundles.length, hubBundles: hubNames, results };
}