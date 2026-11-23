import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, addStat, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let m1: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  m1 = await addMatch(client, f, { date: "2026-11-13", lockAt: "2026-11-13T23:00:00Z", a: f.uniX, b: f.uniY });
  await addStat(client, f.players.oh1!, m1, { kills: 10, digs: 4 });
  await addStat(client, f.players.oh2!, m1, { kills: 6 });
});
afterAll(async () => drop());

/** Saved points must always equal a fresh calculation. */
async function expectInSync() {
  const q = (t: string) => client.query(`select league_id, player_id, match_id, week, scoring_version, points::text from ${t} order by 1, 2, 3`);
  expect((await q("player_match_points")).rows).toEqual((await q("v_player_match_points_live")).rows);
}
const pts = async (player: string) => (await client.query(`select points::float p from v_player_match_points where player_id = $1 and match_id = $2`, [player, m1])).rows[0]?.p;

describe("saved fantasy points", () => {
  it("are saved when stats arrive", async () => {
    expect(await pts(f.players.oh1!)).toBe(12); // 10 kills + 4 digs * 0.5
    await expectInSync();
  });
  it("follow a corrected stat line", async () => {
    await client.query(`update player_match_statistics set kills = 15 where player_id = $1 and match_id = $2`, [f.players.oh1, m1]);
    expect(await pts(f.players.oh1!)).toBe(17);
    await expectInSync();
  });
  it("follow a scoring change", async () => {
    await client.query(`update scoring_rules set points = 2 where stat_key = 'kills'`);
    expect(await pts(f.players.oh1!)).toBe(32);
    await expectInSync();
  });
  it("disappear when a match is cancelled or stops counting, and come back", async () => {
    await client.query(`update matches set counts_for_fantasy = false where id = $1`, [m1]);
    expect(await pts(f.players.oh1!)).toBeUndefined();
    await client.query(`update matches set counts_for_fantasy = true where id = $1`, [m1]);
    expect(await pts(f.players.oh1!)).toBe(32);
    await client.query(`update matches set status = 'cancelled' where id = $1`, [m1]);
    expect(await pts(f.players.oh1!)).toBeUndefined();
    await client.query(`update matches set status = 'final' where id = $1`, [m1]);
    await expectInSync();
  });
  it("follow the fantasy weeks and removed stat lines", async () => {
    await client.query(`delete from matchup_weeks where league_id = $1 and week = 1`, [f.leagueId]);
    expect(await pts(f.players.oh1!)).toBeUndefined(); // the match is no longer in a fantasy week
    await client.query(`insert into matchup_weeks (league_id, week, starts_on, ends_on) values ($1, 1, '2026-11-09', '2026-11-15')`, [f.leagueId]);
    expect(await pts(f.players.oh1!)).toBe(32);
    await client.query(`delete from player_match_statistics where player_id = $1`, [f.players.oh2]);
    expect(await pts(f.players.oh2!)).toBeUndefined();
    await expectInSync();
  });
});
