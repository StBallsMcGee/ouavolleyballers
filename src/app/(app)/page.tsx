import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getOwnership, getStandings, getUniversities } from "@/lib/data/queries";
import { addDays, formatDate } from "@/lib/time";
import { Card, Empty, MatchupStatus, Notice } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { OUA_TV_URL, ouaTvUrl } from "@/lib/oua-tv";
import { LEAGUE_TZ } from "@/lib/time";
import { anyGameLive } from "@/lib/data/games";
import { LiveRefresh } from "@/components/live-refresh";

export default async function Dashboard() {
  const ctx = await requireLeague();
  const { supabase: sb, league, teams, myTeam, currentWeek, weeks, today } = ctx;
  const week = weeks.find((w) => w.week === currentWeek);
  const team = new Map(teams.map((t) => [t.id, t]));

  const [matchups, standings, unis, recentMatches, ownership, { data: offers }] = await Promise.all([
    currentWeek ? getMatchupScores(sb, league.id, currentWeek) : Promise.resolve([]),
    getStandings(sb, league.id, teams.map((t) => t.id)),
    getUniversities(sb),
    getMatchesBetween(sb, addDays(today, -5), today),
    getOwnership(sb, league.id),
    myTeam ? sb.from("trades").select("id").eq("receiving_team_id", myTeam.id).eq("status", "proposed") : Promise.resolve({ data: [] }),
  ]);

  const recentIds = recentMatches.map((m) => m.id);
  const { data: perf } = recentIds.length
    ? await sb.from("v_player_match_points").select("player_id, match_id, points").eq("league_id", league.id).in("match_id", recentIds).order("points", { ascending: false }).limit(5)
    : { data: [] };
  const perfIds = (perf ?? []).map((p) => p.player_id);
  const [{ data: perfPlayers }, { data: perfPhotos }] = perfIds.length
    ? await Promise.all([
        sb.from("players").select("id, display_name, university_id, position_label").in("id", perfIds),
        sb.from("player_profiles").select("player_id, photo_url").in("player_id", perfIds),
      ])
    : [{ data: [] }, { data: [] }];
  const playerById = new Map((perfPlayers ?? []).map((p) => [p.id, p]));
  const photoOf = new Map((perfPhotos ?? []).map((p) => [p.player_id, p.photo_url]));

  const mine = myTeam ? matchups.find((m) => m.home_team_id === myTeam.id || m.away_team_id === myTeam.id) : undefined;
  const todaysGames = recentMatches
    .filter((m) => m.match_date === today && m.status !== "cancelled" && m.status !== "postponed")
    .sort((a, b) => (a.start_time ?? a.lock_at).localeCompare(b.start_time ?? b.lock_at));
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_TZ, hour: "numeric", minute: "2-digit" });
  const code = (id: string) => unis.get(id)?.short_name ?? unis.get(id)?.name ?? "?";
  const others = matchups.filter((m) => m !== mine);

  return (
    <>
      <div className="px-4 pb-2 pt-4 sm:px-0">
        <h1 className="truncate text-xl font-extrabold tracking-tight">{league.name}</h1>
        <p className="text-sm text-gray-500">
          {week ? `Week ${week.week} · ${formatDate(week.starts_on, { month: "short", day: "numeric" })}–${formatDate(week.ends_on, { month: "short", day: "numeric" })}` : league.season_label}
        </p>
      </div>

      <LiveRefresh active={anyGameLive(todaysGames)} />
      <div className="space-y-3">
        {league.status === "setup" ? <Notice tone="amber">Preview: the league switches over from USportVB soon.</Notice> : null}
        {offers && offers.length > 0 ? (
          <Notice tone="mint"><Link href="/trades" className="font-bold">{offers.length} trade offer{offers.length > 1 ? "s" : ""} waiting →</Link></Notice>
        ) : null}

        <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" /></span>
              <span className="text-[13px] font-extrabold uppercase tracking-wide">Watch live</span>
            </div>
            <a href={OUA_TV_URL} target="_blank" rel="noopener noreferrer" className="btn-primary min-h-[34px] px-4 py-1 text-xs">OUA.TV ↗</a>
          </div>
          {todaysGames.length ? (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {todaysGames.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-2">
                  <Link href={`/matches/${g.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {code(g.away_university_id)} @ {code(g.home_university_id)}
                    <span className="ml-2 text-xs font-normal text-gray-500">{g.status === "live" ? "LIVE" : g.status === "final" ? "Final" : g.start_time ? timeFmt.format(new Date(g.start_time)) : "Today"}</span>
                  </Link>
                  {g.status !== "final" ? (
                    <a href={ouaTvUrl(unis.get(g.home_university_id)?.name)} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-bold">▶ Watch</a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">No OUA women&apos;s games today. Replays and other games are on OUA.TV.</p>
          )}
        </section>

        {mine && myTeam ? (
          <Link href={`/matchups/${mine.id}`} className="block border-y border-gray-200 bg-white px-4 py-4 active:bg-gray-50 sm:rounded-xl sm:border">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">Your matchup</span>
              <MatchupStatus status={mine.status} source={mine.score_source} />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {[mine.home_team_id, mine.away_team_id].map((id, i) => (
                <div key={id} className={`min-w-0 ${i === 1 ? "order-3 text-right" : ""}`}>
                  <div className={`truncate text-sm font-bold ${id === myTeam.id ? "text-coral-600" : ""}`}>{team.get(id)?.name}</div>
                  <div className="text-3xl font-black tabular-nums">{(i === 0 ? mine.home_score : mine.away_score).toFixed(1)}</div>
                </div>
              ))}
              <span className="order-2 text-xs font-bold text-gray-400">vs</span>
            </div>
          </Link>
        ) : null}

        {others.length ? (
          <Card flush title="This week" action={<Link href="/matchups" className="link text-xs">All</Link>}>
            <ul className="divide-y divide-gray-100">
              {others.map((m) => (
                <li key={m.id}>
                  <Link href={`/matchups/${m.id}`} className="block px-4 py-2.5 active:bg-gray-50">
                    {[[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]].map(([id, s]) => (
                      <div key={id as string} className="flex items-center justify-between gap-3 text-sm">
                        <span className={`min-w-0 truncate ${m.winner_team_id === id ? "font-bold" : "text-gray-700"}`}>{team.get(id as string)?.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{(s as number).toFixed(1)}</span>
                      </div>
                    ))}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card flush title="Standings" action={<Link href="/standings" className="link text-xs">Full table</Link>}>
          <ol className="divide-y divide-gray-100">
            {standings.slice(0, 5).map((s) => (
              <li key={s.teamId}>
                <Link href={`/teams/${s.teamId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm active:bg-gray-50">
                  <span className="w-4 shrink-0 text-right text-xs font-bold text-gray-400">{s.rank}</span>
                  <span className={`min-w-0 flex-1 truncate ${s.teamId === myTeam?.id ? "font-bold text-coral-600" : "font-semibold"}`}>{team.get(s.teamId)?.name}</span>
                  <span className="shrink-0 font-mono text-xs text-gray-500">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card flush title="Top performers · last 5 days">
          {(perf ?? []).length === 0 ? <Empty>No stats in the last 5 days.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {(perf ?? []).map((p) => {
                const pl = playerById.get(p.player_id);
                const owner = ownership.get(p.player_id);
                return (
                  <li key={`${p.player_id}${p.match_id}`}>
                    <Link href={`/players/${p.player_id}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-gray-50">
                      <PlayerPhoto name={pl?.display_name ?? "?"} photo={photoOf.get(p.player_id)} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{pl?.display_name}</div>
                        <div className="truncate text-xs text-gray-500">
                          {pl?.university_id ? unis.get(pl.university_id)?.short_name : ""} · {owner ? <span className={owner === myTeam?.id ? "font-semibold text-coral-600" : ""}>{team.get(owner)?.name}</span> : <span className="font-semibold text-emerald-700">Free agent</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-base font-extrabold tabular-nums">{Number(p.points).toFixed(1)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
