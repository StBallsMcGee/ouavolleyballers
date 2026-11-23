import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // roster: OH 1, M 1, UTIL 1, TOTAL 4. Alpha: oh1 OH, m1 M, ohB BENCH
  // Put Alpha's bench player in UTIL, and save a plan for a future day using UTIL.
  await client.query(`update lineup_entries set valid_to = now() where player_id = $1 and valid_to is null`, [f.players.ohB]);
  await client.query(
    `insert into lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot)
     select id, fantasy_team_id, player_id, 'UTIL' from roster_assignments where player_id = $1 and released_at is null`, [f.players.ohB]);
  await client.query(`insert into lineup_plans (fantasy_team_id, plan_date, lineup) values ($1, '2099-01-01', $2)`,
    [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "OH" }, { player_id: f.players.m1, slot: "M" }, { player_id: f.players.ohB, slot: "UTIL" }])]);
});
afterAll(async () => drop());

const lineup = async () => Object.fromEntries((await client.query(
  `select player_id, slot from lineup_entries where fantasy_team_id = $1 and valid_to is null`, [f.teamA])).rows.map((r) => [r.player_id, r.slot]));
const setRoster = (roster: Record<string, number>) =>
  client.query(`update leagues set settings = jsonb_set(settings, '{roster}', $2::jsonb) where id = $1`, [f.leagueId, JSON.stringify(roster)]);

describe("changing the starting slots", () => {
  it("removing UTIL moves that player to the bench (lineup and saved plans)", async () => {
    await setRoster({ S: 0, OH: 1, M: 1, L: 0, UTIL: 0, TOTAL: 4 });
    expect(await lineup()).toEqual({ [f.players.oh1!]: "OH", [f.players.m1!]: "M", [f.players.ohB!]: "BENCH" });
    const plan = (await client.query(`select lineup from lineup_plans where fantasy_team_id = $1`, [f.teamA])).rows[0].lineup;
    expect(plan.find((x: { player_id: string }) => x.player_id === f.players.ohB).slot).toBe("BENCH");
  });
  it("renamed slots carry players over (OH -> OH1 when a second OH slot is added)", async () => {
    await setRoster({ S: 0, OH: 2, M: 1, L: 0, UTIL: 0, TOTAL: 4 });
    expect((await lineup())[f.players.oh1!]).toBe("OH1");
    await setRoster({ S: 0, OH: 1, M: 1, L: 0, UTIL: 0, TOTAL: 4 });
    expect((await lineup())[f.players.oh1!]).toBe("OH");
  });
  it("other settings changes leave lineups alone", async () => {
    const before = await lineup();
    await client.query(`update leagues set settings = jsonb_set(settings, '{trades,enabled}', 'false') where id = $1`, [f.leagueId]);
    expect(await lineup()).toEqual(before);
  });
});
