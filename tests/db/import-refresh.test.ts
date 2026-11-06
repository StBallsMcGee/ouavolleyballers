import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb } from "./helpers";
import { runLeagueImport } from "@/lib/migration/league";
import type { UsvbLeague, UsvbPlayer, UsvbTeam } from "@/lib/sources/usportvb";

// Sample league (test data only): two real university ids so names resolve.
const W = "d5fxlv5sp7d57j2i"; // Western
const Y = "1x1r2stwudexxbtb"; // Windsor
const player = (id: string, pos: string, uni: string): UsvbPlayer => ({
  publicId: id, firstName: id, lastName: "Test", position: pos, teamId: uni, jerseyNumber: 1, mens: false, isActive: true, conference: "OUA",
  gameData: [{ date: "2026-10-31", opponent: uni === W ? Y : W, kills: 2, errors: 0, attempts: 5, assists: 0, aces: 0, serveMisses: 0, digs: 1, blockSolo: 0, blockAssist: 0, sets: 4 }],
});
const players = [player("pA", "OH", W), player("pB", "M", W), player("pC", "OH", Y), player("pD", "M", Y), player("pE", "OH", Y)];

function source(week3?: { s1: number; s2: number }) {
  const league: UsvbLeague = {
    publicId: "LG", year: 2027, name: "Test League", commissionerId: "mgr1", teams: ["T1", "T2", "T3"],
    draft: { draftComplete: true, picks: [] },
    criticalSettings: { gender: "womens", conferences: ["OUA"], leagueSize: 3, roster: { S: 0, OH: 1, M: 1, L: 0, UTIL: 0, TOTAL: 3 } },
    adjustableSettings: { points: { aces: 2, digs: 0.5, kills: 1, errors: -1, assists: 0.3, attempts: 0, blockSolo: 2, blockAssist: 0.8, serveMisses: -0.5 } },
    matchups: [
      { week: 3, matchupData: { team1Id: "T1", team2Id: "T2", team1Score: week3?.s1 ?? 0, team2Score: week3?.s2 ?? 0, winnerId: week3 ? (week3.s1 > week3.s2 ? "T1" : "T2") : "" } },
      { week: 4, matchupData: { team1Id: "T2", team2Id: "T1", team1Score: 0, team2Score: 0, winnerId: "" } },
    ],
  };
  return league;
}
const team = (id: string, name: string, mgr: string, roster: Array<[string, string]>): UsvbTeam =>
  ({ publicId: id, leagueId: "LG", name, managerId: mgr, players: roster.map(([publicId, position]) => ({ publicId, position })), points: [], wins: 0, losses: 0 });

let client: pg.Client;
let drop: () => Promise<void>;
const opts = { excludeTeamIds: ["T3"], cutoverWeek: 4 };

beforeAll(async () => ({ client, drop } = await createTestDb()));
afterAll(async () => drop());

const roster = async () =>
  Object.fromEntries((await client.query(
    `select p.source_id, t.source_id team, le.slot from roster_assignments ra join players p on p.id = ra.player_id
     join fantasy_teams t on t.id = ra.fantasy_team_id
     join lineup_entries le on le.roster_assignment_id = ra.id and le.valid_to is null
     where ra.released_at is null order by 1`)).rows.map((r) => [r.source_id, `${r.team}:${r.slot}`]));

