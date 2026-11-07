"use client";
import Link from "next/link";
import { DayStrip, useDaySwitch } from "@/components/day-strip";
import { GameLine } from "@/components/ui";
import { PlayerPhoto } from "@/components/player-photo";
import { PointsButton } from "@/components/points-breakdown";
import type { DayTab, PlayerDay } from "@/lib/data/days";
import type { ScoringRule } from "@/lib/scoring/engine";

export interface SidePlayer {
  playerId: string;
  name: string;
  shortName: string;
  photoUrl: string | null;
  code: string;
  pos: string;
  day: PlayerDay;
}
export interface MatchupDay {
  starters: { slot: string; group: string; home: SidePlayer | null; away: SidePlayer | null }[];
  homeBench: SidePlayer[];
  awayBench: SidePlayer[];
  homeTotal: number;
  awayTotal: number;
}

function Side({ p, align, rules, label, hidePoints }: { p: SidePlayer | null; align: "left" | "right"; rules: ScoringRule[]; label: string; hidePoints: boolean }) {
  if (!p) return <div className={`py-2 text-xs font-semibold text-gray-400 ${align === "right" ? "text-right" : ""}`}>Empty</div>;
  const v = p.day.points;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <PlayerPhoto name={p.name} photo={p.photoUrl} size={28} />
      <Link href={`/players/${p.playerId}`} className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold leading-tight"><span className="sm:hidden">{p.shortName}</span><span className="hidden sm:inline">{p.name}</span></div>
        <div className="truncate text-[11px] text-gray-500">{p.code} · {p.pos}</div>
        <div className="text-[11px]"><GameLine chips={p.day.games} compact /></div>
      </Link>
      <div className={`w-10 shrink-0 text-[14px] font-extrabold tabular-nums ${align === "right" ? "text-left" : "text-right"}`}>
        {hidePoints || v === null ? <span className="text-gray-300">–</span> : (
          <PointsButton value={v} name={p.name} photo={p.photoUrl} subtitle={label} rules={rules} games={p.day.breakdown}
            className={v < 0 ? "text-red-600" : !p.day.counted ? "text-gray-400" : ""} />
        )}
      </div>
    </div>
  );
}

/** The side-by-side lineups for one day at a time, with that day's points only. */
export function MatchupDays({
  days, initialDay, today, byDay, rules, imported, prevHref, nextHref, marks, weekLabel,
}: {
  days: DayTab[];
  initialDay: string;
  today: string;
  byDay: Record<string, MatchupDay>;
  rules: ScoringRule[];
  imported: boolean;
  prevHref: string | null;
  nextHref: string | null;
  marks: string[];
  weekLabel: string;
}) {
  const { day, select, ref } = useDaySwitch(days, initialDay);
  const d = byDay[day];
  const label = days.find((x) => x.date === day)?.label ?? day;
  const benchRows = d ? Math.max(d.homeBench.length, d.awayBench.length) : 0;
  return (
    <>
      <div className="sticky top-14 z-20 lg:static">
        <DayStrip days={days} day={day} today={today} onSelect={select} prevHref={prevHref} nextHref={nextHref} marks={marks} />
      </div>
      <div ref={ref} className="space-y-3">
        <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
            <span className="tabular-nums text-gray-900">{imported || !d ? "–" : d.homeTotal.toFixed(1)}</span>
            <span>{day < today ? `${label} lineups` : day === today ? "Today" : label}</span>
            <span className="text-right tabular-nums text-gray-900">{imported || !d ? "–" : d.awayTotal.toFixed(1)}</span>
          </div>
          {day < today && d && d.starters.every((s) => !s.home && !s.away) ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">No lineups were recorded here for {label}. Days before the league moved to Sideout were played on USportVB.</p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {(d && day < today && d.starters.every((s) => !s.home && !s.away) ? [] : d?.starters ?? []).map((s) => (
              <li key={s.slot} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2 py-2">
                <Side p={s.home} align="left" rules={rules} label={weekLabel} hidePoints={imported} />
                <span className="w-7 text-center text-[10px] font-extrabold text-gray-500">{s.group}</span>
                <Side p={s.away} align="right" rules={rules} label={weekLabel} hidePoints={imported} />
              </li>
            ))}
          </ul>
        </section>
        {d && benchRows > 0 ? (
          <section className="border-y border-gray-200 bg-white sm:rounded-xl sm:border">
            <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">Bench · doesn&apos;t count</div>
            <ul className="divide-y divide-gray-100">
              {Array.from({ length: benchRows }, (_, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-2 opacity-80">
                  <Side p={d.homeBench[i] ?? null} align="left" rules={rules} label={weekLabel} hidePoints={imported} />
                  <span className="w-8 text-center text-[10px] font-extrabold text-gray-400">BN</span>
                  <Side p={d.awayBench[i] ?? null} align="right" rules={rules} label={weekLabel} hidePoints={imported} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
