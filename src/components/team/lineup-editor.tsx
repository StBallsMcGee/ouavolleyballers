"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addDrop, saveLineup, saveLineupPlan } from "@/app/actions";
import { autofillLineup, validateLineup, type LineupPlayer } from "@/lib/lineup/lineup";
import { BENCH, isEligibleForSlot, slotGroup } from "@/lib/league/settings";
import { GameLine } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { PointsButton } from "@/components/points-breakdown";
import type { ScoringRule } from "@/lib/scoring/engine";
import { countedTotal, lineupDayStats, projectedTotal, type PlayerDay } from "@/lib/data/days";

export interface EditorPlayer extends LineupPlayer {
  positionLabel: string | null;
  universityCode: string;
  photoUrl: string | null;
  seasonPoints: number;
  /** Per calendar day: that day's points and games only. */
  byDay: Record<string, PlayerDay>;
}

const NO_DAY: PlayerDay = { points: null, counted: false, games: [], breakdown: [], projected: null };

const fmt = (v: number) => v.toFixed(1);

export function LineupEditor({ teamId, players, slots, editable, rosterLimit, rules, day, dayLabel, weekLabel, isToday, isPast, planDate, hasOwnPlan = false }: {
  teamId: string; players: EditorPlayer[]; slots: string[]; editable: boolean; rosterLimit: number; rules: ScoringRule[];
  day: string; dayLabel: string; weekLabel: string; isToday: boolean; isPast: boolean;
  /** Set for a later day: changes are saved as that day's planned lineup. */
  planDate?: string; hasOwnPlan?: boolean;
}) {
  const original = useMemo(() => new Map(players.map((p) => [p.playerId, p.slot])), [players]);
  const [slotOf, setSlotOf] = useState<Map<string, string>>(original);
  const [moving, setMoving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When fresh numbers arrive from the server (live refresh, after a save), follow them.
  useEffect(() => {
    if (!saving) setSlotOf(original);
  }, [original]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const current: LineupPlayer[] = players.map((p) => ({ ...p, slot: slotOf.get(p.playerId) ?? BENCH }));
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
    setMoving(null);
    persist(next, "Saved");
  }

  function autofill() {
    const filled = autofillLineup(current, slots);
    setMoving(null);
    persist(new Map(filled.map((p) => [p.playerId, p.slot])), planDate ? `Players with games on ${dayLabel} moved in and saved` : "Players with games today moved in and saved");
  }

  /** Every move saves straight away; if the server refuses it, the lineup goes back. */
  function persist(next: Map<string, string>, okText: string) {
    const before = slotOf;
    const lineup: LineupPlayer[] = players.map((p) => ({ ...p, slot: next.get(p.playerId) ?? BENCH }));
    const problems = validateLineup(lineup, original, slots);
    if (problems.length) {
      setMsg({ ok: false, text: problems[0]!.message });
      return;
    }
    setSlotOf(next);
    setSaving(true);
    setMsg(null);
    start(async () => {
      const entries = lineup.map((p) => ({ player_id: p.playerId, slot: p.slot }));
      const r = planDate ? await saveLineupPlan(teamId, planDate, entries) : await saveLineup(teamId, entries);
      setSaving(false);
      if (!r.ok) {
        setSlotOf(before);
        setMsg({ ok: false, text: r.error });
        return;
      }
      setMsg({ ok: true, text: okText });
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setMsg((m) => (m?.ok ? null : m)), 2500);
    });
  }

  function drop(p: EditorPlayer) {
    const note = p.locked ? " Her points from today's game still count for you." : "";
    if (!confirm(`Drop ${p.name}? She becomes a free agent right away.${note}`)) return;
    start(async () => {
      const r = await addDrop(teamId, null, p.playerId);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Dropped." } : { ok: false, text: r.error });
    });
  }

  const actionCell = (slot: string, p: LineupPlayer | undefined) => {
    if (!editable) return null;
    if (moving) {
      if (p && p.playerId === moving) return <button className="w-16 rounded-full border border-gray-300 py-1.5 text-[11px] font-extrabold text-gray-600" onClick={() => setMoving(null)}>CANCEL</button>;
      if (canDrop(slot)) return <button className="w-16 animate-pop rounded-full bg-brand-500 py-1.5 text-[11px] font-extrabold text-white" onClick={() => moveTo(slot)}>HERE</button>;
      return <span className="block w-16" />;
    }
    if (!p) return <span className="block w-16" />;
    if (p.locked) return <span className="grid w-16 place-items-center text-sm text-gray-400" title="Her match today has started">🔒</span>;
    return <button className="w-16 rounded-full border border-gray-300 py-1.5 text-[11px] font-extrabold text-gray-800 active:bg-gray-100" disabled={pending} onClick={() => { setMoving(p.playerId); setMsg(null); }}>MOVE</button>;
  };

  const row = (slot: string, p: LineupPlayer | undefined) => {
    const ep = p ? byId.get(p.playerId) : undefined;
    const d = ep?.byDay[day] ?? NO_DAY;
    const isMover = !!p && p.playerId === moving;
    return (
      <li key={p ? p.playerId : slot} className={`flex items-center gap-3 px-3 py-2.5 transition-colors duration-200 ${isMover ? "bg-brand-950/50" : ""}`}>
        <span className={`w-8 shrink-0 text-center text-[11px] font-extrabold ${slot === BENCH ? "text-gray-400" : "text-gray-700"}`}>{slot === BENCH ? "BN" : slotGroup(slot)}</span>
        {ep ? (
          <>
            <PlayerPhoto name={ep.name} photo={ep.photoUrl} size={42} />
            <div className="min-w-0 flex-1">
              <Link href={`/players/${ep.playerId}`} className="block truncate text-[15px] font-bold leading-tight hover:underline">{ep.name}</Link>
              <div className="truncate text-[12px] text-gray-500">
                <span className="font-semibold text-gray-700">{ep.universityCode}</span> · {ep.positionLabel ?? "–"}
              </div>
              <div className="mt-0.5 text-[12px] leading-snug"><GameLine chips={d.games} compact /></div>
              {editable && !moving ? (
                <button className="mt-0.5 text-[11px] font-bold text-red-600 active:text-red-800" disabled={pending} onClick={() => drop(ep)}>Drop</button>
              ) : null}
            </div>
            <div className="w-12 shrink-0 text-right">
              {d.points === null ? (
                d.projected !== null ? (
                  <span className="block leading-tight" title="Projected points"><span className="text-[14px] font-bold tabular-nums text-gray-400">{d.projected.toFixed(1)}</span><span className="block text-[9px] font-bold uppercase tracking-wide text-gray-400">proj</span></span>
                ) : <span className="text-[15px] font-extrabold text-gray-300">–</span>
              ) : (
                <PointsButton
                  value={d.points}
                  name={ep.name}
                  photo={ep.photoUrl}
                  subtitle={weekLabel}
                  games={d.breakdown}
                  rules={rules}
                  className={`text-[15px] font-extrabold ${d.points < 0 ? "text-red-600" : !d.counted ? "text-gray-400" : ""}`}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 py-2 text-sm font-semibold text-gray-400">Empty</div>
        )}
        <div className="shrink-0">{actionCell(slot, p)}</div>
      </li>
    );
  };

  const dayTotal = countedTotal(players.map((p) => p.byDay[day] ?? NO_DAY));
  // Projection for the rest of the day: players in the lineup whose games haven't been played.
  const dayProj = projectedTotal(slots.map((s) => occupant(s)).flatMap((p) => (p ? [byId.get(p.playerId)?.byDay[day] ?? NO_DAY] : [])));

  if (isPast && players.length === 0) {
    return (
      <p className="mx-4 rounded-xl border border-gray-200 bg-surface px-4 py-6 text-center text-sm text-gray-500 sm:mx-0">
        No lineup was recorded here for {dayLabel}. Days before the league moved to Sideout were played on USportVB.
      </p>
    );
  }

  return (
    <div className="space-y-3 pb-16">
      {editable && (moving || isToday || planDate) ? (
        <div className="flex items-center gap-2 px-4 sm:px-0">
          {moving ? <span className="min-w-0 animate-fade-in truncate text-xs font-semibold text-brand-300">Tap HERE to move {byId.get(moving)?.name}</span> : <button className="btn-secondary min-h-[34px] px-3 py-1 text-xs" onClick={autofill} disabled={pending}>Start active players</button>}
        </div>
      ) : null}
      {isPast ? <p className="px-4 text-xs text-gray-500 sm:px-0">The lineup as it stood at the end of {dayLabel}.</p> : planDate && editable ? <p className="px-4 text-xs text-gray-500 sm:px-0">{hasOwnPlan ? "Your lineup for" : "Set your lineup for"} {dayLabel}. It takes over when that day starts and carries forward to later days; today&apos;s locked players don&apos;t affect it.</p> : null}
      {saving || msg ? (
        <p className={`animate-fade-in px-4 text-sm font-semibold sm:px-0 ${saving ? "text-gray-500" : msg?.ok ? "text-emerald-700" : "text-red-600"}`} role="status">
          {saving ? "Saving…" : msg?.ok ? `✓ ${msg.text}` : msg?.text}
        </p>
      ) : null}

      <section className="mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
        <div className="flex items-center justify-between border-b border-brand-900 bg-brand-950/50 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-brand-200">
          <span>Starters</span>
          <span>{dayLabel} · {fmt(dayTotal)}{dayProj > 0 ? <span className="font-bold normal-case text-gray-400"> · proj {fmt(dayTotal + dayProj)}</span> : null}</span>
        </div>
        <ul className="divide-y divide-gray-100">{slots.map((s) => row(s, occupant(s)))}</ul>
        {(() => {
          const st = lineupDayStats(slots.flatMap((s) => { const o = occupant(s); return o ? [byId.get(o.playerId)?.byDay[day] ?? NO_DAY] : []; }));
          return (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 rounded-b-2xl border-t border-gray-100 bg-surface-2 px-3 py-2 text-[11px] text-gray-500">
              <span><b className="text-gray-900">{st.playing}</b> playing {isToday ? "today" : "this day"}</span>
              <span><b className="text-gray-900">{st.left}</b> left to play</span>
              <span><b className="text-gold-300">{fmt(dayTotal)}</b> daily total</span>
            </div>
          );
        })()}
      </section>

      <section className="mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
        <div className="flex items-center justify-between border-b border-brand-900 bg-brand-950/50 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-brand-200">
          <span>Bench · {players.length}/{rosterLimit} roster</span>
          {editable && moving && canDrop(BENCH) ? <button className="animate-pop rounded-full bg-brand-500 px-3 py-1 text-[11px] font-extrabold text-white" onClick={() => moveTo(BENCH)}>MOVE TO BENCH</button> : null}
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

    </div>
  );
}
