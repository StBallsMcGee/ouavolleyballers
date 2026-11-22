import Link from "next/link";
import { GameLine, type GameLineChip } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { positionText, positionTileClass } from "@/components/position";
import type { StatCell } from "@/lib/players/leaders";

export interface LeaderRow {
  id: string;
  rank: number;
  name: string;
  photo: string | null;
  position: string | null;
  code: string;
  games: GameLineChip[];
  points: number;
  owner: { id: string; name: string; mine: boolean } | null;
  stats: StatCell[];
  /** The button on the left: add/claim, drop (yours) or trade (someone else's). */
  action: React.ReactNode;
}

/** Ranked players for a week or the season, each with a strip of position-relevant stats. */
export function LeadersList({ rows, showStats, pointsLabel }: { rows: LeaderRow[]; showStats: boolean; pointsLabel: string }) {
  return (
    <ol className="divide-y divide-gray-100">
      {rows.map((p) => (
        <li key={p.id} className="px-2 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex w-12 shrink-0 justify-center">{p.action}</div>
            <span className="w-6 shrink-0 text-center text-[15px] font-black tabular-nums text-gray-500">{p.rank}</span>
            <PlayerPhoto name={p.name} photo={p.photo} size={40} />
            <div className="min-w-0 flex-1">
              <Link href={`/players/${p.id}`} className="block truncate text-[15px] font-bold leading-tight hover:underline">{p.name}</Link>
              <div className="truncate text-[12px] text-gray-500">
                <span className={`font-bold ${positionText(p.position)}`}>{p.position ?? "–"}</span>
                {" · "}<span className="font-semibold text-gray-700">{p.code}</span>
                {" · "}{p.owner
                  ? <Link href={`/teams/${p.owner.id}`} className={p.owner.mine ? "font-semibold text-brand-300" : "hover:underline"}>{p.owner.name}</Link>
                  : <span className="font-semibold text-emerald-700">Free agent</span>}
              </div>
              <div className="truncate text-[12px] leading-snug"><GameLine chips={p.games} compact /></div>
            </div>
            <div className={`w-16 shrink-0 rounded-xl px-2 py-1 text-center text-charcoal shadow-md shadow-black/30 ${positionTileClass(p.position)}`}>
              <div className="text-[9px] font-extrabold uppercase tracking-wide opacity-70">{pointsLabel}</div>
              <div className="text-[16px] font-black tabular-nums leading-tight">{p.points.toFixed(1)}</div>
            </div>
          </div>
          {showStats ? (
            <div className="mt-1.5 overflow-x-auto pl-14 [scrollbar-width:none]">
              <dl className="flex min-w-max gap-4 pr-3">
                {p.stats.map((s) => (
                  <div key={s.label} className="min-w-[2.25rem]">
                    <dt className="text-[10px] font-bold uppercase text-gray-400">{s.label}</dt>
                    <dd className="text-[13px] font-semibold tabular-nums text-gray-800">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
