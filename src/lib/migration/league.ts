/**
 * Imports the existing USportVB league (league, teams, rosters, lineups, matchups, scoring).
 *
 * Safety rules:
 *  - Validation runs first. Any error stops an "apply" run before anything is written.
 *  - The whole import is one database transaction. A dry run performs every step, then performs
 *    them a second time (to prove nothing is duplicated), then rolls everything back.
 *  - Nothing is deleted. Rows already present are matched by their source id and left as they
 *    are; differences are reported for the administrator instead of being "fixed" silently.
 *  - Teams the administrator chose to exclude are listed in the report, never silently dropped.
 */
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/pg";
import { DEFAULT_SETTINGS, isEligibleForSlot, parsePositions, startingSlots, type LeagueSettings } from "@/lib/league/settings";
import { leaguePointsToRules, redactSecrets, SOURCE_SYSTEM, type UsvbLeague, type UsvbPlayer, type UsvbTeam } from "@/lib/sources/usportvb";
import { seasonLabelForSourceYear, USVB_WEEKS } from "@/lib/sources/usportvb-calendar";
import { normalizeFeed } from "@/lib/ingest/normalize";
import { writeFeed, type FeedWriteResult } from "@/lib/ingest/writer";

export interface ManagerInvite {
  sourceTeamId: string;
  email: string;
  displayName: string | null;
}

export interface ImportOptions {
  excludeTeamIds: string[];
  /** First week scored by the new app. Earlier weeks keep USportVB's results. */
  cutoverWeek: number;
  managers?: ManagerInvite[];
  timezone?: string;
  /**
   * Refresh mode (league still in setup only): bring the new app in line with the source again
   * by moving/releasing players, updating lineup slots, team names and pre-cut-over results.
   */
  refresh?: boolean;
}

export interface Issue {
  level: "error" | "warning" | "info";
  message: string;
}

export interface LeagueImportReport {
  generatedAt: string;
  mode: "dry_run" | "apply";
  options: { excludeTeamIds: string[]; cutoverWeek: number; refresh: boolean };
  source: { leagueId: string; leagueName: string; season: string; snapshotSha256: string; playersFeedSha256: string };
  counts: {
    sourceTeams: number;
    teamsToImport: number;
    excludedTeams: Array<{ sourceId: string; name: string; players: number }>;
    managers: number;
    playersInFeed: number;
    rosterAssignments: number;
    starters: number;
    bench: number;
    scoringRules: number;
    matchups: number;
    importedResults: number;
    voidedMatchups: number;
    duplicatePlayerRecords: number;
    unmatchedRosterPlayers: number;
    managerInvites: number;
  };
  draftVsRoster: { droppedSinceDraft: string[]; addedSinceDraft: string[] };
  scoring: Array<{ statKey: string; label: string; points: number }>;
  roster: LeagueSettings["roster"];
  issues: Issue[];
  write?: { firstPass: WriteSummary; secondPass?: WriteSummary };
}

