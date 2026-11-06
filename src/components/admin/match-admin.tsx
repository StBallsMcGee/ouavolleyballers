"use client";
import { useState, useTransition } from "react";
import { updateMatch } from "@/app/actions";

/** Converts a UTC ISO time to "YYYY-MM-DDTHH:MM" in Toronto time for a datetime-local input. */
function toLocalInput(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Converts a Toronto wall-clock time to a UTC ISO string (handles daylight saving). */
function fromLocalInput(v: string) {
  const guess = new Date(`${v}:00Z`);
  const shown = new Date(toLocalInput(guess.toISOString()) + ":00Z");
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime())).toISOString();
}

export function MatchRowEditor({ id, lockAt, counts, status }: { id: string; lockAt: string; counts: boolean; status: string }) {
  const [lock, setLock] = useState(toLocalInput(lockAt));
  const [c, setC] = useState(counts);
  const [st, setSt] = useState(status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = lock !== toLocalInput(lockAt) || c !== counts || st !== status;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input type="datetime-local" className="input w-48 py-1 text-xs" value={lock} onChange={(e) => setLock(e.target.value)} />
      <select className="input w-28 py-1 text-xs" value={st} onChange={(e) => setSt(e.target.value)}>
        {["scheduled", "live", "final", "postponed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-coral-500" checked={c} onChange={(e) => setC(e.target.checked)} />counts</label>
      <button className="btn-secondary px-2 py-1 text-xs" disabled={!dirty || pending} onClick={() => start(async () => { const r = await updateMatch(id, lock !== toLocalInput(lockAt) ? fromLocalInput(lock) : null, c !== counts ? c : null, st !== status ? st : null); setMsg({ ok: r.ok, text: r.ok ? "Saved" : r.error }); })}>Save</button>
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span> : null}
    </span>
  );
}
