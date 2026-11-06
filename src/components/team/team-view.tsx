import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getRoster, getSeasonPlayerPoints, getTeamPlayerPoints, getUniversities, lockedUniversities } from "@/lib/data/queries";
import { addDays, formatDate } from "@/lib/time";
import { LineupEditor, type EditorPlayer } from "./lineup-editor";

/** Shared by "My Team" (editable) and other teams' pages (read-only). */
export async function TeamView({ teamId, editable }: { teamId: string; editable: boolean }) {
  const ctx = await requireLeague();
  const { supabase: sb, league, today, currentWeek, slots } = ctx;
  const [roster, unis, upcoming, weekPts, season] = await Promise.all([
    getRoster(sb, teamId),
    getUniversities(sb),
    getMatchesBetween(sb, today, addDays(today, 21)),
    currentWeek ? getTeamPlayerPoints(sb, league.id, { teamId, week: currentWeek }) : Promise.resolve([]),
    getSeasonPlayerPoints(sb, league.id),
  ]);
  const todays = upcoming.filter((m) => m.match_date === today && m.status !== "cancelled" && m.status !== "postponed");
  const locked = lockedUniversities(todays);
  const playsToday = new Set(todays.flatMap((m) => [m.home_university_id, m.away_university_id]));
  const nextFor = (uni: string | null) => {
    if (!uni) return null;
    const m = upcoming.find((x) => (x.home_university_id === uni || x.away_university_id === uni) && x.status !== "final" && x.status !== "cancelled");
    if (!m) return null;
    const opp = m.home_university_id === uni ? m.away_university_id : m.home_university_id;
    return `${formatDate(m.match_date, { weekday: "short", month: "short", day: "numeric" })} vs ${unis.get(opp)?.name ?? "?"}`;
  };
  const weekByPlayer = new Map<string, number>();
  for (const r of weekPts) weekByPlayer.set(r.player_id, Math.round(((weekByPlayer.get(r.player_id) ?? 0) + r.points) * 100) / 100);

  const players: EditorPlayer[] = roster
    .map((r) => ({
      playerId: r.playerId,
      name: r.name,
      positions: r.positions,
      positionLabel: r.positionLabel,
      slot: r.slot,
      locked: r.universityId ? locked.has(r.universityId) : false,
      playsToday: r.universityId ? playsToday.has(r.universityId) : false,
      university: r.universityId ? unis.get(r.universityId)?.name ?? "?" : "?",
      weekPoints: weekByPlayer.get(r.playerId) ?? 0,
      seasonPoints: season.get(r.playerId)?.points ?? 0,
      nextMatch: nextFor(r.universityId),
    }))
    .sort((a, b) => b.seasonPoints - a.seasonPoints);

  const weekTotal = weekPts.filter((r) => r.counted).reduce((a, r) => a + r.points, 0);
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card p-3 text-center"><div className="text-xs text-slate-400">Week {currentWeek ?? "–"} points</div><div className="text-2xl font-black tabular-nums">{weekTotal.toFixed(1)}</div></div>
        <div className="card p-3 text-center"><div className="text-xs text-slate-400">Roster</div><div className="text-2xl font-black tabular-nums">{roster.length}/{league.settings.roster.TOTAL}</div></div>
        <div className="card p-3 text-center"><div className="text-xs text-slate-400">Playing today</div><div className="text-2xl font-black tabular-nums">{players.filter((p) => p.playsToday).length}</div></div>
      </div>
      <LineupEditor teamId={teamId} players={players} slots={slots} editable={editable} rosterLimit={league.settings.roster.TOTAL} />
      <p className="mt-4 text-xs text-slate-500">
        Lineups lock player by player: once a player&apos;s match starts (or, when the start time is unknown, at {league.settings.lineupLock.fallbackLocalTime} Toronto time on match day), they can&apos;t be moved until the next day. Points count only for players in a starting slot when their match locks.
      </p>
    </>
  );
}
