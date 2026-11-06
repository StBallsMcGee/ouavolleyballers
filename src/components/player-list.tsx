import Link from "next/link";
import { Avatar, Badge, GameLine, type GameLineChip } from "@/components/ui";

export interface PlayerListItem {
  id: string;
  name: string;
  code: string;
  position: string | null;
  games: GameLineChip[];
  points: number;
  gamesPlayed: number;
  owner?: { id: string; name: string; mine: boolean } | null;
  flags?: string[];
  action?: React.ReactNode;
}

/** Phone-friendly player rows: who, which team, next game (or BYE), points. */
export function PlayerList({ items, showOwner = true }: { items: PlayerListItem[]; showOwner?: boolean }) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={p.name} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Link href={`/players/${p.id}`} className="truncate text-[15px] font-bold leading-tight hover:underline">{p.name}</Link>
              {p.flags?.map((f) => <Badge key={f} tone="amber">{f}</Badge>)}
            </div>
            <div className="truncate text-[12px] text-gray-500">
              <span className="font-semibold text-gray-700">{p.code}</span> · {p.position ?? "–"}
              {showOwner ? (
                p.owner ? <> · <Link href={`/teams/${p.owner.id}`} className={p.owner.mine ? "font-semibold text-coral-600" : "hover:underline"}>{p.owner.name}</Link></> : <> · <span className="font-semibold text-emerald-700">FA</span></>
              ) : null}
            </div>
            <div className="mt-0.5 text-[12px] leading-snug"><GameLine chips={p.games} /></div>
          </div>
          <div className="w-14 shrink-0 text-right">
            <div className={`text-[15px] font-extrabold tabular-nums ${p.points < 0 ? "text-red-600" : ""}`}>{p.points.toFixed(1)}</div>
            <div className="text-[10px] text-gray-400">{p.gamesPlayed ? `${(p.points / p.gamesPlayed).toFixed(1)}/gm` : "0 GP"}</div>
          </div>
          {p.action ? <div className="shrink-0">{p.action}</div> : null}
        </li>
      ))}
    </ul>
  );
}
