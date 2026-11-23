"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DayTab } from "@/lib/data/days";

const STORE_PREFIX = "sideout:day:";

/** The day last chosen on this screen in this app session (sessionStorage ends when the app is closed). */
function storedDay(path: string): string | null {
  try {
    return window.sessionStorage.getItem(STORE_PREFIX + path);
  } catch {
    return null;
  }
}
function storeDay(path: string, day: string) {
  try {
    window.sessionStorage.setItem(STORE_PREFIX + path, day);
  } catch {
    // Private browsing etc.: the day just isn't remembered.
  }
}

/**
 * The selected day, kept in the address bar (?day=) so a refresh or shared link opens the same
 * day, and remembered for the rest of the app session: going to a player's page and back keeps
 * the day you were on; closing the app starts again on today. Switching days within the week is
 * instant: everything for the week is already on the page. The content slides in from the side
 * you moved towards.
 */
export function useDaySwitch(days: readonly DayTab[], initial: string) {
  const [day, setDay] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(initial);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    // Opened without a day in the address (e.g. back from a player's page, or the tab bar):
    // return to the day chosen earlier in this session.
    let urlDay: string | null = null;
    try {
      urlDay = new URL(window.location.href).searchParams.get("day");
    } catch {
      // ignore
    }
    // The day in the address wins (going back can show an earlier copy of the page built for
    // another day); otherwise the day remembered from earlier in this session.
    const want = urlDay ?? storedDay(path);
    if (want && want !== initial) {
      if (days.some((d) => d.date === want)) {
        setDay(want);
        storeDay(path, want);
        if (!urlDay) {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("day", want);
            window.history.replaceState(window.history.state, "", url);
          } catch {
            // The address bar is a convenience.
          }
        }
        return;
      }
      if (!urlDay) {
        // A day in another week: load that week.
        router.replace(`${path}?day=${want}`, { scroll: false });
        return;
      }
    }
    setDay(initial);
    storeDay(path, initial);
  }, [initial, path]);
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
    storeDay(path, d);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("day", d);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address bar is a convenience; the day still changes.
    }
  }, [days, path]);
  return { day, select, ref };
}

const arrow = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl font-bold text-gold-300 transition active:scale-90 active:bg-white/5";

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
    <div className="mx-3 rounded-2xl bg-surface/95 shadow-lg shadow-black/30 backdrop-blur sm:mx-0">
      <div className="flex items-center justify-between px-2 pt-1">
        {step(-1, prevHref, "Previous day")}
        <span key={day} className="animate-pop text-sm font-bold text-gold-300">{cur ? (day === today ? `Today (${cur.label})` : cur.label) : day}</span>
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
              className={`relative flex flex-col items-center rounded-xl py-1 transition duration-200 active:scale-95 ${sel ? "tile-gold scale-105 shadow-lg shadow-gold-500/20" : "text-gray-600 hover:bg-gray-100"}`}
            >
              <span className={`text-[10px] font-bold uppercase ${sel ? "text-charcoal/70" : d.date === today ? "text-gold-300" : "text-gray-400"}`}>{d.date === today ? "Today" : d.weekday}</span>
              <span className="text-[15px] font-extrabold leading-tight">{d.dayNum}</span>
              <span className={`mt-0.5 h-1 w-1 rounded-full ${marked.has(d.date) ? (sel ? "bg-charcoal" : "bg-gold-400") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
