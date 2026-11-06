"use client";
import { useState, useTransition } from "react";
import { addDrop } from "@/app/actions";

export function AddPlayerButton({ teamId, playerId, playerName, rosterFull, roster }: { teamId: string; playerId: string; playerName: string; rosterFull: boolean; roster: Array<{ id: string; name: string; locked: boolean }> }) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await addDrop(teamId, playerId, drop || null);
      setMsg(r.ok ? { ok: true, text: "Added to your bench" } : { ok: false, text: r.error });
      if (r.ok) setOpen(false);
    });
  if (msg?.ok) return <span className="text-xs text-emerald-600">{msg.text}</span>;
  if (!open) return <button aria-label={`Add ${playerName}`} className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-xl font-bold leading-none text-white active:scale-95 disabled:opacity-50" onClick={() => (rosterFull ? setOpen(true) : confirm(`Add ${playerName} to your bench?`) && run())} disabled={pending}>{pending ? "…" : "+"}</button>;
  return (
    <div className="flex flex-col items-end gap-1">
      <select className="input w-40 py-1 text-xs" value={drop} onChange={(e) => setDrop(e.target.value)}>
        <option value="">Choose a player to drop…</option>
        {roster.filter((r) => !r.locked).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <div className="flex gap-1">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn-primary px-2 py-1 text-xs" disabled={!drop || pending} onClick={run}>Add &amp; drop</button>
      </div>
      {msg && !msg.ok ? <span className="max-w-[14rem] text-right text-xs text-red-600">{msg.text}</span> : null}
    </div>
  );
}
