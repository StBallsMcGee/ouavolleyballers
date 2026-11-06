import Link from "next/link";
import { formatDateTime, timeAgo } from "@/lib/time";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const tones = {
  slate: "bg-white/5 text-slate-300",
  coral: "bg-coral-500/15 text-coral-400",
  mint: "bg-mint-500/15 text-mint-400",
  amber: "bg-amber-500/15 text-amber-300",
  red: "bg-red-500/15 text-red-300",
  blue: "bg-sky-500/15 text-sky-300",
} as const;

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

export function MatchStatus({ status, statsAvailable }: { status: string; statsAvailable?: boolean }) {
  if (status === "live") return <Badge tone="coral">● Live{statsAvailable ? " · partial stats" : ""}</Badge>;
  if (status === "final") return statsAvailable ? <Badge tone="mint">Final</Badge> : <Badge tone="amber">Final · awaiting stats</Badge>;
  if (status === "postponed") return <Badge tone="amber">Postponed</Badge>;
  if (status === "cancelled") return <Badge tone="red">Cancelled</Badge>;
  return <Badge tone="blue">Scheduled</Badge>;
}

export function MatchupStatus({ status, source }: { status: string; source?: string }) {
  if (status === "final") return <Badge tone="mint">Final{source === "imported" ? " · USportVB" : ""}</Badge>;
  if (status === "in_progress") return <Badge tone="coral">In progress</Badge>;
  if (status === "void") return <Badge tone="slate">No contest</Badge>;
  return <Badge tone="blue">Upcoming</Badge>;
}

export function Points({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={`text-slate-500 ${className}`}>–</span>;
  const tone = value > 0 ? "text-mint-400" : value < 0 ? "text-red-300" : "text-slate-400";
  return <span className={`font-mono font-semibold tabular-nums ${tone} ${className}`}>{value.toFixed(1)}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">{children}</p>;
}

/** Shows how fresh data is. Never presents old data as current. */
export function Freshness({ label = "Stats updated", at }: { label?: string; at: string | null | undefined }) {
  return (
    <span className="text-xs text-slate-500" title={at ? formatDateTime(at) : "No data yet"}>
      {label} {timeAgo(at)}
    </span>
  );
}

export function TeamLink({ id, name, mine }: { id: string; name: string; mine?: boolean }) {
  return (
    <Link href={`/teams/${id}`} className={`font-semibold hover:underline ${mine ? "text-coral-400" : "text-slate-100"}`}>
      {name}
    </Link>
  );
}

export function PositionTag({ label }: { label: string | null }) {
  return <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{label ?? "–"}</span>;
}

export function Notice({ tone = "slate", children }: { tone?: "slate" | "amber" | "red" | "mint"; children: React.ReactNode }) {
  const c = { slate: "border-white/10 bg-white/5", amber: "border-amber-400/30 bg-amber-400/10 text-amber-100", red: "border-red-400/30 bg-red-500/10 text-red-100", mint: "border-mint-400/30 bg-mint-500/10 text-mint-100" }[tone];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${c}`}>{children}</div>;
}
