import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ouaSeason, ouaTeamMatches, parseOuaBoxScore, parseOuaSchedule } from "./oua";

const fixture = (f: string) => readFileSync(path.join(__dirname, "__fixtures__", f), "utf8");

describe("OUA website (oua.ca)", () => {
  it("reads both teams' player lines, skipping totals", () => {
    const box = parseOuaBoxScore(fixture("oua-boxscore.html"));
    expect(box.teams.map((t) => t.caption)).toEqual(["TMU", "RMC"]);
    expect(box.teams[0]!.players[0]).toEqual({
      name: "Elise Pridmore", jersey: 1, sets: 1, kills: 3, attackErrors: 1, attackAttempts: 6, assists: 1,
      serviceAces: 0, serviceErrors: 0, soloBlocks: 1, blockAssists: 0, digs: 0,
    });
    expect(box.teams.every((t) => t.players.every((p) => p.name !== "Totals"))).toBe(true);
  });
  it("finds box score links on the schedule; games without one are left out", () => {
    const e = parseOuaSchedule(fixture("oua-schedule.html"));
    expect(e).toContainEqual({ date: "2026-11-07", away: "TMU", home: "RMC", boxScoreUrl: "https://oua.ca/sports/wvball/2026-27/boxscores/20261107_juo3.xml" });
    expect(e.some((x) => x.date === "2026-11-06" && x.home === "RMC")).toBe(false);
  });
  it("matches team names exactly (Toronto is not TMU)", () => {
    const tmu = { name: "Toronto Metropolitan", short_name: "TMU" };
    expect(ouaTeamMatches("TMU", tmu)).toBe(true);
    expect(ouaTeamMatches("Toronto", tmu)).toBe(false);
    expect(ouaTeamMatches("Queen's", { name: "Queen's", short_name: "QU" })).toBe(true);
    expect(ouaSeason(2026)).toBe("2026-27");
  });
});
