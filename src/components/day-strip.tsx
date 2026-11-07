"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DayTab } from "@/lib/data/days";

/**
 * The selected day, kept in the address bar (?day=) so a refresh or shared link opens the same
 * day. Switching days within the week is instant: everything for the week is already on the page.
 * The content slides in from the side you moved towards.
 */
export function useDaySwitch(days: readonly DayTab[], initial: string) {
  const [day, setDay] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(initial);
  useEffect(() => setDay(initial), [initial]);
  useEffect(() => {
    const from = prev.current;
    prev.current = day;
    if (from === day || !ref.current || typeof ref.current.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const dx = day > from ? 28 : -28;
    ref.current.animate(
      [{ transform: `translateX(${dx}px)`, opacity: 0.2 }, { transform: "translateX(0)", opacity: 1 }],
      { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }, [day]);
  const select = useCallback((d: string) => {
    if (!days.some((x) => x.date === d)) return;
    setDay(d);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("day", d);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address bar is a convenience; the day still changes.
    }
  }, [days]);
  return { day, select, ref };
}

const arrow = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl font-bold text-coral-600 transition active:scale-90 active:bg-coral-50";

export function DayStrip({
  days, day, today, onSelect, prevHref, nextHref, marks,
}: {
  days: readonly DayTab[];
  day: string;
  today: string;
  onSelect: (d: string) => void;
  prevHref: string | null;
  nextHref: string | null;
  /** Days to mark with a dot (e.g. days with games for these players). */
  marks?: readonly string[];
}) {
  const i = days.findIndex((d) => d.date === day);
  const cur = days[i];
  const marked = new Set(marks ?? []);
  const step = (dir: -1 | 1, href: string | null, label: string) => {
    const target = days[i + dir];
    if (target) return <button type="button" className={arrow} onClick={() => onSelect(target.date)} aria-label={label}>{dir < 0 ? "‹" : "›"}</button>;
    if (href) return <Link href={href} scroll={false} className={arrow} aria-label={label}>{dir < 0 ? "‹" : "›"}</Link>;
    return <span className={`${arrow} text-gray-300`} aria-hidden>{dir < 0 ? "‹" : "›"}</span>;
  };
  return (
    <div className="border-b border-gray-200 bg-white sm:rounded-xl sm:border">
      <div className="flex items-center justify-between px-2 pt-1">
        {step(-1, prevHref, "Previous day")}
        <span key={day} className="animate-pop text-sm font-bold text-coral-600">{cur ? (day === today ? `Today (${cur.label})` : cur.label) : day}</span>
        {step(1, nextHref, "Next day")}
      </div>
      <div className="grid grid-cols-7 gap-1 px-2 pb-2 pt-1" role="tablist" aria-label="Days">
        {days.map((d) => {
          const sel = d.date === day;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => onSelect(d.date)}
              className={`relative flex flex-col items-center rounded-lg py-1 transition duration-200 active:scale-95 ${sel ? "scale-105 bg-gray-900 text-white shadow" : "text-gray-600 hover:bg-gray-100"}`}
            >
              <span className={`text-[10px] font-bold uppercase ${sel ? "text-gray-300" : d.date === today ? "text-coral-600" : "text-gray-400"}`}>{d.date === today ? "Today" : d.weekday}</span>
              <span className="text-[15px] font-extrabold leading-tight">{d.dayNum}</span>
              <span className={`mt-0.5 h-1 w-1 rounded-full ${marked.has(d.date) ? (sel ? "bg-coral-400" : "bg-coral-500") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
