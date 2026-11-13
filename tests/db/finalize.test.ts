import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let today: string;
const shift = async (days: number) => (await client.query(`select ($1::date + $2::int)::text d`, [today, days])).rows[0].d as string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  today = (await client.query(`select (now() at time zone 'America/Toronto')::date::text d`)).rows[0].d;
  await client.query(`delete from matchup_weeks where league_id = $1`, [f.leagueId]);
  // Weeks relative to today, whatever weekday the test runs on (so not always Monday–Sunday).
  await client.query(`alter table matchup_weeks drop constraint if exists matchup_weeks_monday_to_sunday`);
  // Week 1 ended yesterday; week 2 ended two days ago.
  await client.query(`insert into matchup_weeks (league_id, week, starts_on, ends_on) values ($1, 1, $2, $3), ($1, 2, $4, $5)`,
    [f.leagueId, await shift(-7), await shift(-1), await shift(-14), await shift(-8)]);
  await client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status) values ($1, 1, $2, $3, 'in_progress'), ($1, 2, $2, $3, 'in_progress')`,
    [f.leagueId, f.teamA, f.teamB]);
});
afterAll(async () => drop());

const statusOf = async (week: number) => (await client.query(`select status::text s from matchups where league_id = $1 and week = $2`, [f.leagueId, week])).rows[0].s;
const refresh = () => client.query(`select refresh_matchup_statuses($1)`, [f.leagueId]);

describe("finishing a week", () => {
  it("a week that ended yesterday waits while one of its games isn't marked finished", async () => {
    const d = await shift(-2);
    const m = await addMatch(client, f, { date: d, lockAt: `${d}T23:00:00Z`, a: f.uniX, b: f.uniY, status: "scheduled" });
    await refresh();
    expect(await statusOf(1)).toBe("in_progress");
    await client.query(`update matches set status = 'final' where id = $1`, [m]);
    await refresh();
    expect(await statusOf(1)).toBe("final"); // all games finished: final right away (Monday)
  });
  it("after the grace day a week becomes final even if a source never updated a game", async () => {
    const d = await shift(-9);
    await addMatch(client, f, { date: d, lockAt: `${d}T23:00:00Z`, a: f.uniX, b: f.uniZ, status: "scheduled" });
    await refresh();
    expect(await statusOf(2)).toBe("final");
  });
  it("final weeks count in the standings", async () => {
    const st = (await client.query(`select fantasy_team_id, games from v_standings where league_id = $1`, [f.leagueId])).rows;
    expect(st.every((r) => r.games === 2)).toBe(true);
  });
});
