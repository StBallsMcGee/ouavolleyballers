/**
 * Fantasy scoring engine.
 *
 * The database view public.v_player_match_points is the authoritative calculation used for
 * results and standings. This TypeScript version produces identical numbers and is used for
 * scoring previews ("what if we changed the rules?") and for automated tests. A database
 * test (tests/db) checks that both give the same answers.
 *
 * Fantasy points = sum over categories of (statistic count x point value).
 */

/** Core statistic columns stored for every player in every match. */
export const CORE_STAT_KEYS = [
  "kills",
  "attack_errors",
  "attack_attempts",
  "assists",
  "service_aces",
  "service_errors",
  "digs",
  "solo_blocks",
  "block_assists",
] as const;
export type CoreStatKey = (typeof CORE_STAT_KEYS)[number];

export const STAT_LABELS: Record<CoreStatKey, string> = {
  kills: "Kills",
  attack_errors: "Attack errors",
  attack_attempts: "Attack attempts",
  assists: "Assists",
  service_aces: "Aces",
  service_errors: "Service errors (missed serves)",
  digs: "Digs",
  solo_blocks: "Solo blocks",
  block_assists: "Block assists",
};

export const STAT_SHORT: Record<CoreStatKey, string> = {
  kills: "K",
  attack_errors: "E",
  attack_attempts: "TA",
  assists: "A",
  service_aces: "SA",
  service_errors: "SE",
  digs: "D",
  solo_blocks: "BS",
  block_assists: "BA",
};

export type StatLine = Partial<Record<CoreStatKey, number>> & {
  /** Extra statistics stored as other_statistics in the database. */
  other?: Record<string, number>;
};

export interface ScoringRule {
  statKey: string;
  label: string;
  points: number;
  active: boolean;
}

/**
 * Exact decimal arithmetic. Point values like 0.3 cannot be represented exactly as
 * floating-point numbers, so we calculate in thousandths and convert back at the end.
 */
const SCALE = 1000;
function toUnits(n: number): number {
  return Math.round(n * SCALE);
}

export function statValue(line: StatLine, key: string): number {
  if ((CORE_STAT_KEYS as readonly string[]).includes(key)) {
    return line[key as CoreStatKey] ?? 0; // missing statistic counts as zero
  }
  return line.other?.[key] ?? 0;
}

export interface CategoryBreakdown {
  statKey: string;
  label: string;
  count: number;
  pointsEach: number;
  points: number;
}

export function scoreBreakdown(line: StatLine, rules: readonly ScoringRule[]): CategoryBreakdown[] {
  return rules
    .filter((r) => r.active)
    .map((r) => {
      const count = statValue(line, r.statKey);
      return {
        statKey: r.statKey,
        label: r.label,
        count,
        pointsEach: r.points,
        points: (toUnits(r.points) * count) / SCALE,
      };
    });
}

/** Fantasy points for one player's stat line under one rule set (rounded to 2 decimals). */
export function scoreStatLine(line: StatLine, rules: readonly ScoringRule[]): number {
  let units = 0;
  for (const r of rules) {
    if (!r.active) continue;
    units += toUnits(r.points) * statValue(line, r.statKey);
  }
  return roundPoints(units / SCALE);
}

export function roundPoints(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumPoints(values: readonly number[]): number {
  return roundPoints(values.reduce((acc, v) => acc + toUnits(v), 0) / SCALE);
}

/* ------------------------------------------------------------------------------------------
 * Versioned rule sets
 * ---------------------------------------------------------------------------------------- */

export interface RuleSetVersion {
  version: number;
  effectiveFromWeek: number;
  rules: ScoringRule[];
}

/**
 * The rule set in force for a given week: the one with the latest effective week that is not
 * after the given week (ties broken by the higher version). Mirrors the database view.
 */
export function ruleSetForWeek(sets: readonly RuleSetVersion[], week: number): RuleSetVersion | null {
  let best: RuleSetVersion | null = null;
  for (const s of sets) {
    if (s.effectiveFromWeek > week) continue;
    if (
      !best ||
      s.effectiveFromWeek > best.effectiveFromWeek ||
      (s.effectiveFromWeek === best.effectiveFromWeek && s.version > best.version)
    ) {
      best = s;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------
 * Team scoring with lineup history (mirrors v_team_player_match_points)
 * ---------------------------------------------------------------------------------------- */

export interface MatchInfo {
  id: string;
  week: number | null; // null = outside any fantasy week (not scored)
  lockAt: Date;
  countsForFantasy: boolean;
  cancelled?: boolean;
}

export interface Interval {
  from: Date;
  to: Date | null;
}

export interface RosterSpell extends Interval {
  teamId: string;
  playerId: string;
  /** Slot history while on this team. */
  slots: Array<Interval & { slot: string }>;
}

export interface PlayerMatchStat {
  playerId: string;
  matchId: string;
  line: StatLine;
}

export interface TeamPlayerMatchPoints {
  teamId: string;
  playerId: string;
  matchId: string;
  week: number;
  slot: string;
  counted: boolean;
  points: number;
  scoringVersion: number;
}

function covers(i: Interval, t: Date): boolean {
  return i.from.getTime() <= t.getTime() && (i.to === null || i.to.getTime() > t.getTime());
}

/**
 * Credits each player's match points to the fantasy team that had them at the moment the match
 * locked, and marks them counted only if the player was in a starting slot at that moment.
 * Because stats are keyed by (player, match), re-importing a match can never double count.
 */
export function creditTeamPoints(
  stats: readonly PlayerMatchStat[],
  matches: ReadonlyMap<string, MatchInfo>,
  spells: readonly RosterSpell[],
  ruleSets: readonly RuleSetVersion[],
): TeamPlayerMatchPoints[] {
  const seen = new Set<string>();
  const out: TeamPlayerMatchPoints[] = [];
  for (const s of stats) {
    const key = `${s.playerId}:${s.matchId}`;
    if (seen.has(key)) continue; // duplicate stat rows are ignored, never added twice
    seen.add(key);
    const m = matches.get(s.matchId);
    if (!m || m.week === null || !m.countsForFantasy || m.cancelled) continue;
    const rs = ruleSetForWeek(ruleSets, m.week);
    if (!rs) continue;
    const spell = spells.find((sp) => sp.playerId === s.playerId && covers(sp, m.lockAt));
    if (!spell) continue;
    const slot = spell.slots.find((sl) => covers(sl, m.lockAt));
    if (!slot) continue;
    out.push({
      teamId: spell.teamId,
      playerId: s.playerId,
      matchId: s.matchId,
      week: m.week,
      slot: slot.slot,
      counted: slot.slot !== "BENCH",
      points: scoreStatLine(s.line, rs.rules),
      scoringVersion: rs.version,
    });
  }
  return out;
}

/** Weekly totals per team (starters only). */
export function teamWeekTotals(credited: readonly TeamPlayerMatchPoints[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const c of credited) {
    if (!c.counted) continue;
    const k = `${c.teamId}:${c.week}`;
    units.set(k, (units.get(k) ?? 0) + toUnits(c.points));
  }
  const out = new Map<string, number>();
  for (const [k, u] of units) out.set(k, roundPoints(u / SCALE));
  return out;
}
