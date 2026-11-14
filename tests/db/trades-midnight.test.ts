import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // Alpha: oh1, m1 (school X), ohB (Z). Bravo: oh2, m2 (school Y).
});
afterAll(async () => drop());

const q = (user: string, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const teamOf = async (player: string) => (await client.query(`select fantasy_team_id from roster_assignments where player_id = $1 and released_at is null`, [player])).rows[0]?.fantasy_team_id;
const status = async (id: string) => (await client.query(`select status::text s from trades where id = $1`, [id])).rows[0].s;

describe("accepting a trade", () => {
  it("happens right away when nobody in it has played today", async () => {
    const id = (await q(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.ohB], [f.players.m2]])).rows[0].id;
    expect((await q(f.bob, `select respond_trade($1, true) s`, [id])).rows[0].s).toBe("completed");
    expect(await teamOf(f.players.ohB!)).toBe(f.teamB);
  });
  it("waits for midnight when one of the players' games today has started", async () => {
    const today = (await client.query(`select (now() at time zone 'America/Toronto')::date::text d`)).rows[0].d;
    await addMatch(client, f, { date: today, lockAt: new Date(Date.now() - 3600_000).toISOString(), a: f.uniX, b: f.uniZ, status: "live" });
    const id = (await q(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.oh1], [f.players.oh2]])).rows[0].id;
    expect((await q(f.bob, `select respond_trade($1, true) s`, [id])).rows[0].s).toBe("accepted");
    expect(await teamOf(f.players.oh1!)).toBe(f.teamA); // not yet
    expect((await client.query(`select process_due_trades() n`)).rows[0].n).toBe(0); // before midnight
    await client.query(`update trades set execute_after = now() - interval '1 second' where id = $1`, [id]);
    expect((await client.query(`select process_due_trades() n`)).rows[0].n).toBe(1);
    expect(await status(id)).toBe("completed");
    expect([await teamOf(f.players.oh1!), await teamOf(f.players.oh2!)]).toEqual([f.teamB, f.teamA]);
  });
  it("an accepted trade fails at midnight if a player left the team meanwhile", async () => {
    const id = (await q(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.oh2], [f.players.oh1]])).rows[0].id;
    expect((await q(f.bob, `select respond_trade($1, true) s`, [id])).rows[0].s).toBe("accepted");
    await q(f.bob, `select add_drop($1, null, $2)`, [f.teamB, f.players.oh1]);
    await client.query(`update trades set execute_after = now() - interval '1 second' where id = $1`, [id]);
    await client.query(`select process_due_trades()`);
    expect(await status(id)).toBe("failed");
  });
});
