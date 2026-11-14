"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeTrade } from "@/app/actions";

interface P { id: string; name: string; pos: string | null; pts: number }

export function TradeBuilder({ myTeamId, teams, rosters, initialTeam, limit }: { myTeamId: string; teams: Array<{ id: string; name: string; manager: string }>; rosters: Record<string, P[]>; initialTeam: string; limit: number }) {
  const router = useRouter();
  const [other, setOther] = useState(initialTeam);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = rosters[myTeamId] ?? [];
  const theirs = rosters[other] ?? [];
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const myAfter = mine.length - give.length + get.length;
  const theirAfter = theirs.length - get.length + give.length;
  const over = myAfter > limit || theirAfter > limit;

  const pick = (players: P[], selected: string[], set: (v: string[]) => void) => (
    <ul className="max-h-96 space-y-1 overflow-y-auto">
      {players.map((p) => (
        <li key={p.id}>
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected.includes(p.id) ? "bg-brand-950/50" : "hover:bg-gray-50"}`}>
            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(selected, set, p.id)} className="accent-brand-500" />
            <span className="flex-1">{p.name} <span className="text-xs text-gray-500">{p.pos}</span></span>
            <span className="font-mono text-xs text-gray-500">{p.pts.toFixed(1)}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <label className="label" htmlFor="team">Trade with</label>
        <select id="team" className="input" value={other} onChange={(e) => { setOther(e.target.value); setGet([]); }}>
          <option value="">Choose a team…</option>
          {teams.filter((t) => t.id !== myTeamId).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.manager})</option>)}
        </select>
      </div>
      {other ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4"><h3 className="mb-2 text-sm font-bold">You send ({give.length})</h3>{pick(mine, give, setGive)}<p className="mt-2 text-xs text-gray-500">Your roster after: {myAfter}/{limit}</p></div>
          <div className="card p-4"><h3 className="mb-2 text-sm font-bold">You receive ({get.length})</h3>{pick(theirs, get, setGet)}<p className="mt-2 text-xs text-gray-500">Their roster after: {theirAfter}/{limit}</p></div>
        </div>
      ) : null}
      {other ? (
        <div className="card space-y-3 p-4">
          <label className="label" htmlFor="msg">Message (optional)</label>
          <textarea id="msg" className="input" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          {over ? <p className="text-sm text-amber-700">A roster would go over {limit} players. Send fewer players, or drop someone first.</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            className="btn-primary"
            disabled={pending || over || give.length + get.length === 0}
            onClick={() => start(async () => {
              const r = await proposeTrade({ fromTeam: myTeamId, toTeam: other, give, receive: get, message });
              if (r.ok) router.push("/trades");
              else setError(r.error);
            })}
          >
            {pending ? "Sending…" : "Send trade offer"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
