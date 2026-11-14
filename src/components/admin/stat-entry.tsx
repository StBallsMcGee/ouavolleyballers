"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminSaveMatchStats } from "@/app/actions";

const FIELDS = [
  ["kills", "K", "Kills"],
  ["attack_errors", "E", "Attack errors"],
  ["attack_attempts", "TA", "Attempts"],
  ["assists", "A", "Assists"],
  ["service_aces", "SA", "Aces"],
  ["service_errors", "SE", "Serve errors"],
  ["digs", "D", "Digs"],
  ["solo_blocks", "BS", "Solo blocks"],
  ["block_assists", "BA", "Block assists"],
  ["sets_played", "Sets", "Sets played"],
] as const;
type Key = (typeof FIELDS)[number][0];
type Values = Partial<Record<Key, number | null>>;

export interface StatEntryPlayer {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
  source: string | null; // where the current numbers came from, if any
  values: Values | null;
}

const SOURCE_LABEL: Record<string, string> = { usportvb: "USportVB", "school-boxscore": "school box score", manual: "typed in" };

export function StatEntryForm({ matchId, teams }: { matchId: string; teams: { name: string; players: StatEntryPlayer[] }[] }) {
  const router = useRouter();
  const initial = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, Object.fromEntries(FIELDS.map(([k]) => [k, p.values?.[k] ?? ""]))])) as Record<string, Record<Key, number | "">>;
  const [vals, setVals] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const all = teams.flatMap((t) => t.players);
  const changed = all.filter((p) => FIELDS.some(([k]) => vals[p.id]![k] !== initial[p.id]![k]));
  const isEmpty = (id: string) => FIELDS.every(([k]) => vals[id]![k] === "" || (k !== "sets_played" && vals[id]![k] === 0));

  const save = () => {
    const rows = changed.flatMap((p): Record<string, unknown>[] => {
      if (isEmpty(p.id)) return p.source === "manual" ? [{ player_id: p.id, remove: true }] : [];
      const v = vals[p.id]!;
      return [{
        player_id: p.id,
        ...Object.fromEntries(FIELDS.filter(([k]) => k !== "sets_played").map(([k]) => [k, v[k] === "" ? 0 : Number(v[k])])),
        sets_played: v.sets_played === "" ? null : Number(v.sets_played),
      }];
    });
    if (rows.length === 0) return setMsg({ ok: false, text: "Nothing to save yet." });
    start(async () => {
      const r = await adminSaveMatchStats(matchId, rows);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3 pb-24">
      {teams.map((t) => (
        <section key={t.name} className="mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
          <h2 className="border-b border-gray-100 px-4 py-2.5 text-[13px] font-extrabold uppercase tracking-wide text-gray-800">{t.name}</h2>
          {t.players.length === 0 ? <p className="px-4 py-3 text-sm text-gray-500">No players on file for this team.</p> : null}
          <ul className="divide-y divide-gray-100">
            {t.players.map((p) => {
              const v = vals[p.id]!;
              const summary = FIELDS.filter(([k]) => v[k] !== "" && v[k] !== 0).map(([k, short]) => `${v[k]} ${short}`).join(" · ");
              const isOpen = open === p.id;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50">
                    <span className="w-7 shrink-0 text-center text-xs font-bold text-gray-400">{p.jersey ?? "–"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{p.name}</span>
                      <span className="block truncate text-xs text-gray-500">{summary || "Didn't play / not entered"}{p.source ? ` · from ${SOURCE_LABEL[p.source] ?? p.source}` : ""}</span>
                    </span>
                    <span className={`text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {isOpen ? (
                    <div className="grid animate-grow grid-cols-5 gap-2 px-4 pb-3">
                      {FIELDS.map(([k, short, label]) => (
                        <label key={k} className="block text-center">
                          <span className="block text-[10px] font-bold uppercase text-gray-500" title={label}>{short}</span>
                          <input
                            className="input px-1 py-1.5 text-center tabular-nums"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={k === "sets_played" ? 5 : 300}
                            value={v[k]}
                            aria-label={`${p.name} ${label}`}
                            onChange={(e) => setVals({ ...vals, [p.id]: { ...v, [k]: e.target.value === "" ? "" : Math.max(0, Math.floor(Number(e.target.value))) } })}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-surface/95 px-4 py-2.5 backdrop-blur lg:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <div className="min-w-0 flex-1 text-xs">
            {msg ? <span className={`font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span> : <span className="text-gray-600">{changed.length ? `${changed.length} player${changed.length > 1 ? "s" : ""} changed` : "Tap a player to enter her numbers"}</span>}
          </div>
          <button className="btn-primary min-h-[36px] px-5 py-1" onClick={save} disabled={pending || changed.length === 0}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
