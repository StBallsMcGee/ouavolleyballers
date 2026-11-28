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

describe("FLEX slot", () => {
  it("takes an outside hitter or a middle, nobody else", async () => {
    const { isEligibleForSlot: ok, startingSlots: slots, rosterSettingsSchema } = await import("./settings");
    expect(ok(["OH"], "FLEX")).toBe(true);
    expect(ok(["M"], "FLEX2")).toBe(true);
    expect(ok(["S"], "FLEX")).toBe(false);
    expect(ok(["L"], "FLEX")).toBe(false);
    const r = rosterSettingsSchema.parse({ S: 1, OH: 2, M: 2, L: 1, UTIL: 0, FLEX: 1, TOTAL: 10 });
    expect(slots(r)).toEqual(["S", "OH1", "OH2", "M1", "M2", "FLEX", "L"]);
    // Leagues saved before FLEX existed have none.
    expect(rosterSettingsSchema.parse({ S: 1, OH: 3, M: 2, L: 1, UTIL: 1, TOTAL: 11 }).FLEX).toBe(0);
  });
});
