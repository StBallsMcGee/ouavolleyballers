import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb, seed, addMatch, addStat, asUser, type Fixture } from "./helpers";
import { scoreStatLine, type ScoringRule } from "@/lib/scoring/engine";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let m1: string;
let m2: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  // Week 1: X v Y on Friday (locks 18:00 ET = 23:00Z) and Z v Y Saturday
  m1 = await addMatch(client, f, { date: "2026-11-13", lockAt: "2026-11-13T23:00:00Z", a: f.uniX, b: f.uniY });
  m2 = await addMatch(client, f, { date: "2026-11-14", lockAt: "2026-11-14T23:00:00Z", a: f.uniZ, b: f.uniY });
  await addStat(client, f.players.oh1!, m1, { kills: 12, attack_errors: 3, digs: 6, service_aces: 1, service_errors: 2 });
  await addStat(client, f.players.m1!, m1, { kills: 5, solo_blocks: 2, block_assists: 3 });
  await addStat(client, f.players.ohB!, m2, { kills: 20 }); // bench player: shown, not counted
  await addStat(client, f.players.oh2!, m1, { kills: 9, assists: 7 });
  await addStat(client, f.players.m2!, m1, { kills: 1, digs: 1 });
  await addStat(client, f.players.oh2!, m2, { kills: 4 });
});
afterAll(async () => drop());

const q = async (sql: string, p: unknown[] = []) => asUser(client, f.alice, () => client.query(sql, p));

describe("database scoring views", () => {
  it("player points match the TypeScript engine exactly", async () => {
    const rules: ScoringRule[] = (await client.query(`select stat_key, label, points::float p from scoring_rules`)).rows.map((r) => ({ statKey: r.stat_key, label: r.label, points: r.p, active: true }));
    const rows = (await q(`select v.points::float pts, s.* from v_player_match_points v join player_match_statistics s using (player_id, match_id)`)).rows;
    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.pts).toBe(scoreStatLine({ kills: r.kills, attack_errors: r.attack_errors, digs: r.digs, assists: r.assists, service_aces: r.service_aces, service_errors: r.service_errors, solo_blocks: r.solo_blocks, block_assists: r.block_assists }, rules));
    }
  });
  it("team totals count starters only", async () => {
    const pts = Object.fromEntries((await q(`select fantasy_team_id, points::float p, bench_points::float b from v_team_week_points where week = 1`)).rows.map((r) => [r.fantasy_team_id, r]));
    // oh1: 12 - 3 + 3 + 2 - 1 = 13 ; m1: 5 + 4 + 2.4 = 11.4 ; ohB bench 20
    expect(pts[f.teamA].p).toBe(24.4);
    expect(pts[f.teamA].b).toBe(20);
    // oh2: 9 + 2.1 + 4 = 15.1 ; m2: 1.5
    expect(pts[f.teamB].p).toBe(16.6);
  });
  it("re-importing the same statistics cannot double count", async () => {
    await expect(addStat(client, f.players.oh1!, m1, { kills: 12 })).rejects.toThrow(/duplicate key/);
  });
  it("corrected statistics change the points automatically", async () => {
    await client.query(`update player_match_statistics set kills = 13 where player_id = $1 and match_id = $2`, [f.players.oh1, m1]);
    expect((await q(`select points::float p from v_team_week_points where fantasy_team_id = $1 and week = 1`, [f.teamA])).rows[0].p).toBe(25.4);
  });
  it("lineup changes after a match locks do not affect that match", async () => {
    // Move ohB into OH and oh1 to bench AFTER m1 locked but BEFORE m2 locked.
    await client.query(`update lineup_entries set valid_to = '2026-11-14T12:00:00Z' where player_id in ($1, $2) and valid_to is null`, [f.players.oh1, f.players.ohB]);
    const ra = async (p: string) => (await client.query(`select id from roster_assignments where player_id = $1 and released_at is null`, [p])).rows[0].id;
    await client.query(`insert into lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, valid_from) values ($1,$2,$3,'BENCH','2026-11-14T12:00:00Z'), ($4,$2,$5,'OH','2026-11-14T12:00:00Z')`,
      [await ra(f.players.oh1!), f.teamA, f.players.oh1, await ra(f.players.ohB!), f.players.ohB]);
    // oh1's Friday points still count (14), ohB's Saturday 20 now count too: 14 + 11.4 + 20
    expect((await q(`select points::float p from v_team_week_points where fantasy_team_id = $1 and week = 1`, [f.teamA])).rows[0].p).toBe(45.4);
  });
  it("standings come from final matchups; imported results are kept as they were", async () => {
    await client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status) values ($1, 1, $2, $3, 'final')`, [f.leagueId, f.teamA, f.teamB]);
    await client.query(`insert into matchup_weeks (league_id, week, starts_on, ends_on) values ($1, 0 + 3, '2026-10-26', '2026-11-01')`, [f.leagueId]);
    await client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status, score_source, imported_home_score, imported_away_score) values ($1, 3, $2, $3, 'final', 'imported', 10, 30)`, [f.leagueId, f.teamA, f.teamB]);
    const s = Object.fromEntries((await q(`select fantasy_team_id, wins, losses, points_for::float pf from v_standings`)).rows.map((r) => [r.fantasy_team_id, r]));
    expect([s[f.teamA].wins, s[f.teamA].losses, s[f.teamA].pf]).toEqual([1, 1, 55.4]);
    expect([s[f.teamB].wins, s[f.teamB].losses]).toEqual([1, 1]);
  });
  it("a new scoring version applies from its effective week only (prospective)", async () => {
    await asUser(client, f.admin, () => client.query(`select admin_create_scoring_rule_set($1, $2, 2, 'double kills from week 2')`,
      [f.leagueId, JSON.stringify([{ stat_key: "kills", label: "Kills", points: 2 }])]));
    expect((await q(`select points::float p from v_team_week_points where fantasy_team_id = $1 and week = 1`, [f.teamA])).rows[0].p).toBe(45.4);
  });
  it("a retroactive scoring version (from week 1) recalculates history when the admin chooses it", async () => {
    await asUser(client, f.admin, () => client.query(`select admin_create_scoring_rule_set($1, $2, 1, 'kills only')`,
      [f.leagueId, JSON.stringify([{ stat_key: "kills", label: "Kills", points: 1 }])]));
    // Starters at lock: oh1 13 kills (Fri), m1 5 (Fri), ohB 20 (Sat)
    expect((await q(`select points::float p from v_team_week_points where fantasy_team_id = $1 and week = 1`, [f.teamA])).rows[0].p).toBe(38);
  });
});
