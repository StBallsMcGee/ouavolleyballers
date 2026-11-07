import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runBoxScoreSync } from "@/lib/ingest/boxscores";
import { localDate, addDays } from "@/lib/time";

// Sample pages in the SIDEARM format (test data only).
const yesterday = addDays(localDate(), -1);
const [y, mo, d] = yesterday.split("-").map(Number) as [number, number, number];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1];
const schedule = `<ul><li class="sidearm-schedule-game x">
  <div class="sidearm-schedule-game-opponent-date flex"> ${MON} ${d} (Fri) 6:00 PM </div>
  <div class="sidearm-schedule-game-opponent-name"> Windsor Lancers </div>
  <a href="/sports/womens-volleyball/stats/2026-27/windsor-lancers/boxscore/99">Box Score</a></li></ul>`;
const row = (n: string, j: number, k: number, dig: number) =>
  `<tr><td>${j}</td><td>${j} ${n}</td><td>3</td><td>${k}</td><td>1</td><td>10</td><td>.300</td><td>0</td><td>0</td><td>1</td><td>2</td><td>1-2</td><td>0</td><td>1</td><td>0</td><td>${dig}</td><td>0</td><td>0</td><td>5.0</td></tr>`;
const table = (team: string, rows: string) => `<table class="sidearm-table"><caption>${team} - Individual</caption><thead><tr><th>#</th></tr></thead><tbody>${rows}<tr><td></td><td>Totals</td></tr></tbody></table>`;
const box = `<div>${mo}/${d}/${y}</div>${table("WINDSOR", row("Elle O'Connell", 1, 4, 8))}${table("WESTERN", row("Buntic, Emma", 1, 11, 6) + row("Ghost, Player", 99, 1, 1))}`;

let client: pg.Client;
let drop: () => Promise<void>;
let pool: pg.Pool;
const requests: string[] = [];
const fetchText = async (url: string) => {
  requests.push(url);
  if (url.endsWith("/schedule")) return schedule;
  if (url.includes("/boxscore/99")) return box;
  throw new Error("unexpected " + url);
};

beforeAll(async () => {
  const db = await createTestDb();
  ({ client, drop } = db);
  pool = new pg.Pool({ connectionString: db.url });
  await client.query(`insert into leagues (name, season_label, conference, gender) values ('L', '2026-27', 'OUA', 'womens')`);
  const uni = async (name: string, src: string, short: string) =>
    (await client.query(`insert into universities (name, short_name, source_system, source_id) values ($1, $3, 'usportvb', $2) returning id`, [name, src, short])).rows[0].id as string;
  const w = await uni("Western", "d5fxlv5sp7d57j2i", "WES");
  const win = await uni("Windsor", "1x1r2stwudexxbtb", "WIN");
  for (const [f, l, u, j] of [["Emma", "Buntic", w, 1], ["Elle", "O'Connell", win, 1]] as const) {
    await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, jersey_number, source_system, source_id) values ($1,$2,$1||' '||$2,$3,'OUA','womens',$4,'usportvb',$1)`, [f, l, u, j]);
  }
  await client.query(
    `insert into matches (season_label, match_date, start_time, lock_at, home_university_id, away_university_id, home_away_known, status, source_system, source_id)
     values ('2026-27', $1, $2, $2, $3, $4, true, 'scheduled', 'usportvb', 'm1')`,
    [yesterday, `${yesterday}T23:00:00Z`, w, win]);
});
afterAll(async () => { await pool.end(); await drop(); });

describe("school box score sync", () => {
  it("run 1: one request per school site to find the box score link", async () => {
    const r = await runBoxScoreSync({ pool, fetchText });
    expect([r.candidates, r.requests, r.linksFound, r.boxScoresLoaded]).toEqual([1, 2, 2, 0]);
    expect(requests.every((u) => u.endsWith("/schedule"))).toBe(true); // Western and Windsor schedule pages
  });
  it("run 2: loads the box score, matches players, reports unknown ones", async () => {
    requests.length = 0;
    const r = await runBoxScoreSync({ pool, fetchText });
    expect(r.requests).toBe(1); // the box score is read once, from the home school's site
    expect(requests[0]).toContain("westernmustangs.ca");
    expect(r.boxScoresLoaded).toBe(1);
    expect(r.statsInserted).toBe(2);
    expect(r.warnings.some((w) => w.includes("Player Ghost"))).toBe(true);
    const s = (await client.query(`select p.last_name, s.kills, s.digs, s.sets_played, s.source_system from player_match_statistics s join players p on p.id = s.player_id order by 1`)).rows;
    expect(s).toEqual([
      { last_name: "Buntic", kills: 11, digs: 6, sets_played: 3, source_system: "school-boxscore" },
      { last_name: "O'Connell", kills: 4, digs: 8, sets_played: 3, source_system: "school-boxscore" },
    ]);
    expect((await client.query(`select status::text, stats_available from matches`)).rows[0]).toEqual({ status: "final", stats_available: true });
  });
  it("run 3: nothing left to do, no requests", async () => {
    requests.length = 0;
    const r = await runBoxScoreSync({ pool, fetchText });
    expect([r.status, requests.length]).toEqual(["skipped", 0]);
  });
});
