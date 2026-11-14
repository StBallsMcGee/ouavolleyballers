import { describe, expect, it } from "vitest";
import { pickCourtSix } from "./court";
import type { RosterPlayer } from "./queries";

const p = (id: string, pos: string, slot: string): RosterPlayer => ({
  assignmentId: id, playerId: id, name: id, positions: [pos], positionLabel: pos, jersey: null, universityId: null, slot, acquiredAt: "", photoUrl: null,
});
const show = (six: ReturnType<typeof pickCourtSix>) => six.map((x) => `${x.role}:${x.id}`);

describe("court picture players", () => {
  it("uses current starters ranked by the last day: best OH and M, then the two best other OH/M", () => {
    const roster = [
      p("oh1", "OH", "OH1"), p("oh2", "OH", "OH2"), p("oh3", "OH", "OH3"), p("ohBench", "OH", "BENCH"),
      p("m1", "M", "M1"), p("m2", "M", "M2"), p("s1", "S", "S"), p("l1", "L", "L"), p("util", "OH", "UTIL"),
    ];
    const lastDay = new Map([["ohBench", 30], ["util", 12], ["oh1", 10], ["oh2", 8], ["oh3", 2], ["m2", 9], ["m1", 1]]);
    expect(show(pickCourtSix(roster, lastDay, new Map()))).toEqual(["OH:util", "M:m2", "OH:oh1", "OH:oh2", "S:s1", "L:l1"]);
  });
  it("two middles who outscore an outside hitter both play; one OH is always kept", () => {
    const roster = [p("x", "OH", "OH1"), p("y", "OH", "OH2"), p("z", "OH", "OH3"), p("m1", "M", "M1"), p("m2", "M", "M2"), p("s", "S", "S"), p("l", "L", "L")];
    const lastDay = new Map([["m1", 15], ["m2", 14], ["x", 6], ["y", 3], ["z", 1]]);
    expect(show(pickCourtSix(roster, lastDay, new Map()))).toEqual(["OH:x", "M:m1", "M:m2", "OH:y", "S:s", "L:l"]);
  });
  it("a middle is kept even if every OH outscores her", () => {
    const roster = [p("x", "OH", "OH1"), p("y", "OH", "OH2"), p("z", "OH", "OH3"), p("w", "OH", "UTIL"), p("m1", "M", "M1"), p("s", "S", "S"), p("l", "L", "L")];
    const lastDay = new Map([["x", 20], ["y", 18], ["z", 16], ["w", 14], ["m1", 1]]);
    expect(show(pickCourtSix(roster, lastDay, new Map()))).toEqual(["OH:x", "M:m1", "OH:y", "OH:z", "S:s", "L:l"]);
  });
  it("season points break ties; missing positions are filled by the next best starter", () => {
    const roster = [p("a", "OH", "OH1"), p("b", "OH", "OH2"), p("c", "OH", "OH3"), p("d", "OH", "UTIL"), p("m", "M", "M1"), p("s", "S", "S")];
    const six = pickCourtSix(roster, new Map(), new Map([["c", { points: 50 }], ["a", { points: 40 }]]));
    expect(show(six)).toEqual(["OH:c", "M:m", "OH:a", "OH:b", "S:s", "L:d"]);
  });
});
