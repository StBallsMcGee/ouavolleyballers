import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStandings, type MatchupResult, type StandingRow } from "@/lib/standings/standings";

type Sb = SupabaseClient;

/** Supabase returns at most 1000 rows per request; this fetches every page. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

export interface University {
  id: string;
  name: string;
  short_name: string | null;
}
export async function getUniversities(sb: Sb): Promise<Map<string, University>> {
  const { data } = await sb.from("universities").select("id, name, short_name").order("name");
  return new Map((data ?? []).map((u) => [u.id as string, u as University]));
}

export interface MatchupScore {
  id: string;
  week: number;
  home_team_id: string;
  away_team_id: string;
  status: "scheduled" | "in_progress" | "final" | "void";
  score_source: "calculated" | "imported";
  playoff_round: number | null;
  home_score: number;
  away_score: number;
  winner_team_id: string | null;
  is_tie: boolean;
}
export async function getMatchupScores(sb: Sb, leagueId: string, week?: number): Promise<MatchupScore[]> {
  let q = sb.from("v_matchup_scores").select("*").eq("league_id", leagueId).order("week");
  if (week !== undefined) q = q.eq("week", week);
  const { data } = await q;
  return (data ?? []).map((m) => ({ ...m, home_score: Number(m.home_score), away_score: Number(m.away_score) })) as MatchupScore[];
}

export async function getStandings(sb: Sb, leagueId: string, teamIds: string[]): Promise<StandingRow[]> {
  const all = await getMatchupScores(sb, leagueId);
  const results: MatchupResult[] = all.map((m) => ({
    week: m.week,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeScore: m.home_score,
    awayScore: m.away_score,
    final: m.status === "final",
    playoffRound: m.playoff_round,
  }));
  return computeStandings(teamIds, results);
}

export interface RosterPlayer {
  assignmentId: string;
  playerId: string;
  name: string;
  positions: string[];
  positionLabel: string | null;
  jersey: number | null;
  universityId: string | null;
  slot: string;
  acquiredAt: string;
  photoUrl: string | null;
}
export async function getRoster(sb: Sb, teamId: string): Promise<RosterPlayer[]> {
  const { data: ra } = await sb
    .from("roster_assignments")
    .select("id, player_id, acquired_at, players(display_name, positions, position_label, jersey_number, university_id)")
    .eq("fantasy_team_id", teamId)
    .is("released_at", null);
  const { data: le } = await sb.from("lineup_entries").select("roster_assignment_id, slot").eq("fantasy_team_id", teamId).is("valid_to", null);
  const slotOf = new Map((le ?? []).map((e) => [e.roster_assignment_id as string, e.slot as string]));
  const ids = (ra ?? []).map((r) => r.player_id as string);
  const { data: pp } = ids.length ? await sb.from("player_profiles").select("player_id, photo_url").in("player_id", ids) : { data: [] };
  const photoOf = new Map((pp ?? []).map((p) => [p.player_id as string, p.photo_url as string | null]));
  return (ra ?? []).map((r) => {
    const p = r.players as unknown as { display_name: string; positions: string[]; position_label: string | null; jersey_number: number | null; university_id: string | null };
    return {
      assignmentId: r.id,
      playerId: r.player_id,
      name: p.display_name,
      positions: p.positions ?? [],
      positionLabel: p.position_label,
      jersey: p.jersey_number,
      universityId: p.university_id,
      slot: slotOf.get(r.id) ?? "BENCH",
      acquiredAt: r.acquired_at,
      photoUrl: photoOf.get(r.player_id) ?? null,
    };
  });
}

export interface MatchRow {
  id: string;
  match_date: string;
  start_time: string | null;
  lock_at: string;
  lock_source: string;
  home_university_id: string;
  away_university_id: string;
  home_away_known: boolean;
  home_sets: number | null;
  away_sets: number | null;
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  stats_available: boolean;
  counts_for_fantasy: boolean;
  last_updated_at: string;
  last_checked_at: string | null;
}
const MATCH_COLS =
  "id, match_date, start_time, lock_at, lock_source, home_university_id, away_university_id, home_away_known, home_sets, away_sets, status, stats_available, counts_for_fantasy, last_updated_at, last_checked_at";

export async function getMatchesBetween(sb: Sb, from: string, to: string): Promise<MatchRow[]> {
  const { data } = await sb.from("matches").select(MATCH_COLS).gte("match_date", from).lte("match_date", to).order("match_date").order("lock_at");
  return (data ?? []) as MatchRow[];
}

export async function getMatch(sb: Sb, id: string): Promise<MatchRow | null> {
  const { data } = await sb.from("matches").select(MATCH_COLS).eq("id", id).maybeSingle();
  return (data as MatchRow) ?? null;
}

/** University ids whose match today has reached its lock time (their players are locked). */
export function lockedUniversities(todayMatches: readonly MatchRow[], now = new Date()): Set<string> {
  const out = new Set<string>();
  for (const m of todayMatches) {
    if (m.status === "cancelled" || m.status === "postponed") continue;
    if (new Date(m.lock_at).getTime() <= now.getTime()) {
      out.add(m.home_university_id);
      out.add(m.away_university_id);
    }
  }
  return out;
}

