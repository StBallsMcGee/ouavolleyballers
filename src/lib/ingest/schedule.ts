/**
 * Season schedules: one request per OUA university to USportVB's /api/teams/{id}/games.
 *
 * Each scheduled game is matched to the same database row that player statistics attach to
 * (date + the two universities), so a game is never stored twice. The schedule supplies what
 * the statistics feed cannot: future games, start times, home/away and live/final status.
 */
import type { Db } from "@/lib/db/pg";
import { abbreviate, canonicalUniversityName, UNIVERSITY_ABBREVIATIONS } from "@/lib/sources/abbreviations";
import { SOURCE_SYSTEM, type UsvbScheduleGame } from "@/lib/sources/usportvb";
import { seasonLabelForDate } from "@/lib/sources/usportvb-calendar";
import { matchSourceId } from "./normalize";

const NAME_SYSTEM = "usportvb-name"; // universities known to the schedule only by name
const KNOWN_TZ = new Set(["EST", "EDT", "AST", "ADT", "CST", "CDT", "MST", "MDT", "PST", "PDT", "NST", "NDT"]);
const IGNORED_TEAMS = new Set(["test"]);

export interface NormScheduleGame {
  sourceId: string; // our match key: date:uniA:uniB
  date: string;
  seasonLabel: string;
  home: { system: string; id: string };
  away: { system: string; id: string };
  startLocal: string | null; // "6:00 PM"
  tz: string | null; // "EST" etc.; null = league time zone
  status: "scheduled" | "live" | "final";
  homeSets: number | null;
  awaySets: number | null;
  url: string | null;
}

export interface ScheduleWriteResult {
  gamesSeen: number;
  matchesInserted: number;
  matchesUpdated: number;
  universitiesInserted: number;
  skipped: number;
  warnings: string[];
}

export function seasonStartFor(isoDate: string): string {
  return `${seasonLabelForDate(isoDate).slice(0, 4)}-08-01`;
}

/** Pure: turns raw schedule games into match records. `lookup` maps a canonical name to a university key. */
export function normalizeSchedule(
  games: readonly UsvbScheduleGame[],
  lookup: (name: string) => { system: string; id: string },
  fromDate: string,
): { games: NormScheduleGame[]; skipped: number; warnings: string[] } {
  const seen = new Set<string>();
  const out: NormScheduleGame[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (const g of games) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const homeName = canonicalUniversityName(g.homeTeam);
    const awayName = canonicalUniversityName(g.awayTeam);
    if (g.isMens || g.date < fromDate || IGNORED_TEAMS.has(homeName.toLowerCase()) || IGNORED_TEAMS.has(awayName.toLowerCase()) || homeName === awayName) {
      skipped++;
      continue;
    }
    const home = lookup(homeName);
    const away = lookup(awayName);
    const key = matchSourceId(g.date, home.id, away.id);
    if (out.some((o) => o.sourceId === key)) {
      warnings.push(`Two games on ${g.date} between ${homeName} and ${awayName}; only the first is used.`);
      continue;
    }
    const time = g.gameTime && /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(g.gameTime.trim()) ? g.gameTime.trim().toUpperCase() : null;
    const tz = g.gameTimezone && KNOWN_TZ.has(g.gameTimezone.toUpperCase()) ? g.gameTimezone.toUpperCase() : null;
    const status = g.status === "completed" ? "final" : g.status === "live" ? "live" : "scheduled";
    out.push({
      sourceId: key,
      date: g.date,
      seasonLabel: seasonLabelForDate(g.date),
      home,
      away,
      startLocal: time,
      tz,
      status,
      homeSets: status === "scheduled" ? null : g.homeScore ?? null,
      awaySets: status === "scheduled" ? null : g.awayScore ?? null,
      url: g.gameUrl ?? null,
    });
  }
  return { games: out, skipped, warnings };
}

/** Fills in short codes (WES, GPH, …) for universities that don't have one yet. */
export async function setAbbreviations(db: Db): Promise<void> {
  await db.query(
    `update public.universities u set short_name = x.abbr
     from jsonb_each_text($1::jsonb) as x(name, abbr)
     where u.name = x.name and u.short_name is distinct from x.abbr`,
    [JSON.stringify(UNIVERSITY_ABBREVIATIONS)],
  );
}

