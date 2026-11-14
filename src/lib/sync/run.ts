/**
 * Scheduled synchronisation: pulls the latest player statistics, updates matches and stats,
 * and moves matchups to in-progress / final. Runs in the cloud (see docs/DEPLOYMENT.md).
 *
 * Every run is one transaction and is recorded in sync_runs (shown on the admin page). If the
 * source is down or returns something unexpected, nothing is changed and the error is logged;
 * the app keeps showing the last good data with its "last updated" time.
 */
import type pg from "pg";
import { getPool } from "@/lib/db/pg";
import { normalizeFeed } from "@/lib/ingest/normalize";
import { writeFeed } from "@/lib/ingest/writer";
import { writeSchedule, type ScheduleWriteResult } from "@/lib/ingest/schedule";
import { localDate } from "@/lib/time";
import { parseSettings } from "@/lib/league/settings";
import { fetchPlayers, fetchTeamSchedule, type FetchOptions, type UsvbPlayer, type UsvbScheduleGame } from "@/lib/sources/usportvb";

export interface SyncResult {
  status: "succeeded" | "failed" | "skipped";
  runId: string | null;
  matchesChecked: number;
  inserted: number;
  updated: number;
  matchupsUpdated: number;
  warnings: string[];
  error?: string;
  schedule?: { status: "succeeded" | "failed" | "skipped"; result?: ScheduleWriteResult; error?: string };
  boxScores?: import("@/lib/ingest/boxscores").BoxScoreSyncResult;
  ouaBoxScores?: import("@/lib/ingest/boxscores").BoxScoreSyncResult;
}

export async function runSync(opts: {
  pool?: pg.Pool;
  fetchOptions?: FetchOptions;
  /** For tests: supply the feed instead of downloading it. */
  feed?: UsvbPlayer[];
  /** Refresh season schedules if the last successful refresh is older than this (default 3 h). */
  scheduleMaxAgeHours?: number;
  /** For tests: supply schedules instead of downloading them. */
  schedules?: UsvbScheduleGame[];
} = {}): Promise<SyncResult> {
  const result = await runStatsSync(opts);
  if (result.status !== "skipped") {
    // Schedules (USportVB) and school box scores (school sites) contact different servers, so they
    // run side by side to keep the whole sync well inside the hosting time limit.
    const [schedule, boxScores] = await Promise.all([
      runScheduleSync(opts),
      // School websites first, then the OUA website for whatever is still missing.
      opts.feed ? Promise.resolve(undefined) : (async () => {
        const school = await (await import("@/lib/ingest/boxscores")).runBoxScoreSync({ pool: opts.pool });
        const oua = await (await import("@/lib/ingest/oua-boxscores")).runOuaBoxScoreSync({ pool: opts.pool }).catch(() => undefined);
        return { school, oua };
      })(),
    ]);
    result.schedule = schedule;
    result.boxScores = boxScores?.school;
    result.ouaBoxScores = boxScores?.oua;
    // Move weeks to in-progress/final after everything above, and even if the statistics source
    // was down: finishing a week must never depend on one source being up.
    try {
      result.matchupsUpdated += await refreshMatchups(opts.pool ?? getPool());
    } catch (e) {
      result.warnings.push(`Could not update matchup statuses: ${(e as Error).message}`);
    }
  }
  return result;
}

/** Decides waiver claims that are due (after midnight). Cheap when there are none. */
export async function processDueWaivers(pool: pg.Pool): Promise<number> {
  const due = await pool.query<{ league_id: string }>(
    `select distinct league_id from public.waiver_claims where status = 'pending' and process_after <= now()`).catch(() => ({ rows: [] as { league_id: string }[] }));
  let n = 0;
  for (const l of due.rows) n += (await pool.query<{ n: number }>(`select public.process_waivers($1) as n`, [l.league_id])).rows[0]?.n ?? 0;
  return n;
}

/** Moves matchups to in-progress / final for every running league. Safe to run any time. */
export async function refreshMatchups(pool: pg.Pool): Promise<number> {
  await processDueWaivers(pool).catch(() => undefined);
  const leagues = await pool.query<{ id: string }>(`select id from public.leagues where status in ('setup', 'active')`);
  let n = 0;
  for (const l of leagues.rows) {
    const r = await pool.query<{ n: number }>(`select public.refresh_matchup_statuses($1) as n`, [l.id]);
    n += r.rows[0]?.n ?? 0;
    // Projected points from the latest stats (skipped quietly on a database without them yet).
    await pool.query(`select public.refresh_player_projections($1)`, [l.id]).catch(() => undefined);
  }
  return n;
}

/**
 * Season schedules (future games, start times, home/away, live/final). One request per OUA
 * university, a second apart; refreshed at most every few hours because schedules rarely change.
 */