export interface TeamPlayerPoints {
  fantasy_team_id: string;
  player_id: string;
  match_id: string;
  week: number;
  slot: string;
  counted: boolean;
  points: number;
}
export async function getTeamPlayerPoints(sb: Sb, leagueId: string, filter: { teamId?: string; week?: number; matchId?: string }) {
  return fetchAll<TeamPlayerPoints>((from, to) => {
    let q = sb.from("v_team_player_match_points").select("fantasy_team_id, player_id, match_id, week, slot, counted, points").eq("league_id", leagueId);
    if (filter.teamId) q = q.eq("fantasy_team_id", filter.teamId);
    if (filter.week !== undefined) q = q.eq("week", filter.week);
    if (filter.matchId) q = q.eq("match_id", filter.matchId);
    return q.range(from, to);
  }).then((rows) => rows.map((r) => ({ ...r, points: Number(r.points) })));
}

/** Season fantasy points per player (league scoring, all weeks so far). */
export async function getSeasonPlayerPoints(sb: Sb, leagueId: string): Promise<Map<string, { points: number; games: number }>> {
  const rows = await fetchAll<{ player_id: string; points: number }>((from, to) =>
    sb.from("v_player_match_points").select("player_id, points").eq("league_id", leagueId).range(from, to),
  );
  const out = new Map<string, { points: number; games: number }>();
  for (const r of rows) {
    const cur = out.get(r.player_id) ?? { points: 0, games: 0 };
    cur.points = Math.round((cur.points + Number(r.points)) * 100) / 100;
    cur.games++;
    out.set(r.player_id, cur);
  }
  return out;
}

/** Which fantasy team (if any) currently owns each player. */
export async function getOwnership(sb: Sb, leagueId: string): Promise<Map<string, string>> {
  const rows = await fetchAll<{ player_id: string; fantasy_team_id: string }>((from, to) =>
    sb.from("roster_assignments").select("player_id, fantasy_team_id").eq("league_id", leagueId).is("released_at", null).range(from, to),
  );
  return new Map(rows.map((r) => [r.player_id, r.fantasy_team_id]));
}

export interface ScoringRuleRow {
  stat_key: string;
  label: string;
  points: number;
  active: boolean;
}
export interface RuleSetRow {
  id: string;
  version: number;
  effective_from_week: number;
  note: string | null;
  created_at: string;
  rules: ScoringRuleRow[];
}
export async function getRuleSets(sb: Sb, leagueId: string): Promise<RuleSetRow[]> {
  const { data } = await sb
    .from("scoring_rule_sets")
    .select("id, version, effective_from_week, note, created_at, scoring_rules(stat_key, label, points, active)")
    .eq("league_id", leagueId)
    .order("version", { ascending: false });
  return (data ?? []).map((s) => ({
    id: s.id,
    version: s.version,
    effective_from_week: s.effective_from_week,
    note: s.note,
    created_at: s.created_at,
    rules: ((s.scoring_rules ?? []) as ScoringRuleRow[]).map((r) => ({ ...r, points: Number(r.points) })),
  }));
}

/** The rule set in force for a week (same rule as the database view). */
export function ruleSetInForce(sets: readonly RuleSetRow[], week: number): RuleSetRow | null {
  return (
    [...sets]
      .filter((s) => s.effective_from_week <= week)
      .sort((a, b) => b.effective_from_week - a.effective_from_week || b.version - a.version)[0] ?? null
  );
}
