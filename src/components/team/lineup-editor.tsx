"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { addDrop, saveLineup } from "@/app/actions";
import { autofillLineup, validateLineup, type LineupPlayer } from "@/lib/lineup/lineup";
import { BENCH, isEligibleForSlot, slotGroup } from "@/lib/league/settings";

export interface EditorPlayer extends LineupPlayer {
  positionLabel: string | null;
  university: string;
  weekPoints: number;
  seasonPoints: number;
  nextMatch: string | null;
}

function Pts({ v }: { v: number }) {
  return <span className={`font-mono tabular-nums ${v > 0 ? "text-mint-400" : v < 0 ? "text-red-300" : "text-slate-500"}`}>{v.toFixed(1)}</span>;
}

export function LineupEditor({ teamId, players, slots, editable, rosterLimit }: { teamId: string; players: EditorPlayer[]; slots: string[]; editable: boolean; rosterLimit: number }) {
  const original = useMemo(() => new Map(players.map((p) => [p.playerId, p.slot])), [players]);
  const [slotOf, setSlotOf] = useState<Map<string, string>>(original);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const current: LineupPlayer[] = players.map((p) => ({ ...p, slot: slotOf.get(p.playerId) ?? BENCH }));
  const problems = validateLineup(current, original, slots);
  const dirty = players.some((p) => slotOf.get(p.playerId) !== original.get(p.playerId));
  const occupant = (slot: string) => current.find((p) => p.slot === slot);
  const bench = current.filter((p) => p.slot === BENCH);

  function assign(slot: string, playerId: string) {
    const next = new Map(slotOf);
    const prevOcc = occupant(slot);
    if (playerId === "") {
      if (prevOcc) next.set(prevOcc.playerId, BENCH);
    } else {
      const fromSlot = next.get(playerId) ?? BENCH;
      next.set(playerId, slot);
      if (prevOcc && prevOcc.playerId !== playerId) {
        // swap: displaced player takes the incoming player's old slot if eligible, else bench
        const canSwap = fromSlot !== BENCH && isEligibleForSlot(prevOcc.positions, fromSlot);
        next.set(prevOcc.playerId, canSwap ? fromSlot : BENCH);
      }
    }
    setSlotOf(next);
    setMsg(null);
  }

  function autofill() {
    const filled = autofillLineup(current, slots);
    setSlotOf(new Map(filled.map((p) => [p.playerId, p.slot])));
    setMsg({ ok: true, text: "Suggested lineup filled in. Review it, then save." });
  }

  function save() {
    start(async () => {
      const r = await saveLineup(teamId, current.map((p) => ({ player_id: p.playerId, slot: p.slot })));
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
    });
  }

  function drop(p: EditorPlayer) {
    if (!confirm(`Drop ${p.name}? They become a free agent immediately and any team can pick them up.`)) return;
    start(async () => {
      const r = await addDrop(teamId, null, p.playerId);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Dropped." } : { ok: false, text: r.error });
    });
  }

  const row = (slot: string | null, p: LineupPlayer | undefined) => {
    const ep = p ? byId.get(p.playerId) : undefined;
    const lockedHere = !!p?.locked;
    const options = players.filter((x) => !x.locked && (slot ? isEligibleForSlot(x.positions, slot) : true));
    return (
      <div key={slot ?? ep?.playerId} className="flex items-center gap-3 border-t border-white/5 py-2.5 first:border-t-0">
        <span className={`w-12 shrink-0 rounded-md py-1 text-center font-mono text-xs font-bold ${slot ? "bg-coral-500/15 text-coral-400" : "bg-white/5 text-slate-400"}`}>{slot ? slotGroup(slot) : "BN"}</span>
        <div className="min-w-0 flex-1">
          {ep ? (
            <>
              <div className="flex items-center gap-2">
                <Link href={`/players/${ep.playerId}`} className="truncate font-semibold hover:underline">{ep.name}</Link>
                {ep.locked ? <span title="Their match today has started" className="text-xs text-amber-300">🔒</span> : null}
                {ep.playsToday && !ep.locked ? <span className="rounded bg-mint-500/15 px-1.5 text-[10px] font-bold text-mint-400">PLAYS TODAY</span> : null}
              </div>
              <div className="truncate text-xs text-slate-500">{ep.positionLabel ?? "–"} · {ep.university}{ep.nextMatch ? ` · next: ${ep.nextMatch}` : ""}</div>
            </>
          ) : (
            <span className="text-sm text-slate-500">Empty slot</span>
          )}
        </div>
        <div className="hidden w-14 text-right text-sm sm:block">{ep ? <Pts v={ep.weekPoints} /> : null}</div>
        <div className="hidden w-14 text-right text-sm sm:block">{ep ? <Pts v={ep.seasonPoints} /> : null}</div>
        {editable && slot ? (
          <select
            aria-label={`Choose player for ${slot}`}
            className="input w-28 py-1 text-xs sm:w-40"
            disabled={lockedHere || pending}
            value={p?.playerId ?? ""}
            onChange={(e) => assign(slot, e.target.value)}
          >
            <option value="">— empty —</option>
            {options.map((o) => (
              <option key={o.playerId} value={o.playerId}>{o.name}{slotOf.get(o.playerId) !== BENCH && slotOf.get(o.playerId) !== slot ? ` (${slotOf.get(o.playerId)})` : ""}</option>
            ))}
          </select>
        ) : null}
        {editable && !slot && ep ? (
          <button className="btn-ghost px-2 py-1 text-xs text-red-300" disabled={pending || ep.locked} onClick={() => drop(ep)}>Drop</button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" onClick={autofill} disabled={pending}>Start active players</button>
          <button className="btn-primary" onClick={save} disabled={!dirty || problems.length > 0 || pending}>{pending ? "Saving…" : "Save lineup"}</button>
          {dirty ? <button className="btn-ghost" onClick={() => { setSlotOf(original); setMsg(null); }} disabled={pending}>Undo changes</button> : null}
          {msg ? <span className={`text-sm ${msg.ok ? "text-mint-400" : "text-red-300"}`} role="status">{msg.text}</span> : null}
        </div>
      ) : null}
      {problems.length > 0 && dirty ? (
        <ul className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
      ) : null}
      <section className="card p-4">
        <div className="mb-1 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <span className="w-12">Slot</span><span className="flex-1">Starters</span><span className="hidden w-14 text-right sm:block">Week</span><span className="hidden w-14 text-right sm:block">Season</span>{editable ? <span className="w-28 sm:w-40" /> : null}
        </div>
        {slots.map((s) => row(s, occupant(s)))}
      </section>
      <section className="card p-4">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <span>Bench (scores no points) · {players.length}/{rosterLimit} roster spots used</span>
        </div>
        {bench.length === 0 ? <p className="py-2 text-sm text-slate-500">Nobody on the bench.</p> : bench.map((p) => row(null, p))}
        {editable && players.length < rosterLimit ? (
          <p className="mt-3 text-sm text-slate-400">You have {rosterLimit - players.length} open roster spot{rosterLimit - players.length > 1 ? "s" : ""}. <Link href="/free-agents" className="link">Add a free agent</Link> or <Link href="/trades/new" className="link">propose a trade</Link>.</p>
        ) : null}
      </section>
    </div>
  );
}
