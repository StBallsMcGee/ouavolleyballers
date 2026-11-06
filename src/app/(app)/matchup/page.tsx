import { redirect } from "next/navigation";
import { requireLeague } from "@/lib/data/context";

/** "Matchup" tab: jumps straight to your matchup this week. */
export default async function MyMatchupPage() {
  const ctx = await requireLeague();
  if (ctx.myTeam && ctx.currentWeek) {
    const { data } = await ctx.supabase
      .from("matchups")
      .select("id")
      .eq("league_id", ctx.league.id)
      .eq("week", ctx.currentWeek)
      .or(`home_team_id.eq.${ctx.myTeam.id},away_team_id.eq.${ctx.myTeam.id}`)
      .maybeSingle();
    if (data) redirect(`/matchups/${data.id}`);
  }
  redirect("/matchups");
}
