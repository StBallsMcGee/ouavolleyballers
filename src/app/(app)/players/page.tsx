import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getOwnership, getSeasonPlayerPoints, getUniversities } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { Badge, Card, Empty, PageHeader, Points, PositionTag, TeamLink } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";

export const metadata = { title: "Players" };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const status = sp.status ?? "active";
  const [unis, players, season, owner] = await Promise.all([
    getUniversities(sb),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: status !== "all" }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
  ]);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const rows = players
    .filter((p) => (status === "available" ? !owner.has(p.id) && !p.duplicate_of : status === "rostered" ? owner.has(p.id) : true))
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, games: season.get(p.id)?.games ?? 0 }))
    .sort((a, b) => b.pts - a.pts || a.display_name.localeCompare(b.display_name));
  return (
    <>
      <PageHeader title="Players" subtitle={`OUA women's volleyball · ${league.season_label} fantasy points use your league's scoring`} />
      <PlayerFilters unis={[...unis.values()]} sp={sp} />
      <Card>
        {rows.length === 0 ? <Empty>No players match these filters.</Empty> : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="table">
              <thead><tr><th>Player</th><th>Pos</th><th>University</th><th>Fantasy team</th><th className="text-right">GP</th><th className="text-right">Pts</th><th className="text-right">Avg</th></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((p) => {
                  const o = owner.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td><Link href={`/players/${p.id}`} className="font-semibold hover:underline">{p.display_name}</Link>{p.jersey_number !== null ? <span className="ml-1 text-xs text-slate-500">#{p.jersey_number}</span> : null}{p.duplicate_of ? <span className="ml-2"><Badge tone="amber">Duplicate record</Badge></span> : null}{!p.active ? <span className="ml-2"><Badge>Inactive</Badge></span> : null}</td>
                      <td><PositionTag label={p.position_label} /></td>
                      <td className="text-slate-300">{p.university_id ? unis.get(p.university_id)?.name : "–"}</td>
                      <td>{o ? <TeamLink id={o} name={team.get(o)?.name ?? ""} mine={o === ctx.myTeam?.id} /> : <Badge tone="mint">Free agent</Badge>}</td>
                      <td className="text-right font-mono text-slate-400">{p.games}</td>
                      <td className="text-right"><Points value={p.pts} /></td>
                      <td className="text-right font-mono text-slate-400">{p.games ? (p.pts / p.games).toFixed(1) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 300 ? <p className="mt-2 text-xs text-slate-500">Showing the top 300 of {rows.length}. Use the filters to narrow the list.</p> : null}
          </div>
        )}
      </Card>
    </>
  );
}
