import type { RosterPlayer } from "./queries";

export type CourtRole = "OH" | "M" | "S" | "L";
export interface CourtPlayer {
  id: string;
  name: string;
  photo: string | null;
  role: CourtRole;
}

/**
 * Six players for the court picture, from the team's current starters only (bench players only
 * if there are fewer than six starters), ranked by points on the last day of play, then season:
 * - four attackers: the best outside hitter and the best middle always, plus the next two
 *   highest scorers among the other outside hitters and middles (so two strong middles can both
 *   play ahead of a weaker outside hitter);
 * - the best setter and the best libero.
 * Missing positions are filled by the next best starter.
 */
export function pickCourtSix(
  roster: readonly RosterPlayer[],
  lastDay: ReadonlyMap<string, number>,
  season: ReadonlyMap<string, { points: number }>,
): CourtPlayer[] {
  const score = (r: RosterPlayer) => [lastDay.get(r.playerId) ?? 0, season.get(r.playerId)?.points ?? 0] as const;
  const byScore = (a: RosterPlayer, b: RosterPlayer) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1];
  const starters = roster.filter((r) => r.slot !== "BENCH").sort(byScore);
  const bench = roster.filter((r) => r.slot === "BENCH").sort(byScore);
  const pool = [...starters, ...bench];
  const used = new Set<string>();
  const out: CourtPlayer[] = [];
  const fits = (r: RosterPlayer, role: CourtRole) => r.positions.includes(role) || r.positionLabel === role;
  const add = (p: RosterPlayer | undefined, role: CourtRole) => {
    if (!p) return;
    used.add(p.playerId);
    out.push({ id: p.playerId, name: p.name, photo: p.photoUrl, role });
  };
  const best = (role: CourtRole) =>
    starters.find((r) => !used.has(r.playerId) && fits(r, role)) ?? bench.find((r) => !used.has(r.playerId) && fits(r, role));
  const anyone = () => pool.find((r) => !used.has(r.playerId));

  // Attackers: one OH and one M guaranteed, then the two best remaining OH or M.
  add(best("OH") ?? anyone(), "OH");
  add(best("M") ?? anyone(), "M");
  for (let i = 0; i < 2; i++) {
    const next = starters.find((r) => !used.has(r.playerId) && (fits(r, "OH") || fits(r, "M")))
      ?? bench.find((r) => !used.has(r.playerId) && (fits(r, "OH") || fits(r, "M")));
    if (next) add(next, fits(next, "M") && !fits(next, "OH") ? "M" : "OH");
    else add(anyone(), "OH");
  }
  add(best("S") ?? anyone(), "S");
  add(best("L") ?? anyone(), "L");
  return out;
}
