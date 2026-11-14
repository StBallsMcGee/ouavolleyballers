import { requireLeague } from "@/lib/data/context";
import { getMatchupScores, getStandings } from "@/lib/data/queries";
import { Card, PageHeader } from "@/components/ui";
import { StandingsTable } from "@/components/standings-table";

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
  // Each team's last five regular-season results (oldest first).
  const form = new Map(rows.map((r) => [r.teamId, weeks.map((w) => weekScore(r.teamId, w)?.result).filter(Boolean).slice(-5) as Array<"W" | "L" | "T">]));
  return (
    <>
      <PageHeader title="Standings" />
      <Card flush>
        <StandingsTable rows={rows} teams={team} myTeamId={myTeam?.id} form={form} />
      </Card>
      <p className="px-4 py-3 text-xs text-gray-500 sm:px-0">Ranked by win % (ties count half), then points for. Squares show each team&apos;s last five results; the bar compares points for.</p>
    </>
  );
}
