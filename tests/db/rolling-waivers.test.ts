import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;
let teamC: string;
let carolTeam: string;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client); // limit 4; Alpha 3 players, Bravo 2
  // A third team (Carol) in last place: Alpha beat Bravo, Bravo beat Carol... set via standings below.
  await client.query(`insert into league_members values ($1, $2, 'manager')`, [f.leagueId, f.carol]);
  teamC = (await client.query(`insert into fantasy_teams (league_id, name, owner_user_id) values ($1, 'Charlie', $2) returning id`, [f.leagueId, f.carol])).rows[0].id;
  carolTeam = teamC;
  // Standings: Alpha 2-0, Bravo 0-1 (50 points), Charlie 0-1 (40 points): Charlie last.
  const game = async (w: number, h: string, a: string, hs: number, as: number) =>
    client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status, score_source, imported_home_score, imported_away_score) values ($1, $2, $3, $4, 'final', 'imported', $5, $6)`, [f.leagueId, w, h, a, hs, as]);
  await game(1, f.teamA, f.teamB, 90, 50);
  await game(2, f.teamA, teamC, 80, 40);
});
afterAll(async () => drop());

const q = (user: string, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const newPlayer = async (k: string) =>
  (await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, positions, source_system, source_id) values ($1,'T',$1||' T',$2,'OUA','womens','{OH}','test',$1) returning id`, [k, f.uniZ])).rows[0].id as string;
const order = async () => (await client.query(`select t.name from waiver_priority w join fantasy_teams t on t.id = w.fantasy_team_id where w.league_id = $1 order by position`, [f.leagueId])).rows.map((r) => r.name);
const run = async () => {
  await client.query(`update waiver_claims set process_after = now() - interval '1 second' where status = 'pending'`);
  return (await client.query(`select process_waivers($1) n`, [f.leagueId])).rows[0].n as number;
};
const winner = async (player: string) => (await client.query(`select t.name from waiver_claims w join fantasy_teams t on t.id = w.fantasy_team_id where w.player_id = $1 and w.status = 'won'`, [player])).rows[0]?.name;

describe("rolling waiver priority", () => {
  it("starts as the standings reversed; the winner moves to the back", async () => {
    const p1 = await newPlayer("w1");
    await q(f.alice, `select submit_waiver_claim($1, $2, null)`, [f.teamA, p1]);
    await q(f.bob, `select submit_waiver_claim($1, $2, null)`, [f.teamB, p1]);
    await q(f.carol, `select submit_waiver_claim($1, $2, null)`, [carolTeam, p1]);
    await run();
    expect(await winner(p1)).toBe("Charlie"); // last place picks first
    expect(await order()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });
  it("next night, the new top of the order wins, and also goes to the back", async () => {
    const p2 = await newPlayer("w2");
    await q(f.alice, `select submit_waiver_claim($1, $2, null)`, [f.teamA, p2]);
    await q(f.bob, `select submit_waiver_claim($1, $2, null)`, [f.teamB, p2]);
    await q(f.carol, `select submit_waiver_claim($1, $2, null)`, [carolTeam, p2]);
    await run();
    expect(await winner(p2)).toBe("Bravo");
    expect(await order()).toEqual(["Alpha", "Charlie", "Bravo"]);
  });
  it("within one night the order updates after each win", async () => {
    const p3 = await newPlayer("w3");
    const p4 = await newPlayer("w4");
    // Alpha (top) claims both; Charlie claims p4. Alpha gets p3 first, drops to the back, so Charlie gets p4.
    await q(f.alice, `select submit_waiver_claim($1, $2, null)`, [f.teamA, p3]);
    await q(f.alice, `select submit_waiver_claim($1, $2, $3)`, [f.teamA, p4, f.players.ohB]);
    await q(f.carol, `select submit_waiver_claim($1, $2, null)`, [carolTeam, p4]);
    await run();
    expect([await winner(p3), await winner(p4)]).toEqual(["Alpha", "Charlie"]);
    expect(await order()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });
});
