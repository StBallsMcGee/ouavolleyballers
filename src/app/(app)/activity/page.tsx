import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, Empty, PageHeader, TeamLink } from "@/components/ui";

export const metadata = { title: "Activity" };

const label = { add: ["Added", "mint"], drop: ["Dropped", "red"], trade: ["Traded for", "blue"], admin_move: ["Admin move", "amber"], import: ["Imported", "slate"] } as const;

export default async function ActivityPage() {
  const ctx = await requireLeague();
  const { data } = await ctx.supabase
    .from("transactions")
    .select("id, type, created_at, fantasy_team_id, player_id, details, players(display_name)")
    .eq("league_id", ctx.league.id)
    .neq("type", "import")
    .order("created_at", { ascending: false })
    .limit(150);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  return (
    <>
      <PageHeader title="League activity" subtitle="Every add, drop and trade since the league moved to Sideout." />
      <Card>
        {(data ?? []).length === 0 ? <Empty>No roster moves yet.</Empty> : (
          <ul className="divide-y divide-white/5">
            {(data ?? []).map((t) => {
              const [text, tone] = label[t.type as keyof typeof label];
              const from = (t.details as { from_team_id?: string })?.from_team_id;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <Badge tone={tone}>{text}</Badge>
                  <Link href={`/players/${t.player_id}`} className="font-semibold hover:underline">{(t.players as unknown as { display_name: string })?.display_name}</Link>
                  {t.fantasy_team_id ? <><span className="text-slate-500">{t.type === "drop" ? "from" : "to"}</span><TeamLink id={t.fantasy_team_id} name={team.get(t.fantasy_team_id)?.name ?? "?"} /></> : <span className="text-slate-500">to free agency</span>}
                  {from && team.get(from) ? <span className="text-slate-500">(from {team.get(from)?.name})</span> : null}
                  <span className="ml-auto text-xs text-slate-500">{formatDateTime(t.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
