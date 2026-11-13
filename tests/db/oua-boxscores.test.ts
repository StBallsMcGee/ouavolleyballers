import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runOuaBoxScoreSync } from "@/lib/ingest/oua-boxscores";

const fixture = (f: string) => readFileSync(path.resolve(__dirname, "../../src/lib/sources/__fixtures__", f), "utf8");
let client: pg.Client;
let drop: () => Promise<void>;
let pool: pg.Pool;
const requests: string[] = [];
const fetchText = async (url: string) => {
  requests.push(url);
  if (url.endsWith("/schedule")) return fixture("oua-schedule.html");
  if (url.endsWith("20261107_juo3.xml")) return fixture("oua-boxscore.html");
  throw new Error("unexpected " + url);
};

beforeAll(async () => {
  const db = await createTestDb();
  ({ client, drop } = db);
  pool = new pg.Pool({ connectionString: db.url });
  await client.query(`insert into leagues (name, season_label, conference, gender) values ('L', '2026-27', 'OUA', 'womens')`);
  const uni = async (name: string, short: string) =>
    (await client.query(`insert into universities (name, short_name, source_system, source_id) values ($1, $2, 'usportvb', $2) returning id`, [name, short])).rows[0].id as string;
  const rmc = await uni("RMC", "RMC");
  const tmu = await uni("Toronto Metropolitan", "TMU");
  await uni("Toronto", "TOR");
  await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, jersey_number, source_system, source_id)
    values ('Elise', 'Pridmore', 'Elise Pridmore', $1, 'OUA', 'womens', 1, 'usportvb', 'p1')`, [tmu]);
  // Recorded with RMC at home, as on the OUA site; a second game OUA has no box score for.
  for (const [d, id] of [["2026-11-07", "g7"], ["2026-11-06", "g6"]]) {
    await client.query(`insert into matches (season_label, match_date, lock_at, home_university_id, away_university_id, status, source_system, source_id)
      values ('2026-27', $1, $2, $3, $4, 'final', 'usportvb', $5)`, [d, `${d}T23:00:00Z`, rmc, tmu, id]);
  }
});
afterAll(async () => { await pool.end(); await drop(); });

describe("OUA website box scores", () => {
  it("finds the link on the schedule and loads the box score (one request each, nothing from /action/)", async () => {
    const r = await runOuaBoxScoreSync({ pool, fetchText, lookbackDays: 4000, delayMs: 0 });
    expect([r.candidates, r.linksFound, r.boxScoresLoaded]).toEqual([2, 1, 1]);
    expect(requests.map((u) => u.replace("https://oua.ca", ""))).toEqual(["/sports/wvball/2026-27/schedule", "/sports/wvball/2026-27/boxscores/20261107_juo3.xml"]);
    const s = (await client.query(`select p.last_name, s.kills, s.digs, s.sets_played, s.source_system from player_match_statistics s join players p on p.id = s.player_id`)).rows;
    expect(s).toEqual([{ last_name: "Pridmore", kills: 3, digs: 0, sets_played: 1, source_system: "oua" }]);
    expect(r.warnings.some((w) => w.includes("not in our player list"))).toBe(true); // others in the fixture aren't in this test's player list
  });
  it("next run: the game with no OUA box score stays waiting; nothing is re-read", async () => {
    requests.length = 0;
    const r = await runOuaBoxScoreSync({ pool, fetchText, lookbackDays: 4000, delayMs: 0 });
    expect(r.candidates).toBe(1);
    expect(requests).toEqual(["https://oua.ca/sports/wvball/2026-27/schedule"]);
    expect(r.boxScoresLoaded).toBe(0);
  });
});
