/**
 * Statistics from box scores on the OUA website, for finished games that still have none after
 * USportVB and the school websites. Each run: the OUA schedule page is read once (only when a
 * game needs it) to find box score links, then up to two box scores are read, 10 seconds apart
 * (the site's crawl delay). Links are remembered so the schedule isn't re-read for them.
 */
import type pg from "pg";
import { getPool } from "@/lib/db/pg";
import { localDate } from "@/lib/time";
import { OUA_BASE, OUA_CRAWL_DELAY_MS, ouaSeason, ouaTeamMatches, parseOuaBoxScore, parseOuaSchedule } from "@/lib/sources/oua";
import { defaultFetch, findCandidates, loadBoxScore, type BoxScoreSyncResult, type FetchText } from "./boxscores";

const SITE = "oua.ca";

export async function runOuaBoxScoreSync(opts: { pool?: pg.Pool; fetchText?: FetchText; lookbackDays?: number; maxBoxScores?: number; delayMs?: number } = {}): Promise<BoxScoreSyncResult> {
  const pool = opts.pool ?? getPool();
  const fetchText = opts.fetchText ?? defaultFetch();
  const delay = opts.delayMs ?? OUA_CRAWL_DELAY_MS;
  const result: BoxScoreSyncResult = { status: "succeeded", candidates: 0, requests: 0, linksFound: 0, boxScoresLoaded: 0, statsInserted: 0, warnings: [] };
  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('oua-boxscores') returning id`);
  const finish = async (r: BoxScoreSyncResult) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, matches_checked = $3, records_inserted = $4, records_updated = $5, warnings = $6, error = $7 where id = $1`,
      [run.rows[0]!.id, r.status, r.candidates, r.statsInserted, r.boxScoresLoaded, JSON.stringify(r.warnings.slice(0, 100)), r.error ?? null]);
    return r;
  };
  let lastRequest = 0;
  const politeFetch = async (url: string) => {
    const wait = lastRequest + delay - Date.now();
    if (lastRequest && wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    result.requests++;
    return fetchText(url);
  };

  try {
    const tz = (await pool.query<{ timezone: string }>(`select timezone from public.leagues order by created_at limit 1`)).rows[0]?.timezone ?? "America/Toronto";
    const today = localDate(new Date(), tz);
    const candidates = await findCandidates(pool, today, opts.lookbackDays ?? 10);
    result.candidates = candidates.length;
    if (candidates.length === 0) return await finish({ ...result, status: "skipped" });

    const known = new Map((await pool.query<{ match_id: string; url: string; status: string }>(
      `select match_id, url, status from public.box_score_links where school_site = $1 and match_id = any($2::uuid[])`,
      [SITE, candidates.map((c) => c.id)])).rows.map((l) => [l.match_id, l]));

    // Step 1: find links on the OUA schedule for games we have no OUA link for yet.
    const readSchedule = candidates.some((c) => !known.has(c.id));
    if (readSchedule) {
      const year = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
      const entries = parseOuaSchedule(await politeFetch(`${OUA_BASE}/sports/wvball/${ouaSeason(year)}/schedule`));
      for (const c of candidates.filter((x) => !known.has(x.id))) {
        const home = { name: c.home_name, short_name: c.home_short };
        const away = { name: c.away_name, short_name: c.away_short };
        const e = entries.find((x) => x.date === c.match_date &&
          ((ouaTeamMatches(x.home, home) && ouaTeamMatches(x.away, away)) || (ouaTeamMatches(x.home, away) && ouaTeamMatches(x.away, home))));
        if (!e) continue;
        await pool.query(`insert into public.box_score_links (match_id, school_site, url) values ($1, $2, $3) on conflict (match_id, school_site) do nothing`, [c.id, SITE, e.boxScoreUrl]);
        known.set(c.id, { match_id: c.id, url: e.boxScoreUrl, status: "found" });
        result.linksFound++;
      }
    }

    // Step 2: read up to N box scores.
    // (One fewer when the schedule was just read, to keep each run short.)
    const ready = candidates.filter((c) => known.get(c.id)?.status === "found").slice(0, opts.maxBoxScores ?? (readSchedule ? 1 : 2));
    for (const game of ready) {
      const link = known.get(game.id)!;
      try {
        const inserted = await loadBoxScore(pool, game, parseOuaBoxScore(await politeFetch(link.url)), result.warnings, { source: "oua", teamMatches: ouaTeamMatches });
        await pool.query(`update public.box_score_links set fetched_at = now(), status = $3, detail = $4 where match_id = $1 and school_site = $2`,
          [game.id, SITE, inserted === null ? "error" : inserted > 0 ? "loaded" : "found", inserted === null ? "Could not match the box score to this game" : `${inserted} player lines`]);
        if (inserted) {
          result.boxScoresLoaded++;
          result.statsInserted += inserted;
        }
      } catch (e) {
        result.warnings.push(`${link.url}: ${(e as Error).message}`);
      }
    }
    return await finish(result);
  } catch (e) {
    return finish({ ...result, status: "failed", error: (e as Error).message });
  }
}
