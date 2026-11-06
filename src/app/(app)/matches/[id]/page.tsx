import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getMatch, getOwnership, getUniversities } from "@/lib/data/queries";
import { CORE_STAT_KEYS, STAT_SHORT } from "@/lib/scoring/engine";
import { formatDate, formatDateTime } from "@/lib/time";
import { Badge, Card, Empty, Freshness, MatchStatus, PageHeader, Points, TeamLink } from "@/components/ui";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const m = await getMatch(sb, id);
  if (!m) notFound();
  const [unis, owner, { data: stats }, { data: pts }] = await Promise.all([
    getUniversities(sb),
    getOwnership(sb, league.id),
    sb.from("player_match_statistics").select("*, players(id, display_name, position_label)").eq("match_id", id),
    sb.from("v_player_match_points").select("player_id, points").eq("match_id", id).eq("league_id", league.id),
  ]);
  const pointsOf = new Map((pts ?? []).map((p) => [p.player_id, Number(p.points)]));
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const side = (uni: string) => (stats ?? []).filter((s) => s.university_id === uni).sort((a, b) => (pointsOf.get(b.player_id) ?? 0) - (pointsOf.get(a.player_id) ?? 0));
  return (
    <>
      <PageHeader
        title={`${unis.get(m.home_university_id)?.name} ${m.home_away_known ? "vs" : "&"} ${unis.get(m.away_university_id)?.name}`}
        subtitle={<>{formatDate(m.match_date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · lineups lock {formatDateTime(m.lock_at)}{!m.counts_for_fantasy ? " · does not count for fantasy" : ""}</>}
        actions={<div className="flex flex-col items-end gap-1"><MatchStatus status={m.status} statsAvailable={m.stats_available} /><Freshness at={m.last_updated_at} /></div>}
      />
      {(stats ?? []).length === 0 ? <Empty>No player statistics yet. They appear here automatically once the source publishes them.</Empty> : (
        <div className="space-y-3">
          {[m.home_university_id, m.away_university_id].map((uni) => (
            <Card key={uni} title={unis.get(uni)?.name}>
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="table">
                  <thead><tr><th>Player</th><th>Fantasy team</th><th className="text-right">Sets</th>{CORE_STAT_KEYS.map((k) => <th key={k} className="text-right">{STAT_SHORT[k]}</th>)}<th className="text-right">Pts</th></tr></thead>
                  <tbody>
                    {side(uni).map((s) => {
                      const p = s.players as { id: string; display_name: string; position_label: string | null };
                      const o = owner.get(s.player_id);
                      return (
                        <tr key={s.player_id}>
                          <td><Link href={`/players/${p.id}`} className="font-semibold hover:underline">{p.display_name}</Link> <span className="text-xs text-gray-500">{p.position_label}</span></td>
                          <td className="text-xs">{o ? <TeamLink id={o} name={team.get(o)?.name ?? ""} mine={o === ctx.myTeam?.id} /> : <Badge tone="mint">FA</Badge>}</td>
                          <td className="text-right font-mono text-gray-500">{s.sets_played ?? "–"}</td>
                          {CORE_STAT_KEYS.map((k) => <td key={k} className="text-right font-mono">{s[k]}</td>)}
                          <td className="text-right"><Points value={pointsOf.get(s.player_id) ?? null} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
