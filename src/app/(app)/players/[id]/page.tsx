import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getOwnership, getRuleSets, getSeasonPlayerPoints, getUniversities, ruleSetInForce } from "@/lib/data/queries";
import { buildBlurb, yearLabel } from "@/lib/players/blurb";
import { statSummary } from "@/lib/players/format";
import { PlayerPhoto } from "@/components/player-photo";
import { scoreStatLine, STAT_SHORT, CORE_STAT_KEYS, type StatLine } from "@/lib/scoring/engine";
import { formatDate } from "@/lib/time";
import { Badge, Card, Empty, Points, TeamLink } from "@/components/ui";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const { data: p } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [unis, owner, { data: stats }, { data: leaguePts }, ruleSets, { data: profile }, seasonPts, { data: teammates }] = await Promise.all([
    getUniversities(sb),
    getOwnership(sb, league.id),
    sb.from("player_match_statistics").select("*, matches(id, match_date, season_label, home_university_id, away_university_id, status)").eq("player_id", id),
    sb.from("v_player_match_points").select("match_id, points, week").eq("player_id", id).eq("league_id", league.id),
    getRuleSets(sb, league.id),
    sb.from("player_profiles").select("*").eq("player_id", id).maybeSingle(),
    getSeasonPlayerPoints(sb, league.id),
    p.university_id ? sb.from("players").select("id").eq("university_id", p.university_id).is("duplicate_of", null) : Promise.resolve({ data: [] as Array<{ id: string }> }),
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