export interface WriteSummary {
  feed: FeedWriteResult;
  league: "inserted" | "existing";
  weeksInserted: number;
  teams: { inserted: number; existing: number };
  rosterInserted: number;
  rosterUnchanged: number;
  rosterConflicts: number;
  /** Refresh mode: players moved between teams / released because the source changed. */
  rosterMoved: number;
  rosterReleased: number;
  /** Players in the new app who are not on any source roster (released in refresh mode). */
  rosterNotInSource: number;
  lineupSlotDifferences: number;
  lineupSlotsChanged: number;
  teamsRenamed: number;
  matchupsInserted: number;
  matchupsExisting: number;
  matchupResultsUpdated: number;
  scoringRuleSet: "inserted" | "existing-identical" | "existing-different";
  invitations: number;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/* ----------------------------------------------------------------------------------------
 * Validation (pure)
 * -------------------------------------------------------------------------------------- */

export function validateLeagueSource(
  league: UsvbLeague,
  teams: readonly UsvbTeam[],
  players: readonly UsvbPlayer[],
  opts: ImportOptions,
): LeagueImportReport {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });
  const info = (message: string) => issues.push({ level: "info", message });

  const playerById = new Map(players.map((p) => [p.publicId, p]));
  const feed = normalizeFeed(players);
  const dupIds = new Set(feed.players.filter((p) => p.duplicateOfSourceId).map((p) => p.sourceId));
  const teamIds = new Set(teams.map((t) => t.publicId));
  const excluded = new Set(opts.excludeTeamIds);
  const roster = { ...league.criticalSettings.roster };
  const slots = startingSlots(roster);

  // League-level checks
  if (league.criticalSettings.gender !== "womens") err(`League gender is ${league.criticalSettings.gender}, expected womens.`);
  if (league.criticalSettings.conferences.join(",") !== "OUA") warn(`League conferences: ${league.criticalSettings.conferences.join(", ")}.`);
  if (!USVB_WEEKS[league.year]) err(`No matchup calendar is known for season ${league.year}.`);
  const missing = league.teams.filter((id) => !teamIds.has(id));
  const extra = [...teamIds].filter((id) => !league.teams.includes(id));
  if (missing.length) err(`League lists teams not returned by the teams endpoint: ${missing.join(", ")}.`);
  if (extra.length) err(`Teams endpoint returned teams not in the league: ${extra.join(", ")}.`);
  for (const id of excluded) if (!teamIds.has(id)) err(`Excluded team ${id} does not exist in the source.`);
  if (league.criticalSettings.leagueSize !== teams.length) {
    warn(`League size setting is ${league.criticalSettings.leagueSize}; the source has ${teams.length} teams.`);
  }

  const excludedTeams = teams
    .filter((t) => excluded.has(t.publicId))
    .map((t) => ({ sourceId: t.publicId, name: t.name.trim(), players: t.players.length }));
  for (const t of excludedTeams) {
    if (t.players > 0) err(`Excluded team "${t.name}" has ${t.players} players. Their ownership would be lost; resolve before importing.`);
    else info(`Team "${t.name}" is excluded at the administrator's request (no players, no draft picks).`);
  }

  const imported = teams.filter((t) => !excluded.has(t.publicId));
  const managers = new Set(imported.map((t) => t.managerId));
  if (managers.size !== imported.length) err("At least one manager owns more than one team.");
  if (!imported.some((t) => t.managerId === league.commissionerId)) warn("The commissioner does not own an imported team.");

  // Rosters
  const owner = new Map<string, string>();
  let starters = 0;
  let bench = 0;
  let unmatched = 0;
  for (const t of imported) {
    if (t.players.length > roster.TOTAL) err(`"${t.name.trim()}" has ${t.players.length} players; the limit is ${roster.TOTAL}.`);
    const usedSlots = new Set<string>();
    for (const rp of t.players) {
      const prev = owner.get(rp.publicId);
      if (prev) err(`Player ${rp.publicId} is on two teams (${prev} and ${t.publicId}).`);
      owner.set(rp.publicId, t.publicId);
      const p = playerById.get(rp.publicId);
      if (!p) {
        unmatched++;
        err(`Rostered player ${rp.publicId} on "${t.name.trim()}" is not in the players feed.`);
        continue;
      }
      const name = `${p.firstName.trim()} ${p.lastName.trim()}`;
      if (dupIds.has(p.publicId)) warn(`${name} on "${t.name.trim()}" is a flagged duplicate record. Check with the administrator.`);
      if (!p.isActive) warn(`${name} on "${t.name.trim()}" is marked inactive in the source.`);
      if (rp.position === "BENCH") bench++;
      else {
        starters++;
        if (!slots.includes(rp.position)) warn(`${name} is in unknown slot "${rp.position}"; will be placed on the bench.`);
        else if (!isEligibleForSlot(parsePositions(p.position), rp.position)) {
          warn(`${name} (${p.position ?? "no position"}) is starting at ${rp.position}, which their listed position does not allow. Imported as-is.`);
        }
        if (usedSlots.has(rp.position)) err(`"${t.name.trim()}" has two players in slot ${rp.position}.`);
        usedSlots.add(rp.position);
      }
    }
    if (t.players.length > 0 && t.players.every((p) => p.position === "BENCH")) {
      info(`"${t.name.trim()}" has not set a lineup (all players on the bench).`);
    }
  }

  // Draft vs current rosters
  const picks = new Set(league.draft.picks.map((p) => p.playerId));
  const rostered = new Set(owner.keys());
  const nameOf = (id: string) => {
    const p = playerById.get(id);
    return p ? `${p.firstName.trim()} ${p.lastName.trim()}` : id;
  };
  const droppedSinceDraft = [...picks].filter((id) => !rostered.has(id)).map(nameOf);
  const addedSinceDraft = [...rostered].filter((id) => !picks.has(id)).map(nameOf);
  if (droppedSinceDraft.length) {
    info(`${droppedSinceDraft.length} drafted players were later dropped and ${addedSinceDraft.length} players added. Current rosters are imported.`);
  }

  // Matchups
  let importedResults = 0;
  let voided = 0;
  const weeks = new Set((USVB_WEEKS[league.year] ?? []).map((w) => w.week));
  for (const m of league.matchups) {
    const { team1Id, team2Id, winnerId, team1Score, team2Score } = m.matchupData;
    if (excluded.has(team1Id) || excluded.has(team2Id)) err(`Week ${m.week} matchup involves an excluded team.`);
    if (!teamIds.has(team1Id) || !teamIds.has(team2Id)) err(`Week ${m.week} matchup references an unknown team.`);
    if (!weeks.has(m.week)) err(`Week ${m.week} is not in the season calendar.`);
    if (m.week < opts.cutoverWeek) {
      if (winnerId === "" && team1Score === 0 && team2Score === 0) voided++;
      else {
        importedResults++;
        const expected = team1Score > team2Score ? team1Id : team2Score > team1Score ? team2Id : "TIE";
        if (winnerId && winnerId !== expected) {
          warn(`Week ${m.week}: source winner (${winnerId}) does not match the scores ${team1Score}-${team2Score}.`);
        }
      }
    }
  }
  if (voided) {
    warn(`${voided} matchups in weeks before week ${opts.cutoverWeek} have no result in the source and will be imported as void (no win or loss). Check this is expected.`);
  }
  const weeksWithMatchups = new Set(league.matchups.map((m) => m.week));
  for (const w of USVB_WEEKS[league.year] ?? []) {
    if (!weeksWithMatchups.has(w.week) && w.week >= opts.cutoverWeek) {
      info(`Week ${w.week} has no matchups in the source (playoff weeks are set up by the administrator).`);
    }
  }

  // Managers file
  for (const inv of opts.managers ?? []) {
    if (!teamIds.has(inv.sourceTeamId)) err(`Managers file lists unknown team ${inv.sourceTeamId}.`);
    if (excluded.has(inv.sourceTeamId)) warn(`Managers file lists excluded team ${inv.sourceTeamId}; ignored.`);
  }
  if (!opts.managers?.length) info("No managers file supplied: teams import unclaimed. Invite managers from the admin page.");

  for (const w of feed.warnings) if (!w.startsWith("Possible duplicate")) warn(w);

  const scoring = leaguePointsToRules(league.adjustableSettings.points).map(({ statKey, label, points }) => ({ statKey, label, points }));
  return {
    generatedAt: new Date().toISOString(),
    mode: "dry_run",
    options: { excludeTeamIds: [...opts.excludeTeamIds], cutoverWeek: opts.cutoverWeek, refresh: opts.refresh === true },
    source: {
      leagueId: league.publicId,
      leagueName: league.name,
      season: seasonLabelForSourceYear(league.year),
      snapshotSha256: sha256(redactSecrets({ league, teams })),
      playersFeedSha256: sha256(players),
    },
    counts: {
      sourceTeams: teams.length,
      teamsToImport: imported.length,
      excludedTeams,
      managers: managers.size,
      playersInFeed: players.length,
      rosterAssignments: owner.size,
      starters,
      bench,
      scoringRules: scoring.length,
      matchups: league.matchups.length,
      importedResults,
      voidedMatchups: voided,
      duplicatePlayerRecords: dupIds.size,
      unmatchedRosterPlayers: unmatched,
      managerInvites: (opts.managers ?? []).filter((m) => !excluded.has(m.sourceTeamId)).length,
    },
    draftVsRoster: { droppedSinceDraft, addedSinceDraft },
    scoring,
    roster,
    issues,
  };
}

