import { describe, expect, it } from "vitest";
import { pickCourtSix } from "./court";
import type { RosterPlayer } from "./queries";

const p = (id: string, pos: string, slot: string): RosterPlayer => ({
  assignmentId: id, playerId: id, name: id, positions: [pos], positionLabel: pos, jersey: null, universityId: null, slot, acquiredAt: "", photoUrl: null,
});

describe("court picture players", () => {
  it("uses current starters, ranked by points on the last day of play", () => {
    const roster = [
      p("oh1", "OH", "OH1"), p("oh2", "OH", "OH2"), p("oh3", "OH", "OH3"), p("ohBench", "OH", "BENCH"),
      p("m1", "M", "M1"), p("m2", "M", "M2"), p("s1", "S", "S"), p("l1", "L", "L"), p("util", "OH", "UTIL"),
    ];
    const lastDay = new Map([["ohBench", 30], ["util", 12], ["oh1", 10], ["oh2", 8], ["oh3", 2], ["m2", 9], ["m1", 1]]);
    const six = pickCourtSix(roster, lastDay, new Map());
    expect(six.map((x) => `${x.role}:${x.id}`)).toEqual(["OH:util", "OH:oh1", "OH:oh2", "M:m2", "S:s1", "L:l1"]);
  });
  it("season points break ties; missing positions are filled by the next best starter", () => {
    const roster = [p("a", "OH", "OH1"), p("b", "OH", "OH2"), p("c", "OH", "OH3"), p("d", "OH", "UTIL"), p("m", "M", "M1"), p("s", "S", "S")];
    const six = pickCourtSix(roster, new Map(), new Map([["c", { points: 50 }], ["a", { points: 40 }]]));
    expect(six.map((x) => x.id)).toEqual(["c", "a", "b", "m", "s", "d"]);
    expect(six.at(-1)!.role).toBe("L");
  });
});
