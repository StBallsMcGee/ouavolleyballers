import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isEligibleForSlot, parsePositions, parseSettings, startingSlots } from "./settings";

describe("league settings", () => {
  it("generates the VolleyBALLERs starting slots", () => {
    expect(startingSlots(DEFAULT_SETTINGS.roster)).toEqual(["S", "OH1", "OH2", "OH3", "M1", "M2", "L", "UTIL"]);
  });
  it("fills missing sections from defaults and rejects impossible rosters", () => {
    expect(parseSettings({ roster: { TOTAL: 12 } }).roster.TOTAL).toBe(12);
    expect(() => parseSettings({ roster: { TOTAL: 3 } })).toThrow();
  });
  it("parses multi-position labels", () => {
    expect(parsePositions("OH/L")).toEqual(["OH", "L"]);
    expect(parsePositions(null)).toEqual([]);
    expect(parsePositions("UTIL")).toEqual([]);
  });
  it("applies slot eligibility", () => {
    expect(isEligibleForSlot(["OH", "L"], "L")).toBe(true);
    expect(isEligibleForSlot(["OH"], "M2")).toBe(false);
    expect(isEligibleForSlot(["M"], "UTIL")).toBe(true);
    expect(isEligibleForSlot([], "BENCH")).toBe(true);
  });
});
