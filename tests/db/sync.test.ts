import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./helpers";
import { runSync } from "@/lib/sync/run";
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
