"use client";
import { useState, useTransition } from "react";
import { updateLeague } from "@/app/actions";
import type { LeagueSettings } from "@/lib/league/settings";

export function SettingsForm({ name, status, settings }: { name: string; status: string; settings: LeagueSettings }) {
  const [s, setS] = useState<LeagueSettings>(settings);
  const [n, setN] = useState(name);
  const [st, setSt] = useState(status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Math.floor(Number(v))));
  const starters = s.roster.S + s.roster.OH + s.roster.M + s.roster.L + s.roster.UTIL;

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateLeague({ name: n, status: st, settings: s }); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "Saved" : r.error }); }); }}>
      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <div><label className="label">League name</label><input className="input" value={n} onChange={(e) => setN(e.target.value)} /></div>
        <div><label className="label">Status</label><select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="setup">Setup (preview)</option><option value="active">Active</option><option value="complete">Season complete</option></select></div>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 font-bold">Roster</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {(["S", "OH", "M", "L", "UTIL", "TOTAL"] as const).map((k) => (
            <div key={k}><label className="label">{k === "TOTAL" ? "Total size" : `${k} slots`}</label><input type="number" min={0} max={k === "TOTAL" ? 30 : 10} className="input" value={s.roster[k]} onChange={(e) => setS({ ...s, roster: { ...s.roster, [k]: num(e.target.value) } })} /></div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">{starters} starting slots + {Math.max(0, s.roster.TOTAL - starters)} bench spots. The total can&apos;t be set below the largest current roster.</p>
      </section>

      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-3 font-bold">Free agency</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-coral-500" checked={s.freeAgency.enabled} onChange={(e) => setS({ ...s, freeAgency: { enabled: e.target.checked } })} /> Managers can add and drop free agents</label>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Trades</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-coral-500" checked={s.trades.enabled} onChange={(e) => setS({ ...s, trades: { ...s.trades, enabled: e.target.checked } })} /> Trading is open</label>
          <label className="label mt-3">When a trade is accepted</label>
          <select className="input" value={s.trades.review} onChange={(e) => setS({ ...s, trades: { ...s.trades, review: e.target.value as "none" | "commissioner" } })}>
            <option value="none">Process immediately</option>
            <option value="commissioner">Wait for commissioner approval</option>
          </select>
          <label className="label mt-3">Trade deadline (last week trades are allowed)</label>
          <input type="number" min={1} className="input" placeholder="No deadline" value={s.trades.deadlineWeek ?? ""} onChange={(e) => setS({ ...s, trades: { ...s.trades, deadlineWeek: e.target.value === "" ? null : num(e.target.value) } })} />
        </div>
      </section>

      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-3 font-bold">Lineup locks</h3>
          <label className="label">Default lock time when a match start time is unknown (Toronto time)</label>
          <input type="time" className="input" value={s.lineupLock.fallbackLocalTime} onChange={(e) => setS({ ...s, lineupLock: { fallbackLocalTime: e.target.value } })} />
          <p className="mt-2 text-xs text-gray-500">Players lock individually when their own match locks and stay locked for the rest of that day. You can also set exact lock times per match under &quot;Matches &amp; locks&quot;.</p>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Playoffs</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-coral-500" checked={s.playoffs.enabled} onChange={(e) => setS({ ...s, playoffs: { ...s.playoffs, enabled: e.target.checked } })} /> This league has playoffs</label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><label className="label">Playoff teams</label><input type="number" min={2} max={16} className="input" value={s.playoffs.teams} onChange={(e) => setS({ ...s, playoffs: { ...s.playoffs, teams: num(e.target.value) } })} /></div>
            <div><label className="label">First playoff week</label><input type="number" min={1} className="input" value={s.playoffs.startWeek} onChange={(e) => setS({ ...s, playoffs: { ...s.playoffs, startWeek: num(e.target.value) } })} /></div>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
        {msg ? <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
