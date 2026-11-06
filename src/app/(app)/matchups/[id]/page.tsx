import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getLineupAt, getMatchupScores, getTeamPlayerPoints, type RosterPlayer } from "@/lib/data/queries";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { slotGroup } from "@/lib/league/settings";
import { formatDate } from "@/lib/time";
import { GameLine, MatchupStatus, Notice } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";

/** "Alora Lavallee" -> "A. Lavallee" so names fit side by side on a phone. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league, slots, today } = ctx;
  const { data: row } = await sb.from("matchups").select("week").eq("id", id).maybeSingle();
  if (!row) notFound();
  const m = (await getMatchupScores(sb, league.id, row.week)).find((x) => x.id === id);
  if (!m) notFound();
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const weekInfo = ctx.weeks.find((w) => w.week === m.week);
  const isPast = !!weekInfo && weekInfo.ends_on < today;
  // Past weeks: the lineups as they stood at the end of that week. Otherwise: today's lineups.
  const at = isPast && weekInfo ? new Date(`${weekInfo.ends_on}T23:59:00-05:00`).toISOString() : new Date().toISOString();
  const imported = m.score_source === "imported";

  const [homeRows, awayRows, home, away, sched] = await Promise.all([
    getTeamPlayerPoints(sb, league.id, { teamId: m.home_team_id, week: m.week }),
    getTeamPlayerPoints(sb, league.id, { teamId: m.away_team_id, week: m.week }),
    getLineupAt(sb, m.home_team_id, at),
    getLineupAt(sb, m.away_team_id, at),
    loadScheduleContext(sb, ctx.weeks, m.week, today),
  ]);
  const points = (rows: typeof homeRows) => {
    const counted = new Map<string, number>();
    const bench = new Map<string, number>();
    for (const r of rows) {
      const map = r.counted ? counted : bench;
      map.set(r.player_id, Math.round(((map.get(r.player_id) ?? 0) + r.points) * 100) / 100);
    }
    return { counted, bench };
  };
  const hp = points(homeRows);
  const ap = points(awayRows);
  const showGames = !isPast;

  const Side = ({ p, pts, align, benchRow }: { p: RosterPlayer | undefined; pts: ReturnType<typeof points>; align: "left" | "right"; benchRow?: boolean }) => {
    if (!p) return <div className={`py-2 text-xs font-semibold text-gray-400 ${align === "right" ? "text-right" : ""}`}>Empty</div>;
    const v = benchRow ? pts.bench.get(p.playerId) ?? 0 : pts.counted.get(p.playerId) ?? 0;
    return (
      <Link href={`/players/${p.playerId}`} className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <PlayerPhoto name={p.name} photo={p.photoUrl} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold leading-tight"><span className="sm:hidden">{shortName(p.name)}</span><span className="hidden sm:inline">{p.name}</span></div>
          <div className="truncate text-[11px] text-gray-500">{sched.code(p.universityId)} · {p.positionLabel ?? "–"}</div>
          {showGames ? <div className="text-[11px]"><GameLine chips={sched.chipsFor(p.universityId)} compact /></div> : null}
        </div>
        <div className={`w-9 shrink-0 text-[14px] font-extrabold tabular-nums ${imported ? "text-gray-300" : benchRow ? "text-gray-400" : v < 0 ? "text-red-600" : ""}`}>{imported ? "–" : v.toFixed(1)}</div>
      </Link>
    );
  };

  const homeBench = home.filter((p) => p.slot === "BENCH");
  const awayBench = away.filter((p) => p.slot === "BENCH");
  const benchRows = Math.max(homeBench.length, awayBench.length);

  const ScoreSide = ({ teamId, score, align }: { teamId: string; score: number; align: "left" | "right" }) => {
    const won = m.winner_team_id === teamId;
    return (
      <Link href={`/teams/${teamId}`} className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}>
        <div className={`truncate text-sm font-extrabold ${teamId === ctx.myTeam?.id ? "text-coral-600" : ""}`}>{team.get(teamId)?.name}</div>
        <div className="truncate text-[11px] text-gray-500">{team.get(teamId)?.manager}</div>
        <div className={`mt-1 text-3xl font-black tabular-nums ${m.status === "final" && !won && !m.is_tie ? "text-gray-400" : ""}`}>{score.toFixed(1)}</div>
      </Link>
    );
  };

  return (
    <>
      <div className="border-b border-gray-200 bg-white px-4 pb-4 pt-3 sm:mt-4 sm:rounded-xl sm:border">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          <span className="flex items-center gap-2">
            {m.week > 1 ? <Link href={`/matchups?week=${m.week - 1}`} className="text-gray-400" aria-label="Previous week">‹</Link> : null}
            Week {m.week}{weekInfo ? ` · ${formatDate(weekInfo.starts_on, { month: "short", day: "numeric" })}–${formatDate(weekInfo.ends_on, { month: "short", day: "numeric" })}` : ""}
            <Link href={`/matchups?week=${m.week + 1}`} className="text-gray-400" aria-label="Next week">›</Link>
          </span>
          <MatchupStatus status={m.status} source={m.score_source} />
        </div>
        <div className="flex items-start gap-3">
          <ScoreSide teamId={m.home_team_id} score={m.home_score} align="left" />
          <span className="pt-6 text-xs font-bold text-gray-400">VS</span>
          <ScoreSide teamId={m.away_team_id} score={m.away_score} align="right" />
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {imported ? (
          <Notice>{m.status === "void" ? "No contest: this week was played on USportVB with no result." : "Final score recorded on USportVB; player points weren't tracked here."}</Notice>
        ) : null}
        <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
          <div className="flex justify-between border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
            <span>Starters</span>
            <span>{isPast ? "Lineups at end of week" : "Current lineups"}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {slots.map((s) => (
              <li key={s} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2 py-2">
                <Side p={home.find((p) => p.slot === s)} pts={hp} align="left" />
                <span className="w-7 text-center text-[10px] font-extrabold text-gray-500">{slotGroup(s)}</span>
                <Side p={away.find((p) => p.slot === s)} pts={ap} align="right" />
              </li>
            ))}
          </ul>
        </section>
        {benchRows > 0 ? (
          <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
            <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">Bench · doesn&apos;t count</div>
            <ul className="divide-y divide-gray-100">
              {Array.from({ length: benchRows }, (_, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-2 opacity-80">
                  <Side p={homeBench[i]} pts={hp} align="left" benchRow />
                  <span className="w-8 text-center text-[10px] font-extrabold text-gray-400">BN</span>
                  <Side p={awayBench[i]} pts={ap} align="right" benchRow />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
