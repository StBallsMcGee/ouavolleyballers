import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runGuestMenSync } from "@/lib/ingest/guest-men";

// Three games from Windsor's real men's schedule page: an alumni game (not OUA), a finished OUA
// game at Western (with a box score) and an upcoming OUA game against Brock.
const schedule = readFileSync(path.join(process.cwd(), "src/lib/sources/__fixtures__/sidearm-men-schedule.html"), "utf8");
const row = (n: string, j: number, k: number, dig: number) =>
  `<tr><td>${j}</td><td>${j} ${n}</td><td>4</td><td>${k}</td><td>2</td><td>20</td><td>.300</td><td>0</td><td>1</td><td>1</td><td>2</td><td>1-2</td><td>0</td><td>2</td><td>1</td><td>${dig}</td><td>0</td><td>0</td><td>5.0</td></tr>`;
const table = (team: string, rows: string) => `<table class="sidearm-table"><caption>${team} - Individual</caption><thead><tr><th>#</th></tr></thead><tbody>${rows}<tr><td></td><td>Totals</td></tr></tbody></table>`;
const box = `<div>10/30/2026</div>${table("WINDSOR", row("Huisman, Micah", 15, 9, 3) + row("Other, Guy", 4, 12, 5))}${table("WESTERN", row("Someone, Else", 7, 10, 4))}`;

let client: pg.Client;
let drop: () => Promise<void>;
let pool: pg.Pool;
const requests: string[] = [];
const fetchText = async (url: string) => {
  requests.push(url);
  if (url.endsWith("/sports/mens-volleyball/schedule")) return schedule;
  if (url.includes("/boxscore/6264")) return box;
  throw new Error("unexpected " + url);
};

beforeAll(async () => {
  const db = await createTestDb();
  ({ client, drop } = db);
  pool = new pg.Pool({ connectionString: db.url });
  await client.query(`insert into leagues (name, season_label, conference, gender, status) values ('L', '2026-27', 'OUA', 'womens', 'active')`);
  for (const [name, short, src] of [["Windsor", "WIN", "win"], ["Western", "WES", "wes"], ["Brock", "BRK", "brk"]]) {
    await client.query(`insert into universities (name, short_name, gender, source_system, source_id) values ($1, $2, 'womens', 'usportvb', $3)`, [name, short, src]);
  }
});
afterAll(async () => { await pool.end(); await drop(); });

describe("guest players from men's teams", () => {
  it("run 1: reads the schedule once and adds the team, his OUA games, and the player with his profile", async () => {
    const r = await runGuestMenSync({ pool, fetchText, now: new Date("2026-11-26T12:00:00Z") });
    expect(r.requests).toBe(1);
    expect(r.matchesUpserted).toBe(2); // the alumni game isn't an OUA game
    const games = (await client.query(
      `select m.match_date::text d, uh.name home, ua.name away, m.status, m.home_sets, m.away_sets, m.lock_source, m.start_time
         from matches m join universities uh on uh.id = m.home_university_id join universities ua on ua.id = m.away_university_id order by 1`)).rows;
    expect(games.map((g) => [g.d, g.home, g.away, g.status, g.home_sets, g.away_sets])).toEqual([
      ["2026-10-30", "Western (Men)", "Windsor (Men)", "final", 1, 3],
      ["2026-11-27", "Windsor (Men)", "Brock (Men)", "scheduled", null, null],
    ]);
    expect(games[1].lock_source).toBe("source"); // 7:30 PM start from the page
    expect(new Date(games[1].start_time).toISOString()).toBe("2026-11-28T00:30:00.000Z");
    const p = (await client.query(
      `select p.display_name, p.gender, p.position_label, p.positions, p.jersey_number, u.name uni, u.short_name, pr.photo_url, pr.source_label
         from players p join universities u on u.id = p.university_id join player_profiles pr on pr.player_id = p.id`)).rows;
    expect(p).toEqual([{ display_name: "Micah Huisman", gender: "mens", position_label: "M", positions: ["M"], jersey_number: 15, uni: "Windsor (Men)", short_name: "WIN-M",
      photo_url: "https://golancers.ca/images/2026/9/21/Huisman__Micah_26-27.png", source_label: "Windsor Lancers" }]);
  });

  it("run 2: reads the missing box score and saves only the guest player's line", async () => {
    requests.length = 0;
    const r = await runGuestMenSync({ pool, fetchText, now: new Date("2026-11-26T12:30:00Z") });
    expect(requests).toEqual(["https://golancers.ca/sports/mens-volleyball/stats/2026-27/western-mustangs/boxscore/6264"]);
    expect(r.statsInserted).toBe(1);
    const s = (await client.query(`select p.display_name, s.kills, s.digs, s.sets_played, s.source_system from player_match_statistics s join players p on p.id = s.player_id`)).rows;
    expect(s).toEqual([{ display_name: "Micah Huisman", kills: 9, digs: 3, sets_played: 4, source_system: "guest-men" }]);
    expect(r.warnings).toEqual([]); // the other men's players are skipped quietly
  });

  it("run 3: nothing to do until the schedule is due again", async () => {
    requests.length = 0;
    await runGuestMenSync({ pool, fetchText, now: new Date("2026-11-26T13:00:00Z") });
    expect(requests).toEqual([]);
  });

  it("keeps men's games off the women's team schedule", async () => {
    const r = await client.query(
      `select count(*)::int n from matches m join universities u on u.id in (m.home_university_id, m.away_university_id) where u.name = 'Windsor'`);
    expect(r.rows[0].n).toBe(0);
  });
});
