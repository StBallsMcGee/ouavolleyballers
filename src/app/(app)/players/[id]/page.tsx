import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getOwnership, getProjections, getRuleSets, getSeasonPlayerPoints, getUniversities, ruleSetInForce } from "@/lib/data/queries";
import { PointSources, TrendChart } from "@/components/player-analytics";
import { buildBlurb, yearLabel } from "@/lib/players/blurb";
import { statSummary } from "@/lib/players/format";
import { PlayerPhoto } from "@/components/player-photo";
import { scoreStatLine, STAT_SHORT, CORE_STAT_KEYS, type StatLine } from "@/lib/scoring/engine";
import { addDays, formatDate } from "@/lib/time";
import { Badge, Card, Empty, Points, TeamLink } from "@/components/ui";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const { data: p } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const weekEnd = ctx.weeks.find((w) => w.week === ctx.currentWeek)?.ends_on ?? addDays(ctx.today, 6);
  const [unis, owner, { data: stats }, { data: leaguePts }, ruleSets, { data: profile }, seasonPts, { data: teammates }, projections, { data: positions }, upcoming] = await Promise.all([
    getUniversities(sb),
    getOwnership(sb, league.id),
    sb.from("player_match_statistics").select("*, matches(id, match_date, season_label, home_university_id, away_university_id, status)").eq("player_id", id),
    sb.from("v_player_match_points").select("match_id, points, week").eq("player_id", id).eq("league_id", league.id),
    getRuleSets(sb, league.id),
    sb.from("player_profiles").select("*").eq("player_id", id).maybeSingle(),
    getSeasonPlayerPoints(sb, league.id),
    p.university_id ? sb.from("players").select("id").eq("university_id", p.university_id).is("duplicate_of", null) : Promise.resolve({ data: [] as Array<{ id: string }> }),
    getProjections(sb, league.id),
    sb.from("players").select("id, position_label").eq("gender", "womens").eq("conference", "OUA").is("duplicate_of", null),
    getMatchesBetween(sb, ctx.today, weekEnd),
  ]);
  const official = new Map((leaguePts ?? []).map((r) => [r.match_id, r]));
  const latestRules = ruleSetInForce(ruleSets, ctx.currentWeek ?? 1)?.rules.map((r) => ({ statKey: r.stat_key, label: r.label, points: r.points, active: r.active })) ?? [];
  type Row = { id: string; date: string; season: string; opp: string | null; line: StatLine; sets: number | null; pts: number; official: boolean };
  const rows: Row[] = (stats ?? []).map((s) => {
    const m = s.matches as { id: string; match_date: string; season_label: string; home_university_id: string; away_university_id: string };
    const line: StatLine = Object.fromEntries(CORE_STAT_KEYS.map((k) => [k, s[k] as number]));
    const o = official.get(m.id);
    return {
      id: m.id,
      date: m.match_date,
      season: m.season_label,
      opp: m.home_university_id === p.university_id ? m.away_university_id : m.home_university_id,
      line,
      sets: s.sets_played,
      pts: o ? Number(o.points) : scoreStatLine(line, latestRules),
      official: !!o,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  const seasons = [...new Set(rows.map((r) => r.season))];
  const o = owner.get(id);
  const team = ctx.teams.find((t) => t.id === o);
  const uniName = p.university_id ? unis.get(p.university_id)?.name ?? "?" : "?";
  const current = rows.filter((r) => r.season === league.season_label);
  const sum = (k: (typeof CORE_STAT_KEYS)[number], rs: Row[]) => rs.reduce((a, r) => a + (r.line[k] ?? 0), 0);
  const ranked = (teammates ?? []).map((t) => ({ id: t.id, pts: seasonPts.get(t.id)?.points ?? 0 })).sort((a, b) => b.pts - a.pts);
  const rankIdx = ranked.findIndex((t) => t.id === id);
  const blurb = buildBlurb({
    profile: profile ? { position: profile.position_label, academicYear: profile.academic_year, hometown: profile.hometown, previousTeam: profile.previous_team } : null,
    ourPosition: p.position_label,
    university: uniName,
    season: current.length
      ? {
          matches: current.length,
          sets: current.reduce((a, r) => a + (r.sets ?? 0), 0),
          kills: sum("kills", current), digs: sum("digs", current), assists: sum("assists", current), aces: sum("service_aces", current),
          soloBlocks: sum("solo_blocks", current), blockAssists: sum("block_assists", current),
          fantasyPoints: current.reduce((a, r) => a + r.pts, 0),
        }
      : null,
    teamRank: rankIdx >= 0 && (seasonPts.get(id)?.points ?? 0) > 0 ? { rank: rankIdx + 1, of: ranked.length } : null,
  });
  const facts = [
    ["Position", profile?.position_label ?? p.position_label],
    ["Height", profile?.height],
    ["Year", yearLabel(profile?.academic_year ?? null) ?? profile?.academic_year],
    ["Hometown", profile?.hometown],
    ["Previously", profile?.previous_team],
  ].filter(([, v]) => v) as Array<[string, string]>;

  // ---- Outlook and trends ----
  const proj = projections.get(id);
  const fmt1 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(1));
  const seasonAvg = current.length ? current.reduce((a, r) => a + r.pts, 0) / current.length : null;
  const last3 = current.slice(0, 3);
  const last3Avg = last3.length ? last3.reduce((a, r) => a + r.pts, 0) / last3.length : null;
  const trendDelta = last3Avg !== null && seasonAvg !== null && current.length > 3 ? last3Avg - seasonAvg : null;
  const cv = proj && proj.avg && proj.stddev !== null && proj.games >= 3 ? proj.stddev / Math.max(Math.abs(proj.avg), 1) : null;
  const consistency = cv === null ? null : cv < 0.35 ? "Steady" : cv < 0.6 ? "Fairly steady" : "Up and down";
  // Rank by points per game among players listed at the same position (2+ games this season).
  const posOf = new Map((positions ?? []).map((x) => [x.id as string, x.position_label as string | null]));
  const myPos = posOf.get(id) ?? null;
  const ppg = (pid: string) => { const sp = seasonPts.get(pid); return sp && sp.games >= 2 ? sp.points / sp.games : null; };
  const peers = [...seasonPts.keys()].filter((pid) => posOf.get(pid) === myPos && ppg(pid) !== null).sort((x, y) => ppg(y)! - ppg(x)!);
  const posRank = ppg(id) !== null && myPos ? { rank: peers.indexOf(id) + 1, of: peers.length } : null;
  const allRanked = [...seasonPts.entries()].sort((x, y) => y[1].points - x[1].points);
  const leagueRank = (seasonPts.get(id)?.points ?? 0) > 0 ? allRanked.findIndex(([pid]) => pid === id) + 1 : null;
  const gamesLeft = upcoming.filter((m) => (m.home_university_id === p.university_id || m.away_university_id === p.university_id) && m.status !== "final" && m.status !== "cancelled" && m.status !== "postponed").length;
  const trendSource = [...rows].slice(0, 15).reverse();
  const trendGames = trendSource.map((r) => ({
    date: formatDate(r.date, r.season === league.season_label ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" }),
    opp: `vs ${r.opp ? unis.get(r.opp)?.short_name ?? unis.get(r.opp)?.name ?? "?" : "?"}`,
    pts: Math.round(r.pts * 10) / 10,
    summary: statSummary(r.line),
  }));
  const sourceRows = current.length ? current : rows.slice(0, 15);
  const sources = latestRules.filter((r) => r.active && r.points !== 0).map((r) => ({
    label: r.label,
    perGame: sourceRows.length ? (r.points * sourceRows.reduce((a, row) => a + ((row.line as Record<string, number>)[r.statKey] ?? 0), 0)) / sourceRows.length : 0,
  }));
  const setsTotal = current.reduce((a, r) => a + (r.sets ?? 0), 0);
  const perSet = setsTotal > 0 ? (["kills", "digs", "assists", "service_aces"] as const).map((k) => `${(sum(k, current) / setsTotal).toFixed(1)} ${STAT_SHORT[k]}`).join(" · ") : null;
  const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-lg bg-gray-50 px-2.5 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-black tabular-nums leading-tight text-gray-900">{value}</div>
      {sub ? <div className="truncate text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );

  return (
    <>
      <div className="border-b border-gray-200 bg-white px-4 pb-4 pt-4 sm:mt-4 sm:rounded-xl sm:border">
        <div className="flex items-center gap-4">
          <PlayerPhoto name={p.display_name} photo={profile?.photo_url} size={88} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold leading-tight">{p.display_name}</h1>
            <p className="text-sm text-gray-600">{uniName}{p.jersey_number !== null ? ` · #${p.jersey_number}` : ""} · {p.position_label ?? "–"}{!p.active ? " · inactive" : ""}</p>
            <div className="mt-1.5 text-sm">
              {team ? <span>On <TeamLink id={team.id} name={team.name} mine={team.id === ctx.myTeam?.id} /></span>
                : p.active && !p.duplicate_of ? <Link href={`/free-agents?q=${encodeURIComponent(p.last_name)}`} className="btn-primary min-h-[32px] px-3 py-1 text-xs">Free agent · Add</Link> : null}
            </div>
          </div>
        </div>
        {p.duplicate_of ? <p className="mt-3"><Badge tone="amber">Duplicate record</Badge> <Link href={`/players/${p.duplicate_of}`} className="link text-sm">Go to the main record</Link></p> : null}
        <p className="mt-4 text-[15px] leading-relaxed text-gray-800">{blurb}</p>
        {facts.length ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            {facts.map(([k, v]) => <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
          </dl>
        ) : null}
        {profile ? (
          <p className="mt-3 text-xs text-gray-500">
            Photo and bio details: {profile.source_label}{profile.profile_url ? <> · <a href={profile.profile_url} target="_blank" rel="noopener noreferrer" className="link">Official profile ↗</a></> : null}
          </p>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
      {rows.length > 0 || proj ? (
        <Card title="Outlook">
          <div className="grid grid-cols-3 gap-2">
            {tile("Projected", fmt1(proj?.perGame), "pts per game")}
            {tile("Season avg", fmt1(seasonAvg), `${current.length} game${current.length === 1 ? "" : "s"}`)}
            {tile("Last 3", fmt1(last3Avg), trendDelta === null ? "games" : (
              <span className={trendDelta >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{trendDelta >= 0 ? "▲" : "▼"} {Math.abs(trendDelta).toFixed(1)} vs avg</span>
            ))}
            {tile("Best", fmt1(proj?.best ?? null), "this season")}
            {tile("Worst", fmt1(proj?.worst ?? null), "this season")}
            {tile("Consistency", <span className="text-sm">{consistency ?? "–"}</span>, proj?.stddev !== null && proj?.stddev !== undefined && proj.games >= 3 ? `± ${proj.stddev.toFixed(1)} pts` : "needs 3 games")}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-gray-700">
            {posRank ? <li><b>#{posRank.rank}</b> of {posRank.of} {myPos ?? ""} players in points per game</li> : null}
            {leagueRank ? <li><b>#{leagueRank}</b> in the conference in total fantasy points</li> : null}
            {proj?.perGame !== null && proj?.perGame !== undefined && gamesLeft > 0 ? <li>This week: {gamesLeft} game{gamesLeft > 1 ? "s" : ""} left · projected <b>{(proj.perGame * gamesLeft).toFixed(1)}</b> pts</li> : null}
            {proj && proj.prevGames >= 3 ? <li>Last season: {proj.prevAvg?.toFixed(1)} pts per game over {proj.prevGames} games (this league&apos;s scoring)</li> : null}
          </ul>
          <p className="mt-2 text-[11px] text-gray-400">Projections weigh her latest games most, starting from last season&apos;s average (or her position&apos;s) until she has played a few games. Updated every sync.</p>
        </Card>
      ) : null}
      {trendGames.length >= 2 ? (
        <Card title={`Trend · last ${trendGames.length} games`}>
          <TrendChart games={trendGames} seasonAvg={seasonAvg !== null ? Math.round(seasonAvg * 10) / 10 : null} />
        </Card>
      ) : null}
      {sources.some((x) => Math.abs(x.perGame) >= 0.05) ? (
        <Card title={current.length ? "Where her points come from · per game" : "Where her points came from · last games"}>
          <PointSources rows={sources} />
          {perSet ? <p className="mt-3 text-xs text-gray-500">Per set this season: {perSet}</p> : null}
        </Card>
      ) : null}
      {seasons.length === 0 ? <Empty>No match statistics recorded for this player.</Empty> : seasons.map((season) => {
        const rs = rows.filter((r) => r.season === season);
        const total = rs.reduce((a, r) => a + r.pts, 0);
        const sum = (k: (typeof CORE_STAT_KEYS)[number]) => rs.reduce((a, r) => a + (r.line[k] ?? 0), 0);
        return (
          <details key={season} open={season === league.season_label || seasons.length === 1} className="group border-y border-gray-200 bg-white sm:rounded-xl sm:border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
              <span className="text-[13px] font-extrabold uppercase tracking-wide text-gray-800">{season} · {rs.length} matches</span>
              <span className="flex items-center gap-2 text-sm"><Points value={Math.round(total * 10) / 10} /> pts<span className="text-gray-400 transition group-open:rotate-90">›</span></span>
            </summary>
            <ul className="divide-y divide-gray-100 sm:hidden">
              {rs.map((r) => (
                <li key={r.id}>
                  <Link href={`/matches/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-gray-50">
                    <div className="w-16 shrink-0 text-xs">
                      <div className="font-semibold text-gray-800">{formatDate(r.date, { month: "short", day: "numeric" })}</div>
                      <div className="truncate text-gray-500">vs {r.opp ? unis.get(r.opp)?.short_name ?? unis.get(r.opp)?.name : "?"}</div>
                    </div>
                    <div className="min-w-0 flex-1 text-xs text-gray-700">{statSummary(r.line)}{r.sets ? <span className="text-gray-400"> · {r.sets} sets</span> : null}</div>
                    <div className="shrink-0 text-right text-sm"><Points value={r.pts} />{r.official ? null : <span className="text-gray-400">*</span>}</div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="table">
                <thead><tr><th>Date</th><th>Opponent</th><th className="text-right">Sets</th>{CORE_STAT_KEYS.map((k) => <th key={k} className="text-right">{STAT_SHORT[k]}</th>)}<th className="text-right">Pts</th></tr></thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/matches/${r.id}`} className="hover:underline">{formatDate(r.date)}</Link></td>
                      <td>{r.opp ? unis.get(r.opp)?.name : "?"}</td>
                      <td className="text-right font-mono text-gray-500">{r.sets ?? "–"}</td>
                      {CORE_STAT_KEYS.map((k) => <td key={k} className="text-right font-mono">{r.line[k] ?? 0}</td>)}
                      <td className="text-right"><Points value={r.pts} />{r.official ? null : <span title="Calculated with the league's current scoring (match outside this season's fantasy weeks)" className="text-gray-500">*</span>}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td colSpan={3}>Totals</td>{CORE_STAT_KEYS.map((k) => <td key={k} className="text-right font-mono">{sum(k)}</td>)}<td className="text-right"><Points value={Math.round(total * 10) / 10} /></td></tr>
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
      </div>
      <p className="px-4 py-4 text-xs text-gray-500 sm:px-0">K kills · E attack errors · TA attempts · A assists · SA aces · SE service errors · D digs · BS solo blocks · BA block assists. * earlier season, shown with current scoring.</p>
    </>
  );
}
