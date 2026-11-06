/**
 * Test helpers: each test file gets a brand-new database with the real migrations applied.
 * Sample data is created here ONLY (never in the real league).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgresql://postgres@localhost/postgres?host=/var/tmp/sideout-pg&port=54329";

export async function createTestDb(): Promise<{ client: pg.Client; url: string; drop: () => Promise<void> }> {
  const name = `sideout_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace("/postgres?", `/${name}?`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const root = path.resolve(__dirname, "../..");
  await client.query(fs.readFileSync(path.join(root, "tests/db/supabase-auth-stub.sql"), "utf8"));
  for (const f of fs.readdirSync(path.join(root, "supabase/migrations")).sort()) {
    await client.query(fs.readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
  }
  return {
    client,
    url,
    drop: async () => {
      await client.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** Runs queries as a signed-in user (role authenticated, RLS on) inside a rolled-back-on-error savepoint. */
export async function asUser<T>(client: pg.Client, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    const r = await fn();
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

export interface Fixture {
  leagueId: string;
  admin: string;
  alice: string;
  bob: string;
  carol: string; // signed in, not in the league
  teamA: string;
  teamB: string;
  players: Record<string, string>;
  uniX: string;
  uniY: string;
  uniZ: string;
}

/**
 * Small sample league: 2 teams, roster limit 4 (2 starting slots: OH, M + UTIL).
 * Alice: oh1 (OH), m1 (M) starting; ohB bench.  Bob: oh2 (OH), m2 (M).
 * Free agents: fa1 (OH), dup1 (duplicate record).
 */
export async function seed(client: pg.Client, settingsOverride: Record<string, unknown> = {}): Promise<Fixture> {
  const users: Record<string, string> = {};
  for (const n of ["admin", "alice", "bob", "carol"]) {
    const r = await client.query(`insert into auth.users (email) values ($1) returning id`, [`${n}@example.test`]);
    users[n] = r.rows[0].id;
  }
  const settings = {
    roster: { S: 0, OH: 1, M: 1, L: 0, UTIL: 1, TOTAL: 4 },
    freeAgency: { enabled: true },
    trades: { enabled: true, review: "none", deadlineWeek: null },
    lineupLock: { fallbackLocalTime: "18:00" },
    playoffs: { enabled: false, teams: 2, startWeek: 3 },
    ...settingsOverride,
  };
  const lg = await client.query(
    `insert into leagues (name, season_label, conference, gender, status, settings) values ('Test', '2026-27', 'OUA', 'womens', 'active', $1) returning id`,
    [JSON.stringify(settings)]);
  const leagueId = lg.rows[0].id;
  await client.query(`insert into matchup_weeks (league_id, week, starts_on, ends_on) values ($1, 1, '2026-11-09', '2026-11-15'), ($1, 2, '2026-11-16', '2026-11-22')`, [leagueId]);
  await client.query(`insert into league_members values ($1, $2, 'admin'), ($1, $3, 'manager'), ($1, $4, 'manager')`, [leagueId, users.admin, users.alice, users.bob]);
  const uni = async (n: string) => (await client.query(`insert into universities (name, source_system, source_id) values ($1, 'test', $1) returning id`, [n])).rows[0].id as string;
  const uniX = await uni("X"); const uniY = await uni("Y"); const uniZ = await uni("Z");
  const players: Record<string, string> = {};
  for (const [key, pos, u, extra] of [["oh1", "OH", uniX, ""], ["m1", "M", uniX, ""], ["ohB", "OH", uniZ, ""], ["oh2", "OH", uniY, ""], ["m2", "M", uniY, ""], ["fa1", "OH", uniZ, ""], ["dup1", "OH", uniZ, "dup"]] as const) {
    const r = await client.query(
      `insert into players (first_name, last_name, display_name, university_id, conference, gender, position_label, positions, source_system, source_id)
       values ($1, 'Test', $1 || ' Test', $2, 'OUA', 'womens', $3, array[$3], 'test', $1) returning id`, [key, u, pos]);
    players[key] = r.rows[0].id;
    if (extra === "dup") await client.query(`update players set duplicate_of = $1 where id = $2`, [players.fa1, players[key]]);
  }
  const team = async (name: string, owner: string) => (await client.query(`insert into fantasy_teams (league_id, name, owner_user_id) values ($1, $2, $3) returning id`, [leagueId, name, owner])).rows[0].id as string;
  const teamA = await team("Alpha", users.alice!);
  const teamB = await team("Bravo", users.bob!);
  const start = "2026-11-01T00:00:00Z";
  const place = async (t: string, p: string, slot: string) => {
    const ra = await client.query(`insert into roster_assignments (league_id, fantasy_team_id, player_id, acquisition_type, acquired_at) values ($1, $2, $3, 'import', $4) returning id`, [leagueId, t, p, start]);
    await client.query(`insert into lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, valid_from) values ($1, $2, $3, $4, $5)`, [ra.rows[0].id, t, p, slot, start]);
  };
  await place(teamA, players.oh1!, "OH");
  await place(teamA, players.m1!, "M");
  await place(teamA, players.ohB!, "BENCH");
  await place(teamB, players.oh2!, "OH");
  await place(teamB, players.m2!, "M");
  const rs = await client.query(`insert into scoring_rule_sets (league_id, version, effective_from_week) values ($1, 1, 1) returning id`, [leagueId]);
  await client.query(
    `insert into scoring_rules (rule_set_id, stat_key, label, points) values
     ($1,'kills','Kills',1),($1,'attack_errors','Errors',-1),($1,'assists','Assists',0.3),($1,'service_aces','Aces',2),
     ($1,'service_errors','Serve misses',-0.5),($1,'digs','Digs',0.5),($1,'solo_blocks','Block solo',2),
     ($1,'block_assists','Block assist',0.8),($1,'attack_attempts','Attempts',0)`, [rs.rows[0].id]);
  return { leagueId, admin: users.admin!, alice: users.alice!, bob: users.bob!, carol: users.carol!, teamA, teamB, players, uniX, uniY, uniZ };
}

export async function addMatch(client: pg.Client, f: Fixture, opts: { date: string; lockAt: string; a: string; b: string; status?: string }) {
  const r = await client.query(
    `insert into matches (season_label, match_date, lock_at, home_university_id, away_university_id, status, source_system, source_id)
     values ('2026-27', $1::date, $2, $3, $4, $5, 'test', $6) returning id`,
    [opts.date, opts.lockAt, opts.a, opts.b, opts.status ?? "final", `${opts.date}:${opts.a}:${opts.b}`]);
  return r.rows[0].id as string;
}

export async function addStat(client: pg.Client, player: string, match: string, s: Record<string, number>) {
  await client.query(
    `insert into player_match_statistics (player_id, match_id, kills, digs, assists, service_aces, service_errors, attack_errors, solo_blocks, block_assists, source_system, source_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'test', 'h')`,
    [player, match, s.kills ?? 0, s.digs ?? 0, s.assists ?? 0, s.service_aces ?? 0, s.service_errors ?? 0, s.attack_errors ?? 0, s.solo_blocks ?? 0, s.block_assists ?? 0]);
}
