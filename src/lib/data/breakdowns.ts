import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BreakdownGame } from "@/components/points-breakdown";
import { CORE_STAT_KEYS, type ScoringRule, type StatLine } from "@/lib/scoring/engine";
import { getRuleSets, ruleSetInForce, type TeamPlayerPoints, type University } from "./queries";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short" });

/** The scoring rules that applied in a given week (for the breakdown table). */
export async function rulesForWeek(sb: SupabaseClient, leagueId: string, week: number): Promise<ScoringRule[]> {
  const set = ruleSetInForce(await getRuleSets(sb, leagueId), week);
  return (set?.rules ?? []).map((r) => ({ statKey: r.stat_key, label: r.label, points: r.points, active: r.active }));
}

/**
 * Per player: each game this week with its stat line and points, for the tap-to-see breakdown.
 * Built from the same credited rows the team scores use, so the numbers always agree.
 */
export async function weekBreakdowns(
  sb: SupabaseClient,
  rows: readonly TeamPlayerPoints[],
  unis: ReadonlyMap<string, University>,
): Promise<Map<string, BreakdownGame[]>> {
  const out = new Map<string, BreakdownGame[]>();
  if (rows.length === 0) return out;
  const matchIds = [...new Set(rows.map((r) => r.match_id))];
  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const [{ data: stats }, { data: matches }] = await Promise.all([
    sb.from("player_match_statistics").select("*").in("match_id", matchIds).in("player_id", playerIds),
    sb.from("matches").select("id, match_date, home_university_id, away_university_id, home_away_known").in("id", matchIds),
  ]);
  const statOf = new Map((stats ?? []).map((s) => [`${s.player_id}:${s.match_id}`, s]));
  const matchOf = new Map((matches ?? []).map((m) => [m.id as string, m]));
  for (const r of [...rows].sort((a, b) => String(matchOf.get(a.match_id)?.match_date).localeCompare(String(matchOf.get(b.match_id)?.match_date)))) {
    const s = statOf.get(`${r.player_id}:${r.match_id}`);
    const m = matchOf.get(r.match_id);
    if (!s || !m) continue;
    const isHome = m.home_university_id === s.university_id;
    const opp = unis.get(isHome ? m.away_university_id : m.home_university_id);
    const label = `${dayFmt.format(new Date(`${m.match_date}T12:00:00Z`))} ${m.home_away_known && !isHome ? "@" : "vs"} ${opp?.short_name ?? opp?.name ?? "?"}`;
    const line = Object.fromEntries(CORE_STAT_KEYS.map((k) => [k, Number(s[k] ?? 0)])) as StatLine;
    line.other = (s.other_statistics ?? {}) as Record<string, number>;
    out.set(r.player_id, [...(out.get(r.player_id) ?? []), { label, line, points: r.points, counted: r.counted }]);
  }
  return out;
}