export async function writeSchedule(
  db: Db,
  games: readonly UsvbScheduleGame[],
  opts: { timezone: string; fallbackLocalTime: string; today: string; gender: "womens" | "mens" },
): Promise<ScheduleWriteResult> {
  // Known universities by name (from the statistics feed, keyed by USportVB id).
  const known = await db.query<{ name: string; source_system: string; source_id: string }>(
    `select name, source_system, source_id from public.universities where source_system in ($1, $2)`, [SOURCE_SYSTEM, NAME_SYSTEM]);
  const byName = new Map<string, { system: string; id: string }>();
  for (const u of known.rows) {
    const k = u.name.toLowerCase();
    // Prefer the id-based record over a name-only one.
    if (!byName.has(k) || u.source_system === SOURCE_SYSTEM) byName.set(k, { system: u.source_system, id: u.source_id });
  }
  const newNames = new Set<string>();
  const lookup = (name: string) => {
    const hit = byName.get(name.toLowerCase());
    if (hit) return hit;
    newNames.add(name);
    const key = { system: NAME_SYSTEM, id: name };
    byName.set(name.toLowerCase(), key);
    return key;
  };
  const norm = normalizeSchedule(games, lookup, seasonStartFor(opts.today));

  let universitiesInserted = 0;
  if (newNames.size) {
    const r = await db.query(
      `insert into public.universities (name, short_name, gender, source_system, source_id)
       select n, $3::jsonb ->> n, $2, $1, n from unnest($4::text[]) as n
       on conflict (source_system, source_id) do nothing`,
      [NAME_SYSTEM, opts.gender, JSON.stringify(Object.fromEntries([...newNames].map((n) => [n, abbreviate(n)]))), [...newNames]]);
    universitiesInserted = r.rowCount ?? 0;
  }
  await setAbbreviations(db);

  const rows = await db.query<{ inserted: boolean }>(
    `with src as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         source_id text, match_date date, season_label text, home_system text, home_id text, away_system text, away_id text,
         start_local text, tz text, status text, home_sets int, away_sets int, url text)),
     res as (
       select s.*, uh.id as home_uuid, ua.id as away_uuid,
              case when s.start_local is not null then (s.match_date + s.start_local::time) at time zone coalesce(s.tz, $2) end as start_time
       from src s
       join public.universities uh on uh.source_system = s.home_system and uh.source_id = s.home_id
       join public.universities ua on ua.source_system = s.away_system and ua.source_id = s.away_id)
     insert into public.matches as m (source_system, source_id, season_label, match_date, start_time, lock_at, lock_source,
       home_university_id, away_university_id, home_away_known, home_sets, away_sets, status, source_box_score_url, last_checked_at)
     select $3, source_id, season_label, match_date, start_time,
            coalesce(start_time, (match_date + $4::time) at time zone $2),
            case when start_time is not null then 'source' else 'fallback' end,
            home_uuid, away_uuid, true, home_sets, away_sets, status::public.match_status, url, now()
     from res
     on conflict (source_system, source_id) do update set
       home_university_id = excluded.home_university_id,
       away_university_id = excluded.away_university_id,
       home_away_known = true,
       start_time = excluded.start_time,
       lock_at = case when m.lock_source = 'admin' then m.lock_at else excluded.lock_at end,
       lock_source = case when m.lock_source = 'admin' then 'admin' else excluded.lock_source end,
       home_sets = excluded.home_sets,
       away_sets = excluded.away_sets,
       -- never move a finished match backwards; keep statuses an administrator set
       status = case when m.status in ('final', 'postponed', 'cancelled') and excluded.status <> 'final' then m.status else excluded.status end,
       source_box_score_url = excluded.source_box_score_url,
       last_checked_at = now(),
       last_updated_at = now()
     where (m.home_university_id, m.away_university_id, m.home_away_known, m.start_time, m.home_sets, m.away_sets,
            m.status, m.source_box_score_url, m.lock_at)
       is distinct from
           (excluded.home_university_id, excluded.away_university_id, true, excluded.start_time, excluded.home_sets, excluded.away_sets,
            case when m.status in ('final', 'postponed', 'cancelled') and excluded.status <> 'final' then m.status else excluded.status end,
            excluded.source_box_score_url,
            case when m.lock_source = 'admin' then m.lock_at else excluded.lock_at end)
     returning (xmax = 0) as inserted`,
    [
      JSON.stringify(norm.games.map((g) => ({
        source_id: g.sourceId, match_date: g.date, season_label: g.seasonLabel,
        home_system: g.home.system, home_id: g.home.id, away_system: g.away.system, away_id: g.away.id,
        start_local: g.startLocal, tz: g.tz, status: g.status, home_sets: g.homeSets, away_sets: g.awaySets, url: g.url,
      }))),
      opts.timezone,
      SOURCE_SYSTEM,
      opts.fallbackLocalTime,
    ],
  );
  // Matches the schedule did not change are still marked as checked.
  await db.query(
    `update public.matches set last_checked_at = now() where source_system = $1 and source_id = any($2::text[])`,
    [SOURCE_SYSTEM, norm.games.map((g) => g.sourceId)]);

  return {
    gamesSeen: norm.games.length,
    matchesInserted: rows.rows.filter((r) => r.inserted).length,
    matchesUpdated: rows.rows.filter((r) => !r.inserted).length,
    universitiesInserted,
    skipped: norm.skipped,
    warnings: norm.warnings,
  };
}
