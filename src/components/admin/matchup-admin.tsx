"use client";
import { useState, useTransition } from "react";
import { createPlayoffRound, setMatchupStatus } from "@/app/actions";

export function MatchupStatusSelect({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <select className="input w-36 py-1 text-xs" value={value} disabled={pending} onChange={(e) => { const v = e.target.value as "scheduled" | "in_progress" | "final" | "void"; if (v === "void" && !confirm("Mark as no contest? Neither team gets a win or loss.")) return; setValue(v); start(async () => { const r = await setMatchupStatus(id, v); setErr(r.ok ? null : r.error); }); }}>
        <option value="scheduled">Upcoming</option><option value="in_progress">In progress</option><option value="final">Final</option><option value="void">No contest</option>
      </select>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </span>
  );
}

export function PlayoffCreator({ week, pairs, names }: { week: number; pairs: Array<{ home_team_id: string; away_team_id: string; round: number; homeSeed: number; awaySeed: number }>; names: Record<string, string> }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm">{pairs.map((p) => <li key={p.home_team_id}>({p.homeSeed}) {names[p.home_team_id]} vs ({p.awaySeed}) {names[p.away_team_id]}</li>)}</ul>
      <button className="btn-primary" disabled={pending || pairs.length === 0} onClick={() => confirm(`Create ${pairs.length} playoff matchups in week ${week}?`) && start(async () => { const r = await createPlayoffRound(week, pairs.map(({ home_team_id, away_team_id, round }) => ({ home_team_id, away_team_id, round }))); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); })}>Create week {week} playoff matchups</button>
      {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p> : null}
    </div>
  );
}
