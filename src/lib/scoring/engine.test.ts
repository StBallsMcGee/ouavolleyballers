import { describe, expect, it } from "vitest";
import {
  creditTeamPoints,
  ruleSetForWeek,
  scoreBreakdown,
  scoreStatLine,
  sumPoints,
  teamWeekTotals,
  type MatchInfo,
  type RuleSetVersion,
  type ScoringRule,
} from "./engine";
import {
  gameRowToStatLine,
  leaguePointsToRules,
  USVB_DEFAULT_POINTS,
  type UsvbGameRow,
} from "@/lib/sources/usportvb";
import week2 from "./__fixtures__/usportvb-week2-default-scoring.json";

/** The VolleyBALLERs scoring, verified against the live league on 6 Nov 2026. */
const LEAGUE_POINTS = {
  aces: 2, digs: 0.5, kills: 1, errors: -1, assists: 0.3,
  attempts: 0, blockSolo: 2, blockAssist: 0.8, serveMisses: -0.5,
};
const leagueRules = leaguePointsToRules(LEAGUE_POINTS);
const rule = (statKey: string, points: number, active = true): ScoringRule => ({ statKey, label: statKey, points, active });

describe("individual scoring categories (league values)", () => {
  const cases: Array<[string, number]> = [
    ["service_aces", 2], ["digs", 0.5], ["kills", 1], ["attack_errors", -1], ["assists", 0.3],
    ["attack_attempts", 0], ["solo_blocks", 2], ["block_assists", 0.8], ["service_errors", -0.5],
  ];
  it.each(cases)("%s scores %d per stat", (key, value) => {
    expect(scoreStatLine({ [key]: 1 }, leagueRules)).toBe(value);
    expect(scoreStatLine({ [key]: 10 }, leagueRules)).toBe(Math.round(value * 10 * 100) / 100);
  });
});

describe("scoring arithmetic", () => {
  it("matches the worked example in the project spec (13.5)", () => {
    const rules = [rule("kills", 1), rule("digs", 0.5), rule("service_aces", 2), rule("service_errors", -0.5)];
    expect(scoreStatLine({ kills: 5, digs: 10, service_aces: 2, service_errors: 1 }, rules)).toBe(13.5);
  });
  it("handles negative totals", () => {
    expect(scoreStatLine({ attack_errors: 4, service_errors: 2 }, leagueRules)).toBe(-5);
  });
  it("zero point values contribute nothing", () => {
    expect(scoreStatLine({ attack_attempts: 37 }, leagueRules)).toBe(0);
  });
  it("missing statistics count as zero", () => {
    expect(scoreStatLine({}, leagueRules)).toBe(0);
    expect(scoreStatLine({ kills: 3 }, leagueRules)).toBe(3);
  });
  it("inactive categories are ignored", () => {
    expect(scoreStatLine({ kills: 3, digs: 4 }, [rule("kills", 1), rule("digs", 0.5, false)])).toBe(3);
  });
  it("avoids floating point drift (0.3 x 7 = 2.1 exactly)", () => {
    expect(scoreStatLine({ assists: 7 }, leagueRules)).toBe(2.1);
    expect(sumPoints([0.1, 0.2])).toBe(0.3);
  });
  it("supports custom categories stored as other statistics", () => {
    expect(scoreStatLine({ other: { reception_errors: 2 } }, [rule("reception_errors", -1)])).toBe(-2);
  });
  it("breaks points down by category", () => {
    const b = scoreBreakdown({ kills: 4, assists: 10 }, leagueRules);
    expect(b.find((x) => x.statKey === "assists")?.points).toBe(3);
    expect(b.find((x) => x.statKey === "kills")?.points).toBe(4);
  });
});

describe("agreement with USportVB's published numbers", () => {
  it("reproduces USportVB's week 2 points for 40 real players (site default scoring)", () => {
    const defaults = leaguePointsToRules(USVB_DEFAULT_POINTS);
    for (const p of week2 as Array<{ matches: Omit<UsvbGameRow, "date" | "opponent">[]; usportvbWeekPoints: number }>) {
      const pts = sumPoints(p.matches.map((m) => scoreStatLine(gameRowToStatLine({ ...m, date: "2026-10-30", opponent: "x" }), defaults)));
      expect(pts).toBe(p.usportvbWeekPoints);
    }
  });
});

describe("versioned rule sets", () => {
  const sets: RuleSetVersion[] = [
    { version: 1, effectiveFromWeek: 1, rules: [rule("kills", 1)] },
    { version: 2, effectiveFromWeek: 5, rules: [rule("kills", 2)] },
  ];
  it("uses the set in force for each week (prospective change)", () => {
    expect(ruleSetForWeek(sets, 4)?.version).toBe(1);
    expect(ruleSetForWeek(sets, 5)?.version).toBe(2);
    expect(ruleSetForWeek(sets, 9)?.version).toBe(2);
  });
  it("a retroactive set (effective week 1) replaces history when chosen", () => {
    const all = [...sets, { version: 3, effectiveFromWeek: 1, rules: [rule("kills", 3)] }];
    expect(ruleSetForWeek(all, 2)?.version).toBe(3);
    expect(ruleSetForWeek(all, 6)?.version).toBe(2);
  });
});

