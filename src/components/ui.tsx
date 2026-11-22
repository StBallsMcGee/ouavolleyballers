import Link from "next/link";
import { formatDateTime, timeAgo } from "@/lib/time";

export type Tone = "blue" | "violet" | "green" | "orange" | "teal" | "pink" | "gold";
const TONES: Tone[] = ["blue", "violet", "green", "orange", "teal", "pink", "gold"];
/** Written out in full so the styles are always included. */
export const TONE_CLASS: Record<Tone, string> = {
  blue: "tile-blue", violet: "tile-violet", green: "tile-green", orange: "tile-orange", teal: "tile-teal", pink: "tile-pink", gold: "tile-gold",
};

/** Faint volleyball-court lines, drawn over the pastel headers (like the Home and Matchup courts). */
export function CourtLines({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 110" className={`pointer-events-none ${className}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="4" width="192" height="102" rx="3" />
      <line x1="100" y1="0" x2="100" y2="110" strokeWidth="3.5" />
      <line x1="68" y1="4" x2="68" y2="106" strokeDasharray="5 4" />
      <line x1="132" y1="4" x2="132" y2="106" strokeDasharray="5 4" />
      <circle cx="100" cy="55" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Every screen's title: a bright pastel card with court lines, like the Home and Matchup screens.
 * Each screen has its own colour (`tone`); without one, the title picks a steady colour.
 */
export function PageHeader({ title, subtitle, actions, tone }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; tone?: Tone }) {
  const t = tone ?? TONES[[...title].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]!;
  return (
    <header className={`${TONE_CLASS[t]} relative mx-3 mb-3 mt-1 overflow-hidden rounded-3xl px-5 py-4 shadow-lg shadow-black/30 sm:mx-0 sm:mt-4`}>
      <CourtLines className="absolute right-3 top-1/2 h-[78%] max-h-24 -translate-y-1/2 -rotate-6 text-white/40" />
      <div className="relative flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight text-charcoal">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm font-semibold text-charcoal/70 [&_*]:text-charcoal/70">{subtitle}</p> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap gap-2 [&_.btn-primary]:bg-charcoal [&_.btn-primary]:bg-none [&_.btn-primary]:text-gold-300 [&_.btn-secondary]:bg-charcoal/15 [&_.btn-secondary]:text-charcoal [&_.text-gray-500]:text-charcoal/70 [&_.text-gray-400]:text-charcoal/60">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** White card. On phones it runs edge to edge, like a native app list. */
export function Card({ title, action, children, className = "", flush = false }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0 sm:shadow-sm ${className}`}>
      {title || action ? (
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          {title ? <h2 className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-gray-900"><span className="inline-block h-3.5 w-1 rounded-full bg-gold-400" aria-hidden />{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

const tones = {
  slate: "bg-gray-100 text-gray-600",
  coral: "bg-brand-950/50 text-brand-300",
  mint: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
  dark: "bg-brand-800 text-white",
} as const;

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

export function MatchStatus({ status, statsAvailable }: { status: string; statsAvailable?: boolean }) {
  if (status === "live") return <Badge tone="red">● Live</Badge>;
  if (status === "final") return statsAvailable ? <Badge tone="dark">Final</Badge> : <Badge tone="amber">Final · stats pending</Badge>;
  if (status === "postponed") return <Badge tone="amber">Postponed</Badge>;
  if (status === "cancelled") return <Badge tone="red">Cancelled</Badge>;
  return <Badge tone="blue">Scheduled</Badge>;
}

export function MatchupStatus({ status, source }: { status: string; source?: string }) {
  if (status === "final") return <Badge tone="dark">Final{source === "imported" ? " · USportVB" : ""}</Badge>;
  if (status === "in_progress") return <Badge tone="red">● Live</Badge>;
  if (status === "void") return <Badge>No contest</Badge>;
  return <Badge tone="blue">Upcoming</Badge>;
}

export function Points({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={`text-gray-400 ${className}`}>–</span>;
  const tone = value < 0 ? "text-red-600" : "text-gray-900";
  return <span className={`font-bold tabular-nums ${tone} ${className}`}>{value.toFixed(1)}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="tile-gold grid h-11 w-11 place-items-center rounded-2xl text-charcoal shadow-md shadow-black/30" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3c-1 4 0 7 4 9M3.5 9c4-1 7 0 8.5 3M7 20c1-4 3-6 5-8M20.5 15c-4 1-7 0-8.5-3" />
        </svg>
      </span>
      <p className="text-sm font-semibold text-gray-500">{children}</p>
    </div>
  );
}

/** Shows how fresh data is. Never presents old data as current. */
export function Freshness({ label = "Updated", at }: { label?: string; at: string | null | undefined }) {
  return (
    <span className="text-xs text-gray-500" title={at ? formatDateTime(at) : "No data yet"}>
      {label} {timeAgo(at)}
    </span>
  );
}

export function TeamLink({ id, name, mine }: { id: string; name: string; mine?: boolean }) {
  return (
    <Link href={`/teams/${id}`} className={`font-semibold hover:underline ${mine ? "text-brand-300" : "text-gray-900"}`}>
      {name}
    </Link>
  );
}

export function PositionTag({ label }: { label: string | null }) {
  return <span className="text-[11px] font-semibold text-gray-500">{label ?? "–"}</span>;
}

export function Notice({ tone = "slate", children }: { tone?: "slate" | "amber" | "red" | "mint"; children: React.ReactNode }) {
  const c = { slate: "border-brand-900 bg-brand-950/50 text-gray-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", mint: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={`mx-4 rounded-lg border px-3 py-2.5 text-sm sm:mx-0 ${c}`}>{children}</div>;
}

const AVATAR_COLORS = ["bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];

/** Initials circle (we don't have player photos). Colour is stable per name. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  // Whole characters (an emoji is one character, not two halves).
  const parts = name.trim().split(/\s+/).map((w) => Array.from(w));
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "")).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-extrabold ${AVATAR_COLORS[h % AVATAR_COLORS.length]}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials}
    </span>
  );
}

export interface GameLineChip {
  text: string;
  tone: "bye" | "live" | "today" | "upcoming" | "final" | "none";
}

function toneClass(t: GameLineChip["tone"]) {
  return t === "bye" ? "font-extrabold text-amber-700" : t === "live" ? "font-bold text-red-600" : t === "today" ? "font-bold text-gray-900" : t === "final" ? "text-gray-500" : t === "none" ? "text-gray-400" : "text-gray-700";
}

/** The single most useful game: live/today/next upcoming, else the last result, else BYE. */
export function primaryChip(chips: readonly GameLineChip[]): { chip: GameLineChip | null; more: number } {
  if (chips.length === 0) return { chip: null, more: 0 };
  if (chips[0]!.tone === "bye") return { chip: chips[0]!, more: 0 };
  const next = chips.find((c) => c.tone === "live" || c.tone === "today" || c.tone === "upcoming");
  const chip = next ?? chips[chips.length - 1]!;
  return { chip, more: chips.length - 1 };
}

/** The "Sat 2:00 PM @ GPH" / "BYE" line under a player's name. `compact` = one line only. */
export function GameLine({ chips, compact = false }: { chips: GameLineChip[]; compact?: boolean }) {
  if (chips.length === 0) return <span className="text-gray-400">No games scheduled</span>;
  if (compact) {
    const { chip, more } = primaryChip(chips);
    if (!chip) return null;
    return (
      <span className="block truncate">
        <span className={toneClass(chip.tone)}>{chip.text}</span>
        {more > 0 ? <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] font-bold text-gray-500" title={`${more + 1} games this week`}>+{more}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className={"whitespace-nowrap " + (
            c.tone === "bye" ? "font-extrabold text-amber-700" :
            c.tone === "live" ? "font-bold text-red-600" :
            c.tone === "today" ? "font-bold text-gray-900" :
            c.tone === "final" ? "text-gray-500" : "text-gray-700")
          }
        >
          {c.text}
        </span>
      ))}
    </span>
  );
}
