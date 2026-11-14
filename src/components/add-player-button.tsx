"use client";
import { useState, useTransition } from "react";
import { submitWaiverClaim } from "@/app/actions";

/**
 * Claim a free agent. Claims are decided at midnight (the team lowest in the standings wins a
 * contested player), so a player picked up during her game never lands on a roster locked.
 */
export function AddPlayerButton({ teamId, playerId, playerName, rosterFull, roster, claimed = false }: {
  teamId: string; playerId: string; playerName: string; rosterFull: boolean;
  roster: Array<{ id: string; name: string; locked: boolean }>; claimed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await submitWaiverClaim(teamId, playerId, drop || null);
      setMsg(r.ok ? { ok: true, text: "Claimed" } : { ok: false, text: r.error });
      if (r.ok) setOpen(false);
    });
  if (claimed || msg?.ok) return <span className="animate-pop rounded-full bg-gold-100 px-2.5 py-1 text-[11px] font-extrabold text-gold-800">CLAIMED</span>;
  if (!open) {
    return (
      <span className="flex flex-col items-end">
        <button
          aria-label={`Claim ${playerName}`}
          className="rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-sm active:scale-95 disabled:opacity-50"
          onClick={() => (rosterFull ? setOpen(true) : confirm(`Claim ${playerName}? Claims are decided at midnight; she joins your bench if yours wins.`) && run())}
          disabled={pending}
        >
          {pending ? "…" : "CLAIM"}
        </button>
        {msg && !msg.ok ? <span className="mt-1 max-w-[12rem] text-right text-[11px] text-red-600">{msg.text}</span> : null}
      </span>
    );
  }
  return (
    <div className="flex animate-pop flex-col items-end gap-1">
      <select className="input w-40 py-1 text-xs" value={drop} onChange={(e) => setDrop(e.target.value)}>
        <option value="">Drop who, if it wins?</option>
        {roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <div className="flex gap-1">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn-primary px-2 py-1 text-xs" disabled={!drop || pending} onClick={run}>Claim &amp; drop</button>
      </div>
      {msg && !msg.ok ? <span className="max-w-[14rem] text-right text-xs text-red-600">{msg.text}</span> : null}
    </div>
  );
}
