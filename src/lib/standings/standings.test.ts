import { describe, expect, it } from "vitest";
import { computeStandings, firstRoundPairs, nextRoundPairs, type MatchupResult } from "./standings";

const r = (week: number, h: string, a: string, hs: number, as: number, final = true, playoffRound: number | null = null): MatchupResult =>
  ({ week, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, final, playoffRound });

describe("standings", () => {
  it("counts wins, losses, ties and points; ignores unfinished and playoff games", () => {
    const rows = computeStandings(["A", "B", "C", "D"], [
      r(1, "A", "B", 50, 40), r(1, "C", "D", 30, 30),
      r(2, "A", "C", 20, 25), r(2, "B", "D", 60, 10),
      r(3, "A", "D", 99, 0, false), r(11, "A", "B", 1, 100, true, 1),
    ]);
    const a = rows.find((x) => x.teamId === "A")!;
    expect([a.wins, a.losses, a.ties, a.pointsFor, a.pointsAgainst]).toEqual([1, 1, 0, 70, 65]);
    const c = rows.find((x) => x.teamId === "C")!;
    expect([c.wins, c.ties, c.winPct]).toEqual([1, 1, 0.75]);
    expect(rows[0]!.teamId).toBe("C");
  });
  it("breaks win% ties by points for", () => {
    const rows = computeStandings(["A", "B", "C", "D"], [r(1, "A", "B", 80, 10), r(1, "C", "D", 50, 10)]);
    expect(rows.map((x) => x.teamId).slice(0, 2)).toEqual(["A", "C"]);
  });
  it("teams with no games are listed with zeros", () => {
    expect(computeStandings(["A", "B"], [])).toHaveLength(2);
  });
});

describe("playoff pairs", () => {
  it("4 teams: 1v4, 2v3", () => {
    const { pairs, byes } = firstRoundPairs(["s1", "s2", "s3", "s4", "s5"], 4);
    expect(byes).toEqual([]);
    expect(pairs.map((p) => [p.homeTeamId, p.awayTeamId])).toEqual([["s1", "s4"], ["s2", "s3"]]);
  });
  it("6 teams: top 2 get byes, 3v6, 4v5", () => {
    const { pairs, byes } = firstRoundPairs(["s1", "s2", "s3", "s4", "s5", "s6"], 6);
    expect(byes).toEqual(["s1", "s2"]);
    expect(pairs.map((p) => [p.homeTeamId, p.awayTeamId])).toEqual([["s3", "s6"], ["s4", "s5"]]);
  });
  it("re-seeds the next round", () => {
    const seeds = new Map([["s1", 1], ["s2", 2], ["s4", 4], ["s6", 6]]);
    expect(nextRoundPairs(["s6", "s2", "s1", "s4"], seeds, 2).map((p) => [p.homeTeamId, p.awayTeamId])).toEqual([["s1", "s6"], ["s2", "s4"]]);
  });
});
