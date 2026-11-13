/**
 * Second statistics source: official box scores on the schools' own websites.
 *
 * USportVB stays the main source (it covers every school, including Ottawa, Trent and Lakehead).
 * When a finished game has no statistics from USportVB, this job looks for that game's box score
 * on the website of one of the two schools (12 OUA schools use SIDEARM) and records the stats.
 * If USportVB publishes the game later, its rows are kept as they are (identical in testing).
 *
 * Politeness: at most ONE request per school website per run (robots.txt asks for 30 seconds
 * between requests; runs are 30 minutes apart). Step 1 reads the school's schedule page to find
 * box score links; step 2 (next run) reads the box score. Only recent games without stats.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { getPool } from "@/lib/db/pg";
import { localDate, addDays } from "@/lib/time";
import { nameKey, SIDEARM_SCHOOLS } from "@/lib/sources/sidearm";
import { captionMatches, parseSidearmBoxScore, parseSidearmSchedule, type BoxPlayerLine, type BoxScore } from "@/lib/sources/sidearm-boxscore";

export interface BoxScoreSyncResult {
  status: "succeeded" | "failed" | "skipped";
  candidates: number;
  requests: number;
  linksFound: number;
  boxScoresLoaded: number;
  statsInserted: number;
  warnings: string[];
  error?: string;
}

export type FetchText = (url: string) => Promise<string>;

export function defaultFetch(): FetchText {
  const ua = process.env.SOURCE_USER_AGENT ?? "SideoutFantasy/1.0 (private OUA fantasy league; box scores)";
  return async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua }, signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  };
}

/** Same hash as the USportVB writer, so identical stats are recognised as identical. */
function statHash(p: BoxPlayerLine): string {
  const line = {
    kills: p.kills, attack_errors: p.attackErrors, attack_attempts: p.attackAttempts, assists: p.assists,
    service_aces: p.serviceAces, service_errors: p.serviceErrors, digs: p.digs, solo_blocks: p.soloBlocks, block_assists: p.blockAssists,
  };
  return createHash("sha256").update(JSON.stringify([line, p.sets])).digest("hex").slice(0, 24);
}

export interface Candidate {
  id: string;
  match_date: string;
  home_university_id: string;
  away_university_id: string;
  home_source: string;
  away_source: string;
  home_name: string;
  home_short: string | null;
  away_name: string;
  away_short: string | null;
}

