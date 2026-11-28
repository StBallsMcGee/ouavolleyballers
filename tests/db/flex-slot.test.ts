import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let setter: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // OH 1, M 1, UTIL 1, TOTAL 4. Alpha: oh1 (OH), m1 (M), ohB (OH, bench)
  setter = (await client.query(
    `insert into players (first_name, last_name, display_name, university_id, conference, gender, position_label, positions, source_system, source_id)
     values ('set', 'Test', 'set Test', $1, 'OUA', 'womens', 'S', array['S'], 'test', 'set') returning id`, [f.uniX])).rows[0].id;
  const ra = await client.query(`insert into roster_assignments (league_id, fantasy_team_id, player_id, acquisition_type, acquired_at) values ($1, $2, $3, 'import', '2026-11-01') returning id`, [f.leagueId, f.teamA, setter]);
  await client.query(`insert into lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, valid_from) values ($1, $2, $3, 'BENCH', '2026-11-01')`, [ra.rows[0].id, f.teamA, setter]);
  // Add a FLEX slot (and room for it).
  await client.query(`update leagues set settings = jsonb_set(settings, '{roster}', '{"S":0,"OH":1,"M":1,"L":0,"UTIL":1,"FLEX":1,"TOTAL":5}') where id = $1`, [f.leagueId]);
});
afterAll(async () => drop());

const setLineup = (lineup: Array<{ player_id: string; slot: string }>) =>
  asUser(client, f.alice, () => client.query(`select set_lineup($1, $2)`, [f.teamA, JSON.stringify(lineup)]));
const lineup = async () => Object.fromEntries((await client.query(
  `select player_id, slot from lineup_entries where fantasy_team_id = $1 and valid_to is null`, [f.teamA])).rows.map((r) => [r.player_id, r.slot]));

describe("FLEX slot (OH or M)", () => {
  it("is one of the league's starting slots, after the middles", async () => {
    const r = await client.query(`select league_starting_slots($1) s`, [f.leagueId]);
    expect(r.rows[0].s).toEqual(["OH", "M", "FLEX", "UTIL"]);
  });
  it("takes an outside hitter or a middle", async () => {
    await setLineup([{ player_id: f.players.oh1!, slot: "OH" }, { player_id: f.players.m1!, slot: "M" }, { player_id: f.players.ohB!, slot: "FLEX" }, { player_id: setter, slot: "UTIL" }]);
    expect((await lineup())[f.players.ohB!]).toBe("FLEX");
    await setLineup([{ player_id: f.players.oh1!, slot: "OH" }, { player_id: f.players.m1!, slot: "FLEX" }, { player_id: f.players.ohB!, slot: "BENCH" }, { player_id: setter, slot: "UTIL" }]);
    expect((await lineup())[f.players.m1!]).toBe("FLEX");
  });
  it("refuses a setter", async () => {
    await expect(setLineup([{ player_id: f.players.oh1!, slot: "OH" }, { player_id: f.players.m1!, slot: "M" }, { player_id: f.players.ohB!, slot: "BENCH" }, { player_id: setter, slot: "FLEX" }]))
      .rejects.toThrow(/not eligible/);
  });
  it("counts toward the starting slots when saving settings, and removing it benches whoever is in it", async () => {
    await client.query(`update leagues set settings = jsonb_set(settings, '{roster}', '{"S":0,"OH":1,"M":1,"L":0,"UTIL":1,"FLEX":0,"TOTAL":5}') where id = $1`, [f.leagueId]);
    expect((await lineup())[f.players.m1!]).toBe("BENCH");
  });
});