export async function runScheduleSync(opts: {
  pool?: pg.Pool;
  fetchOptions?: FetchOptions;
  scheduleMaxAgeHours?: number;
  schedules?: UsvbScheduleGame[];
}): Promise<NonNullable<SyncResult["schedule"]>> {
  const pool = opts.pool ?? getPool();
  const maxAge = opts.scheduleMaxAgeHours ?? 3;
  const recent = await pool.query(
    `select 1 from public.sync_runs where job = 'usportvb-schedule' and status = 'succeeded'
     and started_at > now() - make_interval(secs => $1) limit 1`, [maxAge * 3600]);
  if (recent.rowCount && !opts.schedules) return { status: "skipped" };

  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('usportvb-schedule') returning id`);
  const runId = run.rows[0]!.id;
  const done = async (status: "succeeded" | "failed", r?: ScheduleWriteResult, error?: string) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, matches_checked = $3, records_inserted = $4,
         records_updated = $5, warnings = $6, error = $7 where id = $1`,
      [runId, status, r?.gamesSeen ?? 0, r?.matchesInserted ?? 0, r?.matchesUpdated ?? 0, JSON.stringify(r?.warnings ?? []), error ?? null]);
    return { status, result: r, error };
  };

  try {
    const lg = (await pool.query<{ timezone: string; settings: unknown }>(
      `select timezone, settings from public.leagues where status in ('setup', 'active') and gender = 'womens' order by created_at limit 1`)).rows[0];
    let games: UsvbScheduleGame[] = opts.schedules ?? [];
    if (!opts.schedules) {
      const unis = await pool.query<{ source_id: string }>(
        `select source_id from public.universities where source_system = 'usportvb' and conference = 'OUA' order by name`);
      for (const [i, u] of unis.rows.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1000)); // one request per second
        games.push(...(await fetchTeamSchedule(u.source_id, opts.fetchOptions)));
      }
    }
    if (games.length === 0) return await done("failed", undefined, "The source returned no scheduled games; nothing changed.");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const timezone = lg?.timezone ?? "America/Toronto";
      const r = await writeSchedule(client, games, {
        timezone,
        fallbackLocalTime: parseSettings(lg?.settings).lineupLock.fallbackLocalTime,
        today: localDate(new Date(), timezone),
        gender: "womens",
      });
      await client.query("commit");
      return await done("succeeded", r);
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return done("failed", undefined, `Schedule refresh failed: ${(e as Error).message}`);
  }
}

async function runStatsSync(opts: { pool?: pg.Pool; fetchOptions?: FetchOptions; feed?: UsvbPlayer[] }): Promise<SyncResult> {
  const pool = opts.pool ?? getPool();
  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('usportvb-players') returning id`);
  const runId = run.rows[0]!.id;
  const finish = async (r: Omit<SyncResult, "runId">) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, matches_checked = $3, records_inserted = $4,
         records_updated = $5, warnings = $6, error = $7 where id = $1`,
      [runId, r.status, r.matchesChecked, r.inserted, r.updated, JSON.stringify(r.warnings.slice(0, 200)), r.error ?? null],
    );
    return { ...r, runId };
  };

  let feed: UsvbPlayer[];
  try {
    feed = opts.feed ?? (await fetchPlayers("womens", "OUA", opts.fetchOptions));
  } catch (e) {
    return finish({ status: "failed", matchesChecked: 0, inserted: 0, updated: 0, matchupsUpdated: 0, warnings: [], error: `Source unavailable or changed format: ${(e as Error).message}` });
  }
  if (feed.length < 50) {
    // A near-empty feed almost certainly means a source problem, not that players vanished.
    return finish({ status: "failed", matchesChecked: 0, inserted: 0, updated: 0, matchupsUpdated: 0, warnings: [], error: `Source returned only ${feed.length} players; ignored to protect existing data.` });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const got = await client.query<{ ok: boolean }>(`select pg_try_advisory_xact_lock(hashtext('sync:usportvb')) as ok`);
    if (!got.rows[0]?.ok) {
      await client.query("rollback");
      return finish({ status: "skipped", matchesChecked: 0, inserted: 0, updated: 0, matchupsUpdated: 0, warnings: ["Another sync was already running."] });
    }
    const leagues = await client.query<{ id: string; timezone: string; settings: unknown }>(
      `select id, timezone, settings from public.leagues where status in ('setup', 'active') and gender = 'womens' order by created_at limit 1`);
    const lg = leagues.rows[0];
    const settings = parseSettings(lg?.settings);
    const norm = normalizeFeed(feed);
    const w = await writeFeed(client, norm, {
      gender: "womens",
      timezone: lg?.timezone ?? "America/Toronto",
      fallbackLocalTime: settings.lineupLock.fallbackLocalTime,
    });
    let matchupsUpdated = 0;
    for (const l of leagues.rows) {
      const r = await client.query<{ n: number }>(`select public.refresh_matchup_statuses($1) as n`, [l.id]);
      matchupsUpdated += r.rows[0]?.n ?? 0;
    }
    await client.query("commit");
    return finish({
      status: "succeeded",
      matchesChecked: w.matches.inserted + w.matches.updated,
      inserted: w.universities.inserted + w.players.inserted + w.matches.inserted + w.stats.inserted,
      updated: w.universities.updated + w.players.updated + w.stats.updated,
      matchupsUpdated,
      warnings: norm.warnings,
    });
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    return finish({ status: "failed", matchesChecked: 0, inserted: 0, updated: 0, matchupsUpdated: 0, warnings: [], error: (e as Error).message });
  } finally {
    client.release();
  }
}
