/**
 * Third statistics source: box scores on the OUA website (oua.ca, PrestoSports). Covers every
 * OUA school, including the ones without SIDEARM sites (Trent, Ottawa, Lakehead).
 *
 * Politeness: robots.txt allows /sports/ pages for everyone with a 10-second crawl delay and
 * disallows /action/ (the live-update feed), which is never used here.
 */
import type { BoxPlayerLine, BoxScore } from "./sidearm-boxscore";
import { nameKey, textOf } from "./sidearm";

export const OUA_BASE = "https://oua.ca";
export const OUA_CRAWL_DELAY_MS = 10_000;

/** "2026-27" for a season starting in 2026. */
export function ouaSeason(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export interface OuaScheduleEntry {
  date: string; // YYYY-MM-DD (from the box score's file name)
  away: string;
  home: string;
  boxScoreUrl: string; // absolute
}

/** Games on the OUA schedule page that have a box score. */
export function parseOuaSchedule(html: string): OuaScheduleEntry[] {
  const out: OuaScheduleEntry[] = [];
  for (const card of html.split(/<div class="card w-100 event-row/).slice(1)) {
    const block = card.slice(0, 15000);
    const box = block.match(/data-boxscore="([^"]*\/boxscores\/(\d{4})(\d{2})(\d{2})_[0-9a-z]+\.xml)"/i);
    if (!box) continue;
    const name = (side: "away" | "home") =>
      textOf(block.match(new RegExp(`event-team-name ${side}-team[\\s\\S]*?<span class="team-name">([\\s\\S]*?)</span>`))?.[1]) ?? "";
    const away = name("away");
    const home = name("home");
    if (!away || !home) continue;
    out.push({ date: `${box[2]}-${box[3]}-${box[4]}`, away, home, boxScoreUrl: new URL(box[1]!, OUA_BASE).toString() });
  }
  return out;
}

const COLS: Record<string, keyof Omit<BoxPlayerLine, "name" | "jersey">> = {
  sp: "sets", k: "kills", e: "attackErrors", ta: "attackAttempts", a: "assists", sa: "serviceAces", se: "serviceErrors",
  digs: "digs", d: "digs", bs: "soloBlocks", ba: "blockAssists",
};

/** Player statistics from an OUA box score page ("<Team> player statistics" tables). */
export function parseOuaBoxScore(html: string): BoxScore {
  const teams: BoxScore["teams"] = [];
  for (const m of html.matchAll(/<table[^>]*>\s*<caption[^>]*>([^<]*?) player statistics<\/caption>([\s\S]*?)<\/table>/g)) {
    const caption = textOf(m[1]) ?? "";
    const body = m[2]!;
    // Column order from the header row (by abbreviation), so a reordered table still reads right.
    const headRow = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => r[1]!).find((r) => /col-head/.test(r) && />Player</.test(r));
    if (!headRow) continue;
    const heads = [...headRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((h) => (textOf(h[1]) ?? "").toLowerCase()).slice(1);
    const players: BoxPlayerLine[] = [];
    for (const r of body.matchAll(/<tr(?![^>]*class="[^"]*(?:totals|group-head))[^>]*>\s*<th scope="row"[^>]*>([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/g)) {
      const head = r[1]!;
      const playerName = textOf(head.match(/class="player-name"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
      if (!playerName) continue;
      const jersey = Number(textOf(head.match(/class="uniform[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]) ?? NaN);
      const cells = [...r[2]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1]) ?? "");
      const line: BoxPlayerLine = { name: playerName, jersey: Number.isFinite(jersey) ? jersey : null, sets: null, kills: 0, attackErrors: 0, attackAttempts: 0, assists: 0, serviceAces: 0, serviceErrors: 0, soloBlocks: 0, blockAssists: 0, digs: 0 };
      heads.forEach((h, i) => {
        const key = COLS[h];
        if (!key) return;
        const v = Number(cells[i]);
        if (key === "sets") line.sets = cells[i] === "" || !Number.isFinite(v) ? null : v;
        else line[key] = Number.isFinite(v) ? v : 0;
      });
      players.push(line);
    }
    if (players.length) teams.push({ caption, players });
  }
  return { date: null, teams };
}

/** OUA writes team names as our full name or short code ("Toronto", "TMU", "Queen's"): exact match only. */
export function ouaTeamMatches(team: string, university: { name: string; short_name: string | null }): boolean {
  const t = nameKey(team);
  return t === nameKey(university.name) || (!!university.short_name && t === nameKey(university.short_name));
}
