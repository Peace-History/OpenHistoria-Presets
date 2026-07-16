import { describe, it, expect } from "bun:test";
import {
  canonicalize,
  reverseLookup,
  tableSize,
  syntheticCode,
  usedCodes,
} from "../src/canonicalize";

describe("canonicalize", () => {
  it("returns a known ISO code for a mapped polity name", () => {
    const result = canonicalize("Kingdom of Greece");
    expect(result.code).toBe("GRC");
    expect(result.name).toBe("Kingdom of Greece");
  });

  it("maps United States to USA", () => {
    const result = canonicalize("United States");
    expect(result.code).toBe("USA");
    expect(result.name).toBe("United States");
  });

  it("returns a synthetic Z## code for unknown names (replaces passthrough)", () => {
    const result = canonicalize("Atlantis");
    expect(result.code).toMatch(/^Z\d{2}$/);
    expect(result.name).toBe("Atlantis");
  });

  it("reverseLookup returns the display name for a known code", () => {
    expect(reverseLookup("GRC")).toBe("Kingdom of Greece");
    expect(reverseLookup("USA")).toBe("United States");
  });

  it("reverseLookup returns the input code for unknown codes", () => {
    expect(reverseLookup("XYZ")).toBe("XYZ");
  });

  it("table has at least 30 entries", () => {
    expect(tableSize()).toBeGreaterThanOrEqual(30);
  });

  it("never throws on any input", () => {
    expect(() => canonicalize("")).not.toThrow();
    expect(() => canonicalize("Some Very Long Polity Name With Many Words 1234")).not.toThrow();
  });
});

describe("syntheticCode", () => {
  it("returns a Z## code not in usedCodes", () => {
    const code = syntheticCode("Habsburg Monarchy", new Set(["USA", "FRA"]));
    expect(code).toMatch(/^Z\d{2}$/);
    expect(code === "USA" || code === "FRA").toBe(false);
  });

  it("is deterministic for the same name (seeded hash)", () => {
    const a = syntheticCode("Habsburg Monarchy", new Set());
    const b = syntheticCode("Habsburg Monarchy", new Set());
    expect(a).toBe(b);
  });

  it("collision avoidance: skips already-used Z## codes", () => {
    const code = syntheticCode("Atlantis", new Set(["Z01", "Z02"]));
    expect(code).toMatch(/^Z\d{2}$/);
    expect(["Z01", "Z02"]).not.toContain(code);
  });

  it("collision avoidance against full oracle set: skips TABLE codes AND oracle Z01-Z09", () => {
    const used = usedCodes();
    for (const z of ["Z01", "Z02", "Z03", "Z04", "Z05", "Z06", "Z07", "Z08", "Z09"]) {
      used.add(z);
    }
    const code = syntheticCode("Atlantis", used);
    expect(code).toMatch(/^Z\d{2}$/);
    expect(used.has(code)).toBe(false);
  });
});