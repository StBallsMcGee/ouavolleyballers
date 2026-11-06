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
      <PageHeader title="Standings" subtitle="Head-to-head. Ranked by win percentage (ties count as half a win), then total points scored, then head-to-head, then fewest points against." />
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="table">
            <thead>
              <tr><th>#</th><th>Team</th><th className="text-center">W-L-T</th><th className="text-right">PF</th><th className="text-right">PA</th>{weeks.map((w) => <th key={w} className="text-right">W{w}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId} className={r.teamId === myTeam?.id ? "bg-coral-50" : ""}>
                  <td className="text-gray-500">{r.rank}</td>
                  <td><TeamLink id={r.teamId} name={team.get(r.teamId)?.name ?? ""} mine={r.teamId === myTeam?.id} /><div className="text-xs text-gray-500">{team.get(r.teamId)?.manager}</div></td>
                  <td className="text-center font-mono">{r.wins}-{r.losses}-{r.ties}</td>
                  <td className="text-right font-mono">{r.pointsFor.toFixed(1)}</td>
                  <td className="text-right font-mono text-gray-500">{r.pointsAgainst.toFixed(1)}</td>
                  {weeks.map((w) => {
                    const s = weekScore(r.teamId, w);
                    return <td key={w} className="text-right font-mono text-xs">{s ? <><span className={s.result === "W" ? "text-emerald-600" : s.result === "L" ? "text-red-600" : "text-gray-700"}>{s.result}</span> {s.pts.toFixed(1)}</> : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
