"use client";
import { useState } from "react";

// Validated categorical slots (blue = per-game points, orange = 3-game average) and text tokens.
const BLUE = "#2a78d6";
const BLUE_HOVER = "#5598e7";
const ORANGE = "#eb6834";
const RED = "#e34948";
const GRID = "#e5e7eb";
const MUTED = "#6b7280";

export interface TrendGame {
  date: string; // "Nov 7"
  opp: string; // "vs TMU"
  pts: number;
  summary: string; // "12 K · 8 D · 1 SA"
}

function niceMax(v: number) {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

/**
 * Points in each game (bars) with the 3-game rolling average (line). Tap or hover a bar for
 * that game's details. The game log below the chart lists every value, so nothing needs a tap.
 */
export function TrendChart({ games, seasonAvg }: { games: TrendGame[]; seasonAvg: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  if (games.length === 0) return null;
  const W = 340;
  const H = 150;
  const L = 26;
  const R = 34;
  const T = 8;
  const B = 18;
  const maxV = niceMax(Math.max(...games.map((g) => g.pts), seasonAvg ?? 0, 1));
  const minV = Math.min(0, ...games.map((g) => g.pts));
  const minNice = minV < 0 ? -niceMax(-minV) : 0;
  const y = (v: number) => T + ((maxV - v) / (maxV - minNice)) * (H - T - B);
  const slot = (W - L - R) / games.length;
  const bw = Math.max(4, Math.min(24, slot - 4));
  const x = (i: number) => L + slot * i + slot / 2;
  const rolling = games.map((_, i) => {
    const w = games.slice(Math.max(0, i - 2), i + 1);
    return w.reduce((a, g) => a + g.pts, 0) / w.length;
  });
  const ticks = [minNice, ...(minNice < 0 ? [0] : []), maxV / 2, maxV].filter((v, i, a) => a.indexOf(v) === i);
  const bar = (i: number, v: number) => {
    const x0 = x(i) - bw / 2;
    const y0 = y(0);
    const y1 = y(v);
    const r = Math.min(4, Math.abs(y1 - y0), bw / 2);
    if (Math.abs(y1 - y0) < 0.5) return "";
    // Rounded at the data end, square at the baseline.
    return v >= 0
      ? `M${x0},${y0} V${y1 + r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + bw - r} Q${x0 + bw},${y1} ${x0 + bw},${y1 + r} V${y0} Z`
      : `M${x0},${y0} V${y1 - r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + bw - r} Q${x0 + bw},${y1} ${x0 + bw},${y1 - r} V${y0} Z`;
  };
  const line = rolling.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const a = active !== null ? games[active] : null;
  const last = rolling.length - 1;

  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-gray-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BLUE }} />Points per game</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: ORANGE }} />3-game average</span>
      </div>
      <div className="h-11 text-xs" aria-live="polite">
        {a ? (
          <div className="animate-fade-in">
            <span className="text-base font-extrabold tabular-nums text-gray-900">{a.pts.toFixed(1)}</span>
            <span className="ml-1.5 font-semibold text-gray-700">{a.date} {a.opp}</span>
            <span className="ml-1.5 text-gray-500">· 3-game avg {rolling[active!]!.toFixed(1)}</span>
            <div className="truncate text-gray-500">{a.summary || "No scoring actions"}</div>
          </div>
        ) : (
          <div className="pt-1 text-gray-400">Tap a bar to see that game.</div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Fantasy points in the last ${games.length} games`} onPointerLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={L - 5} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={MUTED}>{t}</text>
          </g>
        ))}
        {seasonAvg !== null ? (
          <g>
            <line x1={L} x2={W - R} y1={y(seasonAvg)} y2={y(seasonAvg)} stroke="#9ca3af" strokeWidth={1} />
            <text x={L + 3} y={y(seasonAvg) - 3} fontSize="9" fill={MUTED}>this season&apos;s avg {seasonAvg.toFixed(1)}</text>
          </g>
        ) : null}
        {games.map((g, i) => (
          <path key={i} d={bar(i, g.pts)} fill={active === i ? BLUE_HOVER : g.pts < 0 ? RED : BLUE} className="transition-colors duration-150" />
        ))}
        <path d={line} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last)} cy={y(rolling[last]!)} r={4} fill={ORANGE} stroke="#fff" strokeWidth={2} />
        <text x={x(last) + 7} y={y(rolling[last]!) - 6} fontSize="10" fontWeight="700" fill="#111827">{rolling[last]!.toFixed(1)}</text>
        {active !== null ? <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} stroke="#9ca3af" strokeWidth={1} /> : null}
        <text x={x(0)} y={H - 4} textAnchor="start" fontSize="10" fill={MUTED}>{games[0]!.date}</text>
        {games.length > 1 ? <text x={x(last)} y={H - 4} textAnchor="end" fontSize="10" fill={MUTED}>{games[last]!.date}</text> : null}
        {games.map((g, i) => (
          <rect
            key={`hit${i}`}
            x={L + slot * i}
            y={T}
            width={slot}
            height={H - T - B}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${g.date} ${g.opp}: ${g.pts.toFixed(1)} points`}
            onPointerEnter={() => setActive(i)}
            onClick={() => setActive(i)}
            onFocus={() => setActive(i)}
            className="cursor-pointer outline-none"
          />
        ))}
      </svg>
    </div>
  );
}

export interface SourceRow {
  label: string;
  perGame: number; // points per game from this category
}

/** Where her points come from: each scoring category's points per game, biggest first. */
export function PointSources({ rows }: { rows: SourceRow[] }) {
  const shown = rows.filter((r) => Math.abs(r.perGame) >= 0.05).sort((a, b) => b.perGame - a.perGame);
  if (shown.length === 0) return null;
  const max = Math.max(...shown.map((r) => Math.abs(r.perGame)));
  return (
    <ul className="space-y-1.5">
      {shown.map((r) => (
        <li key={r.label} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate font-semibold text-gray-700">{r.label}</span>
          <span className="relative h-3">
            <span
              className="absolute top-0 h-3 rounded-r"
              style={{ left: 0, width: `${(Math.abs(r.perGame) / max) * 100}%`, background: r.perGame < 0 ? RED : BLUE }}
            />
          </span>
          <span className="text-right font-bold tabular-nums text-gray-900">{r.perGame > 0 ? "+" : ""}{r.perGame.toFixed(1)}</span>
        </li>
      ))}
    </ul>
  );
}
