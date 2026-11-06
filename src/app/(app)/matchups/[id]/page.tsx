import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getMatchupScores, getRoster, getTeamPlayerPoints, type RosterPlayer } from "@/lib/data/queries";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { slotGroup } from "@/lib/league/settings";
import { formatDate } from "@/lib/time";
import { Card, Empty, GameLine, MatchupStatus, Notice } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league, slots } = ctx;
  const { data: row } = await sb.from("matchups").select("week").eq("id", id).maybeSingle();
  if (!row) notFound();
  const m = (await getMatchupScores(sb, league.id, row.week)).find((x) => x.id === id);
  if (!m) notFound();
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const isCurrent = m.week === ctx.currentWeek;
  const weekInfo = ctx.weeks.find((w) => w.week === m.week);
  const [home, away, homeRoster, awayRoster, sched] = await Promise.all([
    getTeamPlayerPoints(sb, league.id, { teamId: m.home_team_id, week: m.week }),
    getTeamPlayerPoints(sb, league.id, { teamId: m.away_team_id, week: m.week }),
    getRoster(sb, m.home_team_id),
    getRoster(sb, m.away_team_id),
    loadScheduleContext(sb, ctx.weeks, m.week, ctx.today),
  ]);
  const ptsOf = (rows: typeof home) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.player_id, Math.round(((map.get(r.player_id) ?? 0) + (r.counted ? r.points : 0)) * 100) / 100);
    return map;
  };
  const hp = ptsOf(home);
  const ap = ptsOf(away);

  const Side = ({ p, pts, align }: { p: RosterPlayer | undefined; pts: Map<string, number>; align: "left" | "right" }) => {
    if (!p) return <div className={`py-2 text-sm text-gray-400 ${align === "right" ? "text-right" : ""}`}>Empty</div>;
    const v = pts.get(p.playerId) ?? 0;
    return (
      <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <PlayerPhoto name={p.name} photo={p.photoUrl} size={32} />
        <div className="min-w-0 flex-1">
          <Link href={`/players/${p.playerId}`} className="block truncate text-[13px] font-bold leading-tight">{p.name}</Link>
          <div className="truncate text-[11px] text-gray-500">{sched.code(p.universityId)} · {p.positionLabel ?? "–"}</div>
          {isCurrent ? <div className="truncate text-[11px]"><GameLine chips={sched.chipsFor(p.universityId).slice(0, 2)} /></div> : null}
        </div>
        <div className={`w-10 shrink-0 text-[14px] font-extrabold tabular-nums ${v < 0 ? "text-red-600" : ""}`}>{v.toFixed(1)}</div>
      </div>
    );
  };

  const homeBench = homeRoster.filter((p) => p.slot === "BENCH");
  const awayBench = awayRoster.filter((p) => p.slot === "BENCH");
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
        <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-gray-500">
          <span>Week {m.week}{weekInfo ? ` · ${formatDate(weekInfo.starts_on, { month: "short", day: "numeric" })}–${formatDate(weekInfo.ends_on, { month: "short", day: "numeric" })}` : ""}</span>
          <MatchupStatus status={m.status} source={m.score_source} />
        </div>
        <div className="flex items-start gap-3">
          <ScoreSide teamId={m.home_team_id} score={m.home_score} align="left" />
          <span className="pt-6 text-xs font-bold text-gray-400">VS</span>
          <ScoreSide teamId={m.away_team_id} score={m.away_score} align="right" />
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {m.score_source === "imported" ? (
          <Notice>This result was recorded on USportVB before the league moved to Sideout, so a player-by-player breakdown isn&apos;t available.</Notice>
        ) : !isCurrent ? (
          <Card flush title="Points by player">
            {home.length + away.length === 0 ? <Empty>No points recorded for this week.</Empty> : (
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                {[{ rows: home, roster: homeRoster, t: m.home_team_id }, { rows: away, roster: awayRoster, t: m.away_team_id }].map(({ rows, t }) => {
                  const pts = ptsOf(rows);
                  return (
                    <ul key={t} className="divide-y divide-gray-100">
                      {[...pts.entries()].sort((a, b) => b[1] - a[1]).map(([pid, v]) => (
                        <li key={pid} className="flex justify-between gap-2 px-3 py-2 text-sm"><Link href={`/players/${pid}`} className="truncate">{[...homeRoster, ...awayRoster].find((r) => r.playerId === pid)?.name ?? "Former player"}</Link><span className="font-bold tabular-nums">{v.toFixed(1)}</span></li>
                      ))}
                    </ul>
                  );
                })}
              </div>
            )}
          </Card>
        ) : (
          <>
            <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
              <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">Starters</div>
              <ul className="divide-y divide-gray-100">
                {slots.map((s) => (
                  <li key={s} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-2">
                    <Side p={homeRoster.find((p) => p.slot === s)} pts={hp} align="left" />
                    <span className="w-8 text-center text-[10px] font-extrabold text-gray-500">{slotGroup(s)}</span>
                    <Side p={awayRoster.find((p) => p.slot === s)} pts={ap} align="right" />
                  </li>
                ))}
              </ul>
            </section>
            {benchRows > 0 ? (
              <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
                <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">Bench (doesn&apos;t score)</div>
                <ul className="divide-y divide-gray-100 opacity-75">
                  {Array.from({ length: benchRows }, (_, i) => (
                    <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-2">
                      <Side p={homeBench[i]} pts={new Map()} align="left" />
                      <span className="w-8 text-center text-[10px] font-extrabold text-gray-400">BN</span>
                      <Side p={awayBench[i]} pts={new Map()} align="right" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="px-4 text-xs text-gray-500 sm:px-0">Points shown are what counts this week: a player only scores for matches she started. Lineups shown are the current ones.</p>
          </>
        )}
      </div>
    </>
  );
}
