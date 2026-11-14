import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getMatchupScores, getOwnership, getStandings, getUniversities } from "@/lib/data/queries";
import { addDays, formatDate } from "@/lib/time";
import { Card, Empty, MatchupStatus, Notice } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { TeamAvatar } from "@/components/team-avatar";
import { OUA_TV_URL, ouaTvUrl } from "@/lib/oua-tv";
import { LEAGUE_TZ } from "@/lib/time";
import { anyGameLive } from "@/lib/data/games";
import { LiveRefresh } from "@/components/live-refresh";

const TILES = ["tile-violet", "tile-green", "tile-orange", "tile-blue", "tile-pink", "tile-teal"];

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
      <div className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-0">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">Hi {(ctx.profile?.display_name || myTeam?.manager || "there").split(" ")[0]}</h1>
          <p className="truncate text-sm text-gray-500">
            {week ? `Week ${week.week} · ${formatDate(week.starts_on, { month: "short", day: "numeric" })}–${formatDate(week.ends_on, { month: "short", day: "numeric" })}` : league.season_label} · {league.name}
          </p>
        </div>
        {myTeam ? <Link href="/team" aria-label="My team"><TeamAvatar team={myTeam} size={46} ring /></Link> : null}
      </div>

      <LiveRefresh active={anyGameLive(todaysGames)} />
      <div className="space-y-3">
        {league.status === "setup" ? <Notice tone="amber">Preview: the league switches over from USportVB soon.</Notice> : null}
        {offers && offers.length > 0 ? (
          <Notice tone="mint"><Link href="/trades" className="font-bold">{offers.length} trade offer{offers.length > 1 ? "s" : ""} waiting →</Link></Notice>
        ) : null}

        {mine && myTeam ? (
          <Link href={`/matchups/${mine.id}`} className="relative mx-3 block overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 px-5 py-5 text-white shadow-xl shadow-brand-950/50 active:opacity-95 sm:mx-0">
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-gold-400/20 blur-2xl" />
            <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-brand-400/20 blur-2xl" />
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-gold-300">Your matchup</span>
              <MatchupStatus status={mine.status} source={mine.score_source} />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {[mine.home_team_id, mine.away_team_id].map((id, i) => (
                <div key={id} className={`flex min-w-0 flex-col ${i === 1 ? "order-3 items-end text-right" : "items-start"}`}>
                  <TeamAvatar team={team.get(id)} size={36} ring={id === myTeam.id} />
                  <div className={`mt-1 w-full truncate text-sm font-bold ${id === myTeam.id ? "text-gold-300" : "text-brand-100"}`}>{team.get(id)?.name}</div>
                  <div className="text-4xl font-black tabular-nums">{(i === 0 ? mine.home_score : mine.away_score).toFixed(1)}</div>
                </div>
              ))}
              <span className="order-2 text-xs font-black text-gold-400">VS</span>
            </div>
          </Link>
        ) : null}

        <section className="mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
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


        {others.length ? (
          <section>
            <div className="flex items-center justify-between px-4 pb-2 pt-1 sm:px-0">
              <h2 className="text-lg font-extrabold tracking-tight">This week&apos;s matchups</h2>
              <Link href="/matchups" className="link text-xs">All</Link>
            </div>
            <div className="-mb-2 flex snap-x gap-3 overflow-x-auto px-3 pb-3 sm:px-0 [scrollbar-width:none]">
              {others.map((m, i) => (
                <Link
                  key={m.id}
                  href={`/matchups/${m.id}`}
                  className={`${TILES[i % TILES.length]} flex w-44 shrink-0 snap-start flex-col rounded-2xl p-3 shadow-lg shadow-black/30 transition active:scale-[0.98]`}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-white/35 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">{m.status === "in_progress" ? "Live" : m.status === "final" ? "Final" : m.status === "void" ? "—" : "Soon"}</span>
                    <span className="text-[10px] font-bold opacity-70">Wk {m.week}</span>
                  </div>
                  <div className="my-3 flex items-center justify-center gap-2">
                    <TeamAvatar team={team.get(m.home_team_id)} size={38} />
                    <span className="text-xs font-black opacity-60">–</span>
                    <TeamAvatar team={team.get(m.away_team_id)} size={38} />
                  </div>
                  {[[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]].map(([id, sc]) => (
                    <div key={id as string} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className={`min-w-0 truncate ${m.winner_team_id === id ? "font-extrabold" : "font-semibold opacity-80"}`}>{team.get(id as string)?.name}</span>
                      <span className="shrink-0 font-extrabold tabular-nums">{(sc as number).toFixed(1)}</span>
                    </div>
                  ))}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <Card flush title="Standings" action={<Link href="/standings" className="link text-xs">Full table</Link>}>
          <ol className="divide-y divide-gray-100">
            {standings.slice(0, 5).map((s) => (
              <li key={s.teamId}>
                <Link href={`/teams/${s.teamId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm active:bg-gray-50">
                  <span className={`w-4 shrink-0 text-right text-xs font-black ${s.rank === 1 ? "text-gold-600" : "text-gray-400"}`}>{s.rank}</span>
                  <TeamAvatar team={team.get(s.teamId)} size={26} />
                  <span className={`min-w-0 flex-1 truncate ${s.teamId === myTeam?.id ? "font-bold text-brand-300" : "font-semibold"}`}>{team.get(s.teamId)?.name}</span>
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
                          {pl?.university_id ? unis.get(pl.university_id)?.short_name : ""} · {owner ? <span className={owner === myTeam?.id ? "font-semibold text-brand-300" : ""}>{team.get(owner)?.name}</span> : <span className="font-semibold text-emerald-700">Free agent</span>}
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
