/**
 * Writes normalised source data to the database with idempotent upserts:
 *  - rows are matched on (source_system, source_id), so running twice never duplicates;
 *  - existing rows are only updated when the data actually changed;
 *  - corrected statistics (different source hash) replace the old numbers, and fantasy points
 *    follow automatically because points are calculated by database views.
 */
import type { Db } from "@/lib/db/pg";
import { SOURCE_SYSTEM } from "@/lib/sources/usportvb";
import type { NormalizedFeed } from "./normalize";
import { setAbbreviations } from "./schedule";

export interface UpsertCounts {
  inserted: number;
  updated: number;
}

export interface FeedWriteResult {
  universities: UpsertCounts;
  players: UpsertCounts;
  duplicatesFlagged: number;
  matches: UpsertCounts;
  stats: UpsertCounts;
  matchesWithChangedStats: number;
}

function count(rows: Array<{ inserted: boolean }>): UpsertCounts {
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted };
}

export interface WriteOptions {
  gender: "womens" | "mens";
  timezone: string;
  /** "HH:MM" local lock time for matches without a known start time. */
  fallbackLocalTime: string;
}

export async function writeFeed(db: Db, feed: NormalizedFeed, opts: WriteOptions): Promise<FeedWriteResult> {
  const uni = await db.query<{ inserted: boolean }>(
    `with src as (
       select * from jsonb_to_recordset($1::jsonb) as x(source_id text, name text, conference text, known boolean))
     insert into public.universities as u (source_system, source_id, name, conference, gender)
     select $2, source_id, name, conference, $3 from src
     on conflict (source_system, source_id) do update
       set name = case when excluded.name like 'Unknown team%' then u.name else excluded.name end,
           conference = coalesce(excluded.conference, u.conference)
       where (case when excluded.name like 'Unknown team%' then u.name else excluded.name end, coalesce(excluded.conference, u.conference))
             is distinct from (u.name, u.conference)
     returning (xmax = 0) as inserted`,
    [
      JSON.stringify(feed.universities.map((u) => ({ source_id: u.sourceId, name: u.name, conference: u.conference, known: u.known }))),
      SOURCE_SYSTEM,
      opts.gender,
    ],
  );

  const players = await db.query<{ inserted: boolean }>(
    `with src as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         source_id text, first_name text, last_name text, display_name text, university_source_id text,
         conference text, gender text, position_label text, positions text[], jersey_number int, active boolean))
     insert into public.players as p (source_system, source_id, first_name, last_name, display_name, university_id,
       conference, gender, position_label, positions, jersey_number, active, last_synced_at)
     select $2, s.source_id, s.first_name, s.last_name, s.display_name, u.id, s.conference, s.gender,
            s.position_label, coalesce(s.positions, '{}'), s.jersey_number, s.active, now()
     from src s left join public.universities u on u.source_system = $2 and u.source_id = s.university_source_id
     on conflict (source_system, source_id) do update set
       first_name = excluded.first_name, last_name = excluded.last_name, display_name = excluded.display_name,
       university_id = excluded.university_id, conference = excluded.conference, gender = excluded.gender,
       position_label = excluded.position_label, positions = excluded.positions,
       jersey_number = excluded.jersey_number, active = excluded.active, last_synced_at = now()
     where (p.first_name, p.last_name, p.display_name, p.university_id, p.conference, p.gender,
            p.position_label, p.positions, p.jersey_number, p.active)
       is distinct from (excluded.first_name, excluded.last_name, excluded.display_name, excluded.university_id,
            excluded.conference, excluded.gender, excluded.position_label, excluded.positions,
            excluded.jersey_number, excluded.active)
     returning (xmax = 0) as inserted`,
    [
      JSON.stringify(
        feed.players.map((p) => ({
          source_id: p.sourceId,
          first_name: p.firstName,
          last_name: p.lastName,
          display_name: p.displayName,
          university_source_id: p.universitySourceId,
          conference: p.conference,
          gender: p.gender,
          position_label: p.positionLabel,
          positions: p.positions,
          jersey_number: p.jerseyNumber,
          active: p.active,
        })),
      ),
      SOURCE_SYSTEM,
    ],
  );

  const dups = await db.query(
    `with src as (select * from jsonb_to_recordset($1::jsonb) as x(source_id text, dup_of text))
     update public.players p set duplicate_of = d.id
     from src s left join public.players d on d.source_system = $2 and d.source_id = s.dup_of
     where p.source_system = $2 and p.source_id = s.source_id and p.duplicate_of is distinct from d.id`,
    [
      JSON.stringify(feed.players.map((p) => ({ source_id: p.sourceId, dup_of: p.duplicateOfSourceId }))),
      SOURCE_SYSTEM,
    ],
  );

  const matches = await db.query<{ inserted: boolean }>(
    `with src as (
       select * from jsonb_to_recordset($1::jsonb) as x(source_id text, match_date date, season_label text, a text, b text)),
     today as (select (now() at time zone $3)::date as d)
     insert into public.matches as m (source_system, source_id, season_label, match_date, lock_at, lock_source,
       home_university_id, away_university_id, home_away_known, status, stats_available, last_checked_at)
     select $2, s.source_id, s.season_label, s.match_date, (s.match_date + $4::time) at time zone $3, 'fallback',
            ua.id, ub.id, false,
            (case when s.match_date < today.d then 'final' else 'live' end)::public.match_status, true, now()
     from src s cross join today
     join public.universities ua on ua.source_system = $2 and ua.source_id = s.a
     join public.universities ub on ub.source_system = $2 and ub.source_id = s.b
     on conflict (source_system, source_id) do update set
       last_checked_at = now(),
       stats_available = true,
       status = case when m.status in ('scheduled', 'live') and m.match_date < (now() at time zone $3)::date
                     then 'final'::public.match_status
                     when m.status = 'scheduled' then 'live'::public.match_status
                     else m.status end
     returning (xmax = 0) as inserted`,
    [
      JSON.stringify(feed.matches.map((m) => ({ source_id: m.sourceId, match_date: m.date, season_label: m.seasonLabel, a: m.universityA, b: m.universityB }))),
      SOURCE_SYSTEM,
      opts.timezone,
      opts.fallbackLocalTime,
    ],
  );

  // Matches without a known start time lock at the league's fallback time; keep upcoming ones
  // in step if the administrator changes that time.
  await db.query(
    `update public.matches set lock_at = (match_date + $1::time) at time zone $2
     where lock_source = 'fallback' and match_date >= (now() at time zone $2)::date
       and lock_at is distinct from (match_date + $1::time) at time zone $2`,
    [opts.fallbackLocalTime, opts.timezone],
  );

  const stats = await db.query<{ inserted: boolean; match_id: string }>(
    `with src as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         player_source_id text, match_source_id text, university_source_id text,
         kills int, attack_errors int, attack_attempts int, assists int, service_aces int,
         service_errors int, digs int, solo_blocks int, block_assists int, sets_played int, hash text))
     insert into public.player_match_statistics as t (player_id, match_id, university_id, kills, attack_errors,
       attack_attempts, assists, service_aces, service_errors, digs, solo_blocks, block_assists, sets_played,
       source_system, source_hash, source_updated_at)
     select p.id, m.id, u.id, s.kills, s.attack_errors, s.attack_attempts, s.assists, s.service_aces,
            s.service_errors, s.digs, s.solo_blocks, s.block_assists, s.sets_played, $2, s.hash, now()
     from src s
     join public.players p on p.source_system = $2 and p.source_id = s.player_source_id
     join public.matches m on m.source_system = $2 and m.source_id = s.match_source_id
     left join public.universities u on u.source_system = $2 and u.source_id = s.university_source_id
     on conflict (player_id, match_id) do update set
       university_id = excluded.university_id, kills = excluded.kills, attack_errors = excluded.attack_errors,
       attack_attempts = excluded.attack_attempts, assists = excluded.assists, service_aces = excluded.service_aces,
       service_errors = excluded.service_errors, digs = excluded.digs, solo_blocks = excluded.solo_blocks,
       block_assists = excluded.block_assists, sets_played = excluded.sets_played,
       source_hash = excluded.source_hash, source_updated_at = now(), updated_at = now()
     where t.source_hash <> excluded.source_hash
     returning (xmax = 0) as inserted, match_id`,
    [
      JSON.stringify(
        feed.stats.map((s) => ({
          player_source_id: s.playerSourceId,
          match_source_id: s.matchSourceId,
          university_source_id: s.universitySourceId,
          kills: s.line.kills ?? 0,
          attack_errors: s.line.attack_errors ?? 0,
          attack_attempts: s.line.attack_attempts ?? 0,
          assists: s.line.assists ?? 0,
          service_aces: s.line.service_aces ?? 0,
          service_errors: s.line.service_errors ?? 0,
          digs: s.line.digs ?? 0,
          solo_blocks: s.line.solo_blocks ?? 0,
          block_assists: s.line.block_assists ?? 0,
          sets_played: s.setsPlayed,
          hash: s.hash,
        })),
      ),
      SOURCE_SYSTEM,
    ],
  );

  await setAbbreviations(db);
  const changedMatchIds = [...new Set(stats.rows.map((r) => r.match_id))];
  if (changedMatchIds.length > 0) {
    await db.query(`update public.matches set last_updated_at = now() where id = any($1::uuid[])`, [changedMatchIds]);
  }

  return {
    universities: count(uni.rows),
    players: count(players.rows),
    duplicatesFlagged: dups.rowCount ?? 0,
    matches: count(matches.rows.map((r) => ({ inserted: r.inserted }))),
    stats: count(stats.rows),
    matchesWithChangedStats: changedMatchIds.length,
  };
}
