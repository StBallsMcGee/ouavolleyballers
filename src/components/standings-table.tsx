import Link from "next/link";
import { TeamAvatar, type TeamLike } from "@/components/team-avatar";
import type { StandingRow } from "@/lib/standings/standings";

type Team = TeamLike & { manager?: string };
const BADGE: Record<number, string> = {
  1: "tile-gold",
  2: "bg-gradient-to-br from-[#eef1f5] to-[#a8b0bd] text-charcoal",
  3: "bg-gradient-to-br from-[#f5c49c] to-[#c47a48] text-charcoal",
};

/**
 * League table that fits a phone without sideways scrolling: rank badges (gold, silver,
 * bronze), team pictures, record pills, points-for with a small bar, and optionally recent form.
 */
function oddsText(p: number): string {
  if (p >= 0.995) return p === 1 ? "100%" : ">99%";
  if (p <= 0.005) return p === 0 ? "0%" : "<1%";
  return `${Math.round(p * 100)}%`;
}
function oddsTone(p: number): string {
  return p >= 0.75 ? "bg-[#7fe0a6] text-charcoal" : p >= 0.25 ? "bg-gold-300 text-charcoal" : p > 0.005 ? "bg-surface-3 text-gray-700" : "bg-surface-2 text-gray-400";
}

export function StandingsTable({ rows, teams, myTeamId, form, odds }: {
  rows: StandingRow[];
  teams: ReadonlyMap<string, Team>;
  myTeamId: string | null | undefined;
  /** Last results per team, oldest first (shown as coloured squares). */
  form?: ReadonlyMap<string, Array<"W" | "L" | "T">>;
  /** Chance of making the playoffs (0–1), shown as a "Playoffs" column. */
  odds?: ReadonlyMap<string, number>;
}) {
  const cols = odds ? "grid-cols-[1.75rem_minmax(0,1fr)_2.9rem_3.1rem_3.1rem]" : "grid-cols-[2rem_minmax(0,1fr)_3.25rem_3.75rem]";
  const maxPf = Math.max(1, ...rows.map((r) => r.pointsFor));
  return (
    <div>
      <div className={`grid ${cols} items-center gap-2 border-b border-gray-100 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-gray-500`}>
        <span className="text-center">#</span>
        <span>Team</span>
        <span className="text-center">W-L</span>
        {odds ? <span className="text-center" title="Chance of making the playoffs">Playoffs</span> : null}
        <span className="text-right">PF</span>
      </div>
      <ol>
        {rows.map((r) => {
          const t = teams.get(r.teamId);
          const mine = r.teamId === myTeamId;
          const f = form?.get(r.teamId) ?? [];
          return (
            <li key={r.teamId} className={`border-b border-gray-100 last:border-0 ${mine ? "bg-gold-400/10" : ""}`}>
              <Link href={`/teams/${r.teamId}`} className={`grid ${cols} items-center gap-2 px-3 py-2.5 active:bg-white/5`}>
                <span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[12px] font-black shadow ${BADGE[r.rank] ?? "bg-surface-3 text-gray-600"}`}>{r.rank}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamAvatar team={t} size={32} ring={mine} />
                  <span className="min-w-0">
                    <span className={`block truncate text-[14px] font-extrabold ${mine ? "text-gold-300" : "text-gray-900"}`}>{t?.name}</span>
                    {f.length ? (
                      <span className="mt-1 flex gap-1" aria-label={`Recent results: ${f.join(" ")}`}>
                        {f.map((x, i) => (
                          <span key={i} className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] text-[8px] font-black text-charcoal ${x === "W" ? "bg-[#7fe0a6]" : x === "L" ? "bg-[#ff8fa3]" : "bg-gray-400"}`}>{x}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="block truncate text-[11px] text-gray-500">{t?.manager}</span>
                    )}
                  </span>
                </span>
                <span className="justify-self-center rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-extrabold tabular-nums text-gray-900">
                  {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ""}
                </span>
                {odds ? (
                  <span className={`justify-self-center rounded-full px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums ${oddsTone(odds.get(r.teamId) ?? 0)}`}>
                    {oddsText(odds.get(r.teamId) ?? 0)}
                  </span>
                ) : null}
                <span className="text-right">
                  <span className="block text-[13px] font-extrabold tabular-nums text-gray-900">{r.pointsFor.toFixed(1)}</span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-gradient-to-r from-gold-300 to-orange-400" style={{ width: `${(r.pointsFor / maxPf) * 100}%` }} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
