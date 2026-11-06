"use client";
import { useState, useTransition } from "react";
import { cancelTrade, respondTrade, reviewTrade } from "@/app/actions";

export function TradeButtons({ tradeId, kind }: { tradeId: string; kind: "respond" | "cancel" | "review" }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? "" });
    });
  if (msg?.ok) return <span className="text-sm text-mint-400">{msg.text}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "respond" ? (
        <>
          <button className="btn-primary px-3 py-1.5" disabled={pending} onClick={() => confirm("Accept this trade? Players move immediately (or after commissioner approval).") && run(() => respondTrade(tradeId, true))}>Accept</button>
          <button className="btn-secondary px-3 py-1.5" disabled={pending} onClick={() => run(() => respondTrade(tradeId, false))}>Decline</button>
        </>
      ) : kind === "cancel" ? (
        <button className="btn-secondary px-3 py-1.5" disabled={pending} onClick={() => run(() => cancelTrade(tradeId))}>Withdraw offer</button>
      ) : (
        <>
          <button className="btn-primary px-3 py-1.5" disabled={pending} onClick={() => run(() => reviewTrade(tradeId, true, ""))}>Approve</button>
          <button className="btn-danger px-3 py-1.5" disabled={pending} onClick={() => { const reason = prompt("Reason for veto (shown to both managers):") ?? ""; run(() => reviewTrade(tradeId, false, reason)); }}>Veto</button>
        </>
      )}
      {msg && !msg.ok ? <span className="text-sm text-red-300">{msg.text}</span> : null}
    </div>
  );
}
