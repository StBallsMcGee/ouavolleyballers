/**
 * Guest players from men's teams (the league's choice: e.g. Micah Huisman, Windsor men).
 *
 * Their games aren't in the women's schedule feed, so this job keeps them up to date from the
 * team's own SIDEARM site:
 *   * the team ("Windsor (Men)") and its OUA opponents ("Western (Men)", ...) as separate
 *     universities, so men's games never appear on the women's team schedules
 *   * every OUA league game (date, start time for lineup locks, home/away, result)
 *   * the guest player and his profile (photo credited to the school, like everyone else)
 *   * statistics from each finished game's box score
 * Live scoring during games comes from the OUA site, like every other game (oua-live.ts).
 *
 * Politeness: at most one request to the school site per run (its robots.txt asks for 30 s
 * between requests; runs are 30 minutes apart): the schedule every few hours, otherwise one box
 * score that's still missing.
 */
import type pg from "pg";
import { getPool } from "@/lib/db/pg";
import { addDays, localDate } from "@/lib/time";
import { nameKey } from "@/lib/sources/sidearm";
import { parseSidearmBoxScore } from "@/lib/sources/sidearm-boxscore";
import { parseSidearmFullSchedule } from "@/lib/sources/sidearm-schedule";
import { defaultFetch, loadBoxScore, type Candidate, type FetchText } from "./boxscores";

export const GUEST_SYSTEM = "guest-men";

export interface GuestPlayer {
  key: string;
  firstName: string;
  lastName: string;
  jersey: number;
  position: "S" | "OH" | "M" | "L";
  positionLabel: string;
  profile: { photoUrl: string; profileUrl: string; height: string | null; hometown: string | null; previousTeam: string | null };
}

export interface GuestTeam {
  key: string;
  /** Matches the women's university of the same school (for the name and short code). */
  school: string;
  label: string; // photo credit
  site: string;
  scheduleUrl: string;
  players: GuestPlayer[];
}

export const GUEST_TEAMS: GuestTeam[] = [
  {
    key: "windsor",
    school: "Windsor",
    label: "Windsor Lancers",
    site: "golancers.ca",
    scheduleUrl: "https://golancers.ca/sports/mens-volleyball/schedule",
    players: [
      {
        key: "micah-huisman", firstName: "Micah", lastName: "Huisman", jersey: 15, position: "M", positionLabel: "M",
        profile: {
          photoUrl: "https://golancers.ca/images/2026/9/21/Huisman__Micah_26-27.png",
          profileUrl: "https://golancers.ca/sports/mens-volleyball/roster/micah-huisman/10241",
          height: "6'6\"", hometown: "Amherstburg, ON", previousTeam: "Maranatha Christian Academy",
        },
      },
    ],
  },
];

export interface GuestSyncResult {
  status: "succeeded" | "failed" | "skipped";
  requests: number;
  matchesUpserted: number;
  statsInserted: number;
  warnings: string[];
  error?: string;
}

const MEN = " (Men)";

