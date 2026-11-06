import { requireAdmin } from "@/lib/data/context";
import { getMatchupScores, getStandings } from "@/lib/data/queries";
import { firstRoundPairs, nextRoundPairs } from "@/lib/standings/standings";
import { AdminNav } from "@/components/admin/admin-nav";
import { MatchupStatusSelect, PlayoffCreator } from "@/components/admin/matchup-admin";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Matchups & playoffs" };

export default async function AdminMatchupsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const { supabase: sb, league, teams } = ctx;
  const week = Number(sp.week) || ctx.currentWeek || 1;
  const [all, standings] = await Promise.all([getMatchupScores(sb, league.id), getStandings(sb, league.id, teams.map((t) => t.id))]);
  const names = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const thisWeek = all.filter((m) => m.week === week);
  const po = league.settings.playoffs;

  // Next playoff week to create and its proposed pairs.
  const playoffWeeks = [...new Set(all.filter((m) => m.playoff_round !== null).map((m) => m.week))].sort((a, b) => a - b);
  const seeds = new Map(standings.slice(0, po.teams).map((s, i) => [s.teamId, i + 1]));
  let plan: { week: number; pairs: Array<{ home_team_id: string; away_team_id: string; round: number; homeSeed: number; awaySeed: number }> } | null = null;
  let planNote = "";
  if (po.enabled) {
    if (playoffWeeks.length === 0) {
      const { pairs, byes } = firstRoundPairs(standings.map((s) => s.teamId), po.teams);
      plan = { week: po.startWeek, pairs: pairs.map((p) => ({ home_team_id: p.homeTeamId, away_team_id: p.awayTeamId, round: 1, homeSeed: p.homeSeed, awaySeed: p.awaySeed })) };
      planNote = byes.length ? `Byes: ${byes.map((b) => names[b]).join(", ")}` : "";
    } else {
      const lastWeek = playoffWeeks[playoffWeeks.length - 1]!;
      const last = all.filter((m) => m.week === lastWeek && m.playoff_round !== null);
      const round = (last[0]?.playoff_round ?? 1) + 1;
      if (last.every((m) => m.status === "final") && last.length > 0) {
        const winners = last.map((m) => m.winner_team_id ?? ((seeds.get(m.home_team_id) ?? 99) <= (seeds.get(m.away_team_id) ?? 99) ? m.home_team_id : m.away_team_id));
        const playedIn = new Set(all.filter((m) => m.playoff_round !== null).flatMap((m) => [m.home_team_id, m.away_team_id]));
        const byes = round === 2 ? [...seeds.keys()].filter((t) => !playedIn.has(t)) : [];
        const adv = [...winners, ...byes];
        if (adv.length >= 2) {
          plan = { week: lastWeek + 1, pairs: nextRoundPairs(adv, seeds, round).map((p) => ({ home_team_id: p.homeTeamId, away_team_id: p.awayTeamId, round, homeSeed: p.homeSeed, awaySeed: p.awaySeed })) };
          planNote = "Ties go to the higher seed.";
        } else planNote = "The playoffs are complete.";
      } else planNote = `Finish week ${lastWeek} (all playoff matchups final) before creating the next round.`;
    }
  }

  return (
    <>
      <PageHeader title="Matchups & playoffs" subtitle="Matchups become final automatically the day after their week ends, once every match has finished. You can override that here." />
      <AdminNav current="/admin/matchups" />
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {ctx.weeks.map((w) => <a key={w.week} href={`/admin/matchups?week=${w.week}`} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${w.week === week ? "bg-coral-500 text-white" : "bg-gray-100 text-gray-700"}`}>W{w.week}</a>)}
      </div>
      <Card title={`Week ${week}`}>
        {thisWeek.length === 0 ? <Empty>No matchups this week.</Empty> : (
          <table className="table">
            <thead><tr><th>Home</th><th>Away</th><th className="text-right">Score</th><th>Status</th></tr></thead>
            <tbody>{thisWeek.map((m) => <tr key={m.id}><td>{names[m.home_team_id]}</td><td>{names[m.away_team_id]}</td><td className="text-right font-mono">{m.home_score.toFixed(1)}–{m.away_score.toFixed(1)}{m.score_source === "imported" ? " *" : ""}</td><td><MatchupStatusSelect id={m.id} status={m.status} /></td></tr>)}</tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-gray-500">* result recorded on USportVB before the move to Sideout.</p>
      </Card>
      <Card title="Playoffs" className="mt-4">
        {!po.enabled ? <Notice>Playoffs are turned off. Turn them on and choose the number of teams and first week in <a href="/admin/settings" className="link">League settings</a>.</Notice> : plan ? (
          <><p className="mb-2 text-sm text-gray-500">Seeded from the current standings (top {po.teams}). {planNote}</p><PlayoffCreator week={plan.week} pairs={plan.pairs} names={names} /></>
        ) : <p className="text-sm text-gray-500">{planNote}</p>}
      </Card>
    </>
  );
}
