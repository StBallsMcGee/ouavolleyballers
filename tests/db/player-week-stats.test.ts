import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, addStat, asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  const m1 = await addMatch(client, f, { date: "2026-11-13", lockAt: "2026-11-13T23:00:00Z", a: f.uniX, b: f.uniY });
  const m2 = await addMatch(client, f, { date: "2026-11-14", lockAt: "2026-11-14T23:00:00Z", a: f.uniZ, b: f.uniX });
  const m3 = await addMatch(client, f, { date: "2026-11-20", lockAt: "2026-11-20T23:00:00Z", a: f.uniX, b: f.uniY });
  await addStat(client, f.players.oh1!, m1, { kills: 10, attack_errors: 2, digs: 4 });
  await addStat(client, f.players.oh1!, m2, { kills: 14, attack_errors: 3, digs: 6, service_aces: 1 });
  await addStat(client, f.players.oh1!, m3, { kills: 5 });
  await client.query(`update player_match_statistics set sets_played = 4, attack_attempts = 30`);
});
afterAll(async () => drop());

describe("v_player_week_stats", () => {
  it("totals each player's stats and points per week, readable by league members", async () => {
    const r = await asUser(client, f.alice, () => client.query(
      `select week, games, sets, kills, attack_errors, attack_attempts, digs, service_aces, points::float as points
         from v_player_week_stats where league_id = $1 and player_id = $2 order by week`, [f.leagueId, f.players.oh1]));
    expect(r.rows).toEqual([
      // Week 1: 24 kills - 5 errors + 10 digs * 0.5 + 1 ace * 2 = 26
      { week: 1, games: 2, sets: 8, kills: 24, attack_errors: 5, attack_attempts: 60, digs: 10, service_aces: 1, points: 26 },
      { week: 2, games: 1, sets: 4, kills: 5, attack_errors: 0, attack_attempts: 30, digs: 0, service_aces: 0, points: 5 },
    ]);
  });
});
