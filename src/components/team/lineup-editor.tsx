"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { addDrop, saveLineup } from "@/app/actions";
import { autofillLineup, validateLineup, type LineupPlayer } from "@/lib/lineup/lineup";
import { BENCH, isEligibleForSlot, slotGroup } from "@/lib/league/settings";
import { GameLine, type GameLineChip } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { PointsButton, type BreakdownGame } from "@/components/points-breakdown";
import type { ScoringRule } from "@/lib/scoring/engine";

export interface EditorPlayer extends LineupPlayer {
  positionLabel: string | null;
  universityCode: string;
  photoUrl: string | null;
  breakdown: BreakdownGame[];
  weekPoints: number;
  seasonPoints: number;
  games: GameLineChip[];
}

const fmt = (v: number) => v.toFixed(1);

export function LineupEditor({ teamId, players, slots, editable, rosterLimit, rules, weekLabel }: { teamId: string; players: EditorPlayer[]; slots: string[]; editable: boolean; rosterLimit: number; rules: ScoringRule[]; weekLabel: string }) {
  const original = useMemo(() => new Map(players.map((p) => [p.playerId, p.slot])), [players]);
  const [slotOf, setSlotOf] = useState<Map<string, string>>(original);
  const [moving, setMoving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const current: LineupPlayer[] = players.map((p) => ({ ...p, slot: slotOf.get(p.playerId) ?? BENCH }));
  const problems = validateLineup(current, original, slots);
  const dirty = players.some((p) => slotOf.get(p.playerId) !== original.get(p.playerId));
  const occupant = (slot: string) => current.find((p) => p.slot === slot);
  const bench = current.filter((p) => p.slot === BENCH).sort((a, b) => (byId.get(b.playerId)?.seasonPoints ?? 0) - (byId.get(a.playerId)?.seasonPoints ?? 0));
  const mover = moving ? current.find((p) => p.playerId === moving) : undefined;

  /** Can the player being moved go to this slot (swapping with whoever is there)? */
  function canDrop(slot: string): boolean {
    if (!mover || mover.slot === slot) return false;
    const occ = slot === BENCH ? undefined : occupant(slot);
    if (occ?.locked) return false;
    return isEligibleForSlot(mover.positions, slot);
  }

  function moveTo(slot: string) {
    if (!mover) return;
    const next = new Map(slotOf);
    const from = mover.slot;
    const occ = slot === BENCH ? undefined : occupant(slot);
    next.set(mover.playerId, slot);
    // The displaced starter takes the mover's old slot if she can play it, otherwise the bench.
    if (occ) next.set(occ.playerId, from !== BENCH && isEligibleForSlot(occ.positions, from) ? from : BENCH);
    setSlotOf(next);
    setMoving(null);
    setMsg(null);
  }

  function autofill() {
    const filled = autofillLineup(current, slots);
    setSlotOf(new Map(filled.map((p) => [p.playerId, p.slot])));
    setMoving(null);
    setMsg({ ok: true, text: "Players with games today moved into your lineup. Review, then save." });
  }

  function save() {
    start(async () => {
      const r = await saveLineup(teamId, current.map((p) => ({ player_id: p.playerId, slot: p.slot })));
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
    });
  }

  function drop(p: EditorPlayer) {
    if (!confirm(`Drop ${p.name}? She becomes a free agent immediately and any team can pick her up.`)) return;
    start(async () => {
      const r = await addDrop(teamId, null, p.playerId);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Dropped." } : { ok: false, text: r.error });
    });
  }

  const actionCell = (slot: string, p: LineupPlayer | undefined) => {
    if (!editable) return null;
    if (moving) {
      if (p && p.playerId === moving) return <button className="w-16 rounded-full border border-gray-300 py-1.5 text-[11px] font-extrabold text-gray-600" onClick={() => setMoving(null)}>CANCEL</button>;
      if (canDrop(slot)) return <button className="w-16 rounded-full bg-coral-500 py-1.5 text-[11px] font-extrabold text-white" onClick={() => moveTo(slot)}>HERE</button>;
      return <span className="block w-16" />;
    }
    if (!p) return <span className="block w-16" />;
    if (p.locked) return <span className="grid w-16 place-items-center text-sm text-gray-400" title="Her match today has started">🔒</span>;
    return <button className="w-16 rounded-full border border-gray-300 py-1.5 text-[11px] font-extrabold text-gray-800 active:bg-gray-100" disabled={pending} onClick={() => { setMoving(p.playerId); setMsg(null); }}>MOVE</button>;
  };

  const row = (slot: string, p: LineupPlayer | undefined) => {
    const ep = p ? byId.get(p.playerId) : undefined;
    const isMover = !!p && p.playerId === moving;
    return (
      <li key={p ? p.playerId : slot} className={`flex items-center gap-3 px-3 py-2.5 ${isMover ? "bg-coral-50" : ""}`}>
        <span className={`w-8 shrink-0 text-center text-[11px] font-extrabold ${slot === BENCH ? "text-gray-400" : "text-gray-700"}`}>{slot === BENCH ? "BN" : slotGroup(slot)}</span>
        {ep ? (
          <>
            <PlayerPhoto name={ep.name} photo={ep.photoUrl} size={42} />
            <div className="min-w-0 flex-1">
              <Link href={`/players/${ep.playerId}`} className="block truncate text-[15px] font-bold leading-tight hover:underline">{ep.name}</Link>
              <div className="truncate text-[12px] text-gray-500">
                <span className="font-semibold text-gray-700">{ep.universityCode}</span> · {ep.positionLabel ?? "–"}
                {slot === BENCH && editable && !moving && !ep.locked ? (
                  <button className="ml-2 font-semibold text-red-600" disabled={pending} onClick={() => drop(ep)}>Drop</button>
                ) : null}
              </div>
              <div className="mt-0.5 text-[12px] leading-snug"><GameLine chips={ep.games} compact /></div>
            </div>
            <div className="w-12 shrink-0 text-right">
              <PointsButton
                value={ep.weekPoints}
                name={ep.name}
                photo={ep.photoUrl}
                subtitle={weekLabel}
                games={ep.breakdown}
                rules={rules}
                className={`text-[15px] font-extrabold ${ep.weekPoints < 0 ? "text-red-600" : slot === BENCH ? "text-gray-400" : ""}`}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 py-2 text-sm font-semibold text-gray-400">Empty</div>
        )}
        <div className="shrink-0">{actionCell(slot, p)}</div>
      </li>
    );
  };

  const startersTotal = slots.reduce((a, s) => a + (byId.get(occupant(s)?.playerId ?? "")?.weekPoints ?? 0), 0);

  return (
    <div className="space-y-3 pb-16">
      {editable ? (
        <div className="flex items-center gap-2 px-4 sm:px-0">
          {moving ? <span className="min-w-0 truncate text-xs font-semibold text-coral-700">Tap HERE to move {byId.get(moving)?.name}</span> : <button className="btn-secondary min-h-[34px] px-3 py-1 text-xs" onClick={autofill} disabled={pending}>Start active players</button>}
        </div>
      ) : null}
      {msg && !dirty ? <p className={`px-4 text-sm sm:px-0 ${msg.ok ? "text-emerald-700" : "text-red-600"}`} role="status">{msg.text}</p> : null}

      <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
          <span>Starters</span>
          <span>This week {fmt(startersTotal)}</span>
        </div>
        <ul className="divide-y divide-gray-100">{slots.map((s) => row(s, occupant(s)))}</ul>
      </section>

      <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
          <span>Bench · {players.length}/{rosterLimit} roster</span>
          {editable && moving && canDrop(BENCH) ? <button className="rounded-full bg-coral-500 px-3 py-1 text-[11px] font-extrabold text-white" onClick={() => moveTo(BENCH)}>MOVE TO BENCH</button> : null}
        </div>
        <ul className="divide-y divide-gray-100">
          {bench.length === 0 ? <li className="px-4 py-3 text-sm text-gray-400">Nobody on the bench.</li> : bench.map((p) => row(BENCH, p))}
        </ul>
        {editable && players.length < rosterLimit ? (
          <p className="border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
            {rosterLimit - players.length} open roster spot{rosterLimit - players.length > 1 ? "s" : ""}: <Link href="/free-agents" className="link">add a free agent</Link> or <Link href="/trades/new" className="link">trade</Link>.
          </p>
        ) : null}
      </section>

      {editable && (dirty || pending) ? (
        <div className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <div className="min-w-0 flex-1 text-xs">
              {problems.length ? <span className="font-semibold text-red-600">{problems[0]!.message}</span> : msg && !msg.ok ? <span className="font-semibold text-red-600">{msg.text}</span> : <span className="font-semibold text-gray-700">Unsaved lineup changes</span>}
            </div>
            <button className="btn-ghost min-h-[36px] px-3 py-1" onClick={() => { setSlotOf(original); setMoving(null); setMsg(null); }} disabled={pending}>Undo</button>
            <button className="btn-primary min-h-[36px] px-5 py-1" onClick={save} disabled={problems.length > 0 || pending}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
