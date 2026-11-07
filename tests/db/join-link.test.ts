import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let open1: string;
let open2: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  open1 = (await client.query(`insert into fantasy_teams (league_id, name, manager_display_name) values ($1, 'Open One', 'Dana') returning id`, [f.leagueId])).rows[0].id;
  open2 = (await client.query(`insert into fantasy_teams (league_id, name) values ($1, 'Open Two') returning id`, [f.leagueId])).rows[0].id;
});
afterAll(async () => drop());

const q = (user: string | null, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const newUser = async (email: string) => (await client.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;

describe("shareable invite link", () => {
  let code: string;
  it("only the admin can get the link, and it stays the same until reset", async () => {
    await expect(q(f.alice, `select admin_join_code($1)`, [f.leagueId])).rejects.toThrow(/administrator/);
    code = (await q(f.admin, `select admin_join_code($1) c`, [f.leagueId])).rows[0].c;
    expect(code).toMatch(/^[0-9a-f]{16}$/);
    expect((await q(f.admin, `select admin_join_code($1) c`, [f.leagueId])).rows[0].c).toBe(code);
  });
  it("the table itself is never readable directly", async () => {
    await expect(q(f.alice, `select * from league_join_links`)).rejects.toThrow(/permission denied/);
  });
  it("anyone with the code sees the league name and open team count; a wrong code shows nothing", async () => {
    expect((await q(null, `select * from join_link_info($1)`, [code])).rows).toEqual([{ league_name: expect.any(String), open_teams: 2 }]);
    expect((await q(null, `select * from join_link_info('nope')`)).rows).toEqual([]);
  });
  it("a new user picks an open team and becomes a league manager", async () => {
    const erin = await newUser("erin@example.test");
    const teams = (await q(erin, `select name, manager_hint from join_link_teams($1)`, [code])).rows;
    expect(teams).toEqual([{ name: "Open One", manager_hint: "Dana" }, { name: "Open Two", manager_hint: null }]);
    await q(erin, `select join_with_link($1, $2, 'Erin')`, [code, open1]);
    expect((await client.query(`select owner_user_id from fantasy_teams where id = $1`, [open1])).rows[0].owner_user_id).toBe(erin);
    expect((await client.query(`select role::text from league_members where user_id = $1`, [erin])).rows[0].role).toBe("manager");
    expect((await client.query(`select display_name from profiles where id = $1`, [erin])).rows[0].display_name).toBe("Erin");
    await expect(q(erin, `select join_with_link($1, $2)`, [code, open2])).rejects.toThrow(/already manage Open One/);
  });
  it("claimed teams can't be taken, and a reset link stops the old one", async () => {
    const finn = await newUser("finn@example.test");
    await expect(q(finn, `select join_with_link($1, $2)`, [code, f.teamA])).rejects.toThrow(/already claimed/);
    await expect(q(finn, `select join_with_link($1, $2)`, [code, open1])).rejects.toThrow(/already claimed/);
    const fresh = (await q(f.admin, `select admin_join_code($1, true) c`, [f.leagueId])).rows[0].c;
    expect(fresh).not.toBe(code);
    await expect(q(finn, `select join_with_link($1, $2)`, [code, open2])).rejects.toThrow(/no longer valid/);
    await q(finn, `select join_with_link($1, $2)`, [fresh, open2]);
    expect((await q(null, `select open_teams from join_link_info($1)`, [fresh])).rows[0].open_teams).toBe(0);
  });
});
