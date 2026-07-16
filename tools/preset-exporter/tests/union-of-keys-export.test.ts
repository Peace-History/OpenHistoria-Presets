import { describe, it, expect } from "bun:test";
import { unionOfKeysAt } from "../src/conformance";
import { setHubUnionAssetKeys, isHubUnionAssetKey } from "../src/verify";
import type { HubBundle } from "../src/conformance";

describe("unionOfKeysAt export contract", () => {
  it("is exported from src/conformance and round-trips through setHubUnionAssetKeys / isHubUnionAssetKey", () => {
    const hubBundles: HubBundle[] = [
      { name: "a.json", data: { assets: { cover: {}, colors: {}, regionsGeojson: {} } } },
      { name: "b.json", data: { assets: { cover: {}, flags: {}, cities: {} } } },
    ];

    const union = unionOfKeysAt(hubBundles, ["assets"]);
    setHubUnionAssetKeys(union);

    for (const k of union) {
      expect(isHubUnionAssetKey(k)).toBe(true);
    }
    for (const k of ["backgroundData", "nonsense"]) {
      expect(isHubUnionAssetKey(k)).toBe(false);
    }
  });
});