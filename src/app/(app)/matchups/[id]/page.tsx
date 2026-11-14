import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getProjections, getTeamPlayerPoints, getUniversities, loadLineupHistory, type RosterPlayer } from "@/lib/data/queries";
import { anyGameLive, dayChips } from "@/lib/data/games";
import { LiveRefresh } from "@/components/live-refresh";
import { countedTotal, daysOfWeek, lineupMomentFor, playerDay, projectedTotal } from "@/lib/data/days";
import { slotGroup } from "@/lib/league/settings";
import { formatDate, parseDay } from "@/lib/time";
import { MatchupStatus, Notice } from "@/components/ui";
import { TeamAvatar } from "@/components/team-avatar";
import { MatchupDays, type MatchupDay, type SidePlayer } from "@/components/matchup-days";
import { rulesForWeek, weekBreakdowns } from "@/lib/data/breakdowns";

/** "Alora Lavallee" -> "A. Lavallee" so names fit side by side on a phone. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}

export default async function MatchupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireLeague();
  const { supabase: sb, league, slots, today } = ctx;
  const { data: row } = await sb.from("matchups").select("week, home_team_id, away_team_id").eq("id", id).maybeSingle();
  if (!row) notFound();
  const weekInfo = ctx.weeks.find((w) => w.week === row.week);
  const days = daysOfWeek(weekInfo?.starts_on ?? today);
  const monday = days[0]!.date;
  const sunday = days[6]!.date;

  // Everything at once: scores, schedule, rules, both teams' points and lineup histories.
  const [scores, unis, matches, rules, homeRows, awayRows, homeHist, awayHist] = await Promise.all([
    getMatchupScores(sb, league.id, row.week),
    getUniversities(sb),
    getMatchesBetween(sb, monday, sunday),
    rulesForWeek(sb, league.id, row.week),
    getTeamPlayerPoints(sb, league.id, { teamId: row.home_team_id, week: row.week }),
    getTeamPlayerPoints(sb, league.id, { teamId: row.away_team_id, week: row.week }),
    loadLineupHistory(sb, row.home_team_id),
    loadLineupHistory(sb, row.away_team_id),
  ]);
  const m = scores.find((x) => x.id === id);
  if (!m) notFound();
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const imported = m.score_source === "imported";
  const lineupIds = [...new Set([...homeHist(new Date().toISOString()), ...awayHist(new Date().toISOString())].map((p) => p.playerId))];
  const [breaks, proj] = await Promise.all([
    weekBreakdowns(sb, [...homeRows, ...awayRows], unis),
    getProjections(sb, league.id, lineupIds),
  ]);

  // Which day to open: the one asked for, else today, else (past weeks) the last day with games.
  const inWeek = (d: string | null) => !!d && d >= monday && d <= sunday;
  const requested = parseDay(sp.day);
  const lastGameDay = [...matches].filter((x) => x.status !== "cancelled" && x.match_date <= today).map((x) => x.match_date).sort().pop();
  const day = inWeek(requested) ? requested! : inWeek(today) ? today : sunday < today ? (lastGameDay ?? sunday) : monday;

  const code = (uni: string | null) => (uni ? unis.get(uni)?.short_name ?? unis.get(uni)?.name ?? "?" : "?");
  const side = (p: RosterPlayer, date: string): SidePlayer => ({
    playerId: p.playerId,
    name: p.name,
    shortName: shortName(p.name),
    photoUrl: p.photoUrl,
    code: code(p.universityId),
    pos: p.positionLabel ?? "–",
    day: playerDay(breaks.get(p.playerId) ?? [], date, dayChips(p.universityId, matches, unis, date, today), date >= today ? proj.get(p.playerId)?.perGame ?? null : null),
  });
  const universities = new Set<string>();
  let homeProj = 0;
  let awayProj = 0;
  const byDay: Record<string, MatchupDay> = {};
  for (const d of days) {
    const at = lineupMomentFor(d.date, today, league.timezone);
    const homeL = homeHist(at);
    const awayL = awayHist(at);
    const home = homeL.map((p) => side(p, d.date));
    const away = awayL.map((p) => side(p, d.date));
    for (const p of [...homeL, ...awayL]) if (p.universityId) universities.add(p.universityId);
    const slotOf = new Map([...homeL, ...awayL].map((p) => [p.playerId, p.slot]));
    byDay[d.date] = {
      starters: slots.map((s) => ({
        slot: s,
        group: slotGroup(s),
        home: home.find((p) => slotOf.get(p.playerId) === s) ?? null,
        away: away.find((p) => slotOf.get(p.playerId) === s) ?? null,
      })),
      homeBench: home.filter((p) => slotOf.get(p.playerId) === "BENCH"),
      awayBench: away.filter((p) => slotOf.get(p.playerId) === "BENCH"),
      homeTotal: countedTotal(home.map((p) => p.day)),
      awayTotal: countedTotal(away.map((p) => p.day)),
    };
    // Still to come: current starters' projections for games not played yet.
    const starters = byDay[d.date]!.starters;
    homeProj += projectedTotal(starters.flatMap((s) => (s.home ? [s.home.day] : [])));
    awayProj += projectedTotal(starters.flatMap((s) => (s.away ? [s.away.day] : [])));
  }
  const marks = days
    .filter((d) => matches.some((x) => x.match_date === d.date && x.status !== "cancelled" && (universities.has(x.home_university_id) || universities.has(x.away_university_id))))
    .map((d) => d.date);
  const prevHref = m.week > 1 ? `/matchups?week=${m.week - 1}` : null;
  const nextHref = ctx.weeks.some((w) => w.week === m.week + 1) ? `/matchups?week=${m.week + 1}` : null;

  const showProj = !imported && m.status !== "final" && m.status !== "void" && homeProj + awayProj > 0;
  const ScoreSide = ({ teamId, score, align, projected }: { teamId: string; score: number; align: "left" | "right"; projected: number }) => {
    const won = m.winner_team_id === teamId;
    return (
      <Link href={`/teams/${teamId}`} className={`flex min-w-0 flex-1 flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
        <TeamAvatar team={team.get(teamId)} size={40} ring={teamId === ctx.myTeam?.id} />
        <div className={`mt-1.5 w-full truncate text-sm font-extrabold ${teamId === ctx.myTeam?.id ? "text-gold-300" : ""}`}>{team.get(teamId)?.name}</div>
        <div className="w-full truncate text-[11px] text-brand-200">{team.get(teamId)?.manager}</div>
        <div className={`mt-1 text-3xl font-black tabular-nums ${m.status === "final" && !won && !m.is_tie ? "text-brand-300" : won ? "text-gold-300" : ""}`}>{score.toFixed(1)}</div>
        {showProj ? <div className="text-xs font-semibold tabular-nums text-brand-100">Proj {(score + projected).toFixed(1)}</div> : null}
      </Link>
    );
  };

  return (
    <>
      <div className="bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 px-4 pb-4 pt-3 text-white shadow-sm sm:mt-4 sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-200">
          <span className="flex items-center gap-2">
            {m.week > 1 ? <Link href={`/matchups?week=${m.week - 1}`} className="text-brand-300" aria-label="Previous week">‹</Link> : null}
            Week {m.week}{weekInfo ? ` · ${formatDate(weekInfo.starts_on, { month: "short", day: "numeric" })}–${formatDate(weekInfo.ends_on, { month: "short", day: "numeric" })}` : ""}
            <Link href={`/matchups?week=${m.week + 1}`} className="text-brand-300" aria-label="Next week">›</Link>
          </span>
          <MatchupStatus status={m.status} source={m.score_source} />
        </div>
        <div className="flex items-start gap-3">
          <ScoreSide teamId={m.home_team_id} score={m.home_score} align="left" projected={homeProj} />
          <span className="pt-14 text-xs font-black text-gold-400">VS</span>
          <ScoreSide teamId={m.away_team_id} score={m.away_score} align="right" projected={awayProj} />
        </div>
      </div>

      <LiveRefresh active={!imported && anyGameLive(matches.filter((x) => x.match_date === today))} />
      <div className="mt-3 space-y-3">
        {imported ? (
          <Notice>{m.status === "void" ? "No contest: this week was played on USportVB with no result." : "Final score recorded on USportVB; player points weren't tracked here."}</Notice>
        ) : null}
        <MatchupDays days={days} initialDay={day} today={today} byDay={byDay} rules={rules} imported={imported} prevHref={prevHref} nextHref={nextHref} marks={marks} weekLabel={`Week ${m.week}`} />
      </div>
    </>
  );
}
