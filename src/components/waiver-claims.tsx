"use client";
import Link from "next/link";
import { useTransition } from "react";
import { cancelWaiverClaim } from "@/app/actions";

export interface ClaimRow {
  id: string;
  player: string;
  playerId: string;
  drop: string | null;
  status: "pending" | "won" | "lost" | "failed" | "cancelled";
  detail: string | null;
}

const BADGE: Record<ClaimRow["status"], string> = {
  pending: "bg-gold-100 text-gold-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-gray-100 text-gray-600",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

/** Your waiver claims: pending ones (cancellable) and the latest results. */
export function WaiverClaims({ claims }: { claims: ClaimRow[] }) {
  const [pending, start] = useTransition();
  if (claims.length === 0) return null;
  return (
    <ul className="divide-y divide-gray-100">
      {claims.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <Link href={`/players/${c.playerId}`} className="block truncate font-bold">{c.player}</Link>
            <div className="truncate text-xs text-gray-500">{c.drop ? `Drops ${c.drop} if it wins` : "No drop"}{c.detail ? ` · ${c.detail}` : ""}</div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${BADGE[c.status]}`}>{c.status === "pending" ? "midnight" : c.status}</span>
          {c.status === "pending" ? (
            <button className="btn-ghost shrink-0 px-2 py-1 text-xs text-red-600" disabled={pending} onClick={() => start(async () => { await cancelWaiverClaim(c.id); })}>Cancel</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
