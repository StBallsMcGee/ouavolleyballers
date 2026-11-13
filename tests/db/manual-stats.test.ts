import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, addStat, asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let match: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  match = await addMatch(client, f, { date: "2026-11-10", lockAt: "2026-11-10T23:00:00Z", a: f.uniX, b: f.uniY });
});
afterAll(async () => drop());

const q = (user: string | null, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const save = (user: string, rows: unknown[]) => q(user, `select admin_set_match_stats_and_refresh($1, $2::jsonb) n`, [match, JSON.stringify(rows)]);

describe("typing in a box score", () => {
  it("only admins can, and only for players on the two teams", async () => {
    await expect(save(f.alice, [{ player_id: f.players.oh1, kills: 5 }])).rejects.toThrow(/administrator/);
    await expect(save(f.admin, [{ player_id: f.players.fa1, kills: 5 }])).rejects.toThrow(/either team/);
    await expect(save(f.admin, [{ player_id: f.players.oh1, kills: -1 }])).rejects.toThrow(/between 0 and 300/);
  });
  it("saved lines score like any other stats and count for the lineup", async () => {
    expect((await save(f.admin, [{ player_id: f.players.oh1, kills: 10, digs: 4, sets_played: 3 }])).rows[0].n).toBe(1);
    const pts = (await client.query(`select points::float p, counted from v_team_player_match_points where match_id = $1 and player_id = $2`, [match, f.players.oh1])).rows[0];
    expect(pts).toEqual({ p: 12, counted: true }); // 10 kills + 4 digs × 0.5
    expect((await client.query(`select stats_available from matches where id = $1`, [match])).rows[0].stats_available).toBe(true);
    expect((await client.query(`select count(*)::int n from audit_log where action = 'stats.manual'`)).rows[0].n).toBe(1);
  });
  it("editing replaces the line; removing deletes only typed-in lines", async () => {
    await save(f.admin, [{ player_id: f.players.oh1, kills: 8 }]);
    expect((await client.query(`select kills from player_match_statistics where match_id = $1 and player_id = $2`, [match, f.players.oh1])).rows[0].kills).toBe(8);
    await addStat(client, f.players.oh2!, match, { kills: 3 }); // from a source
    await save(f.admin, [{ player_id: f.players.oh1, remove: true }, { player_id: f.players.oh2, remove: true }]);
    const left = (await client.query(`select player_id from player_match_statistics where match_id = $1`, [match])).rows.map((r) => r.player_id);
    expect(left).toEqual([f.players.oh2]);
  });
});

describe("projections", () => {
  it("are saved for players with games and readable by league members only", async () => {
    const d = "2026-11-11";
    const m2 = await addMatch(client, f, { date: d, lockAt: `${d}T23:00:00Z`, a: f.uniX, b: f.uniY });
    await addStat(client, f.players.oh1!, m2, { kills: 20 });
    await client.query(`select refresh_player_projections($1)`, [f.leagueId]);
    const r = (await q(f.alice, `select games, avg_points::float avg, proj_per_game::float proj from player_projections where player_id = $1`, [f.players.oh1])).rows[0];
    expect(r.games).toBe(1);
    expect(r.avg).toBe(20);
    expect(r.proj).toBeGreaterThan(0);
    expect((await q(f.carol, `select count(*)::int n from player_projections`)).rows[0].n).toBe(0);
    await expect(q(f.alice, `select refresh_player_projections($1)`, [f.leagueId])).rejects.toThrow(/permission denied/);
  });
});
