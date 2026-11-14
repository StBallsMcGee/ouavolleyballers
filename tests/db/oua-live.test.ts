import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runOuaLiveSync } from "@/lib/ingest/oua-live";

const fixture = (f: string) => readFileSync(path.resolve(__dirname, "../../src/lib/sources/__fixtures__", f), "utf8");
const live = fixture("oua-live-individual.html");
// The same page after the match: "Final" in the score table, and one more kill for Aliah Admans.
const final = live.replace(/(<table class="table mb-0">[\s\S]*?<th[^>]*>)[\s\S]*?(<\/th>)/, "$1Final$2")
  .replace(/(Aliah Admans<\/a>[\s\S]*?<\/th>\s*<td>\d+<\/td>\s*<td>)(\d+)/, (_m, a, k) => `${a}${Number(k) + 1}`);

let client: pg.Client;
let drop: () => Promise<void>;
let pool: pg.Pool;
let page = live;
const requests: string[] = [];
const fetchText = async (url: string) => {
  requests.push(url.replace("https://oua.ca", ""));
  if (url.includes("/composite")) return fixture("oua-composite.html");
  if (url.includes("20261113_6m3g.xml?view=individual")) return page;
  throw new Error("unexpected " + url);
};
let matchId: string;

beforeAll(async () => {
  const db = await createTestDb();
  ({ client, drop } = db);
  pool = new pg.Pool({ connectionString: db.url });
  await client.query(`insert into leagues (name, season_label, conference, gender) values ('L', '2026-27', 'OUA', 'womens')`);
  const uni = async (name: string, short: string) =>
    (await client.query(`insert into universities (name, short_name, source_system, source_id) values ($1, $2, 'usportvb', $2) returning id`, [name, short])).rows[0].id as string;
  const mac = await uni("McMaster", "MAC");
  const win = await uni("Windsor", "WIN");
  await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, jersey_number, source_system, source_id)
    values ('Aliah', 'Admans', 'Aliah Admans', $1, 'OUA', 'womens', 6, 'usportvb', 'p1')`, [win]);
  // Started 40 minutes ago, today (the fixtures' links are dated 2026-11-13; the date is rewritten to today below).
  const today = (await client.query(`select (now() at time zone 'America/Toronto')::date::text d`)).rows[0].d as string;
  matchId = (await client.query(`insert into matches (season_label, match_date, start_time, lock_at, home_university_id, away_university_id, status, source_system, source_id)
    values ('2026-27', $1, now() - interval '40 minutes', now() - interval '40 minutes', $2, $3, 'scheduled', 'usportvb', 'g1') returning id`, [today, win, mac])).rows[0].id;
  await client.query(`insert into box_score_links (match_id, school_site, url) values ($1, 'oua.ca', 'https://oua.ca/sports/wvball/2026-27/boxscores/20261113_6m3g.xml')`, [matchId]);
});
afterAll(async () => { await pool.end(); await drop(); });

const line = async () => (await client.query(`select kills, source_system from player_match_statistics where match_id = $1`, [matchId])).rows;
const status = async () => (await client.query(`select status::text s from matches where id = $1`, [matchId])).rows[0].s;

describe("live scoring from the OUA website", () => {
  it("does nothing at all when no game is on", async () => {
    await client.query(`update matches set start_time = now() + interval '3 hours', lock_at = now() + interval '3 hours' where id = $1`, [matchId]);
    const r = await runOuaLiveSync({ pool, fetchText, delayMs: 0 });
    expect([r.status, requests.length]).toEqual(["skipped", 0]);
    await client.query(`update matches set start_time = now() - interval '40 minutes', lock_at = now() - interval '40 minutes' where id = $1`, [matchId]);
  });
  it("during the game: saves live lines and marks the game live (individual-stats page only)", async () => {
    const r = await runOuaLiveSync({ pool, fetchText, delayMs: 0 });
    expect(r.gamesUpdated).toBe(1);
    expect(requests).toEqual(["/sports/wvball/2026-27/boxscores/20261113_6m3g.xml?view=individual"]);
    expect(await line()).toEqual([{ kills: 11, source_system: "oua-live" }]);
    expect(await status()).toBe("live");
  });
  it("at the end: final numbers replace the live ones and the game is final; then it stops", async () => {
    page = final;
    await runOuaLiveSync({ pool, fetchText, delayMs: 0 });
    expect(await line()).toEqual([{ kills: 12, source_system: "oua" }]);
    expect(await status()).toBe("final");
    requests.length = 0;
    const r = await runOuaLiveSync({ pool, fetchText, delayMs: 0 });
    expect([r.status, requests.length]).toEqual(["skipped", 0]);
  });
});
