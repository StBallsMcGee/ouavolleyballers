/**
 * The Players tab's Leaders view: everyone ranked by fantasy points for a week or the whole
 * season, with the stats that matter for her position.
 */

export interface WeekStatRow {
  player_id: string;
  week: number;
  games: number;
  sets: number;
  kills: number;
  attack_errors: number;
  attack_attempts: number;
  assists: number;
  service_aces: number;
  service_errors: number;
  digs: number;
  solo_blocks: number;
  block_assists: number;
  points: number | string;
}

export type Totals = Omit<WeekStatRow, "player_id" | "week" | "points"> & { points: number };

const KEYS = ["games", "sets", "kills", "attack_errors", "attack_attempts", "assists", "service_aces", "service_errors", "digs", "solo_blocks", "block_assists"] as const;

/** "season" or a week number. */
export type Period = "season" | number;

export function parsePeriod(raw: string | undefined, weeks: readonly number[], fallback: Period = "season"): Period {
  if (raw === "season") return "season";
  const n = Number.parseInt((raw ?? "").replace(/^w/, ""), 10);
  return Number.isFinite(n) && weeks.includes(n) ? n : fallback;
}

/** Adds up each player's rows for the period. */
export function totalsFor(rows: readonly WeekStatRow[], period: Period): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const r of rows) {
    if (period !== "season" && r.week !== period) continue;
    let t = out.get(r.player_id);
    if (!t) {
      t = { games: 0, sets: 0, kills: 0, attack_errors: 0, attack_attempts: 0, assists: 0, service_aces: 0, service_errors: 0, digs: 0, solo_blocks: 0, block_assists: 0, points: 0 };
      out.set(r.player_id, t);
    }
    for (const k of KEYS) t[k] += Number(r[k] ?? 0);
    t.points = Math.round((t.points + Number(r.points ?? 0)) * 100) / 100;
  }
  return out;
}

export interface StatCell {
  label: string;
  value: string;
}

const perSet = (v: number, t: Totals) => (t.sets > 0 ? (v / t.sets).toFixed(2) : "–");
const hitPct = (t: Totals) => {
  if (t.attack_attempts === 0) return "–";
  const v = (t.kills - t.attack_errors) / t.attack_attempts;
  return (v < 0 ? "-" : "") + "." + String(Math.round(Math.abs(v) * 1000)).padStart(3, "0");
};
const blocks = (t: Totals) => {
  const b = t.solo_blocks + t.block_assists * 0.5;
  return Number.isInteger(b) ? String(b) : b.toFixed(1);
};

type Group = "S" | "L" | "M" | "OH";

export function positionGroup(position: string | null | undefined): Group {
  const p = (position ?? "").trim().toUpperCase();
  if (p === "S" || p.startsWith("SET")) return "S";
  if (p === "L" || p === "DS" || p.startsWith("LIB")) return "L";
  if (p === "M" || p === "MB" || p.startsWith("MID")) return "M";
  return "OH";
}

/** The stat strip under each player: the numbers that matter for her position. */
export function statCells(position: string | null | undefined, t: Totals): StatCell[] {
  const c = (label: string, value: string | number): StatCell => ({ label, value: String(value) });
  const head = [c("GP", t.games), c("Sets", t.sets)];
  switch (positionGroup(position)) {
    case "S":
      return [...head, c("A", t.assists), c("A/S", perSet(t.assists, t)), c("D", t.digs), c("K", t.kills), c("SA", t.service_aces), c("BLK", blocks(t)), c("SE", t.service_errors)];
    case "L":
      return [...head, c("D", t.digs), c("D/S", perSet(t.digs, t)), c("A", t.assists), c("SA", t.service_aces), c("SE", t.service_errors)];
    case "M":
      return [...head, c("K", t.kills), c("K/S", perSet(t.kills, t)), c("HIT%", hitPct(t)), c("BLK", blocks(t)), c("BS", t.solo_blocks), c("BA", t.block_assists), c("TA", t.attack_attempts), c("SA", t.service_aces)];
    default:
      return [...head, c("K", t.kills), c("K/S", perSet(t.kills, t)), c("HIT%", hitPct(t)), c("E", t.attack_errors), c("TA", t.attack_attempts), c("D", t.digs), c("SA", t.service_aces), c("BLK", blocks(t))];
  }
}

export const STAT_KEY_HELP = "GP games · K kills · K/S kills per set · HIT% hitting · E attack errors · TA attempts · A assists · A/S assists per set · D digs · D/S digs per set · SA aces · SE service errors · BLK blocks (solo + half of assisted) · BS solo · BA assisted";
