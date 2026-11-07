/**
 * Official box scores on the schools' SIDEARM websites: a second statistics source used when
 * USportVB has not (yet) recorded a finished game. Verified 7 Nov 2026: for Western v Windsor
 * (31 Oct) all 21 players' statistics matched USportVB exactly.
 *
 * Politeness: robots.txt allows these pages with a 30-second crawl delay, so the sync makes at
 * most one request per school site per run (runs are 30 minutes apart).
 */
import { nameKey, textOf } from "./sidearm";

export interface ScheduleEntry {
  date: string; // YYYY-MM-DD
  opponent: string;
  boxScoreUrl: string; // absolute
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Schedule page entries that already have a box score. `seasonStartYear` = 2026 for 2026-27. */
export function parseSidearmSchedule(html: string, pageUrl: string, seasonStartYear: number): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  for (const item of html.split(/<li class="sidearm-schedule-game /).slice(1)) {
    const block = item.slice(0, 12000);
    const box = block.match(/href="([^"]*\/boxscore\/[^"]+)"/)?.[1];
    if (!box) continue;
    const dateText = textOf(block.match(/class="sidearm-schedule-game-opponent-date[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]) ?? "";
    const m = dateText.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/);
    if (!m) continue;
    const month = MONTHS[m[1]!.toLowerCase()];
    if (!month) continue;
    const year = month >= 8 ? seasonStartYear : seasonStartYear + 1;
    out.push({
      date: `${year}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`,
      opponent: textOf(block.match(/class="sidearm-schedule-game-opponent-name[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]) ?? "",
      boxScoreUrl: new URL(box.replace(/&amp;/g, "&"), pageUrl).toString(),
    });
  }
  return out;
}

export interface BoxPlayerLine {
  name: string; // "First Last"
  jersey: number | null;
  sets: number | null;
  kills: number;
  attackErrors: number;
  attackAttempts: number;
  assists: number;
  serviceAces: number;
  serviceErrors: number;
  soloBlocks: number;
  blockAssists: number;
  digs: number;
}

export interface BoxScore {
  date: string | null; // YYYY-MM-DD
  teams: Array<{ caption: string; players: BoxPlayerLine[] }>;
}

function num(v: string | undefined): number {
  const n = Number.parseInt((v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reads the "<TEAM> - Individual" tables. Columns (SIDEARM volleyball box score):
 * #, Player, SP, K, E, TA, Pct, A, (set) E, SA, SE, SA-SE, BS, BA, BE, DIG, BHE, RE, Pts
 */
export function parseSidearmBoxScore(html: string): BoxScore {
  const dm = html.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/);
  const date = dm ? `${dm[3]}-${dm[1]!.padStart(2, "0")}-${dm[2]!.padStart(2, "0")}` : null;
  const teams: BoxScore["teams"] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<caption>([^<]+?) - Individual/g)) {
    const caption = m[1]!.trim();
    if (seen.has(caption)) continue; // each table appears twice (desktop and phone versions)
    const start = html.lastIndexOf("<table", m.index);
    const table = html.slice(start, html.indexOf("</table>", m.index));
    const body = table.split("<tbody")[1] ?? "";
    const players: BoxPlayerLine[] = [];
    for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const c = [...row[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((x) => textOf(x[1]) ?? "");
      if (c.length < 19) continue; // the narrow phone table has fewer columns
      const who = c[1]!.match(/^(\d+)\s+(.+)$/);
      if (!who) continue; // "Totals" and team rows
      let name = who[2]!;
      const comma = name.match(/^(.+?),\s*(.+)$/);
      if (comma) name = `${comma[2]} ${comma[1]}`; // "Buntic, Emma" -> "Emma Buntic"
      players.push({
        name,
        jersey: num(who[1]),
        sets: c[2] ? num(c[2]) : null,
        kills: num(c[3]),
        attackErrors: num(c[4]),
        attackAttempts: num(c[5]),
        assists: num(c[7]),
        serviceAces: num(c[9]),
        serviceErrors: num(c[10]),
        soloBlocks: num(c[12]),
        blockAssists: num(c[13]),
        digs: num(c[15]),
      });
    }
    if (players.length) {
      seen.add(caption);
      teams.push({ caption, players });
    }
  }
  return { date, teams };
}

/** Does a box score team caption ("WESTERN", "QUEEN'S", "TORONTO METROPOLITAN") refer to this university? */
export function captionMatches(caption: string, university: { name: string; short_name: string | null }): boolean {
  const c = nameKey(caption);
  const n = nameKey(university.name);
  const s = nameKey(university.short_name ?? "");
  return c === n || (s.length > 1 && c === s) || (n.length > 3 && (c.startsWith(n) || n.startsWith(c)));
}
