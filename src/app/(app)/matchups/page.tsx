import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchupScores } from "@/lib/data/queries";
import { formatDate } from "@/lib/time";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { TeamAvatar } from "@/components/team-avatar";

const TILES = ["tile-violet", "tile-green", "tile-orange", "tile-blue", "tile-pink", "tile-teal"];

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
      <div className="mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-0 [scrollbar-width:none]">
        {ctx.weeks.map((w) => (
          <Link key={w.week} href={`/matchups?week=${w.week}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-bold ${w.week === week ? "bg-gold-400 text-charcoal" : "bg-surface text-gray-700 hover:bg-surface-3"}`}>
            W{w.week}{w.week === ctx.currentWeek ? " •" : ""}
          </Link>
        ))}
      </div>
      {matchups.length === 0 ? <Empty>No matchups scheduled for week {week}.{info?.is_playoff ? "" : " Playoff weeks are set up by the administrator."}</Empty> : (
        <div className="grid grid-cols-2 gap-3 px-3 sm:px-0 md:grid-cols-3">
          {matchups.map((m, i) => {
            const mine = m.home_team_id === ctx.myTeam?.id || m.away_team_id === ctx.myTeam?.id;
            return (
              <Link key={m.id} href={`/matchups/${m.id}`} className={`${TILES[i % TILES.length]} flex flex-col rounded-2xl p-3 shadow-lg shadow-black/30 transition active:scale-[0.98] ${mine ? "ring-2 ring-gold-400 ring-offset-2 ring-offset-charcoal" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-white/35 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                    {m.status === "in_progress" ? "● Live" : m.status === "final" ? (m.score_source === "imported" ? "Final · USVB" : "Final") : m.status === "void" ? "No contest" : "Upcoming"}
                  </span>
                  {mine ? <span className="text-[10px] font-extrabold uppercase">You</span> : null}
                </div>
                {m.playoff_round ? <div className="mt-1"><Badge tone="amber">Playoff round {m.playoff_round}</Badge></div> : null}
                <div className="my-3 flex items-center justify-center gap-2">
                  <TeamAvatar team={team.get(m.home_team_id)} size={40} />
                  <span className="text-xs font-black opacity-60">–</span>
                  <TeamAvatar team={team.get(m.away_team_id)} size={40} />
                </div>
                {[[m.home_team_id, m.home_score], [m.away_team_id, m.away_score]].map(([id, sc]) => (
                  <div key={id as string} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className={`min-w-0 truncate ${m.winner_team_id === id ? "font-extrabold" : "font-semibold opacity-80"}`}>{team.get(id as string)?.name}</span>
                    <span className="shrink-0 font-extrabold tabular-nums">{(sc as number).toFixed(1)}</span>
                  </div>
                ))}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
