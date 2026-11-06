import { redirect } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { fetchAll, getSeasonPlayerPoints } from "@/lib/data/queries";
import { Notice, PageHeader } from "@/components/ui";
import { TradeBuilder } from "@/components/trade-builder";

export const metadata = { title: "Propose a trade" };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  if (!ctx.myTeam) redirect("/trades");
  const { supabase: sb, league } = ctx;
  if (!league.settings.trades.enabled) return <><PageHeader title="Propose a trade" /><Notice tone="amber">Trading is currently closed.</Notice></>;
  const [rows, season] = await Promise.all([
    fetchAll<{ fantasy_team_id: string; player_id: string; players: { display_name: string; position_label: string | null } }>((from, to) =>
      sb.from("roster_assignments").select("fantasy_team_id, player_id, players(display_name, position_label)").eq("league_id", league.id).is("released_at", null).range(from, to) as never),
    getSeasonPlayerPoints(sb, league.id),
  ]);
  const rosters: Record<string, Array<{ id: string; name: string; pos: string | null; pts: number }>> = {};
  for (const r of rows) {
    (rosters[r.fantasy_team_id] ??= []).push({ id: r.player_id, name: r.players.display_name, pos: r.players.position_label, pts: season.get(r.player_id)?.points ?? 0 });
  }
  for (const list of Object.values(rosters)) list.sort((a, b) => b.pts - a.pts);
  return (
    <>
      <PageHeader title="Propose a trade" subtitle="Pick a team, then tick the players on each side. The other manager can accept or decline." />
      <TradeBuilder myTeamId={ctx.myTeam.id} teams={ctx.teams} rosters={rosters} initialTeam={ctx.teams.some((t) => t.id === sp.with) ? sp.with! : ""} limit={league.settings.roster.TOTAL} />
    </>
  );
}
