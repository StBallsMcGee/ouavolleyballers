import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // limit 4. Alpha: oh1, m1, ohB. Bravo: oh2, m2. Free agent: fa1.
});
afterAll(async () => drop());

const q = (user: string, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const waiverUntil = async (player: string) =>
  (await client.query(`select until from player_waivers where league_id = $1 and player_id = $2`, [f.leagueId, player])).rows[0]?.until as Date | undefined;
const secondMidnight = async () =>
  (await client.query(`select ((date_trunc('day', now() at time zone 'America/Toronto') + interval '2 days') at time zone 'America/Toronto') t`)).rows[0].t as Date;

describe("waiver period after a drop", () => {
  it("a dropped player is on waivers until the second midnight", async () => {
    await q(f.alice, `select add_drop($1, null, $2)`, [f.teamA, f.players.ohB]);
    expect((await waiverUntil(f.players.ohB!))?.toISOString()).toBe((await secondMidnight()).toISOString());
  });
  it("she can't be added right away; claims wait for the end of the waiver period", async () => {
    const r = await q(f.bob, `select claim_player($1, $2, null) r`, [f.teamB, f.players.ohB]);
    expect(r.rows[0].r).toBe("claimed");
    const c = (await client.query(`select process_after from waiver_claims where player_id = $1 and status = 'pending'`, [f.players.ohB])).rows[0];
    expect(new Date(c.process_after).toISOString()).toBe((await secondMidnight()).toISOString());
    expect((await client.query(`select count(*)::int n from roster_assignments where player_id = $1 and released_at is null`, [f.players.ohB])).rows[0].n).toBe(0);
  });
  it("a free agent who wasn't dropped can still be added right away", async () => {
    const r = await q(f.alice, `select claim_player($1, $2, null) r`, [f.teamA, f.players.fa1]);
    expect(r.rows[0].r).toBe("added");
  });
  it("players moved in a trade don't go on waivers", async () => {
    const id = (await q(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.m1], [f.players.m2]])).rows[0].id;
    await q(f.bob, `select respond_trade($1, true)`, [id]);
    expect(await waiverUntil(f.players.m1!)).toBeUndefined();
    expect(await waiverUntil(f.players.m2!)).toBeUndefined();
  });
});

describe("dissolving a team", () => {
  let carolTeam: string;
  beforeAll(async () => {
    await client.query(`insert into league_members values ($1, $2, 'manager')`, [f.leagueId, f.carol]);
    carolTeam = (await client.query(`insert into fantasy_teams (league_id, name, owner_user_id) values ($1, 'Charlie', $2) returning id`, [f.leagueId, f.carol])).rows[0].id;
    // Charlie beat Alpha in week 1 (final); they meet again in week 2.
    await client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status, score_source, imported_home_score, imported_away_score) values ($1, 1, $2, $3, 'final', 'imported', 50, 40)`, [f.leagueId, carolTeam, f.teamA]);
    await client.query(`update players set active = true`);
    // Give Charlie a player directly.
    const p = (await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, position_label, positions, source_system, source_id) values ('c', 'P', 'c P', $1, 'OUA', 'womens', 'OH', '{OH}', 'test', 'cp') returning id`, [f.uniZ])).rows[0].id;
    await q(f.carol, `select claim_player($1, $2, null)`, [carolTeam, p]);
  });

  it("only the commissioner can dissolve a team", async () => {
    await expect(q(f.alice, `select admin_dissolve_team($1)`, [carolTeam])).rejects.toThrow();
  });
  it("sends every player to waivers, removes the manager, and keeps the team and its record", async () => {
    const n = (await q(f.admin, `select admin_dissolve_team($1) n`, [carolTeam])).rows[0].n;
    expect(n).toBe(1);
    const t = (await client.query(`select owner_user_id, dissolved_at, active from fantasy_teams where id = $1`, [carolTeam])).rows[0];
    expect(t.owner_user_id).toBeNull();
    expect(t.dissolved_at).not.toBeNull();
    expect(t.active).toBe(true);
    const cp = (await client.query(`select id from players where source_id = 'cp'`)).rows[0].id;
    expect((await waiverUntil(cp))?.toISOString()).toBe((await secondMidnight()).toISOString());
    // Alpha's loss to Charlie still counts.
    const st = (await client.query(`select name, wins, losses from v_standings where league_id = $1 and name in ('Alpha', 'Charlie') order by name`, [f.leagueId])).rows;
    expect(st).toEqual([{ name: "Alpha", wins: 0, losses: 1 }, { name: "Charlie", wins: 1, losses: 0 }]);
  });
  it("can't be taken by a manager again", async () => {
    await expect(client.query(`update fantasy_teams set owner_user_id = $2 where id = $1`, [carolTeam, f.carol])).rejects.toThrow(/dissolved/);
  });
});

describe("guest players from men's teams", () => {
  it("can be claimed in the women's league", async () => {
    const uni = (await client.query(`insert into universities (name, short_name, gender, source_system, source_id) values ('Windsor (Men)', 'WIN-M', 'mens', 'guest-men', 'windsor') returning id`)).rows[0].id;
    const micah = (await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, position_label, positions, jersey_number, source_system, source_id)
      values ('Micah', 'Huisman', 'Micah Huisman', $1, 'OUA', 'mens', 'M', '{M}', 15, 'guest-men', 'windsor-micah-huisman') returning id`, [uni])).rows[0].id;
    const r = await q(f.bob, `select claim_player($1, $2, $3) r`, [f.teamB, micah, f.players.oh2]).catch((e) => ({ rows: [{ r: (e as Error).message }] }));
    expect(["added", "claimed"]).toContain(r.rows[0].r);
  });
});