/* ----------------------------------------------------------------------------------------
 * Database write
 * -------------------------------------------------------------------------------------- */

export async function writeLeague(
  db: Db,
  league: UsvbLeague,
  teams: readonly UsvbTeam[],
  players: readonly UsvbPlayer[],
  opts: ImportOptions,
): Promise<WriteSummary> {
  const timezone = opts.timezone ?? "America/Toronto";
  const excluded = new Set(opts.excludeTeamIds);
  const settings: LeagueSettings = { ...DEFAULT_SETTINGS, roster: { ...league.criticalSettings.roster } };

  // 1. League (existing leagues keep their settings; the administrator may have changed them)
  const lg = await db.query<{ id: string; inserted: boolean }>(
    `insert into public.leagues (name, season_label, source_year, conference, gender, status, timezone, settings, source_system, source_id)
     values ($1, $2, $3, $4, $5, 'setup', $6, $7, $8, $9)
     on conflict (source_system, source_id) do update set source_year = public.leagues.source_year
     returning id, (xmax = 0) as inserted`,
    [league.name, seasonLabelForSourceYear(league.year), league.year, league.criticalSettings.conferences[0] ?? "OUA",
     league.criticalSettings.gender, timezone, JSON.stringify(settings), SOURCE_SYSTEM, league.publicId],
  );
  const leagueId = lg.rows[0]!.id;

  // 2. Real-world data (players, matches, statistics)
  const feed = await writeFeed(db, normalizeFeed(players), {
    gender: "womens",
    timezone,
    fallbackLocalTime: settings.lineupLock.fallbackLocalTime,
  });

  // 3. Calendar
  const weeks = await db.query(
    `insert into public.matchup_weeks (league_id, week, starts_on, ends_on)
     select $1, (w->>'week')::int, (w->>'start')::date, (w->>'end')::date from jsonb_array_elements($2::jsonb) w
     on conflict (league_id, week) do nothing`,
    [leagueId, JSON.stringify(USVB_WEEKS[league.year] ?? [])],
  );

  // 4. Scoring rule set (version 1 = the verified source rules)
  const rules = leaguePointsToRules(league.adjustableSettings.points);
  const existing = await db.query<{ stat_key: string; points: string }>(
    `select r.stat_key, r.points from public.scoring_rules r join public.scoring_rule_sets s on s.id = r.rule_set_id
     where s.league_id = $1 and s.source_system = $2 order by s.version limit 100`,
    [leagueId, SOURCE_SYSTEM],
  );
  let scoringRuleSet: WriteSummary["scoringRuleSet"];
  if (existing.rowCount === 0) {
    const rs = await db.query<{ id: string }>(
      `insert into public.scoring_rule_sets (league_id, version, effective_from_week, note, source_system)
       values ($1, coalesce((select max(version) from public.scoring_rule_sets where league_id = $1), 0) + 1, 1,
               'Imported from USportVB (verified against league settings 6 Nov 2026)', $2) returning id`,
      [leagueId, SOURCE_SYSTEM],
    );
    await db.query(
      `insert into public.scoring_rules (rule_set_id, stat_key, label, points, active)
       select $1, r->>'statKey', r->>'label', (r->>'points')::numeric, true from jsonb_array_elements($2::jsonb) r`,
      [rs.rows[0]!.id, JSON.stringify(rules)],
    );
    scoringRuleSet = "inserted";
  } else {
    const stored = new Map(existing.rows.map((r) => [r.stat_key, Number(r.points)]));
    scoringRuleSet = rules.every((r) => stored.get(r.statKey) === r.points) ? "existing-identical" : "existing-different";
  }

  // 5. Teams
  const teamRows = await db.query<{ id: string; source_id: string; inserted: boolean }>(
    `with src as (select * from jsonb_to_recordset($2::jsonb) as x(source_id text, name text, manager_id text))
     insert into public.fantasy_teams (league_id, name, source_system, source_id, source_owner_id)
     select $1, trim(name), $3, source_id, manager_id from src
     on conflict (league_id, source_system, source_id) do update set source_owner_id = excluded.source_owner_id
     returning id, source_id, (xmax = 0) as inserted`,
    [leagueId, JSON.stringify(teams.filter((t) => !excluded.has(t.publicId)).map((t) => ({ source_id: t.publicId, name: t.name, manager_id: t.managerId }))), SOURCE_SYSTEM],
  );
  const teamId = new Map(teamRows.rows.map((r) => [r.source_id, r.id]));

  // 6. Rosters and lineups (set-based, so the whole league takes a handful of queries)
  const slots = new Set(startingSlots(settings.roster));
  const refresh = opts.refresh === true;
  const sourceIds = teams.filter((t) => !excluded.has(t.publicId)).flatMap((t) => t.players.map((p) => p.publicId));
  const idRows = await db.query<{ id: string; source_id: string }>(
    `select id, source_id from public.players where source_system = $1 and source_id = any($2::text[])`, [SOURCE_SYSTEM, sourceIds]);
  const playerIdOf = new Map(idRows.rows.map((r) => [r.source_id, r.id]));
  const openRows = await db.query<{ ra_id: string; player_id: string; fantasy_team_id: string; slot: string | null }>(
    `select ra.id as ra_id, ra.player_id, ra.fantasy_team_id, le.slot
       from public.roster_assignments ra
       left join public.lineup_entries le on le.roster_assignment_id = ra.id and le.valid_to is null
      where ra.league_id = $1 and ra.released_at is null`, [leagueId]);
  const open = new Map(openRows.rows.map((r) => [r.player_id, r]));

  interface Desired { teamId: string; playerId: string; slot: string; sourceAssignmentId: string }
  const desired = new Map<string, Desired>();
  for (const t of teams) {
    if (excluded.has(t.publicId)) continue;
    for (const rp of t.players) {
      const playerId = playerIdOf.get(rp.publicId);
      if (!playerId) throw new Error(`Rostered player ${rp.publicId} missing after feed import.`);
      desired.set(playerId, { teamId: teamId.get(t.publicId)!, playerId, slot: slots.has(rp.position) ? rp.position : "BENCH", sourceAssignmentId: `${t.publicId}:${rp.publicId}` });
    }
  }

  const toInsert: Desired[] = [];
  const toRelease: string[] = []; // roster_assignment ids
  const slotChanges: Array<{ raId: string; d: Desired }> = [];
  let rosterUnchanged = 0;
  let rosterConflicts = 0;
  let rosterMoved = 0;
  let lineupSlotDifferences = 0;
  for (const d of desired.values()) {
    const cur = open.get(d.playerId);
    if (!cur) toInsert.push(d);
    else if (cur.fantasy_team_id === d.teamId) {
      rosterUnchanged++;
      if ((cur.slot ?? "BENCH") !== d.slot) {
        lineupSlotDifferences++;
        if (refresh) slotChanges.push({ raId: cur.ra_id, d });
      }
    } else if (refresh) {
      toRelease.push(cur.ra_id);
      toInsert.push(d);
      rosterMoved++;
    } else rosterConflicts++; // never moved automatically outside refresh mode; reported instead
  }
  const notInSource = [...open.values()].filter((o) => !desired.has(o.player_id));
  if (refresh) toRelease.push(...notInSource.map((o) => o.ra_id));

  if (toRelease.length) {
    await db.query(`update public.lineup_entries set valid_to = now() where roster_assignment_id = any($1::uuid[]) and valid_to is null`, [toRelease]);
    await db.query(`update public.roster_assignments set released_at = now() where id = any($1::uuid[])`, [toRelease]);
    await db.query(
      `insert into public.transactions (league_id, type, fantasy_team_id, player_id, details)
       select $1, 'import', ra.fantasy_team_id, ra.player_id, '{"source":"usportvb","refresh":"released"}'::jsonb
       from public.roster_assignments ra where ra.id = any($2::uuid[]) and ra.player_id <> all($3::uuid[])`,
      [leagueId, toRelease, toInsert.map((d) => d.playerId)]);
  }
  if (slotChanges.length) {
    await db.query(`update public.lineup_entries set valid_to = now() where roster_assignment_id = any($1::uuid[]) and valid_to is null`, [slotChanges.map((c) => c.raId)]);
    await db.query(
      `insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot)
       select x.ra_id, x.team_id, x.player_id, x.slot from jsonb_to_recordset($1::jsonb) as x(ra_id uuid, team_id uuid, player_id uuid, slot text)`,
      [JSON.stringify(slotChanges.map((c) => ({ ra_id: c.raId, team_id: c.d.teamId, player_id: c.d.playerId, slot: c.d.slot })))]);
  }
  if (toInsert.length) {
    await db.query(
      `with src as (select * from jsonb_to_recordset($2::jsonb) as x(team_id uuid, player_id uuid, slot text, source_assignment_id text)),
       ins as (
         insert into public.roster_assignments (league_id, fantasy_team_id, player_id, acquisition_type, source_assignment_id)
         select $1, team_id, player_id, 'import', source_assignment_id from src
         returning id, fantasy_team_id, player_id),
       le as (
         insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot)
         select ins.id, ins.fantasy_team_id, ins.player_id, src.slot from ins join src on src.player_id = ins.player_id
         returning 1)
       insert into public.transactions (league_id, type, fantasy_team_id, player_id, details)
       select $1, 'import', team_id, player_id, jsonb_build_object('source', 'usportvb', 'slot', slot) from src`,
      [leagueId, JSON.stringify(toInsert.map((d) => ({ team_id: d.teamId, player_id: d.playerId, slot: d.slot, source_assignment_id: d.sourceAssignmentId })))]);
  }

  // Team names can change on the old platform while the league is still in setup.
  let teamsRenamed = 0;
  if (refresh) {
    const r = await db.query(
      `with src as (select * from jsonb_to_recordset($2::jsonb) as x(source_id text, name text))
       update public.fantasy_teams t set name = trim(src.name) from src
       where t.league_id = $1 and t.source_system = $3 and t.source_id = src.source_id and t.name is distinct from trim(src.name)`,
      [leagueId, JSON.stringify(teams.filter((t) => !excluded.has(t.publicId)).map((t) => ({ source_id: t.publicId, name: t.name }))), SOURCE_SYSTEM]);
    teamsRenamed = r.rowCount ?? 0;
  }

  // 7. Matchups. Weeks before the cut-over keep the source's result; later weeks are scored here.
  const matchupRows = league.matchups
    .filter((m) => teamId.has(m.matchupData.team1Id) && teamId.has(m.matchupData.team2Id))
    .map((m) => {
      const d = m.matchupData;
      const before = m.week < opts.cutoverWeek;
      const hasResult = d.winnerId !== "" || d.team1Score !== 0 || d.team2Score !== 0;
      return {
        week: m.week,
        home: teamId.get(d.team1Id),
        away: teamId.get(d.team2Id),
        status: before ? (hasResult ? "final" : "void") : "scheduled",
        score_source: before ? "imported" : "calculated",
        hs: before && hasResult ? d.team1Score : null,
        as: before && hasResult ? d.team2Score : null,
        source_id: `${league.publicId}:w${m.week}:${d.team1Id}:${d.team2Id}`,
      };
    });
  const mu = await db.query<{ inserted: boolean }>(
    `with src as (select * from jsonb_to_recordset($2::jsonb) as x(week int, home uuid, away uuid, status text, score_source text, hs numeric, "as" numeric, source_id text))
     insert into public.matchups (league_id, week, home_team_id, away_team_id, status, score_source, imported_home_score, imported_away_score, source_system, source_id, finalized_at)
     select $1, week, home, away, status::public.matchup_status, score_source, hs, "as", $3, source_id, case when status = 'final' then now() end from src
     on conflict (league_id, week, home_team_id) do nothing
     returning true as inserted`,
    [leagueId, JSON.stringify(matchupRows), SOURCE_SYSTEM]);
  const matchupsInserted = mu.rowCount ?? 0;
  let matchupResultsUpdated = 0;
  if (refresh) {
    // Results recorded on the old platform since the last import (e.g. a week that just ended).
    const r = await db.query(
      `with src as (select * from jsonb_to_recordset($2::jsonb) as x(week int, home uuid, status text, hs numeric, "as" numeric))
       update public.matchups m set status = src.status::public.matchup_status, imported_home_score = src.hs, imported_away_score = src."as",
              finalized_at = case when src.status = 'final' then coalesce(m.finalized_at, now()) else null end
       from src
       where m.league_id = $1 and m.week = src.week and m.home_team_id = src.home and m.score_source = 'imported'
         and (m.status::text, m.imported_home_score, m.imported_away_score) is distinct from (src.status, src.hs, src."as")`,
      [leagueId, JSON.stringify(matchupRows.filter((r) => r.score_source === "imported"))]);
    matchupResultsUpdated = r.rowCount ?? 0;
  }
  const matchupsExisting = matchupRows.length - matchupsInserted;

  // 8. Manager invitations (emails come from the administrator, never from the source)
  let invitations = 0;
  for (const inv of opts.managers ?? []) {
    const team = teamId.get(inv.sourceTeamId);
    if (!team) continue;
    await db.query(
      `insert into public.team_invitations (fantasy_team_id, email, display_name) values ($1, lower($2), $3)
       on conflict (fantasy_team_id) do nothing`,
      [team, inv.email.trim(), inv.displayName]);
    if (inv.displayName) {
      await db.query(`update public.fantasy_teams set manager_display_name = $2 where id = $1 and manager_display_name is null`,
        [team, inv.displayName]);
    }
    invitations++;
  }

  return {
    feed,
    league: lg.rows[0]!.inserted ? "inserted" : "existing",
    weeksInserted: weeks.rowCount ?? 0,
    teams: {
      inserted: teamRows.rows.filter((r) => r.inserted).length,
      existing: teamRows.rows.filter((r) => !r.inserted).length,
    },
    rosterInserted: toInsert.length,
    rosterUnchanged,
    rosterConflicts,
    rosterMoved,
    rosterReleased: refresh ? notInSource.length : 0,
    rosterNotInSource: notInSource.length,
    lineupSlotDifferences,
    lineupSlotsChanged: slotChanges.length,
    teamsRenamed,
    matchupsInserted,
    matchupsExisting,
    matchupResultsUpdated,
    scoringRuleSet,
    invitations,
  };
}

