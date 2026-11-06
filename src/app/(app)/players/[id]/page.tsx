import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getOwnership, getRuleSets, getUniversities, ruleSetInForce } from "@/lib/data/queries";
import { scoreStatLine, STAT_SHORT, CORE_STAT_KEYS, type StatLine } from "@/lib/scoring/engine";
import { formatDate } from "@/lib/time";
import { Badge, Card, Empty, PageHeader, Points, PositionTag, TeamLink } from "@/components/ui";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const { data: p } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [unis, owner, { data: stats }, { data: leaguePts }, ruleSets] = await Promise.all([
    getUniversities(sb),
    getOwnership(sb, league.id),
    sb.from("player_match_statistics").select("*, matches(id, match_date, season_label, home_university_id, away_university_id, status)").eq("player_id", id),
    sb.from("v_player_match_points").select("match_id, points, week").eq("player_id", id).eq("league_id", league.id),
    getRuleSets(sb, league.id),
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
  return (
    <>
      <PageHeader
        title={p.display_name}
        subtitle={<><PositionTag label={p.position_label} /> · {p.university_id ? unis.get(p.university_id)?.name : "–"}{p.jersey_number !== null ? ` · #${p.jersey_number}` : ""}{!p.active ? " · inactive" : ""}</>}
        actions={team ? <span className="text-sm">On <TeamLink id={team.id} name={team.name} mine={team.id === ctx.myTeam?.id} /></span> : p.active && !p.duplicate_of ? <Link href={`/free-agents?q=${encodeURIComponent(p.last_name)}`} className="btn-primary">Free agent · Add</Link> : null}
      />
      {p.duplicate_of ? <p className="mb-4"><Badge tone="amber">Duplicate record</Badge> <Link href={`/players/${p.duplicate_of}`} className="link text-sm">Go to the main record</Link></p> : null}
      {seasons.length === 0 ? <Empty>No match statistics recorded for this player.</Empty> : seasons.map((season) => {
        const rs = rows.filter((r) => r.season === season);
        const total = rs.reduce((a, r) => a + r.pts, 0);
        const sum = (k: (typeof CORE_STAT_KEYS)[number]) => rs.reduce((a, r) => a + (r.line[k] ?? 0), 0);
        return (
          <Card key={season} title={`${season} · ${rs.length} matches`} action={<span className="text-sm">Fantasy points <Points value={Math.round(total * 10) / 10} /></span>} className="mb-4">
            <div className="-mx-4 overflow-x-auto sm:mx-0">
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
          </Card>
        );
      })}
      <p className="text-xs text-gray-500">K kills · E attack errors · TA attack attempts · A assists · SA aces · SE service errors · D digs · BS solo blocks · BA block assists. * calculated with current league scoring for reference.</p>
    </>
  );
}
