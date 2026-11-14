"use client";
import { useState, useTransition } from "react";
import { adminJoinCode, adminMovePlayer, inviteManager, setMemberRole, unassignOwner } from "@/app/actions";

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
      <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" className="accent-brand-500" checked={send} onChange={(x) => setSend(x.target.checked)} />email invite</label>
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

/** The league's shareable invite link: copy it or send it by text from the phone's share menu. */
export function InviteLinkCard({ origin, initialCode, error }: { origin: string; initialCode: string | null; error: string | null }) {
  const [code, setCode] = useState(initialCode);
  const [msg, setMsg] = useState<Msg>(error ? { ok: false, text: error } : null);
  const [pending, start] = useTransition();
  const url = code ? `${origin}/join/${code}` : "";
  const text = `Join our fantasy volleyball league on Sideout: ${url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg({ ok: true, text: "Link copied." });
    } catch {
      setMsg({ ok: false, text: "Couldn't copy automatically. Press and hold the link to copy it." });
    }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Join the league", text }); } catch { /* closed the share sheet */ }
    } else {
      window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">Text this link to your managers. They create an account with their email and a password, then pick their team. No emails are sent.</p>
      {url ? <p className="select-all break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">{url}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary min-h-[36px] px-4 py-1 text-xs" onClick={share} disabled={!url}>Text / share link</button>
        <button className="btn-secondary min-h-[36px] px-4 py-1 text-xs" onClick={copy} disabled={!url}>Copy</button>
        <button
          className="btn-ghost min-h-[36px] px-3 py-1 text-xs"
          disabled={pending}
          onClick={() => {
            if (code && !confirm("Make a new link? The old link will stop working (teams already claimed stay claimed).")) return;
            start(async () => {
              const r = await adminJoinCode(true);
              if (r.ok) { setCode(r.code); setMsg({ ok: true, text: "New link ready. The old one no longer works." }); } else setMsg({ ok: false, text: r.error });
            });
          }}
        >
          {code ? "Make a new link" : "Create link"}
        </button>
      </div>
      <Result m={msg} />
    </div>
  );
}
