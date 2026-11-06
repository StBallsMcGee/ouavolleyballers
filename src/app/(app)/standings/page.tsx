import { requireLeague } from "@/lib/data/context";
import { getMatchupScores, getStandings } from "@/lib/data/queries";
import { Card, PageHeader, TeamLink } from "@/components/ui";

export const metadata = { title: "Standings" };

export default async function StandingsPage() {
  const ctx = await requireLeague();
  const { supabase: sb, league, teams, myTeam } = ctx;
  const [rows, all] = await Promise.all([getStandings(sb, league.id, teams.map((t) => t.id)), getMatchupScores(sb, league.id)]);
  const team = new Map(teams.map((t) => [t.id, t]));
  const finals = all.filter((m) => m.status === "final" && m.playoff_round === null);
  const weeks = [...new Set(finals.map((m) => m.week))].sort((a, b) => a - b);
  const weekScore = (teamId: string, w: number) => {
    const m = finals.find((x) => x.week === w && (x.home_team_id === teamId || x.away_team_id === teamId));
    if (!m) return null;
    const mine = m.home_team_id === teamId ? m.home_score : m.away_score;
    const theirs = m.home_team_id === teamId ? m.away_score : m.home_score;
    return { pts: mine, result: mine > theirs ? "W" : mine < theirs ? "L" : "T" };
  };
  return (
    <>
      <PageHeader title="Standings" />
      <Card flush>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500">
              <th className="w-8 py-2 pl-3 text-left">#</th>
              <th className="py-2 text-left">Team</th>
              <th className="w-16 py-2 text-center">W-L</th>
              <th className="w-16 py-2 pr-3 text-right">PF</th>
              <th className="hidden w-16 py-2 pr-3 text-right md:table-cell">PA</th>
              {weeks.map((w) => <th key={w} className="hidden w-16 py-2 pr-3 text-right lg:table-cell">W{w}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.teamId} className={r.teamId === myTeam?.id ? "bg-coral-50" : ""}>
                <td className="py-2.5 pl-3 text-xs font-bold text-gray-400">{r.rank}</td>
                <td className="py-2.5 pr-2">
                  <div className="truncate"><TeamLink id={r.teamId} name={team.get(r.teamId)?.name ?? ""} mine={r.teamId === myTeam?.id} /></div>
                  <div className="truncate text-xs text-gray-500">{team.get(r.teamId)?.manager}</div>
                </td>
                <td className="py-2.5 text-center font-mono text-xs font-semibold">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ""}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-xs">{r.pointsFor.toFixed(1)}</td>
                <td className="hidden py-2.5 pr-3 text-right font-mono text-xs text-gray-500 md:table-cell">{r.pointsAgainst.toFixed(1)}</td>
                {weeks.map((w) => {
                  const s2 = weekScore(r.teamId, w);
                  return <td key={w} className="hidden py-2.5 pr-3 text-right font-mono text-xs lg:table-cell">{s2 ? <><span className={s2.result === "W" ? "text-emerald-600" : s2.result === "L" ? "text-red-600" : ""}>{s2.result}</span> {s2.pts.toFixed(1)}</> : "–"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="px-4 py-3 text-xs text-gray-500 sm:px-0">Ranked by win % (ties count half), then points for.</p>
    </>
  );
}
