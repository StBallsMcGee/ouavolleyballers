"use client";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { submitWaiverClaim } from "@/app/actions";
import { PlayerPhoto } from "@/components/player-photo";
import { PositionTile, positionText } from "@/components/position";

export interface DropCandidate {
  id: string;
  name: string;
  locked: boolean;
  photo?: string | null;
  position?: string | null;
  slot?: string;
  points?: number;
}

/**
 * Add or claim a free agent. If her game today hasn't started, she joins the roster at once
 * ("ADD"). If it has (she's locked), the claim is decided at midnight ("CLAIM"); the team lowest
 * in the standings wins a contested player.
 */
export function AddPlayerButton({ teamId, playerId, playerName, rosterFull, roster, claimed = false, locked = false }: {
  teamId: string; playerId: string; playerName: string; rosterFull: boolean;
  roster: DropCandidate[]; claimed?: boolean; locked?: boolean;
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
  // Roster full: choose who to drop from a sheet with photos and positions.
  const chosen = roster.find((r) => r.id === drop);
  return (
    <>
      <span className="text-[11px] font-bold text-gray-500">Choosing…</span>
      {createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Who to drop for ${playerName}`}>
          <button className="absolute inset-0 animate-fade-in bg-black/60" aria-label="Cancel" onClick={() => { setOpen(false); setDrop(""); }} />
          <div className="relative w-full max-w-md animate-slide-up rounded-t-3xl bg-surface pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-2xl sm:rounded-3xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300" />
            <div className="px-5 pb-2 pt-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-gold-300">{verb} {playerName}</p>
              <h2 className="text-lg font-black">Who do you want to drop?</h2>
              {locked ? <p className="text-xs text-gray-500">The drop only happens if your claim wins at midnight.</p> : null}
            </div>
            <ul className="max-h-[55vh] divide-y divide-gray-100 overflow-y-auto">
              {roster.map((r) => {
                const on = r.id === drop;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setDrop(r.id)} className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${on ? "bg-red-50" : "active:bg-white/5"}`} aria-pressed={on}>
                      <PositionTile label={r.slot && r.slot !== "BENCH" ? r.slot.replace(/\d+$/, "") : "BN"} size="sm" />
                      <PlayerPhoto name={r.name} photo={r.photo} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{r.name}</span>
                        <span className="block text-[11px] text-gray-500"><span className={`font-bold ${positionText(r.position)}`}>{r.position ?? "–"}</span>{r.points !== undefined ? ` · ${r.points.toFixed(1)} pts this season` : ""}{r.locked ? " · 🔒 playing today" : ""}</span>
                      </span>
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-black ${on ? "border-red-600 bg-red-600 text-charcoal" : "border-gray-300 text-transparent"}`}>✕</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 px-5 pt-3">
              <button className="btn-ghost flex-1" onClick={() => { setOpen(false); setDrop(""); }}>Cancel</button>
              <button className="btn-primary flex-[2]" disabled={!drop || pending} onClick={run}>
                {pending ? "…" : chosen ? `${verb} & drop ${chosen.name.split(" ")[0]}` : "Pick a player to drop"}
              </button>
            </div>
            {msg && !msg.ok ? <p className="px-5 pt-2 text-xs text-red-600">{msg.text}</p> : null}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