describe("crediting points to fantasy teams", () => {
  const t0 = new Date("2026-11-09T00:00:00Z");
  const lockA = new Date("2026-11-13T23:00:00Z");
  const lockB = new Date("2026-11-14T23:00:00Z");
  const matches = new Map<string, MatchInfo>([
    ["mA", { id: "mA", week: 4, lockAt: lockA, countsForFantasy: true }],
    ["mB", { id: "mB", week: 4, lockAt: lockB, countsForFantasy: true }],
    ["mX", { id: "mX", week: null, lockAt: lockB, countsForFantasy: true }],
  ]);
  const rules: RuleSetVersion[] = [{ version: 1, effectiveFromWeek: 1, rules: leagueRules }];
  const stats = [
    { playerId: "p1", matchId: "mA", line: { kills: 10 } },
    { playerId: "p1", matchId: "mB", line: { kills: 5 } },
    { playerId: "p2", matchId: "mA", line: { digs: 10 } },
    { playerId: "p3", matchId: "mA", line: { kills: 8 } },
  ];

  it("counts starters, shows bench points without counting them, across multiple matches", () => {
    const spells = [
      { teamId: "T1", playerId: "p1", from: t0, to: null, slots: [{ slot: "OH1", from: t0, to: null }] },
      { teamId: "T1", playerId: "p2", from: t0, to: null, slots: [{ slot: "BENCH", from: t0, to: null }] },
      { teamId: "T2", playerId: "p3", from: t0, to: null, slots: [{ slot: "OH1", from: t0, to: null }] },
    ];
    const credited = creditTeamPoints(stats, matches, spells, rules);
    const totals = teamWeekTotals(credited);
    expect(totals.get("T1:4")).toBe(15); // p1 10 + 5; p2 benched
    expect(totals.get("T2:4")).toBe(8); // players on different teams are credited separately
    expect(credited.find((c) => c.playerId === "p2")?.counted).toBe(false);
  });

  it("never double counts a match imported twice", () => {
    const spells = [{ teamId: "T1", playerId: "p1", from: t0, to: null, slots: [{ slot: "OH1", from: t0, to: null }] }];
    const credited = creditTeamPoints([...stats, stats[0]!, stats[0]!], matches, spells, rules);
    expect(teamWeekTotals(credited).get("T1:4")).toBe(15);
  });

  it("uses the lineup at lock time: changes after lock do not change the result", () => {
    const moved = new Date("2026-11-14T01:00:00Z"); // after mA locked, before mB locked
    const spells = [{
      teamId: "T1", playerId: "p1", from: t0, to: null,
      slots: [{ slot: "OH1", from: t0, to: moved }, { slot: "BENCH", from: moved, to: null }],
    }];
    const credited = creditTeamPoints(stats, matches, spells, rules);
    expect(teamWeekTotals(credited).get("T1:4")).toBe(10); // mA counted, mB benched
  });

  it("credits points to whichever team owned the player when each match locked (trade mid-week)", () => {
    const traded = new Date("2026-11-14T12:00:00Z");
    const spells = [
      { teamId: "T1", playerId: "p1", from: t0, to: traded, slots: [{ slot: "OH1", from: t0, to: traded }] },
      { teamId: "T2", playerId: "p1", from: traded, to: null, slots: [{ slot: "UTIL", from: traded, to: null }] },
    ];
    const totals = teamWeekTotals(creditTeamPoints(stats, matches, spells, rules));
    expect(totals.get("T1:4")).toBe(10);
    expect(totals.get("T2:4")).toBe(5);
  });

  it("ignores matches outside fantasy weeks and players on no team", () => {
    const credited = creditTeamPoints([{ playerId: "p9", matchId: "mA", line: { kills: 3 } }, { playerId: "p1", matchId: "mX", line: { kills: 3 } }], matches, [], rules);
    expect(credited).toHaveLength(0);
  });

  it("recalculates when the scoring rules change", () => {
    const spells = [{ teamId: "T1", playerId: "p1", from: t0, to: null, slots: [{ slot: "OH1", from: t0, to: null }] }];
    const v2: RuleSetVersion[] = [...rules, { version: 2, effectiveFromWeek: 1, rules: [rule("kills", 2)] }];
    expect(teamWeekTotals(creditTeamPoints(stats, matches, spells, v2)).get("T1:4")).toBe(30);
  });
});
