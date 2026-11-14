import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // limit 4; Alpha has 3 (oh1, m1, ohB), Bravo has 2 (oh2, m2)
  // Fill Alpha to the limit.
  await client.query(`select internal_assign_player($1, $2, $3, 'add')`, [f.leagueId, f.teamA, f.players.fa1]);
});
afterAll(async () => drop());

const q = (user: string, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const count = async (team: string) => (await client.query(`select count(*)::int n from roster_assignments where fantasy_team_id = $1 and released_at is null`, [team])).rows[0].n;
const lineup = async (team: string) =>
  (await client.query(`select player_id, slot from lineup_entries where fantasy_team_id = $1 and valid_to is null`, [team])).rows.map((r) => ({ player_id: r.player_id, slot: r.slot }));

describe("trades over the roster limit", () => {
  it("a 2-for-1 trade takes Alpha to 5 of 4", async () => {
    const id = (await q(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.m1], [f.players.oh2, f.players.m2]])).rows[0].id;
    expect((await q(f.bob, `select respond_trade($1, true) s`, [id])).rows[0].s).toBe("completed");
    expect(await count(f.teamA)).toBe(5);
  });
  it("then Alpha can't change its lineup, set a later day's lineup, or add anyone", async () => {
    const l = await lineup(f.teamA);
    await expect(q(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify(l)])).rejects.toThrow(/over the limit .*Drop a player/);
    await expect(q(f.alice, `select save_lineup_plan($1, current_date + 2, $2)`, [f.teamA, JSON.stringify(l)])).rejects.toThrow(/over the limit/);
    await expect(q(f.alice, `select claim_player($1, $2, $3)`, [f.teamA, f.players.dup1, f.players.oh1])).rejects.toThrow(/over the limit/);
  });
  it("dropping back to the limit unlocks the lineup", async () => {
    await q(f.alice, `select add_drop($1, null, $2)`, [f.teamA, f.players.fa1]);
    expect(await count(f.teamA)).toBe(4);
    await q(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify(await lineup(f.teamA))]);
  });
});
