"use client";
import { useState, useTransition } from "react";
import { submitWaiverClaim } from "@/app/actions";

/**
 * Add or claim a free agent. If her game today hasn't started, she joins the roster at once
 * ("ADD"). If it has (she's locked), the claim is decided at midnight ("CLAIM"); the team lowest
 * in the standings wins a contested player.
 */
export function AddPlayerButton({ teamId, playerId, playerName, rosterFull, roster, claimed = false, locked = false }: {
  teamId: string; playerId: string; playerName: string; rosterFull: boolean;
  roster: Array<{ id: string; name: string; locked: boolean }>; claimed?: boolean; locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await submitWaiverClaim(teamId, playerId, drop || null);
      setMsg(r.ok ? { ok: true, text: r.message === "added" ? "added" : "claimed" } : { ok: false, text: r.error });
      if (r.ok) setOpen(false);
    });
  if (msg?.ok && msg.text === "added") return <span className="animate-pop rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-extrabold text-emerald-800">ADDED</span>;
  if (claimed || msg?.ok) return <span className="animate-pop rounded-full bg-gold-100 px-2.5 py-1 text-[11px] font-extrabold text-gold-800" title="Decided at midnight">CLAIMED</span>;
  const verb = locked ? "Claim" : "Add";
  if (!open) {
    return (
      <span className="flex flex-col items-end">
        <button
          aria-label={`${verb} ${playerName}`}
          className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold shadow-sm active:scale-95 disabled:opacity-50 ${locked ? "bg-gold-400 text-brand-950" : "bg-brand-600 text-white"}`}
          onClick={() => (rosterFull ? setOpen(true) : confirm(locked
            ? `Claim ${playerName}? Her game today has started, so the claim is decided at midnight; she joins your bench if yours wins.`
            : `Add ${playerName} to your bench now?`) && run())}
          disabled={pending}
        >
          {pending ? "…" : verb.toUpperCase()}
        </button>
        {msg && !msg.ok ? <span className="mt-1 max-w-[12rem] text-right text-[11px] text-red-600">{msg.text}</span> : null}
      </span>
    );
  }
  return (
    <div className="flex animate-pop flex-col items-end gap-1">
      <select className="input w-40 py-1 text-xs" value={drop} onChange={(e) => setDrop(e.target.value)}>
        <option value="">{locked ? "Drop who, if it wins?" : "Drop who?"}</option>
        {roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <div className="flex gap-1">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn-primary px-2 py-1 text-xs" disabled={!drop || pending} onClick={run}>{verb} &amp; drop</button>
      </div>
      {msg && !msg.ok ? <span className="max-w-[14rem] text-right text-xs text-red-600">{msg.text}</span> : null}
    </div>
  );
}
