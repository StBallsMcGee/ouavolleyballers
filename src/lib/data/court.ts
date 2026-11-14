import type { RosterPlayer } from "./queries";

export type CourtRole = "OH" | "M" | "S" | "L";
export interface CourtPlayer {
  id: string;
  name: string;
  photo: string | null;
  role: CourtRole;
}

/**
 * Six players for the court picture, from the team's current starters only: the three
 * outside hitters who scored the most on the last day of play, and the best middle, setter and
 * libero by the same measure (season points break ties). If the starters lack a position, the
 * next best starter fills in; bench players are used only if there are fewer than six starters.
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
  const used = new Set<string>();
  const out: CourtPlayer[] = [];
  const fits = (r: RosterPlayer, role: CourtRole) => r.positions.includes(role) || r.positionLabel === role;
  const take = (role: CourtRole) => {
    const p = starters.find((r) => !used.has(r.playerId) && fits(r, role))
      ?? starters.find((r) => !used.has(r.playerId))
      ?? bench.find((r) => !used.has(r.playerId) && fits(r, role))
      ?? bench.find((r) => !used.has(r.playerId));
    if (!p) return;
    used.add(p.playerId);
    out.push({ id: p.playerId, name: p.name, photo: p.photoUrl, role });
  };
  (["OH", "OH", "OH", "M", "S", "L"] as const).forEach(take);
  return out;
}
