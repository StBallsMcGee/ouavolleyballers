import Link from "next/link";
import { TeamAvatar, type TeamLike } from "@/components/team-avatar";
import { formatDate } from "@/lib/time";

export interface HomeTrade {
  id: string;
  status: string;
  date: string; // ISO
  sides: Array<{ team: TeamLike | undefined; gets: string[] }>;
}

const STATUS: Record<string, [string, string]> = {
  completed: ["Done", "bg-[#7fe0a6] text-charcoal"],
  proposed: ["Offered", "bg-gold-300 text-charcoal"],
  pending_review: ["In review", "bg-[#c3adff] text-charcoal"],
  rejected: ["Declined", "bg-surface-3 text-gray-500"],
  cancelled: ["Withdrawn", "bg-surface-3 text-gray-500"],
  vetoed: ["Vetoed", "bg-[#ff8fa3] text-charcoal"],
  failed: ["Failed", "bg-surface-3 text-gray-500"],
};

/** Home: the trade banner (make an offer, offers waiting) and the league's latest trades. */
export function TradesHome({ trades, waiting, canTrade }: { trades: HomeTrade[]; waiting: number; canTrade: boolean }) {
  return (
    <section className="space-y-3">
      <div className="relative mx-3 overflow-hidden rounded-3xl tile-orange p-4 shadow-xl shadow-black/30 sm:mx-0">
        <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 text-[110px] leading-none opacity-15">⇄</span>
        <p className="text-[11px] font-extrabold uppercase tracking-wider opacity-70">Trade centre</p>
        <h2 className="text-xl font-black leading-tight">Make a deal</h2>
        <p className="mt-0.5 max-w-[16rem] text-[12px] font-semibold opacity-75">Offer players to any team. Trades happen when the other manager accepts.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canTrade ? <Link href="/trades/new" className="rounded-full bg-charcoal px-4 py-2 text-[12px] font-extrabold text-white shadow-lg">Make an offer</Link> : null}
          <Link href="/trades" className="rounded-full bg-white/40 px-4 py-2 text-[12px] font-extrabold">
            {waiting > 0 ? `${waiting} offer${waiting > 1 ? "s" : ""} waiting →` : "My trades →"}
          </Link>
        </div>
      </div>

      {trades.length ? (
        <div className="mx-3 overflow-hidden rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-gray-900"><span className="inline-block h-3.5 w-1 rounded-full bg-gold-400" aria-hidden />Latest trades</h3>
            <Link href="/activity" className="link text-xs">All activity</Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {trades.map((t) => {
              const [label, cls] = STATUS[t.status] ?? [t.status, "bg-surface-3 text-gray-500"];
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${cls}`}>{label}</span>
                    <span className="text-[11px] text-gray-500">{formatDate(t.date, { month: "short", day: "numeric" })}</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
                    {t.sides.map((s, i) => (
                      <div key={i} className={`flex min-w-0 items-start gap-2 ${i === 1 ? "order-3 flex-row-reverse text-right" : ""}`}>
                        <TeamAvatar team={s.team} size={28} />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-extrabold text-gray-900">{s.team?.name}</div>
                          <div className="text-[11px] leading-snug text-gray-500">gets {s.gets.length ? s.gets.join(", ") : "nothing"}</div>
                        </div>
                      </div>
                    ))}
                    <span className="order-2 pt-1 text-sm font-black text-gold-400">⇄</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
