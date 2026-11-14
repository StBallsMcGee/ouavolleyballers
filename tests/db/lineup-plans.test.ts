import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let today: string;
let tomorrow: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  const r = (await client.query(`select (now() at time zone 'America/Toronto')::date::text t, ((now() at time zone 'America/Toronto')::date + 1)::text n`)).rows[0];
  today = r.t;
  tomorrow = r.n;
});
afterAll(async () => drop());

const q = (user: string | null, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const lineupOf = async (team: string) =>
  Object.fromEntries((await client.query(`select player_id, slot from lineup_entries where fantasy_team_id = $1 and valid_to is null`, [team])).rows.map((r) => [r.player_id, r.slot]));

describe("lineups for future days", () => {
  it("can be set for tomorrow even while players are locked today, and today's lineup is unchanged", async () => {
    // oh1's game today has started: she is locked today.
    await addMatch(client, f, { date: today, lockAt: new Date(Date.now() - 3600_000).toISOString(), a: f.uniX, b: f.uniY, status: "live" });
    const plan = [{ player_id: f.players.oh1, slot: "BENCH" }, { player_id: f.players.m1, slot: "M" }, { player_id: f.players.ohB, slot: "OH" }];
    await expect(q(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify(plan)])).rejects.toThrow(/locked/);
    await q(f.alice, `select save_lineup_plan($1, $2::date, $3)`, [f.teamA, tomorrow, JSON.stringify(plan)]);
    expect((await lineupOf(f.teamA))[f.players.oh1!]).toBe("OH");
    expect((await q(f.bob, `select count(*)::int n from lineup_plans`)).rows[0].n).toBe(1); // league members can see it
  });
  it("is checked like any lineup, only by the manager, and only for days that haven't started", async () => {
    await expect(q(f.bob, `select save_lineup_plan($1, $2::date, $3)`, [f.teamA, tomorrow, "[]"])).rejects.toThrow(/own team/);
    const bad = [{ player_id: f.players.oh1, slot: "M" }, { player_id: f.players.m1, slot: "BENCH" }, { player_id: f.players.ohB, slot: "BENCH" }];
    await expect(q(f.alice, `select save_lineup_plan($1, $2::date, $3)`, [f.teamA, tomorrow, JSON.stringify(bad)])).rejects.toThrow(/not eligible/);
    await expect(q(f.alice, `select save_lineup_plan($1, $2::date, $3)`, [f.teamA, today, "[]"])).rejects.toThrow(/has started/);
  });
  it("is applied when its day starts (here: by moving it to today and clearing today's games)", async () => {
    await client.query(`delete from matches`);
    await client.query(`update lineup_plans set plan_date = $1`, [today]);
    expect((await client.query(`select apply_due_lineup_plans() n`)).rows[0].n).toBe(1);
    const l = await lineupOf(f.teamA);
    expect([l[f.players.oh1!], l[f.players.ohB!], l[f.players.m1!]]).toEqual(["BENCH", "OH", "M"]);
    expect((await client.query(`select apply_due_lineup_plans() n`)).rows[0].n).toBe(0); // only once
  });
});
