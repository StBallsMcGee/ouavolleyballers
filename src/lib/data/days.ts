import type { BreakdownGame } from "@/components/points-breakdown";
import type { GameLineChip } from "@/components/ui";
import { addDays, endOfDayIso, formatDate } from "@/lib/time";
import type { WeekRow } from "./context";

/** One calendar day in the day picker. */
export interface DayTab {
  date: string; // "2026-11-05"
  label: string; // "Thu, Nov 5"
  weekday: string; // "Thu"
  dayNum: string; // "5"
}

/** What one player did on one day: only that day's points, never a running total. */
export interface PlayerDay {
  points: number | null; // null = no stats that day (no game, or it hasn't been played)
  counted: boolean; // true when the points went to the fantasy team (she was in the lineup)
  games: GameLineChip[];
  breakdown: BreakdownGame[];
  /** Projected points for games that day that haven't been played yet (null if none). */
  projected: number | null;
}

/** The Monday of the Monday–Sunday week containing the date. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The seven days (Monday to Sunday) of the week containing the date. */
export function daysOfWeek(date: string): DayTab[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return {
      date: d,
      label: formatDate(d, { weekday: "short", month: "short", day: "numeric" }),
      weekday: formatDate(d, { weekday: "short" }),
      dayNum: formatDate(d, { day: "numeric" }),
    };
  });
}

export function weekContaining(weeks: readonly WeekRow[], date: string): WeekRow | null {
  return weeks.find((w) => w.starts_on <= date && date <= w.ends_on) ?? null;
}

/** Links to the previous/next week's days, kept inside the season. */
export function weekLinks(weeks: readonly WeekRow[], date: string, path: string) {
  const monday = mondayOf(date);
  const first = weeks[0]?.starts_on;
  const last = weeks[weeks.length - 1]?.ends_on;
  const prev = addDays(monday, -1);
  const next = addDays(monday, 7);
  return {
    prevHref: first && prev >= first ? `${path}?day=${prev}` : null,
    nextHref: last && next <= last ? `${path}?day=${next}` : null,
  };
}

/**
 * The moment a day's lineup is read from history: the end of that day for past days (so it shows
 * the lineup that actually played), or right now for today and later.
 */
export function lineupMomentFor(date: string, today: string, tz: string): string {
  return date < today ? endOfDayIso(date, tz) : new Date().toISOString();
}

/** One player's day: points from that day's games only, and the game line for that day. */
export function playerDay(breakdown: readonly BreakdownGame[], date: string, games: GameLineChip[], projPerGame: number | null = null): PlayerDay {
  const that = breakdown.filter((g) => g.date === date);
  const upcoming = games.filter((g) => g.tone === "today" || g.tone === "upcoming" || g.tone === "live").length;
  const projected = that.length === 0 && upcoming > 0 && projPerGame !== null ? Math.round(projPerGame * upcoming * 10) / 10 : null;
  if (that.length === 0) return { points: null, counted: false, games, breakdown: [], projected };
  const points = Math.round(that.reduce((a, g) => a + g.points, 0) * 100) / 100;
  return { points, counted: that.some((g) => g.counted), games, breakdown: that, projected: null };
}

/** Projected points still to come that day for these players (lineup players only). */
export function projectedTotal(days: readonly PlayerDay[]): number {
  return Math.round(days.reduce((a, d) => a + (d.projected ?? 0), 0) * 10) / 10;
}

/** Points that went to the team that day (only lineup players count). */
export function countedTotal(days: readonly PlayerDay[]): number {
  return Math.round(days.reduce((a, d) => a + (d.counted && d.points !== null ? d.points : 0), 0) * 100) / 100;
}
