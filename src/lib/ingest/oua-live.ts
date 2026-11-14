/**
 * Live scoring: while OUA games are on, read each game's individual stats from the OUA website
 * and update the players' stat lines, so fantasy points move during the game. Runs every minute
 * (see docs/DEPLOYMENT.md) and does nothing — no requests at all — when no game is on. With more
 * games than fit in one run, the ones read longest ago go first, so every game keeps updating.
 *
 * Source: the game's box score page with ?view=individual, an ordinary page that robots.txt
 * allows (/sports/). The live-update feed under /action/ is disallowed and never used. Requests
 * are spaced 10 seconds apart (the site's crawl delay).
 *
 * Live lines are stored as source "oua-live" and overwritten as the game goes on. When the page
 * says the game is final, the lines are saved one last time as "oua" and the game is marked final.
 */
import type pg from "pg";
import { getPool } from "@/lib/db/pg";
import { localDate } from "@/lib/time";
import { OUA_BASE, OUA_CRAWL_DELAY_MS, ouaIndividualStatsUrl, ouaTeamMatches, parseOuaBoxScore, parseOuaComposite, parseOuaGameState } from "@/lib/sources/oua";
import { defaultFetch, loadBoxScore, type Candidate, type FetchText } from "./boxscores";

const SITE = "oua.ca";

export interface LiveSyncResult {
  status: "succeeded" | "failed" | "skipped";
  gamesOn: number;
  requests: number;
  gamesUpdated: number;
  gamesFinished: number;
  linesSaved: number;
  warnings: string[];
  error?: string;
}

/** Games that should be live now: today, started (or about to), and not yet finished here. */
async function liveCandidates(pool: pg.Pool, today: string): Promise<Candidate[]> {
  return (await pool.query<Candidate>(
    `select m.id, m.match_date::text, m.home_university_id, m.away_university_id,
            uh.source_id as home_source, ua.source_id as away_source,
            uh.name as home_name, uh.short_name as home_short, ua.name as away_name, ua.short_name as away_short
       from public.matches m
       join public.universities uh on uh.id = m.home_university_id
       join public.universities ua on ua.id = m.away_university_id
      where m.match_date between ($1::date - 1) and $1::date
        and m.counts_for_fantasy and m.status not in ('cancelled', 'postponed')
        and coalesce(m.start_time, m.lock_at) <= now() + interval '5 minutes'
        and coalesce(m.start_time, m.lock_at) >= now() - interval '6 hours'
        and (m.status in ('scheduled', 'live')
             or exists (select 1 from public.player_match_statistics s where s.match_id = m.id and s.source_system = 'oua-live'))
      order by coalesce(m.start_time, m.lock_at)`, [today])).rows;
}

export async function runOuaLiveSync(opts: { pool?: pg.Pool; fetchText?: FetchText; delayMs?: number; maxGames?: number } = {}): Promise<LiveSyncResult> {
  const pool = opts.pool ?? getPool();
  const fetchText = opts.fetchText ?? defaultFetch();
  const delay = opts.delayMs ?? OUA_CRAWL_DELAY_MS;
  const result: LiveSyncResult = { status: "succeeded", gamesOn: 0, requests: 0, gamesUpdated: 0, gamesFinished: 0, linesSaved: 0, warnings: [] };

  const tz = (await pool.query<{ timezone: string }>(`select timezone from public.leagues order by created_at limit 1`)).rows[0]?.timezone ?? "America/Toronto";
  const today = localDate(new Date(), tz);
  const games = await liveCandidates(pool, today);
  result.gamesOn = games.length;
  if (games.length === 0) return { ...result, status: "skipped" }; // quiet: no request, no log row

  // A run can take ~50 s (10 s between requests); if the previous one is still going, skip.
  const busy = await pool.query(`select 1 from public.sync_runs where job = 'oua-live' and status = 'running' and started_at > now() - interval '75 seconds' limit 1`);
  if (busy.rowCount) return { ...result, status: "skipped", warnings: ["Previous live run still going."] };
  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('oua-live') returning id`);
  const finish = async (r: LiveSyncResult) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, matches_checked = $3, records_inserted = $4, records_updated = $5, warnings = $6, error = $7 where id = $1`,
      [run.rows[0]!.id, r.status, r.gamesOn, r.linesSaved, r.gamesUpdated, JSON.stringify(r.warnings.slice(0, 100)), r.error ?? null]);
    return r;
  };
  let last = 0;
  const politeFetch = async (url: string) => {
    const wait = last + delay - Date.now();
    if (last && wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    result.requests++;
    return fetchText(url);
  };

  try {
    const linkRows = (await pool.query<{ match_id: string; url: string; fetched_at: string | null }>(
      `select match_id, url, fetched_at from public.box_score_links where school_site = $1 and match_id = any($2::uuid[])`,
      [SITE, games.map((g) => g.id)])).rows;
    const links = new Map(linkRows.map((l) => [l.match_id, l.url]));
    const lastRead = new Map(linkRows.map((l) => [l.match_id, l.fetched_at ? new Date(l.fetched_at).getTime() : 0]));

    // Today's game links come from the composite page (read only when a game has no link yet).
    if (games.some((g) => !links.has(g.id))) {
      const entries = parseOuaComposite(await politeFetch(`${OUA_BASE}/composite?sport=wvball`));
      for (const g of games.filter((x) => !links.has(x.id))) {
        const home = { name: g.home_name, short_name: g.home_short };
        const away = { name: g.away_name, short_name: g.away_short };
        const e = entries.find((x) => x.date === g.match_date &&
          ((ouaTeamMatches(x.home, home) && ouaTeamMatches(x.away, away)) || (ouaTeamMatches(x.home, away) && ouaTeamMatches(x.away, home))));
        if (!e) continue;
        await pool.query(`insert into public.box_score_links (match_id, school_site, url) values ($1, $2, $3) on conflict (match_id, school_site) do update set url = excluded.url`, [g.id, SITE, e.boxScoreUrl]);
        links.set(g.id, e.boxScoreUrl);
      }
    }

    const queue = games.filter((x) => links.has(x.id)).sort((a, b) => (lastRead.get(a.id) ?? 0) - (lastRead.get(b.id) ?? 0));
    for (const g of queue.slice(0, opts.maxGames ?? 5)) {
      try {
        const html = await politeFetch(ouaIndividualStatsUrl(links.get(g.id)!));
        await pool.query(`update public.box_score_links set fetched_at = now() where match_id = $1 and school_site = $2`, [g.id, SITE]);
        const state = parseOuaGameState(html);
        if (state === "pre") continue;
        const saved = await loadBoxScore(pool, g, parseOuaBoxScore(html), result.warnings, {
          source: state === "final" ? "oua" : "oua-live",
          teamMatches: ouaTeamMatches,
          replaceSources: ["oua-live"],
          matchStatus: state === "final" ? "final" : "live",
        });
        if (saved !== null) {
          result.gamesUpdated++;
          result.linesSaved += saved;
          if (state === "final") {
            result.gamesFinished++;
            await pool.query(`update public.box_score_links set fetched_at = now(), status = 'loaded', detail = 'final (live)' where match_id = $1 and school_site = $2`, [g.id, SITE]);
          }
        }
      } catch (e) {
        result.warnings.push(`${g.away_name} at ${g.home_name}: ${(e as Error).message}`);
      }
    }
    return await finish(result);
  } catch (e) {
    return finish({ ...result, status: "failed", error: (e as Error).message });
  }
}
