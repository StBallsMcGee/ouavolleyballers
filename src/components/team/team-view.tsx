import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getRoster, getSeasonPlayerPoints, getProjections, getStandings, getTeamPlayerPoints, getUniversities, loadLineupHistory, lockedUniversities, type RosterPlayer } from "@/lib/data/queries";
import { anyGameLive, dayChips } from "@/lib/data/games";
import { LiveRefresh } from "@/components/live-refresh";
import { rulesForWeek, weekBreakdowns } from "@/lib/data/breakdowns";
import { daysOfWeek, lineupMomentFor, playerDay, weekContaining, weekLinks } from "@/lib/data/days";
import { Avatar, MatchupStatus } from "@/components/ui";
import { formatDate } from "@/lib/time";
import type { EditorPlayer } from "./lineup-editor";
import { TeamDays } from "./team-days";

const label = (d: string) => formatDate(d, { weekday: "short", month: "short", day: "numeric" });

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/**
 * Shared by "My Team" (editable) and other teams' pages (read-only). Shows one day at a time:
 * each player's points and game for that day only. Everything for the day's Monday–Sunday week
 * is sent at once so switching days inside the week is instant.
 */
export async function TeamView({ teamId, editable, day: requested, path }: { teamId: string; editable: boolean; day?: string | null; path: string }) {
  const ctx = await requireLeague();
  const { supabase: sb, league, today, slots, weeks, teams } = ctx;
  const day = requested ?? today;
  const days = daysOfWeek(day);
  const monday = days[0]!.date;
  const sunday = days[6]!.date;
  const week = weekContaining(weeks, day);
  const pastDays = days.filter((d) => d.date < today).map((d) => d.date);

  const [roster, history, unis, matches, weekPts, standings, matchups, rules] = await Promise.all([
    getRoster(sb, teamId),
    pastDays.length ? loadLineupHistory(sb, teamId) : Promise.resolve(null),
    getUniversities(sb),
    getMatchesBetween(sb, monday < today ? monday : today, sunday > today ? sunday : today),
    week ? getTeamPlayerPoints(sb, league.id, { teamId, week: week.week }) : Promise.resolve([]),
    getStandings(sb, league.id, teams.map((t) => t.id)),
    week ? getMatchupScores(sb, league.id, week.week) : Promise.resolve([]),
    week ? rulesForWeek(sb, league.id, week.week) : Promise.resolve([]),
  ]);
  const pastLineups = new Map(pastDays.map((d) => [d, history ? history(lineupMomentFor(d, today, league.timezone)) : []]));
  const allIds = [...new Set([...roster, ...[...pastLineups.values()].flat()].map((p) => p.playerId))];
  const [breakdowns, season, proj] = await Promise.all([
    weekBreakdowns(sb, weekPts, unis),
    getSeasonPlayerPoints(sb, league.id, allIds),
    getProjections(sb, league.id, allIds),
  ]);

  const todays = matches.filter((m) => m.match_date === today && m.status !== "cancelled" && m.status !== "postponed");
  const locked = lockedUniversities(todays);
  const playsToday = new Set(todays.flatMap((m) => [m.home_university_id, m.away_university_id]));
  const weekMatches = matches.filter((m) => m.match_date >= monday && m.match_date <= sunday);
  const toEditor = (r: RosterPlayer, current: boolean): EditorPlayer => ({
    playerId: r.playerId,
    name: r.name,
    positions: r.positions,
    positionLabel: r.positionLabel,
    slot: r.slot,
    locked: current && r.universityId ? locked.has(r.universityId) : false,
    playsToday: r.universityId ? playsToday.has(r.universityId) : false,
    photoUrl: r.photoUrl,
    universityCode: r.universityId ? unis.get(r.universityId)?.short_name ?? unis.get(r.universityId)?.name ?? "?" : "?",
    seasonPoints: season.get(r.playerId)?.points ?? 0,
    byDay: Object.fromEntries(days.map((d) => [d.date, playerDay(breakdowns.get(r.playerId) ?? [], d.date, dayChips(r.universityId, weekMatches, unis, d.date, today), proj.get(r.playerId)?.perGame ?? null)])),
  });
  const current = roster.map((r) => toEditor(r, true));
  const past = Object.fromEntries([...pastLineups].map(([d, l]) => [d, l.map((r) => toEditor(r, false))]));
  const playing = new Set([...roster, ...[...pastLineups.values()].flat()].map((r) => r.universityId).filter(Boolean));
  const marks = days.filter((d) => weekMatches.some((m) => m.match_date === d.date && m.status !== "cancelled" && (playing.has(m.home_university_id) || playing.has(m.away_university_id)))).map((d) => d.date);
  const { prevHref, nextHref } = weekLinks(weeks, day, path);

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
          <Link href={`/matchups/${mu.id}?day=${day}`} className="mt-3 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 active:bg-gray-100">
            <span className="text-[11px] font-bold uppercase text-gray-500">Wk {mu.week}</span>
            <span className="text-lg font-black tabular-nums">{myScore.toFixed(1)}</span>
            <span className="text-xs text-gray-400">vs</span>
            <span className="text-lg font-black tabular-nums text-gray-500">{oppScore.toFixed(1)}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{teams.find((t) => t.id === oppId)?.name}</span>
            <MatchupStatus status={mu.status} source={mu.score_source} />
          </Link>
        ) : null}
      </div>
      <LiveRefresh active={anyGameLive(todays)} />
      <div className="mt-3">
        <TeamDays
          teamId={teamId}
          days={days}
          initialDay={day}
          today={today}
          current={current}
          past={past}
          slots={slots}
          editable={editable}
          rosterLimit={league.settings.roster.TOTAL}
          rules={rules}
          prevHref={prevHref}
          nextHref={nextHref}
          marks={marks}
          weekLabel={week ? `Week ${week.week}` : label(day)}
        />
      </div>
    </>
  );
}