/** The men's version of a school: "Windsor" -> "Windsor (Men)", short code "WIN-M". */
async function menUniversity(pool: pg.Pool, school: { name: string; short_name: string | null }): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into public.universities (name, short_name, conference, gender, source_system, source_id)
     values ($1, $2, 'OUA', 'mens', $3, $4)
     on conflict (source_system, source_id) do update set name = excluded.name, short_name = excluded.short_name
     returning id`,
    [school.name + MEN, school.short_name ? `${school.short_name}-M` : null, GUEST_SYSTEM, nameKey(school.name)]);
  return r.rows[0]!.id;
}

/** "Western Mustangs" -> the women's university "Western" (longest name that the opponent starts with). */
function findSchool(opponent: string, schools: Array<{ name: string; short_name: string | null }>) {
  const o = nameKey(opponent);
  return schools
    .filter((s) => {
      const n = nameKey(s.name);
      const sh = nameKey(s.short_name ?? "");
      return (n.length >= 3 && o.startsWith(n)) || (sh.length >= 3 && o.startsWith(sh));
    })
    .sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

export async function runGuestMenSync(opts: { pool?: pg.Pool; fetchText?: FetchText; now?: Date; scheduleEveryHours?: number } = {}): Promise<GuestSyncResult> {
  const pool = opts.pool ?? getPool();
  const fetchText = opts.fetchText ?? defaultFetch();
  const now = opts.now ?? new Date();
  const result: GuestSyncResult = { status: "succeeded", requests: 0, matchesUpserted: 0, statsInserted: 0, warnings: [] };
  const league = (await pool.query<{ timezone: string; season_label: string; fallback: string | null }>(
    `select timezone, season_label, settings -> 'lineupLock' ->> 'fallbackLocalTime' as fallback
       from public.leagues where status in ('setup', 'active') order by created_at limit 1`)).rows[0];
  if (!league) return { ...result, status: "skipped" };
  const tz = league.timezone;
  const today = localDate(now, tz);
  const seasonStart = Number(league.season_label.slice(0, 4));
  const run = await pool.query<{ id: string }>(`insert into public.sync_runs (job) values ('guest-men') returning id`);
  const finish = async (r: GuestSyncResult) => {
    await pool.query(
      `update public.sync_runs set finished_at = now(), status = $2, records_inserted = $3, records_updated = $4, warnings = $5, error = $6 where id = $1`,
      [run.rows[0]!.id, r.status, r.statsInserted, r.matchesUpserted, JSON.stringify(r.warnings.slice(0, 100)), r.error ?? null]);
    return r;
  };

  try {
    const schools = (await pool.query<{ name: string; short_name: string | null }>(
      `select name, short_name from public.universities where coalesce(gender, 'womens') = 'womens' and source_system <> $1`, [GUEST_SYSTEM])).rows;
    for (const team of GUEST_TEAMS) {
      const school = schools.find((s) => nameKey(s.name) === nameKey(team.school)) ?? { name: team.school, short_name: null };
      const teamUni = await menUniversity(pool, school);

      // The guest players and their profiles.
      for (const p of team.players) {
        const pr = await pool.query<{ id: string }>(
          `insert into public.players (first_name, last_name, display_name, university_id, conference, gender, position_label, positions, jersey_number, active, source_system, source_id)
           values ($1, $2, $1 || ' ' || $2, $3, 'OUA', 'mens', $4, array[$5], $6, true, $7, $8)
           on conflict (source_system, source_id) do update set university_id = excluded.university_id, position_label = excluded.position_label,
             positions = excluded.positions, jersey_number = excluded.jersey_number
           returning id`,
          [p.firstName, p.lastName, teamUni, p.positionLabel, p.position, p.jersey, GUEST_SYSTEM, `${team.key}-${p.key}`]);
        await pool.query(
          `insert into public.player_profiles (player_id, photo_url, profile_url, position_label, height, hometown, previous_team, source_label, source_site)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (player_id) do update set photo_url = excluded.photo_url, profile_url = excluded.profile_url, position_label = excluded.position_label,
             height = excluded.height, hometown = excluded.hometown, previous_team = excluded.previous_team, source_label = excluded.source_label,
             source_site = excluded.source_site, updated_at = now()`,
          [pr.rows[0]!.id, p.profile.photoUrl, p.profile.profileUrl, p.positionLabel === "M" ? "Middle" : p.positionLabel, p.profile.height,
           p.profile.hometown, p.profile.previousTeam, team.label, team.site]);
      }

      // One request this run: a missing box score if there is one, otherwise the schedule now and then.
      const missing = (await pool.query<Candidate & { url: string }>(
        `select m.id, m.match_date::text, m.home_university_id, m.away_university_id,
                uh.source_id as home_source, ua.source_id as away_source,
                uh.name as home_name, uh.short_name as home_short, ua.name as away_name, ua.short_name as away_short,
                m.source_box_score_url as url
           from public.matches m
           join public.universities uh on uh.id = m.home_university_id
           join public.universities ua on ua.id = m.away_university_id
          where m.source_system = $1 and (m.home_university_id = $2 or m.away_university_id = $2)
            and m.source_box_score_url is not null and m.status = 'final'
            and m.match_date >= $3::date
            and not exists (select 1 from public.player_match_statistics s join public.players p on p.id = s.player_id
                             where s.match_id = m.id and p.university_id = $2)
          order by m.match_date limit 1`, [GUEST_SYSTEM, teamUni, addDays(today, -120)])).rows[0];
      const lastSchedule = (await pool.query<{ t: string | null }>(
        `select max(started_at)::text as t from public.sync_runs where job = 'guest-men' and records_updated > 0 and status = 'succeeded'`)).rows[0]?.t;
      const scheduleDue = !lastSchedule || now.getTime() - new Date(lastSchedule).getTime() > (opts.scheduleEveryHours ?? 4) * 3600_000;

      if (missing && !scheduleDue) {
        result.requests++;
        const box = parseSidearmBoxScore(await fetchText(missing.url));
        // Captions read "Windsor" while our team is "Windsor (Men)".
        const matches = (caption: string, u: { name: string; short_name: string | null }) => {
          const c = nameKey(caption);
          const n = nameKey(u.name.replace(MEN, ""));
          return c === n || (n.length > 3 && (c.startsWith(n) || n.startsWith(c)));
        };
        // Only the guest players are in our list; everyone else on the men's teams is skipped quietly.
        const warnings: string[] = [];
        const n = await loadBoxScore(pool, missing, box, warnings, { source: GUEST_SYSTEM, teamMatches: matches, replaceSources: [GUEST_SYSTEM] });
        result.warnings.push(...warnings.filter((w) => !/not in our player list/.test(w)));
        result.statsInserted += n ?? 0;
        continue;
      }
      if (!scheduleDue) continue;

      result.requests++;
      const games = parseSidearmFullSchedule(await fetchText(team.scheduleUrl), team.scheduleUrl, seasonStart).filter((g) => g.conference);
      for (const g of games) {
        const opp = findSchool(g.opponent, schools);
        if (!opp) {
          result.warnings.push(`${g.date}: opponent "${g.opponent}" not recognised; skipped.`);
          continue;
        }
        const oppUni = await menUniversity(pool, opp);
        const [home, away] = g.home === false ? [oppUni, teamUni] : [teamUni, oppUni];
        const [homeSets, awaySets] = g.home === false ? [g.setsAgainst, g.setsFor] : [g.setsFor, g.setsAgainst];
        const r = await pool.query(
          `insert into public.matches as m (source_system, source_id, season_label, match_date, start_time, lock_at, lock_source,
              home_university_id, away_university_id, home_away_known, home_sets, away_sets, status, source_box_score_url, last_checked_at)
           values ($1, $2, $3, $4::date,
                   case when $5::text is not null then ($4::date + $5::time) at time zone $6 end,
                   coalesce(case when $5::text is not null then ($4::date + $5::time) at time zone $6 end, ($4::date + $7::time) at time zone $6),
                   case when $5::text is not null then 'source' else 'fallback' end,
                   $8, $9, $10, $11, $12, $13::public.match_status, $14, now())
           on conflict (source_system, source_id) do update set
             match_date = excluded.match_date, start_time = coalesce(excluded.start_time, m.start_time),
             lock_at = case when m.lock_source = 'admin' then m.lock_at when excluded.start_time is null and m.start_time is not null then m.lock_at else excluded.lock_at end,
             lock_source = case when m.lock_source = 'admin' then 'admin' when excluded.start_time is null and m.start_time is not null then m.lock_source else excluded.lock_source end,
             home_university_id = excluded.home_university_id, away_university_id = excluded.away_university_id,
             home_sets = excluded.home_sets, away_sets = excluded.away_sets,
             status = case when m.status in ('final', 'postponed', 'cancelled') and excluded.status <> 'final' then m.status else excluded.status end,
             source_box_score_url = coalesce(excluded.source_box_score_url, m.source_box_score_url),
             last_checked_at = now(), last_updated_at = now()`,
          [GUEST_SYSTEM, `${team.key}-${g.gameId}`, league.season_label, g.date, g.time, tz, league.fallback ?? "18:00",
           home, away, g.home !== null, homeSets, awaySets, g.final ? "final" : "scheduled", g.boxScoreUrl]);
        result.matchesUpserted += r.rowCount ?? 0;
      }
    }
    return await finish(result);
  } catch (e) {
    return finish({ ...result, status: "failed", error: (e as Error).message });
  }
}
