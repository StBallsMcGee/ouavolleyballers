import type { GameLineChip } from "@/components/ui";
import type { MatchRow, University } from "./queries";
import { LEAGUE_TZ } from "@/lib/time";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short" });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_TZ, hour: "numeric", minute: "2-digit" });

function day(iso: string) {
  return dayFmt.format(new Date(`${iso}T12:00:00Z`));
}

export interface WeekRange {
  starts_on: string;
  ends_on: string;
}

/**
 * Game chips for one university: every game in the given fantasy week, or "BYE" (plus the next
 * game) when they don't play that week. Times are shown in Toronto time.
 */
function chipMaker(universityId: string, matches: readonly MatchRow[], unis: ReadonlyMap<string, University>, today: string) {
  const mine = matches
    .filter((m) => (m.home_university_id === universityId || m.away_university_id === universityId) && m.status !== "cancelled")
    .sort((a, b) => a.match_date.localeCompare(b.match_date) || (a.start_time ?? a.lock_at).localeCompare(b.start_time ?? b.lock_at));
  const opp = (m: MatchRow) => {
    const isHome = m.home_university_id === universityId;
    const other = unis.get(isHome ? m.away_university_id : m.home_university_id);
    const code = other?.short_name ?? other?.name ?? "?";
    return `${m.home_away_known && !isHome ? "@" : "vs"} ${code}`;
  };
  const chip = (m: MatchRow): GameLineChip => {
    if (m.status === "live") return { text: `LIVE ${opp(m)}`, tone: "live" };
    if (m.status === "postponed") return { text: `PPD ${opp(m)}`, tone: "final" };
    if (m.status === "final") {
      const isHome = m.home_university_id === universityId;
      const us = isHome ? m.home_sets : m.away_sets;
      const them = isHome ? m.away_sets : m.home_sets;
      if (us !== null && them !== null && m.home_away_known) return { text: `${us > them ? "W" : "L"} ${us}-${them} ${opp(m)}`, tone: "final" };
      return { text: `${day(m.match_date)} Final ${opp(m)}`, tone: "final" };
    }
    const time = m.start_time ? timeFmt.format(new Date(m.start_time)) : "TBD";
    if (m.match_date === today) return { text: `Today ${time} ${opp(m)}`, tone: "today" };
    return { text: `${day(m.match_date)} ${time} ${opp(m)}`, tone: "upcoming" };
  };
  return { mine, opp, chip };
}

export function gameChips(
  universityId: string | null,
  matches: readonly MatchRow[],
  unis: ReadonlyMap<string, University>,
  week: WeekRange | null,
  today: string,
): GameLineChip[] {
  if (!universityId) return [];
  const { mine, opp, chip } = chipMaker(universityId, matches, unis, today);
  if (!week) {
    const next = mine.find((m) => m.match_date >= today);
    return next ? [chip(next)] : [];
  }
  const inWeek = mine.filter((m) => m.match_date >= week.starts_on && m.match_date <= week.ends_on);
  if (inWeek.length > 0) return inWeek.map(chip);
  const next = mine.find((m) => m.match_date > week.ends_on);
  return [{ text: "BYE", tone: "bye" }, ...(next ? [{ text: `Next ${dateFmt.format(new Date(`${next.match_date}T12:00:00Z`))} ${opp(next)}`, tone: "upcoming" as const }] : [])];
}

/**
 * Game chips for one calendar day: the game(s) that day with the result or start time,
 * or "No game" when the university doesn't play that day.
 */
export function dayChips(
  universityId: string | null,
  matches: readonly MatchRow[],
  unis: ReadonlyMap<string, University>,
  date: string,
  today: string,
): GameLineChip[] {
  if (!universityId) return [];
  const { mine, chip } = chipMaker(universityId, matches, unis, today);
  const that = mine.filter((m) => m.match_date === date);
  if (that.length === 0) return [{ text: "No game", tone: "none" }];
  return that.map((m) => {
    const c = chip(m);
    // The day is already in the header: drop the weekday prefix ("Fri 7:00 PM" -> "7:00 PM").
    return { ...c, text: c.text.replace(/^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?=\d|TBD|Final)/, "") };
  });
}

/** True when the university has no game in the week. */
export function isBye(chips: readonly GameLineChip[]): boolean {
  return chips[0]?.tone === "bye";
}
