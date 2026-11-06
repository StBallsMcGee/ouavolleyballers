import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getRoster, getSeasonPlayerPoints, getStandings, getTeamPlayerPoints, getUniversities, lockedUniversities } from "@/lib/data/queries";
import { gameChips } from "@/lib/data/games";
import { addDays } from "@/lib/time";
import { Avatar, MatchupStatus } from "@/components/ui";
import { LineupEditor, type EditorPlayer } from "./lineup-editor";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** Shared by "My Team" (editable) and other teams' pages (read-only). */
export async function TeamView({ teamId, editable }: { teamId: string; editable: boolean }) {
  const ctx = await requireLeague();
  const { supabase: sb, league, today, currentWeek, slots, weeks, teams } = ctx;
  const week = weeks.find((w) => w.week === currentWeek) ?? null;
  const from = week && week.starts_on < today ? week.starts_on : today;
  const [roster, unis, matches, weekPts, season, standings, matchups] = await Promise.all([
    getRoster(sb, teamId),
    getUniversities(sb),
    getMatchesBetween(sb, from, addDays(from, 75)),
    currentWeek ? getTeamPlayerPoints(sb, league.id, { teamId, week: currentWeek }) : Promise.resolve([]),
    getSeasonPlayerPoints(sb, league.id),
    getStandings(sb, league.id, teams.map((t) => t.id)),
    currentWeek ? getMatchupScores(sb, league.id, currentWeek) : Promise.resolve([]),
  ]);
  const todays = matches.filter((m) => m.match_date === today && m.status !== "cancelled" && m.status !== "postponed");
  const locked = lockedUniversities(todays);
  const playsToday = new Set(todays.flatMap((m) => [m.home_university_id, m.away_university_id]));
  const weekByPlayer = new Map<string, number>();
  for (const r of weekPts) weekByPlayer.set(r.player_id, Math.round(((weekByPlayer.get(r.player_id) ?? 0) + r.points) * 100) / 100);

  const players: EditorPlayer[] = roster.map((r) => ({
    playerId: r.playerId,
    name: r.name,
    positions: r.positions,
    positionLabel: r.positionLabel,
    slot: r.slot,
    locked: r.universityId ? locked.has(r.universityId) : false,
    playsToday: r.universityId ? playsToday.has(r.universityId) : false,
    universityCode: r.universityId ? unis.get(r.universityId)?.short_name ?? unis.get(r.universityId)?.name ?? "?" : "?",
    weekPoints: weekByPlayer.get(r.playerId) ?? 0,
    seasonPoints: season.get(r.playerId)?.points ?? 0,
    games: gameChips(r.universityId, matches, unis, week, today),
  }));

  const team = teams.find((t) => t.id === teamId);
  const st = standings.find((s) => s.teamId === teamId);
  const mu = matchups.find((m) => m.home_team_id === teamId || m.away_team_id === teamId);
  const oppId = mu ? (mu.home_team_id === teamId ? mu.away_team_id : mu.home_team_id) : null;
  const myScore = mu ? (mu.home_team_id === teamId ? mu.home_score : mu.away_score) : 0;
  const oppScore = mu ? (mu.home_team_id === teamId ? mu.away_score : mu.home_score) : 0;

  return (
    <>
      <div className="border-b border-gray-200 bg-white px-4 pb-3 pt-4 sm:mt-4 sm:rounded-xl sm:border">
        <div className="flex items-center gap-3">
          <Avatar name={team?.name ?? "?"} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold leading-tight">{team?.name}</h1>
            <p className="truncate text-xs text-gray-500">{team?.manager}</p>
            {st ? <p className="mt-0.5 text-xs font-semibold text-gray-700">{st.wins}-{st.losses}{st.ties ? `-${st.ties}` : ""} · {ordinal(st.rank)} place</p> : null}
          </div>
        </div>
        {mu && oppId ? (
          <Link href={`/matchups/${mu.id}`} className="mt-3 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 active:bg-gray-100">
            <span className="text-[11px] font-bold uppercase text-gray-500">Wk {mu.week}</span>
            <span className="text-lg font-black tabular-nums">{myScore.toFixed(1)}</span>
            <span className="text-xs text-gray-400">vs</span>
            <span className="text-lg font-black tabular-nums text-gray-500">{oppScore.toFixed(1)}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{teams.find((t) => t.id === oppId)?.name}</span>
            <MatchupStatus status={mu.status} source={mu.score_source} />
          </Link>
        ) : null}
      </div>
      <div className="mt-3">
        <LineupEditor teamId={teamId} players={players} slots={slots} editable={editable} rosterLimit={league.settings.roster.TOTAL} />
      </div>
      <p className="px-4 pb-4 text-xs text-gray-500 sm:px-0">
        Each player locks when her match starts (if no start time is listed: {league.settings.lineupLock.fallbackLocalTime} Toronto time on match day) and stays locked for the rest of the day. Only starters score. Times are Toronto time.
      </p>
    </>
  );
}