export async function runBoxScoreSync(opts: { pool?: pg.Pool; fetchText?: FetchText; lookbackDays?: number } = {}): Promise<BoxScoreSyncResult> {
  const pool = opts.pool ?? getPool();
  const fetchText = opts.fetchText ?? defaultFetch();
  const result: BoxScoreSyncResult = { status: "succeeded", candidates: 0, requests: 0, linksFound: 0, boxScoresLoaded: 0, statsInserted: 0, warnings: [] };
  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('school-boxscores') returning id`);
  const runId = run.rows[0]!.id;
  const finish = async (r: BoxScoreSyncResult) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, matches_checked = $3, records_inserted = $4, records_updated = $5, warnings = $6, error = $7 where id = $1`,
      [runId, r.status, r.candidates, r.statsInserted, r.boxScoresLoaded, JSON.stringify(r.warnings.slice(0, 100)), r.error ?? null]);
    return r;
  };

  try {
    const lg = (await pool.query<{ timezone: string }>(`select timezone from public.leagues order by created_at limit 1`)).rows[0];
    const tz = lg?.timezone ?? "America/Toronto";
    const today = localDate(new Date(), tz);
    const seasonStartYear = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
    const candidates = await findCandidates(pool, today, opts.lookbackDays ?? 10);
    result.candidates = candidates.length;
    if (candidates.length === 0) return await finish({ ...result, status: "skipped" });

    // Which school sites can supply each game (home school first: its own stat crew).
    const bySite = new Map<string, { school: (typeof SIDEARM_SCHOOLS)[number]; games: Candidate[] }>();
    for (const c of candidates) {
      for (const src of [c.home_source, c.away_source]) {
        const school = SIDEARM_SCHOOLS.find((s) => s.universitySourceId === src);
        if (!school) continue;
        const site = new URL(school.rosterUrl).hostname;
        const entry = bySite.get(site) ?? { school, games: [] };
        entry.games.push(c);
        bySite.set(site, entry);
      }
    }
    for (const c of candidates) {
      if (![c.home_source, c.away_source].some((s) => SIDEARM_SCHOOLS.some((x) => x.universitySourceId === s))) {
        result.warnings.push(`${c.match_date} ${c.home_name} v ${c.away_name}: no school website box score available; waiting for USportVB.`);
      }
    }

    const links = new Map<string, { match_id: string; school_site: string; url: string; status: string }>();
    for (const l of (await pool.query<{ match_id: string; school_site: string; url: string; status: string }>(
      `select match_id, school_site, url, status from public.box_score_links where match_id = any($1::uuid[])`, [candidates.map((c) => c.id)])).rows) {
      links.set(`${l.match_id}|${l.school_site}`, l);
    }

    // Each game's box score is read from ONE site: the first link found, home school first.
    const siteOrder = (g: Candidate) =>
      [g.home_source, g.away_source]
        .map((src) => SIDEARM_SCHOOLS.find((s) => s.universitySourceId === src))
        .filter(Boolean)
        .map((s) => new URL(s!.rosterUrl).hostname);
    const chosen = new Map<string, string>(); // match id -> site to read the box score from
    for (const g of candidates) {
      const site = siteOrder(g).find((st) => links.get(`${g.id}|${st}`)?.status === "found");
      if (site) chosen.set(g.id, site);
    }
    const hasAnyLink = (g: Candidate) => siteOrder(g).some((st) => links.has(`${g.id}|${st}`));

    // One request per school site, all sites in parallel.
    await Promise.all([...bySite.entries()].map(async ([site, { school, games }]) => {
      try {
        const readyGame = games.find((g) => chosen.get(g.id) === site);
        const ready = readyGame ? links.get(`${readyGame.id}|${site}`) : undefined;
        if (ready) {
          // Step 2: read a box score we already found.
          result.requests++;
          const html = await fetchText(ready.url);
          const game = games.find((g) => g.id === ready.match_id)!;
          const inserted = await loadBoxScore(pool, game, parseSidearmBoxScore(html), result.warnings);
          await pool.query(`update public.box_score_links set fetched_at = now(), status = $3, detail = $4 where match_id = $1 and school_site = $2`,
            [game.id, site, inserted === null ? "error" : "loaded", inserted === null ? "Could not match the box score to this game" : `${inserted} player lines`]);
          if (inserted !== null) {
            result.boxScoresLoaded++;
            result.statsInserted += inserted;
          }
          return;
        }
        // Step 1: read the schedule page to find box score links for games that have none yet.
        const looking = games.filter((g) => !hasAnyLink(g));
        if (looking.length === 0) return; // nothing new to look for on this site
        result.requests++;
        const scheduleUrl = school.rosterUrl.replace(/\/roster$/, "/schedule");
        const entries = parseSidearmSchedule(await fetchText(scheduleUrl), scheduleUrl, seasonStartYear);
        for (const g of looking) {
          const e = entries.find((x) => x.date === g.match_date);
          if (!e) continue;
          await pool.query(
            `insert into public.box_score_links (match_id, school_site, url) values ($1, $2, $3) on conflict (match_id, school_site) do nothing`,
            [g.id, site, e.boxScoreUrl]);
          result.linksFound++;
        }
      } catch (e) {
        result.warnings.push(`${site}: ${(e as Error).message}`);
      }
    }));
    return await finish(result);
  } catch (e) {
    return finish({ ...result, status: "failed", error: (e as Error).message });
  }
}