/* ----------------------------------------------------------------------------------------
 * Orchestration
 * -------------------------------------------------------------------------------------- */

export async function runLeagueImport(
  db: Db,
  input: { league: UsvbLeague; teams: UsvbTeam[]; players: UsvbPlayer[]; mode: "dry_run" | "apply"; createdBy: string },
  opts: ImportOptions,
): Promise<LeagueImportReport> {
  const report = validateLeagueSource(input.league, input.teams, input.players, opts);
  report.mode = input.mode;
  const errors = report.issues.filter((i) => i.level === "error");
  if (errors.length > 0 && input.mode === "apply") {
    throw Object.assign(new Error(`Import blocked by ${errors.length} validation error(s).`), { report });
  }
  if (errors.length > 0) return report;

  // Refuse to re-apply after the league has gone live (rosters will legitimately differ).
  const live = await db.query(`select status from public.leagues where source_system = $1 and source_id = $2`,
    [SOURCE_SYSTEM, input.league.publicId]);
  if (live.rows[0]?.status && live.rows[0].status !== "setup") {
    throw new Error("This league is already active in the new app. Importing again could undo managers' changes; refused.");
  }
  if (opts.refresh && !live.rows[0]) {
    report.issues.push({ level: "info", message: "Refresh requested but the league has not been imported yet; running a first import instead." });
  }

  const firstPass = await writeLeague(db, input.league, input.teams, input.players, opts);
  report.write = { firstPass };
  if (input.mode === "dry_run") {
    // Prove idempotency: a second run must not create anything new.
    const secondPass = await writeLeague(db, input.league, input.teams, input.players, opts);
    report.write.secondPass = secondPass;
    const createdAgain =
      secondPass.feed.players.inserted + secondPass.feed.matches.inserted + secondPass.feed.stats.inserted +
      secondPass.teams.inserted + secondPass.rosterInserted + secondPass.matchupsInserted + secondPass.weeksInserted +
      secondPass.rosterMoved + secondPass.rosterReleased + secondPass.lineupSlotsChanged + secondPass.teamsRenamed + secondPass.matchupResultsUpdated;
    if (createdAgain > 0 || secondPass.scoringRuleSet === "inserted") {
      report.issues.push({ level: "error", message: `Second pass created ${createdAgain} new records: import is not repeatable.` });
    } else {
      report.issues.push({ level: "info", message: "Repeatability check passed: running the import twice created no duplicates." });
    }
  } else {
    const snap = redactSecrets({ league: input.league, teams: input.teams });
    const snapshot = await db.query<{ id: string }>(
      `insert into public.source_snapshots (source, sha256, payload) values ('usportvb-league', $1, $2)
       on conflict (sha256) do update set source = excluded.source returning id`,
      [sha256(snap), JSON.stringify(snap)]);
    await db.query(
      `insert into public.import_runs (mode, source, status, snapshot_id, report, created_by, finished_at)
       values ('apply', 'usportvb-league', 'succeeded', $1, $2, $3, now())`,
      [snapshot.rows[0]!.id, JSON.stringify(report), input.createdBy]);
  }
  return report;
}