async function run(league: UsvbLeague, teams: UsvbTeam[], mode: "dry_run" | "apply", refresh = false) {
  await client.query("begin");
  try {
    const r = await runLeagueImport(client, { league, teams, players, mode, createdBy: "test" }, { ...opts, refresh });
    await client.query(mode === "apply" ? "commit" : "rollback");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

describe("league import and pre-switch refresh", () => {
  const initialTeams = [team("T1", "Alpha", "mgr1", [["pA", "OH"], ["pB", "BENCH"]]), team("T2", "Bravo", "mgr2", [["pC", "OH"], ["pD", "M"]]), team("T3", "Empty", "mgr3", [])];

  it("dry run saves nothing", async () => {
    const r = await run(source(), initialTeams, "dry_run");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect((await client.query(`select count(*)::int n from leagues`)).rows[0].n).toBe(0);
  });

  it("first import copies teams, rosters and lineups, excluding the empty team", async () => {
    await run(source(), initialTeams, "apply");
    expect(await roster()).toEqual({ pA: "T1:OH", pB: "T1:BENCH", pC: "T2:OH", pD: "T2:M" });
    expect((await client.query(`select count(*)::int n from fantasy_teams`)).rows[0].n).toBe(2);
    expect((await client.query(`select status::text from matchups where week = 3`)).rows[0].status).toBe("void");
  });

  it("refresh applies weekend changes: moves, drops, adds, slots, names and the week 3 result", async () => {
    const changed = [
      team("T1", "Alpha Renamed", "mgr1", [["pA", "BENCH"], ["pB", "M"], ["pE", "OH"]]), // slot changes + added pE
      team("T2", "Bravo", "mgr2", [["pC", "OH"]]), // pD dropped
      team("T3", "Empty", "mgr3", []),
    ];
    const preview = await run(source({ s1: 55.5, s2: 40 }), changed, "dry_run", true);
    expect(preview.write?.secondPass?.rosterInserted).toBe(0);
    expect(await roster()).toEqual({ pA: "T1:OH", pB: "T1:BENCH", pC: "T2:OH", pD: "T2:M" }); // preview changed nothing

    const r = await run(source({ s1: 55.5, s2: 40 }), changed, "apply", true);
    const w = r.write!.firstPass;
    expect([w.rosterInserted, w.rosterReleased, w.lineupSlotsChanged, w.teamsRenamed, w.matchupResultsUpdated]).toEqual([1, 1, 2, 1, 1]);
    expect(await roster()).toEqual({ pA: "T1:BENCH", pB: "T1:M", pC: "T2:OH", pE: "T1:OH" });
    const m = (await client.query(`select status::text, imported_home_score::float h, imported_away_score::float a from matchups where week = 3`)).rows[0];
    expect(m).toEqual({ status: "final", h: 55.5, a: 40 });
    expect((await client.query(`select name from fantasy_teams where source_id = 'T1'`)).rows[0].name).toBe("Alpha Renamed");
  });

  it("a player traded between teams moves with them", async () => {
    const traded = [team("T1", "Alpha Renamed", "mgr1", [["pA", "BENCH"], ["pE", "OH"]]), team("T2", "Bravo", "mgr2", [["pC", "OH"], ["pB", "M"]]), team("T3", "Empty", "mgr3", [])];
    const r = await run(source({ s1: 55.5, s2: 40 }), traded, "apply", true);
    expect(r.write!.firstPass.rosterMoved).toBe(1);
    expect((await roster()).pB).toBe("T2:M");
  });

  it("running the same refresh again changes nothing", async () => {
    const same = [team("T1", "Alpha Renamed", "mgr1", [["pA", "BENCH"], ["pE", "OH"]]), team("T2", "Bravo", "mgr2", [["pC", "OH"], ["pB", "M"]]), team("T3", "Empty", "mgr3", [])];
    const r = await run(source({ s1: 55.5, s2: 40 }), same, "dry_run", true);
    const w = r.write!.firstPass;
    expect([w.rosterInserted, w.rosterMoved, w.rosterReleased, w.lineupSlotsChanged, w.teamsRenamed, w.matchupResultsUpdated]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.issues.some((i) => i.message.startsWith("Repeatability check passed"))).toBe(true);
  });

  it("moving the cut-over earlier hands that week to Sideout scoring", async () => {
    const same = [team("T1", "Alpha Renamed", "mgr1", [["pA", "BENCH"], ["pE", "OH"]]), team("T2", "Bravo", "mgr2", [["pC", "OH"], ["pB", "M"]]), team("T3", "Empty", "mgr3", [])];
    await client.query("begin");
    const r = await runLeagueImport(client, { league: source({ s1: 55.5, s2: 40 }), teams: same, players, mode: "apply", createdBy: "test" }, { ...opts, cutoverWeek: 3, refresh: true });
    await client.query("commit");
    expect(r.write!.firstPass.matchupsNowCalculated).toBe(1);
    const m = (await client.query(`select score_source, status::text, imported_home_score from matchups where week = 3`)).rows[0];
    expect(m).toEqual({ score_source: "calculated", status: "scheduled", imported_home_score: null });
  });

  it("is refused once the league is active", async () => {
    await client.query(`update leagues set status = 'active'`);
    await expect(run(source(), initialTeams, "apply", true)).rejects.toThrow(/already active/);
  });
});
