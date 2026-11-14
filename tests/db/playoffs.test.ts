import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let league: string;
const team: string[] = []; // team[i] = the team that finishes the regular season in place i + 1

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  league = (await client.query(`insert into leagues (name, season_label, conference, gender, status, settings)
    values ('P', '2026-27', 'OUA', 'womens', 'active', '{"playoffs": {"enabled": true, "teams": 8, "startWeek": 2}}') returning id`)).rows[0].id;
  for (let i = 0; i < 16; i++) team.push((await client.query(`insert into fantasy_teams (league_id, name) values ($1, $2) returning id`, [league, `T${i + 1}`])).rows[0].id);
  await client.query(`alter table matchup_weeks drop constraint if exists matchup_weeks_monday_to_sunday`);
  for (let w = 1; w <= 4; w++) await client.query(`insert into matchup_weeks (league_id, week, starts_on, ends_on) values ($1, $2, $3, $4)`, [league, w, `2027-01-0${w}`, `2027-01-0${w}`]);
  // Regular season (week 1): T1 beats T16 by the most, ... so the standings are T1..T16.
  for (let i = 0; i < 8; i++) {
    await client.query(`insert into matchups (league_id, week, home_team_id, away_team_id, status, score_source, imported_home_score, imported_away_score)
      values ($1, 1, $2, $3, 'final', 'imported', $4, $5)`, [league, team[i], team[15 - i], 100 - i, 10 + i]);
  }
});
afterAll(async () => drop());

const advance = async () => (await client.query(`select advance_playoffs($1) n`, [league])).rows[0].n as number;
const games = async (week: number) =>
  (await client.query(`select m.label, m.place_base, h.name home, a.name away from matchups m join fantasy_teams h on h.id = m.home_team_id join fantasy_teams a on a.id = m.away_team_id
    where m.league_id = $1 and m.week = $2 order by m.place_base, m.bracket_slot`, [league, week])).rows.map((r) => `${r.label}: ${r.home} v ${r.away}`);
// The home team (better seed) wins every game, except where named.
const finishWeek = async (week: number, upsets: string[] = []) => {
  for (const m of (await client.query(`select m.id, h.name home from matchups m join fantasy_teams h on h.id = m.home_team_id where m.league_id = $1 and m.week = $2`, [league, week])).rows) {
    const upset = upsets.includes(m.home);
    await client.query(`update matchups set status = 'final', score_source = 'imported', imported_home_score = $2, imported_away_score = $3 where id = $1`, [m.id, upset ? 1 : 2, upset ? 2 : 1]);
  }
};

describe("automatic playoffs", () => {
  it("week 2 (first playoff week): quarterfinals for 1–8, consolation ladder for 9–16", async () => {
    expect(await advance()).toBe(8);
    expect(await games(2)).toEqual([
      "Quarterfinal: T1 v T8", "Quarterfinal: T4 v T5", "Quarterfinal: T2 v T7", "Quarterfinal: T3 v T6",
      "Consolation ladder · round 1: T9 v T16", "Consolation ladder · round 1: T12 v T13", "Consolation ladder · round 1: T10 v T15", "Consolation ladder · round 1: T11 v T14",
    ]);
    expect(await advance()).toBe(0); // the next round waits for week 2 to finish
  });
  it("week 3: semifinals for the winners; losers play for 5th–8th (and 13th–16th)", async () => {
    await finishWeek(2, ["T4"]); // T5 upsets T4
    expect(await advance()).toBe(8);
    expect(await games(3)).toEqual([
      "Semifinal: T1 v T5", "Semifinal: T2 v T3",
      "5th–8th place semifinal: T4 v T8", "5th–8th place semifinal: T6 v T7",
      "9th–12th place semifinal: T9 v T12", "9th–12th place semifinal: T10 v T11",
      "13th–16th place semifinal: T13 v T16", "13th–16th place semifinal: T14 v T15",
    ]);
  });
  it("week 4: championship, bronze medal and a game for every other place", async () => {
    await finishWeek(3, ["T2"]); // T3 beats T2
    expect(await advance()).toBe(8);
    expect(await games(4)).toEqual([
      "Championship: T1 v T3", "Bronze medal: T2 v T5", "5th place: T4 v T6", "7th place: T7 v T8",
      "9th place: T9 v T10", "11th place: T11 v T12", "13th place: T13 v T14", "15th place: T15 v T16",
    ]);
    expect(await advance()).toBe(0);
  });
  it("playoff games don't change the regular standings", async () => {
    const st = (await client.query(`select f.name, s.wins, s.losses from v_standings s join fantasy_teams f on f.id = s.fantasy_team_id where f.name in ('T1', 'T16')`)).rows;
    expect(st).toEqual(expect.arrayContaining([{ name: "T1", wins: 1, losses: 0 }, { name: "T16", wins: 0, losses: 1 }]));
  });
});
