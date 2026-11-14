import type { RosterPlayer } from "./queries";

export type CourtRole = "OH" | "M" | "S" | "L";
export interface CourtPlayer {
  id: string;
  name: string;
  photo: string | null;
  role: CourtRole;
}

/**
 * Six players for the court picture: the team's three highest-scoring outside hitters, its best
 * middle, setter and libero (by season points). Missing positions are filled by the next best.
 */
export function pickCourtSix(roster: readonly RosterPlayer[], points: ReadonlyMap<string, { points: number }>): CourtPlayer[] {
  const ranked = [...roster].sort((a, b) => (points.get(b.playerId)?.points ?? 0) - (points.get(a.playerId)?.points ?? 0));
  const used = new Set<string>();
  const out: CourtPlayer[] = [];
  const take = (role: CourtRole) => {
    const p = ranked.find((r) => !used.has(r.playerId) && (r.positions.includes(role) || r.positionLabel === role))
      ?? ranked.find((r) => !used.has(r.playerId));
    if (!p) return;
    used.add(p.playerId);
    out.push({ id: p.playerId, name: p.name, photo: p.photoUrl, role });
  };
  (["OH", "OH", "OH", "M", "S", "L"] as const).forEach(take);
  return out;
}
