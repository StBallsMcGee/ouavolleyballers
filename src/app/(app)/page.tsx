import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getOwnership, getStandings, getUniversities } from "@/lib/data/queries";
import { addDays, formatDate } from "@/lib/time";
import { Badge, Card, Empty, Freshness, MatchStatus, MatchupStatus, Notice, PageHeader, Points, TeamLink } from "@/components/ui";

export default async function Dashboard() {
  const ctx = await requireLeague();
  const { supabase: sb, league, teams, myTeam, currentWeek, weeks, today } = ctx;
  const week = weeks.find((w) => w.week === currentWeek);
  const teamName = new Map(teams.map((t) => [t.id, t]));

  const [matchups, standings, unis, recentMatches, ownership, { data: offers }, { data: lastSync }] = await Promise.all([
    currentWeek ? getMatchupScores(sb, league.id, currentWeek) : Promise.resolve([]),
    getStandings(sb, league.id, teams.map((t) => t.id)),
    getUniversities(sb),
    getMatchesBetween(sb, addDays(today, -5), addDays(today, 2)),
    getOwnership(sb, league.id),
    myTeam ? sb.from("trades").select("id").eq("receiving_team_id", myTeam.id).eq("status", "proposed") : Promise.resolve({ data: [] }),
    sb.from("matches").select("last_updated_at").order("last_updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const recentIds = recentMatches.filter((m) => m.match_date <= today).map((m) => m.id);
  const { data: perf } = recentIds.length
    ? await sb.from("v_player_match_points").select("player_id, match_id, points").eq("league_id", league.id).in("match_id", recentIds).order("points", { ascending: false }).limit(8)
    : { data: [] };
  const perfPlayerIds = (perf ?? []).map((p) => p.player_id);
  const { data: perfPlayers } = perfPlayerIds.length
    ? await sb.from("players").select("id, display_name, university_id, position_label").in("id", perfPlayerIds)
    : { data: [] };
  const playerById = new Map((perfPlayers ?? []).map((p) => [p.id, p]));

  const mine = myTeam ? matchups.find((m) => m.home_team_id === myTeam.id || m.away_team_id === myTeam.id) : undefined;
  const uniName = (id: string) => unis.get(id)?.name ?? "Unknown";

  return (
    <>
      <PageHeader
        title={league.name}
        subtitle={<>{league.season_label} season{week ? <> · Week {week.week} ({formatDate(week.starts_on, { month: "short", day: "numeric" })} – {formatDate(week.ends_on, { month: "short", day: "numeric" })})</> : null}</>}
        actions={<Freshness at={lastSync?.last_updated_at} />}
      />
      {league.status === "setup" ? <div className="mb-4"><Notice tone="amber">The league is being set up. Rosters and scores shown here are a preview until the administrator activates the league.</Notice></div> : null}
      {offers && offers.length > 0 ? (
        <div className="mb-4"><Notice tone="mint">You have {offers.length} trade offer{offers.length > 1 ? "s" : ""} waiting. <Link href="/trades" className="link">Review</Link></Notice></div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {mine && myTeam ? (
            <Card title={`Your week ${mine.week} matchup`} action={<MatchupStatus status={mine.status} source={mine.score_source} />}>
              <Link href={`/matchups/${mine.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-court-950/60 p-4 hover:bg-court-950">
                {[mine.home_team_id, mine.away_team_id].map((id, i) => (
                  <div key={id} className={`${i === 1 ? "order-3 text-right" : ""}`}>
                    <div className={`truncate text-sm font-bold ${id === myTeam.id ? "text-coral-400" : ""}`}>{teamName.get(id)?.name}</div>
                    <div className="truncate text-xs text-slate-500">{teamName.get(id)?.manager}</div>
                    <div className="mt-1 text-3xl font-black tabular-nums">{(i === 0 ? mine.home_score : mine.away_score).toFixed(1)}</div>
                  </div>
                ))}
                <div className="order-2 text-xs font-bold text-slate-500">VS</div>
              </Link>
            </Card>
          ) : null}

          <Card title={currentWeek ? `Week ${currentWeek} matchups` : "Matchups"} action={<Link href="/matchups" className="text-xs link">All weeks</Link>}>
            {matchups.length === 0 ? <Empty>No matchups this week.</Empty> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {matchups.map((m) => (
                  <li key={m.id}>
                    <Link href={`/matchups/${m.id}`} className="block rounded-xl bg-court-950/60 px-3 py-2 hover:bg-court-950">
                      {[[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]].map(([id, s]) => (
                        <div key={id as string} className="flex justify-between gap-2 text-sm">
                          <span className={`truncate ${id === myTeam?.id ? "font-bold text-coral-400" : ""} ${m.winner_team_id === id ? "font-bold" : ""}`}>{teamName.get(id as string)?.name}</span>
                          <span className="font-mono tabular-nums">{(s as number).toFixed(1)}</span>
                        </div>
                      ))}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Top performances (last 5 days)">
            {(perf ?? []).length === 0 ? <Empty>No matches with statistics in the last 5 days.</Empty> : (
              <table className="table">
                <tbody>
                  {(perf ?? []).map((p) => {
                    const pl = playerById.get(p.player_id);
                    const owner = ownership.get(p.player_id);
                    return (
                      <tr key={`${p.player_id}${p.match_id}`}>
                        <td><Link href={`/players/${p.player_id}`} className="font-semibold hover:underline">{pl?.display_name}</Link><div className="text-xs text-slate-500">{pl?.position_label ?? "–"} · {pl?.university_id ? uniName(pl.university_id) : ""}</div></td>
                        <td className="text-xs">{owner ? <TeamLink id={owner} name={teamName.get(owner)?.name ?? ""} mine={owner === myTeam?.id} /> : <Badge tone="mint">Free agent</Badge>}</td>
                        <td className="text-right"><Points value={Number(p.points)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Standings" action={<Link href="/standings" className="text-xs link">Full table</Link>}>
            <ol className="space-y-1 text-sm">
              {standings.map((s) => (
                <li key={s.teamId} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs text-slate-500">{s.rank}</span>
                  <span className={`flex-1 truncate ${s.teamId === myTeam?.id ? "font-bold text-coral-400" : ""}`}>{teamName.get(s.teamId)?.name}</span>
                  <span className="font-mono text-xs text-slate-400">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Recent & upcoming matches" action={<Link href="/matches" className="text-xs link">Match centre</Link>}>
            {recentMatches.length === 0 ? <Empty>No matches in this window.</Empty> : (
              <ul className="space-y-2 text-sm">
                {recentMatches.slice(-8).reverse().map((m) => (
                  <li key={m.id}>
                    <Link href={`/matches/${m.id}`} className="flex items-center justify-between gap-2 hover:underline">
                      <span className="truncate">{uniName(m.home_university_id)} – {uniName(m.away_university_id)}</span>
                      <span className="shrink-0 text-xs text-slate-500">{formatDate(m.match_date, { month: "short", day: "numeric" })}</span>
                    </Link>
                    <MatchStatus status={m.status} statsAvailable={m.stats_available} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
