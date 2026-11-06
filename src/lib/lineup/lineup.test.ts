import { describe, expect, it } from "vitest";
import { autofillLineup, validateLineup, type LineupPlayer } from "./lineup";

const slots = ["S", "OH1", "OH2", "OH3", "M1", "M2", "L", "UTIL"];
const p = (id: string, positions: string[], slot = "BENCH", extra: Partial<LineupPlayer> = {}): LineupPlayer =>
  ({ playerId: id, name: id, positions, slot, locked: false, playsToday: true, ...extra });

describe("lineup validation", () => {
  it("rejects ineligible positions, duplicate slots and moving locked players", () => {
    const current = new Map([["x", "BENCH"]]);
    const problems = validateLineup([p("a", ["OH"], "M1"), p("b", ["S"], "S"), p("c", ["S"], "S"), p("x", ["L"], "L", { locked: true })], current, slots);
    expect(problems.map((x) => x.message)).toEqual([
      "a cannot play M.",
      "Two players are in the S slot.",
      "x is locked until tomorrow.",
    ]);
  });
  it("accepts a valid lineup", () => {
    expect(validateLineup([p("a", ["OH", "L"], "L"), p("b", ["M"], "UTIL")], new Map(), slots)).toEqual([]);
  });
});

describe("start active players", () => {
  it("fills empty slots with eligible bench players, UTIL last, and never moves locked players", () => {
    const out = autofillLineup([
      p("s", ["S"]), p("oh1", ["OH"]), p("oh2", ["OH"]), p("oh3", ["OH"]), p("oh4", ["OH"]),
      p("m1", ["M"]), p("m2", ["M"]), p("l", ["L"]), p("lk", ["OH"], "BENCH", { locked: true }),
    ], slots);
    const slotOf = (id: string) => out.find((x) => x.playerId === id)!.slot;
    expect(slotOf("s")).toBe("S");
    expect(slotOf("l")).toBe("L");
    expect(slotOf("oh4")).toBe("UTIL");
    expect(slotOf("lk")).toBe("BENCH");
  });
  it("swaps a starter with no match today for a bench player who plays", () => {
    const out = autofillLineup([p("idle", ["OH"], "OH1", { playsToday: false }), p("busy", ["OH"])], slots);
    expect(out.find((x) => x.playerId === "busy")!.slot).not.toBe("BENCH");
  });
});
