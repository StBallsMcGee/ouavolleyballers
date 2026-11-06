"use client";
import { useState, useTransition } from "react";
import { adminMovePlayer, inviteManager, setMemberRole, unassignOwner } from "@/app/actions";

type Msg = { ok: boolean; text: string } | null;
const Result = ({ m }: { m: Msg }) => (m ? <span className={`text-xs ${m.ok ? "text-emerald-600" : "text-red-600"}`}>{m.text}</span> : null);

export function InviteForm({ teamId, email, name, claimed }: { teamId: string; email: string; name: string; claimed: boolean }) {
  const [e, setE] = useState(email);
  const [n, setN] = useState(name);
  const [send, setSend] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" onSubmit={(ev) => { ev.preventDefault(); start(async () => { const r = await inviteManager(teamId, e, n, send); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); }); }}>
      <input className="input col-span-2 py-1.5 sm:w-56" type="email" placeholder="manager@email.com" value={e} onChange={(x) => setE(x.target.value)} required />
      <input className="input col-span-2 py-1.5 sm:w-40" placeholder="Manager name" value={n} onChange={(x) => setN(x.target.value)} />
      <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" className="accent-coral-500" checked={send} onChange={(x) => setSend(x.target.checked)} />email invite</label>
      <button className="btn-secondary min-h-[36px] px-3 py-1 text-xs" disabled={pending}>{claimed ? "Re-assign" : email ? "Update / resend" : "Invite"}</button>
      <Result m={msg} />
    </form>
  );
}

export function TeamOwnerButtons({ teamId, ownerId, isAdmin }: { teamId: string; ownerId: string; isAdmin: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => start(async () => { const r = await setMemberRole(ownerId, isAdmin ? "manager" : "admin"); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); })}>{isAdmin ? "Remove admin" : "Make admin"}</button>
      <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={pending} onClick={() => confirm("Remove this manager from the team? The roster is not changed.") && start(async () => { const r = await unassignOwner(teamId); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); })}>Unassign</button>
      <Result m={msg} />
    </span>
  );
}

export function RosterCorrection({ players, teams }: { players: Array<{ id: string; name: string; team: string | null }>; teams: Array<{ id: string; name: string }> }) {
  const [player, setPlayer] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const current = players.find((p) => p.id === player);
  return (
    <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await adminMovePlayer(player, to === "FA" ? null : to, reason); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); }); }}>
      <select className="input" value={player} onChange={(e) => setPlayer(e.target.value)} required>
        <option value="">Player…</option>
        {players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` (${teams.find((t) => t.id === p.team)?.name})` : " (free agent)"}</option>)}
      </select>
      <select className="input" value={to} onChange={(e) => setTo(e.target.value)} required>
        <option value="">Move to…</option>
        <option value="FA">Free agency (release)</option>
        {teams.filter((t) => t.id !== current?.team).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input className="input" placeholder="Reason (required, kept in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} required />
      <button className="btn-danger" disabled={pending || !player || !to || !reason.trim()}>Apply correction</button>
      <div className="sm:col-span-4"><Result m={msg} /></div>
    </form>
  );
}
