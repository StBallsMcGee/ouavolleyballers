import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db/pg";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Read-only health report for troubleshooting (protected by CRON_SECRET, like the sync):
 * recent weeks and their matchup statuses, past games still not marked finished, the latest
 * sync runs, and how long database calls take from the server. No personal data.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pool = getPool();
  const t0 = Date.now();
  await pool.query("select 1");
  const firstQueryMs = Date.now() - t0;
  const pings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await pool.query("select 1");
    pings.push(Date.now() - t);
  }
  const timed = async <T,>(sql: string, params: unknown[] = []) => {
    const t = Date.now();
    const r = await pool.query(sql, params);
    return { ms: Date.now() - t, rows: r.rows as T[] };
  };
  const league = (await pool.query<{ id: string; status: string; timezone: string }>(`select id, status, timezone from public.leagues order by created_at limit 1`)).rows[0];
  const weeks = await timed(
    `select w.week, w.starts_on::text, w.ends_on::text,
            jsonb_object_agg(coalesce(s.status::text, 'none'), s.n) as matchups
       from public.matchup_weeks w
       left join (select week, status, score_source, count(*) n from public.matchups where league_id = $1 group by 1, 2, 3) s on s.week = w.week
      where w.league_id = $1 and w.starts_on <= current_date + 7
      group by 1, 2, 3 order by 1 desc limit 4`, [league?.id]);
  const unfinished = await timed(
    `select m.match_date::text, uh.short_name home, ua.short_name away, m.status::text, m.source_system,
            (select count(*) from public.player_match_statistics s where s.match_id = m.id)::int stat_lines
       from public.matches m join public.universities uh on uh.id = m.home_university_id join public.universities ua on ua.id = m.away_university_id
      where m.counts_for_fantasy and m.match_date between current_date - 14 and current_date - 1 and m.status in ('scheduled', 'live')
      order by 1`);
  const recentGames = await timed(
    `select m.match_date::text, uh.short_name home, ua.short_name away, m.status::text,
            (select count(*) from public.player_match_statistics s where s.match_id = m.id)::int stat_lines
       from public.matches m join public.universities uh on uh.id = m.home_university_id join public.universities ua on ua.id = m.away_university_id
      where m.counts_for_fantasy and m.match_date between current_date - 9 and current_date order by 1`);
  const syncs = await timed(
    `select job, status, started_at, finished_at, matches_checked, records_inserted, records_updated, error
       from public.sync_runs order by started_at desc limit 10`);
  const scores = await timed(`select count(*)::int n from public.v_matchup_scores where league_id = $1`, [league?.id]);
  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    now: new Date().toISOString(),
    db: { firstQueryMs, roundTripMs: pings, matchupScoresMs: scores.ms },
    league: league ? { status: league.status, timezone: league.timezone } : null,
    weeks: weeks.rows,
    pastGamesNotFinished: unfinished.rows,
    recentGames: recentGames.rows,
    syncRuns: syncs.rows,
  });
}
