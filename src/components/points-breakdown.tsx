"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { scoreBreakdown, sumPoints, type ScoringRule, type StatLine } from "@/lib/scoring/engine";
import { PlayerPhoto } from "@/components/player-photo";

export interface BreakdownGame {
  label: string; // "Fri vs WAT"
  date: string; // "2026-11-06"
  line: StatLine;
  points: number;
  counted: boolean; // false = she was on the bench, so the points didn't count
}

function fmt(n: number) {
  return Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100);
}

/**
 * The player's points as a tappable number. Tapping opens a card with every scoring action:
 * category, points per action, how many, and the points earned, game by game or for the week.
 */
export function PointsButton({
  value, name, photo, subtitle, games, rules, className = "",
}: {
  value: number;
  name: string;
  photo?: string | null;
  subtitle: string;
  games: BreakdownGame[];
  rules: ScoringRule[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tab, setTab] = useState(0); // 0 = all games (when several), else game index + 1
  // Play the closing animation, then remove the card.
  const close = () => {
    setClosing(true);
    timer.current = setTimeout(() => { setOpen(false); setClosing(false); }, 170);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const several = games.length > 1;
  const shown = !several ? games : tab === 0 ? games : [games[tab - 1]!];
  // Add up the chosen games' statistics, then score them category by category.
  const total: StatLine = {};
  for (const g of shown) for (const [k, v] of Object.entries(g.line)) if (typeof v === "number") (total as Record<string, number>)[k] = ((total as Record<string, number>)[k] ?? 0) + v;
  const rows = scoreBreakdown(total, rules).filter((r) => r.count !== 0);
  const sum = sumPoints(shown.map((g) => g.points));
  const benchOnly = shown.length > 0 && shown.every((g) => !g.counted);

  return (
    <>
      <button type="button" onClick={() => { setTab(0); setOpen(true); }} className={`tabular-nums underline decoration-gray-300 decoration-dotted underline-offset-4 ${className}`} aria-label={`${name}: ${fmt(value)} points, show breakdown`}>
        {value.toFixed(1)}
      </button>
      {open ? createPortal(
        // Rendered at the top of the page so it never inherits the row's layout or alignment.
        <div className="fixed inset-0 z-[60] flex items-end justify-center text-left sm:items-center" role="dialog" aria-modal="true" aria-label={`${name} points breakdown`}>
          <button className={`absolute inset-0 bg-black/50 ${closing ? "animate-fade-out" : "animate-fade-in"}`} aria-label="Close" onClick={close} />
          <div className={`relative mx-3 w-full max-w-md ${closing ? "animate-pop-out" : "animate-pop"}`} style={{ transformOrigin: "50% 80%" }}>
          <div className="relative mb-[calc(env(safe-area-inset-bottom)+12px)] rounded-2xl bg-surface pt-12 shadow-2xl sm:mb-0">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-surface p-1 shadow">
              <PlayerPhoto name={name} photo={photo} size={80} />
            </div>
            <button className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-2xl leading-none text-gray-500 hover:bg-gray-100" aria-label="Close" onClick={close}>×</button>
            <div className="px-5 text-center">
              <h2 className="text-xl font-extrabold">{name}</h2>
              <p className="text-sm text-gray-500">{several && tab === 0 ? `${subtitle} · ${games.length} games` : `${subtitle}${shown[0] ? ` · ${shown[0].label}` : ""}`}</p>
            </div>
            {several ? (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 px-4">
                {["All", ...games.map((g) => g.label)].map((l, i) => (
                  <button key={l + i} onClick={() => setTab(i)} className={`rounded-full px-3 py-1 text-xs font-bold transition-colors duration-200 ${tab === i ? "bg-gold-400 text-charcoal" : "bg-surface-3 text-gray-700"}`}>{l}</button>
                ))}
              </div>
            ) : null}
            {games.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No stats recorded yet this week.</p>
            ) : (
              <table className="mt-3 w-full table-fixed text-sm">
                <thead>
                  <tr className="border-y border-gray-200 text-[11px] font-extrabold uppercase tracking-wide text-gray-800">
                    <th className="py-2.5 pl-5 text-left">Scoring category</th>
                    <th className="w-16 py-2.5 text-right">Pts per</th>
                    <th className="w-12 py-2.5 text-right">#</th>
                    <th className="w-20 py-2.5 pr-5 text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="py-4 text-center text-gray-500">No scoring actions.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.statKey}>
                      <td className="py-3 pl-5">{r.label}</td>
                      <td className="py-3 text-right text-gray-600">{r.pointsEach}</td>
                      <td className="py-3 text-right text-gray-600">{r.count}</td>
                      <td className={`py-3 pr-5 text-right font-bold ${r.points < 0 ? "text-red-600" : ""}`}>{fmt(r.points)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td colSpan={3} className="rounded-bl-2xl py-3 pl-5 font-extrabold">TOTAL{benchOnly ? <span className="ml-2 text-xs font-semibold text-amber-700">on bench, didn&apos;t count</span> : null}</td>
                    <td className={`rounded-br-2xl py-3 pr-5 text-right text-base font-extrabold ${sum < 0 ? "text-red-600" : ""}`}>{fmt(sum)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
