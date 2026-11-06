"use client";
import { useState, useTransition } from "react";
import { createScoringVersion, previewScoring, type ScoringPreviewRow } from "@/app/actions";
import { CORE_STAT_KEYS, STAT_LABELS } from "@/lib/scoring/engine";

interface Rule { stat_key: string; label: string; points: number; active: boolean }

export function ScoringEditor({ initial, currentWeek, teams }: { initial: Rule[]; currentWeek: number; teams: Record<string, string> }) {
  const [rules, setRules] = useState<Rule[]>(() => {
    const have = new Set(initial.map((r) => r.stat_key));
    return [...initial, ...CORE_STAT_KEYS.filter((k) => !have.has(k)).map((k) => ({ stat_key: k, label: STAT_LABELS[k], points: 0, active: false }))];
  });
  const [mode, setMode] = useState<"next" | "now" | "history" | "custom">("next");
  const [custom, setCustom] = useState(currentWeek + 1);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<ScoringPreviewRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const effective = mode === "next" ? currentWeek + 1 : mode === "now" ? currentWeek : mode === "history" ? 1 : custom;
  const changed = JSON.stringify(rules.filter((r) => r.active || r.points !== 0)) !== JSON.stringify(initial);
  const update = (i: number, patch: Partial<Rule>) => { setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r))); setPreview(null); };
  const affected = preview?.filter((p) => p.week >= effective) ?? [];

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <table className="table table-fixed">
          <thead><tr><th className="w-12">Use</th><th>Category</th><th className="w-24 text-right">Points</th></tr></thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.stat_key}>
                <td><input type="checkbox" className="accent-coral-500" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} /></td>
                <td><input className="input min-w-0 py-1" value={r.label} onChange={(e) => update(i, { label: e.target.value })} /><div className="mt-0.5 font-mono text-[11px] text-gray-500">{r.stat_key}</div></td>
                <td><input type="number" step="0.05" className="input py-1 text-right font-mono" value={r.points} onChange={(e) => update(i, { points: Number(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddCategory onAdd={(key, label) => setRules([...rules, { stat_key: key, label, points: 0, active: true }])} existing={rules.map((r) => r.stat_key)} />
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="font-bold">When should the new scoring apply?</h3>
        {[
          ["next", `From next week (week ${currentWeek + 1}) — past results stay exactly as they are`],
          ["now", `From this week (week ${currentWeek}) — this week's scores are recalculated`],
          ["history", "Recalculate the whole season from week 1 — standings may change"],
          ["custom", "From a specific week"],
        ].map(([v, text]) => (
          <label key={v} className="flex items-start gap-2 text-sm"><input type="radio" name="mode" className="mt-1 accent-coral-500" checked={mode === v} onChange={() => setMode(v as typeof mode)} />{text}</label>
        ))}
        {mode === "custom" ? <input type="number" min={1} className="input w-32" value={custom} onChange={(e) => setCustom(Math.max(1, Number(e.target.value)))} /> : null}
        <div><label className="label">Note (why the change was made)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={pending} onClick={() => start(async () => { const r = await previewScoring(rules); if (r.ok) setPreview(r.rows); else setMsg({ ok: false, text: r.error }); })}>Preview effect</button>
          <button className="btn-primary" disabled={pending || !changed} onClick={() => { if (!confirm(`Save new scoring, effective from week ${effective}?`)) return; start(async () => { const r = await createScoringVersion({ rules, effectiveFromWeek: effective, note }); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "Saved" : r.error }); }); }}>Save as new version</button>
        </div>
        {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p> : null}
      </section>

      {preview ? (
        <section className="card p-4">
          <h3 className="mb-2 font-bold">Preview: weeks {effective} onward ({affected.length ? "scores that would change" : "no completed games affected yet"})</h3>
          {affected.length ? (
            <div>
              <table className="table table-fixed">
                <thead><tr><th className="w-12">Wk</th><th>Team</th><th className="w-14 text-right">Now</th><th className="w-14 text-right">New</th><th className="w-14 text-right">+/−</th></tr></thead>
                <tbody>
                  {affected.sort((a, b) => a.week - b.week || (b.proposed - b.current) - (a.proposed - a.current)).map((p) => (
                    <tr key={`${p.teamId}${p.week}`}><td>{p.week}</td><td className="truncate">{teams[p.teamId] ?? "?"}</td><td className="text-right font-mono">{p.current.toFixed(1)}</td><td className="text-right font-mono">{p.proposed.toFixed(1)}</td><td className={`text-right font-mono ${p.proposed - p.current > 0 ? "text-emerald-600" : p.proposed - p.current < 0 ? "text-red-600" : "text-gray-500"}`}>{(p.proposed - p.current).toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-gray-500">Weeks imported from USportVB keep their recorded results and are not recalculated.</p>
        </section>
      ) : null}
    </div>
  );
}

function AddCategory({ onAdd, existing }: { onAdd: (key: string, label: string) => void; existing: string[] }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const valid = /^[a-z][a-z0-9_]{0,40}$/.test(key) && !existing.includes(key) && label.trim();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-gray-500">Add a custom category…</summary>
      <p className="my-2 text-xs text-gray-500">Custom categories only score if the data source provides that statistic (stored under that key). Our current source provides the nine standard categories above.</p>
      <div className="flex flex-wrap gap-2">
        <input className="input w-48" placeholder="key, e.g. reception_errors" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
        <input className="input w-48" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!valid} onClick={() => { onAdd(key, label.trim()); setKey(""); setLabel(""); }}>Add</button>
      </div>
    </details>
  );
}
