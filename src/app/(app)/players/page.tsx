import { requireLeague } from "@/lib/data/context";
import { getOwnership, getSeasonPlayerPoints } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { Card, Empty, PageHeader } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";
import { PlayerList } from "@/components/player-list";

export const metadata = { title: "Players" };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const status = sp.status ?? "active";
  const [sched, players, season, owner] = await Promise.all([
    loadScheduleContext(sb, ctx.weeks, ctx.currentWeek, ctx.today),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: status !== "all" }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
  ]);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const rows = players
    .filter((p) => (status === "available" ? !owner.has(p.id) && !p.duplicate_of : status === "rostered" ? owner.has(p.id) : true))
    .filter((p) => (sp.week === "playing" ? sched.playsThisWeek(p.university_id) : true))
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, gp: season.get(p.id)?.games ?? 0 }))
    .sort((a, b) => b.pts - a.pts || a.display_name.localeCompare(b.display_name));
  return (
    <>
      <PageHeader title="Players" subtitle={`${league.season_label} fantasy points · ${sched.week ? `week ${sched.week.week} games shown` : "next games shown"}`} />
      <PlayerFilters unis={[...sched.unis.values()]} sp={sp} />
      <Card flush title={`${rows.length} players`}>
        {rows.length === 0 ? <Empty>No players match these filters.</Empty> : (
          <PlayerList
            items={rows.slice(0, 150).map((p) => {
              const o = owner.get(p.id);
              return {
                id: p.id, name: p.display_name, code: sched.code(p.university_id), position: p.position_label,
                games: sched.chipsFor(p.university_id), points: p.pts, gamesPlayed: p.gp,
                owner: o ? { id: o, name: team.get(o)?.name ?? "", mine: o === ctx.myTeam?.id } : null,
                flags: [...(p.duplicate_of ? ["Duplicate"] : []), ...(!p.active ? ["Inactive"] : [])],
              };
            })}
          />
        )}
        {rows.length > 150 ? <p className="px-4 py-3 text-xs text-gray-500">Showing the top 150 of {rows.length}. Use search or filters to narrow the list.</p> : null}
      </Card>
    </>
  );
}
