import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, Empty, Notice, PageHeader, TeamLink } from "@/components/ui";
import { TradeButtons } from "@/components/trade-buttons";

export const metadata = { title: "Trades" };

const statusTone = { proposed: "blue", pending_review: "amber", completed: "mint", rejected: "slate", cancelled: "slate", vetoed: "red", failed: "red" } as const;
const statusText = { proposed: "Awaiting response", pending_review: "Awaiting commissioner", completed: "Completed", rejected: "Declined", cancelled: "Withdrawn", vetoed: "Vetoed", failed: "Could not process" } as const;

export default async function TradesPage() {
  const ctx = await requireLeague();
  const { supabase: sb, league, myTeam, isAdmin } = ctx;
  const { data: trades } = await sb.from("trades").select("*, trade_items(player_id, from_team_id, to_team_id, players(display_name, position_label))").eq("league_id", league.id).order("created_at", { ascending: false }).limit(100);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  type T = NonNullable<typeof trades>[number];
  const incoming = (trades ?? []).filter((t) => t.status === "proposed" && t.receiving_team_id === myTeam?.id);
  const outgoing = (trades ?? []).filter((t) => ["proposed", "pending_review"].includes(t.status) && t.proposing_team_id === myTeam?.id);
  const review = isAdmin ? (trades ?? []).filter((t) => t.status === "pending_review") : [];
  const history = (trades ?? []).filter((t) => !incoming.includes(t) && !outgoing.includes(t) && !review.includes(t));

  const TradeCard = ({ t, buttons }: { t: T; buttons?: React.ReactNode }) => {
    const items = (t.trade_items ?? []) as Array<{ player_id: string; from_team_id: string; players: { display_name: string; position_label: string | null } }>;
    const side = (teamId: string) => items.filter((i) => i.from_team_id === teamId);
    return (
      <div className="rounded-xl bg-court-950/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>{formatDateTime(t.created_at)}</span>
          <Badge tone={statusTone[t.status as keyof typeof statusTone]}>{statusText[t.status as keyof typeof statusText]}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[t.proposing_team_id, t.receiving_team_id].map((tid: string) => (
            <div key={tid}>
              <div className="mb-1 text-sm"><TeamLink id={tid} name={team.get(tid)?.name ?? "?"} mine={tid === myTeam?.id} /> <span className="text-slate-500">sends</span></div>
              <ul className="space-y-1 text-sm">
                {side(tid).length === 0 ? <li className="text-slate-500">Nothing</li> : side(tid).map((i) => <li key={i.player_id}><Link href={`/players/${i.player_id}`} className="hover:underline">{i.players.display_name}</Link> <span className="text-xs text-slate-500">{i.players.position_label}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
        {t.message ? <p className="mt-3 border-l-2 border-white/10 pl-3 text-sm italic text-slate-300">“{t.message}”</p> : null}
        {t.status_reason ? <p className="mt-2 text-xs text-slate-400">{t.status_reason}</p> : null}
        {buttons ? <div className="mt-3">{buttons}</div> : null}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Trades" actions={myTeam && league.settings.trades.enabled ? <Link href="/trades/new" className="btn-primary">Propose a trade</Link> : null} />
      {!league.settings.trades.enabled ? <div className="mb-4"><Notice tone="amber">Trading is currently closed by the league administrator.</Notice></div> : null}
      {league.settings.trades.enabled ? (
        <p className="mb-4 text-sm text-slate-400">
          Accepted trades {league.settings.trades.review === "commissioner" ? "go to the commissioner for approval, then " : ""}move players straight onto the receiving team&apos;s bench.
          {league.settings.trades.deadlineWeek ? ` Trade deadline: end of week ${league.settings.trades.deadlineWeek}.` : ""} Rosters can&apos;t go over {league.settings.roster.TOTAL} players.
        </p>
      ) : null}
      <div className="space-y-4">
        {review.length ? <Card title="Waiting for your approval (commissioner)"><div className="space-y-3">{review.map((t) => <TradeCard key={t.id} t={t} buttons={<TradeButtons tradeId={t.id} kind="review" />} />)}</div></Card> : null}
        <Card title="Offers to you">{incoming.length ? <div className="space-y-3">{incoming.map((t) => <TradeCard key={t.id} t={t} buttons={<TradeButtons tradeId={t.id} kind="respond" />} />)}</div> : <Empty>No offers waiting.</Empty>}</Card>
        <Card title="Your open offers">{outgoing.length ? <div className="space-y-3">{outgoing.map((t) => <TradeCard key={t.id} t={t} buttons={<TradeButtons tradeId={t.id} kind="cancel" />} />)}</div> : <Empty>You have no open offers.</Empty>}</Card>
        <Card title="League trade history">{history.length ? <div className="space-y-3">{history.map((t) => <TradeCard key={t.id} t={t} />)}</div> : <Empty>No trades yet.</Empty>}</Card>
      </div>
    </>
  );
}