/** Records one box score's player lines. Returns lines inserted, or null if it didn't fit the game. */
export async function loadBoxScore(
  pool: pg.Pool,
  game: Candidate,
  box: BoxScore,
  warnings: string[],
  opts: { source?: string; teamMatches?: typeof captionMatches } = {},
): Promise<number | null> {
  const source = opts.source ?? "school-boxscore";
  const matches = opts.teamMatches ?? captionMatches;
  const label = `${game.match_date} ${game.home_name} v ${game.away_name}`;
  if (box.date && box.date !== game.match_date) {
    warnings.push(`${label}: box score is dated ${box.date}; ignored.`);
    return null;
  }
  if (box.teams.length !== 2) {
    warnings.push(`${label}: box score has ${box.teams.length} teams; ignored.`);
    return null;
  }
  const home = { id: game.home_university_id, name: game.home_name, short_name: game.home_short };
  const away = { id: game.away_university_id, name: game.away_name, short_name: game.away_short };
  let assignment: Array<typeof home> | null = null;
  const [a, b] = box.teams as [BoxTeam, BoxTeam];
  if (matches(a.caption, home) || matches(b.caption, away)) assignment = [home, away];
  else if (matches(a.caption, away) || matches(b.caption, home)) assignment = [away, home];
  if (!assignment) {
    warnings.push(`${label}: teams "${a.caption}" / "${b.caption}" not recognised; ignored.`);
    return null;
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("begin");
    for (const [i, team] of box.teams.entries()) {
      const uni = assignment[i]!;
      const ours = (await client.query<{ id: string; display_name: string; last_name: string; jersey_number: number | null }>(
        `select id, display_name, last_name, jersey_number from public.players where university_id = $1 and duplicate_of is null`, [uni.id])).rows;
      const byName = new Map(ours.map((o) => [nameKey(o.display_name), o]));
      for (const p of team.players) {
        const last = nameKey(p.name.split(" ").slice(-1)[0] ?? "");
        const o = byName.get(nameKey(p.name)) ?? ours.find((x) => x.jersey_number === p.jersey && nameKey(x.last_name) === last);
        if (!o) {
          warnings.push(`${label}: ${uni.name} player "${p.name}" #${p.jersey ?? "?"} not in our player list; skipped.`);
          continue;
        }
        const r = await client.query(
          `insert into public.player_match_statistics (player_id, match_id, university_id, kills, attack_errors, attack_attempts, assists,
             service_aces, service_errors, digs, solo_blocks, block_assists, sets_played, source_system, source_hash, source_updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $15, $14, now())
           on conflict (player_id, match_id) do nothing`,
          [o.id, game.id, uni.id, p.kills, p.attackErrors, p.attackAttempts, p.assists, p.serviceAces, p.serviceErrors, p.digs,
           p.soloBlocks, p.blockAssists, p.sets, statHash(p), source]);
        inserted += r.rowCount ?? 0;
      }
    }
    await client.query(
      `update public.matches set stats_available = true, last_updated_at = now(),
         status = case when status in ('scheduled', 'live') then 'final'::public.match_status else status end
       where id = $1`, [game.id]);
    await client.query("commit");
    return inserted;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

type BoxTeam = ReturnType<typeof parseSidearmBoxScore>["teams"][number];

/** Recent finished games that count and still have no statistics from any source. */
export async function findCandidates(pool: pg.Pool, today: string, lookbackDays: number): Promise<Candidate[]> {
  return (await pool.query<Candidate>(
    `select m.id, m.match_date::text, m.home_university_id, m.away_university_id,
            uh.source_id as home_source, ua.source_id as away_source,
            uh.name as home_name, uh.short_name as home_short, ua.name as away_name, ua.short_name as away_short
     from public.matches m
     join public.universities uh on uh.id = m.home_university_id
     join public.universities ua on ua.id = m.away_university_id
     where m.match_date between $1::date and $2::date
       and m.counts_for_fantasy and m.status not in ('cancelled', 'postponed')
       and coalesce(m.start_time, m.lock_at) + interval '2 hours' < now()
       and not exists (select 1 from public.player_match_statistics s where s.match_id = m.id)
     order by m.match_date`,
    [addDays(today, -lookbackDays), today])).rows;
}
