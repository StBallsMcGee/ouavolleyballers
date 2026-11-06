import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchupScores } from "@/lib/data/queries";
import { formatDate } from "@/lib/time";
import { Badge, Card, Empty, MatchupStatus, PageHeader } from "@/components/ui";

export const metadata = { title: "Matchups" };

export default async function MatchupsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireLeague();
  const sp = await searchParams;
  const week = Number(sp.week) || ctx.currentWeek || 1;
  const info = ctx.weeks.find((w) => w.week === week);
  const matchups = await getMatchupScores(ctx.supabase, ctx.league.id, week);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  return (
    <>
      <PageHeader title="Matchups" subtitle={info ? `Week ${week}: ${formatDate(info.starts_on)} – ${formatDate(info.ends_on)}${info.is_playoff ? " · Playoffs" : ""}` : `Week ${week}`} />
      <div className="mb-3 flex gap-1 overflow-x-auto px-4 pb-1 sm:px-0">
        {ctx.weeks.map((w) => (
          <Link key={w.week} href={`/matchups?week=${w.week}`} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${w.week === week ? "bg-coral-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
            W{w.week}{w.week === ctx.currentWeek ? " •" : ""}
          </Link>
        ))}
      </div>
      {matchups.length === 0 ? <Empty>No matchups scheduled for week {week}.{info?.is_playoff ? "" : " Playoff weeks are set up by the administrator."}</Empty> : (
        <div className="grid gap-2 px-4 sm:px-0 md:grid-cols-2">
          {matchups.map((m) => {
            const mine = m.home_team_id === ctx.myTeam?.id || m.away_team_id === ctx.myTeam?.id;
            return (
              <Link key={m.id} href={`/matchups/${m.id}`} className={`card block p-4 hover:border-gray-300 ${mine ? "ring-1 ring-coral-500/50" : ""}`}>
                <div className="mb-2 flex items-center justify-between">
                  <MatchupStatus status={m.status} source={m.score_source} />
                  {m.playoff_round ? <Badge tone="amber">Playoff round {m.playoff_round}</Badge> : null}
                </div>
                {[[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]].map(([id, s]) => (
                  <div key={id as string} className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <div className={`truncate font-semibold ${m.winner_team_id === id ? "text-emerald-600" : ""}`}>{team.get(id as string)?.name}</div>
                      <div className="truncate text-xs text-gray-500">{team.get(id as string)?.manager}</div>
                    </div>
                    <div className="text-2xl font-black tabular-nums">{(s as number).toFixed(1)}</div>
                  </div>
                ))}
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-4 px-4 text-xs text-gray-500 sm:px-0">Scores update automatically as statistics arrive. Results for weeks before the switch to Sideout are kept exactly as recorded on USportVB.</p>
    </>
  );
}
