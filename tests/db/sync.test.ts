import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runScheduleSync, runSync } from "@/lib/sync/run";
import type { UsvbScheduleGame } from "@/lib/sources/usportvb";
import type { UsvbPlayer } from "@/lib/sources/usportvb";

let drop: () => Promise<void>;
let pool: pg.Pool;
let client: pg.Client;

// Sample feed: 60 players at two real university ids, one match between them.
function feed(kills = 5): UsvbPlayer[] {
  return Array.from({ length: 60 }, (_, i) => ({
    publicId: `p${i}`, firstName: `First${i}`, lastName: `Last${i}`, position: i % 2 ? "OH" : "M/OH",
    teamId: i < 30 ? "d5fxlv5sp7d57j2i" : "1x1r2stwudexxbtb", jerseyNumber: i, mens: false, isActive: true, conference: "OUA",
    gameData: [{ date: "2026-10-31", opponent: i < 30 ? "1x1r2stwudexxbtb" : "d5fxlv5sp7d57j2i", kills: i === 0 ? kills : 1, errors: 0, attempts: 3, assists: 0, aces: 0, serveMisses: 0, digs: 2, blockSolo: 0, blockAssist: 0, sets: 4 }],
  }));
}

beforeAll(async () => {
  const db = await createTestDb();
  ({ client, drop } = db);
  pool = new pg.Pool({ connectionString: db.url });
});
afterAll(async () => { await pool.end(); await drop(); });

describe("scheduled sync", () => {
  it("imports players, one match and stats", async () => {
    const r = await runSync({ pool, feed: feed() });
    expect(r.status).toBe("succeeded");
    expect((await client.query(`select count(*)::int n from matches`)).rows[0].n).toBe(1);
    expect((await client.query(`select count(*)::int n from player_match_statistics`)).rows[0].n).toBe(60);
    expect((await client.query(`select name from universities order by name`)).rows.map((x) => x.name)).toEqual(["Western", "Windsor"]);
  });
  it("is idempotent: a second identical run inserts and updates nothing", async () => {
    const r = await runSync({ pool, feed: feed() });
    expect([r.inserted, r.updated]).toEqual([0, 0]);
  });
  it("applies corrected statistics", async () => {
    const r = await runSync({ pool, feed: feed(9) });
    expect(r.updated).toBe(1);
    expect((await client.query(`select kills from player_match_statistics s join players p on p.id = s.player_id where p.source_id = 'p0'`)).rows[0].kills).toBe(9);
  });
  it("refuses a suspiciously small feed and records the failure", async () => {
    const r = await runSync({ pool, feed: feed().slice(0, 3) });
    expect(r.status).toBe("failed");
    expect((await client.query(`select count(*)::int n from players`)).rows[0].n).toBe(60);
    expect((await client.query(`select status from sync_runs order by started_at desc limit 1`)).rows[0].status).toBe("failed");
  });
  it("records a source outage without changing data", async () => {
    const r = await runSync({ pool, fetchOptions: { baseUrl: "http://127.0.0.1:9", timeoutMs: 2000 } });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Source unavailable/);
  });
});

const game = (id: string, date: string, home: string, away: string, status: string, time: string | null, tz: string | null, hs = 0, as = 0): UsvbScheduleGame =>
  ({ id, date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, status, isMens: false, gameUrl: `https://example.test/${id}.xml`, gameTime: time, gameTimezone: tz });

describe("schedule sync", () => {
  const schedule = [
    game("g1", "2026-10-31", "Western", "Windsor", "completed", null, null, 3, 1), // already known from stats
    game("g1", "2026-10-31", "Western", "Windsor", "completed", null, null, 3, 1), // listed by both teams
    game("g2", "2026-11-13", "Windsor", "McMaster", "upcoming", "6:00 PM", "EST"),
    game("g3", "2026-11-14", "TMU", "Western", "upcoming", "2:00 PM", null), // alias + league time zone
    game("g4", "2026-11-14", "test", "Western", "upcoming", "2:00 PM", "EST"), // junk entry
    game("g5", "2025-11-14", "Western", "Windsor", "completed", "2:00 PM", "EST"), // last season: ignored
  ];
  it("adds future games with real start times and fills in home/away for known ones", async () => {
    const r = await runScheduleSync({ pool, schedules: schedule });
    expect(r.status).toBe("succeeded");
    expect([r.result?.matchesInserted, r.result?.matchesUpdated, r.result?.skipped]).toEqual([2, 1, 2]);
    expect((await client.query(`select count(*)::int n from matches`)).rows[0].n).toBe(3);
    const known = (await client.query(`select h.name home, a.name away, m.home_sets, m.away_sets, m.home_away_known from matches m join universities h on h.id = m.home_university_id join universities a on a.id = m.away_university_id where match_date = '2026-10-31'`)).rows[0];
    expect(known).toEqual({ home: "Western", away: "Windsor", home_sets: 3, away_sets: 1, home_away_known: true });
    const g2 = (await client.query(`select start_time, lock_at, lock_source, status::text from matches where match_date = '2026-11-13'`)).rows[0];
    expect(new Date(g2.start_time).toISOString()).toBe("2026-11-13T23:00:00.000Z");
    expect(g2.lock_at).toEqual(g2.start_time);
    expect([g2.lock_source, g2.status]).toEqual(["source", "scheduled"]);
    const g3 = (await client.query(`select start_time, h.name, h.short_name from matches m join universities h on h.id = m.home_university_id where match_date = '2026-11-14'`)).rows[0];
    expect(new Date(g3.start_time).toISOString()).toBe("2026-11-14T19:00:00.000Z"); // 2 pm Toronto (EST)
    expect([g3.name, g3.short_name]).toEqual(["Toronto Metropolitan", "TMU"]);
  });
  it("is idempotent and keeps an administrator's lock time", async () => {
    await client.query(`update matches set lock_at = '2026-11-13T22:00:00Z', lock_source = 'admin' where match_date = '2026-11-13'`);
    const r = await runScheduleSync({ pool, schedules: schedule });
    expect([r.result?.matchesInserted, r.result?.matchesUpdated]).toEqual([0, 0]);
    expect((await client.query(`select lock_source from matches where match_date = '2026-11-13'`)).rows[0].lock_source).toBe("admin");
  });
  it("never moves a finished match back to scheduled", async () => {
    await runScheduleSync({ pool, schedules: [game("g1", "2026-10-31", "Western", "Windsor", "upcoming", null, null)] });
    expect((await client.query(`select status::text from matches where match_date = '2026-10-31'`)).rows[0].status).toBe("final");
  });
  it("skips the refresh when a recent one succeeded", async () => {
    const r = await runScheduleSync({ pool, scheduleMaxAgeHours: 3, fetchOptions: { baseUrl: "http://127.0.0.1:9" } });
    expect(r.status).toBe("skipped");
  });
});
