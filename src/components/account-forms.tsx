"use client";
import { useState, useTransition } from "react";
import { renameTeam, updateDisplayName } from "@/app/actions";

function InlineForm({ label, initial, onSave }: { label: string; initial: string; onSave: (v: string) => Promise<{ ok: boolean; message?: string; error?: string }> }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await onSave(value); setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? "" }); }); }}>
      <label className="label">{label}</label>
      <div className="flex gap-2"><input className="input" maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} /><button className="btn-primary" disabled={pending || !value.trim() || value === initial}>Save</button></div>
      {msg ? <p className={`text-sm ${msg.ok ? "text-mint-400" : "text-red-300"}`}>{msg.text}</p> : null}
    </form>
  );
}

export function AccountForms({ displayName, team }: { displayName: string; team: { id: string; name: string } | null }) {
  return (
    <div className="space-y-6">
      <InlineForm label="Your name (shown to the league)" initial={displayName} onSave={updateDisplayName} />
      {team ? <InlineForm label="Team name" initial={team.name} onSave={(v) => renameTeam(team.id, v)} /> : null}
    </div>
  );
}