/** Plain-English Markdown version of the report for the administrator. */
export function reportToMarkdown(r: LeagueImportReport): string {
  const c = r.counts;
  const lines: string[] = [];
  lines.push(`# Import report — ${r.source.leagueName} (${r.source.season})`, "");
  lines.push(`- Mode: **${r.mode === "dry_run" ? "DRY RUN (nothing was saved)" : "APPLIED"}**`);
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Source snapshot SHA-256: \`${r.source.snapshotSha256.slice(0, 16)}…\``, "");
  const errors = r.issues.filter((i) => i.level === "error");
  lines.push(errors.length ? `## ❌ ${errors.length} error(s) — import blocked` : "## ✅ No blocking errors", "");
  lines.push("| Item | Count |", "|---|---:|");
  lines.push(`| Teams in source | ${c.sourceTeams} |`, `| Teams imported | ${c.teamsToImport} |`, `| Managers | ${c.managers} |`);
  lines.push(`| Players in feed | ${c.playersInFeed} |`, `| Roster assignments | ${c.rosterAssignments} (${c.starters} starting, ${c.bench} bench) |`);
  lines.push(`| Scoring rules | ${c.scoringRules} |`, `| Matchups | ${c.matchups} (${c.importedResults} results kept, ${c.voidedMatchups} void) |`);
  lines.push(`| Duplicate player records (flagged) | ${c.duplicatePlayerRecords} |`, `| Unmatched roster players | ${c.unmatchedRosterPlayers} |`);
  lines.push(`| Manager invitations | ${c.managerInvites} |`, "");
  if (c.excludedTeams.length) {
    lines.push("### Excluded teams", ...c.excludedTeams.map((t) => `- ${t.name} (${t.players} players)`), "");
  }
  lines.push("### Scoring", "| Category | Points |", "|---|---:|", ...r.scoring.map((s) => `| ${s.label} | ${s.points} |`), "");
  lines.push(`### Roster: ${r.roster.S} S, ${r.roster.OH} OH, ${r.roster.M} M, ${r.roster.L} L, ${r.roster.UTIL} UTIL, ${r.roster.TOTAL} total`, "");
  if (r.draftVsRoster.droppedSinceDraft.length) {
    lines.push("### Changes since the draft",
      `- Dropped: ${r.draftVsRoster.droppedSinceDraft.join(", ")}`,
      `- Added: ${r.draftVsRoster.addedSinceDraft.join(", ")}`, "");
  }
  for (const level of ["error", "warning", "info"] as const) {
    const items = r.issues.filter((i) => i.level === level);
    if (items.length) lines.push(`### ${level === "error" ? "Errors" : level === "warning" ? "Warnings" : "Notes"}`, ...items.map((i) => `- ${i.message}`), "");
  }
  lines.push(`Options: cut-over week ${r.options.cutoverWeek}${r.options.refresh ? " · refresh from source" : ""}`, "");
  if (r.write) {
    const w = r.write.firstPass;
    lines.push("### Database changes" + (r.mode === "dry_run" ? " (rolled back)" : ""),
      `- Universities: +${w.feed.universities.inserted}, players: +${w.feed.players.inserted} (updated ${w.feed.players.updated}), matches: +${w.feed.matches.inserted}, player match stats: +${w.feed.stats.inserted} (updated ${w.feed.stats.updated})`,
      `- League: ${w.league}, weeks: +${w.weeksInserted}, teams: +${w.teams.inserted} (existing ${w.teams.existing})`,
      `- Roster assignments: +${w.rosterInserted} (unchanged ${w.rosterUnchanged}, moved ${w.rosterMoved}, released ${w.rosterReleased}, conflicts ${w.rosterConflicts}, not in source ${w.rosterNotInSource})`,
      `- Lineup slots: ${w.lineupSlotDifferences} differ from the source${r.options.refresh ? `, ${w.lineupSlotsChanged} updated` : ""}; teams renamed: ${w.teamsRenamed}`,
      `- Matchups: +${w.matchupsInserted} (existing ${w.matchupsExisting}, results updated ${w.matchupResultsUpdated}); scoring rule set: ${w.scoringRuleSet}; invitations: ${w.invitations}`);
    if (r.write.secondPass) {
      const s = r.write.secondPass;
      lines.push(`- Second (repeat) pass created: players ${s.feed.players.inserted}, stats ${s.feed.stats.inserted}, teams ${s.teams.inserted}, roster ${s.rosterInserted}, matchups ${s.matchupsInserted}`);
    }
  }
  return lines.join("\n") + "\n";
}
