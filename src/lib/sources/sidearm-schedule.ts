/**
 * A team's full season from its SIDEARM schedule page: every game with its date, start time,
 * opponent, home/away, result and box score link. Used for guest players from men's teams, whose
 * games aren't in the women's schedule feed.
 */
import { textOf } from "./sidearm";

export interface SidearmGame {
  gameId: string;
  date: string; // YYYY-MM-DD
  /** Local start time "HH:MM" (24 h), or null when the page doesn't give one. */
  time: string | null;
  opponent: string;
  /** true = home, false = away, null = neutral / unknown. */
  home: boolean | null;
  /** An OUA league game (exhibitions and alumni games aren't). */
  conference: boolean;
  final: boolean;
  /** Sets won / lost by this team (final games). */
  setsFor: number | null;
  setsAgainst: number | null;
  boxScoreUrl: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function to24h(t: string): string | null {
  const m = t.replace(/\s+/g, "").toUpperCase().match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** `seasonStartYear` = 2026 for the 2026-27 season (Aug-Dec in 2026, Jan-Jul in 2027). */
export function parseSidearmFullSchedule(html: string, pageUrl: string, seasonStartYear: number): SidearmGame[] {
  const out: SidearmGame[] = [];
  for (const item of html.split(/<li class="sidearm-schedule-game /).slice(1)) {
    const block = item.slice(0, 14000);
    const gameId = block.match(/data-game-id="(\d+)"/)?.[1];
    const dateText = textOf(block.match(/class="sidearm-schedule-game-opponent-date[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]) ?? "";
    const d = dateText.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/);
    if (!gameId || !d) continue;
    const month = MONTHS[d[1]!.toLowerCase()];
    if (!month) continue;
    const year = month >= 8 ? seasonStartYear : seasonStartYear + 1;
    const head = block.slice(0, 200);
    const final = /sidearm-schedule-game-completed/.test(head) || /sidearm-schedule-game-result-final/.test(block.slice(0, 3000));
    const timeText = textOf(block.match(/class="sidearm-schedule-game-time[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]) ?? "";
    const result = (textOf(block.match(/class="sidearm-schedule-game-result(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/)?.[1]) ?? "")
      .match(/\b([WLT])\s*,\s*(\d)\s*-\s*(\d)/);
    let setsFor: number | null = null;
    let setsAgainst: number | null = null;
    if (result) {
      const hi = Math.max(Number(result[2]), Number(result[3]));
      const lo = Math.min(Number(result[2]), Number(result[3]));
      [setsFor, setsAgainst] = result[1] === "W" ? [hi, lo] : result[1] === "L" ? [lo, hi] : [Number(result[2]), Number(result[3])];
    }
    const box = block.match(/href="([^"]*\/boxscore\/[^"]+)"/)?.[1];
    out.push({
      gameId,
      date: `${year}-${String(month).padStart(2, "0")}-${d[2]!.padStart(2, "0")}`,
      time: to24h(timeText),
      opponent: textOf(block.match(/class="sidearm-schedule-game-opponent-name[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]) ?? "",
      home: /sidearm-schedule-home-game/.test(head) ? true : /sidearm-schedule-away-game/.test(head) ? false : null,
      conference: />\s*OUA\s*</.test(block),
      final,
      setsFor,
      setsAgainst,
      boxScoreUrl: box ? new URL(box.replace(/&amp;/g, "&"), pageUrl).toString() : null,
    });
  }
  return out;
}
