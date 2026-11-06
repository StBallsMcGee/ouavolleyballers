import { BENCH, isEligibleForSlot, slotGroup } from "@/lib/league/settings";

export interface LineupPlayer {
  playerId: string;
  name: string;
  positions: string[];
  slot: string;
  locked: boolean;
  /** True if the player's university has a match on the lineup day (used by autofill). */
  playsToday?: boolean;
}

export interface LineupProblem {
  playerId?: string;
  slot?: string;
  message: string;
}

/**
 * Checks a proposed lineup the same way the database does, so problems show instantly in the
 * browser. The database re-checks everything before saving (the browser is never trusted).
 */
export function validateLineup(
  proposed: readonly LineupPlayer[],
  current: ReadonlyMap<string, string>,
  slots: readonly string[],
): LineupProblem[] {
  const problems: LineupProblem[] = [];
  const used = new Map<string, string>();
  for (const p of proposed) {
    if (p.slot !== BENCH && !slots.includes(p.slot)) {
      problems.push({ playerId: p.playerId, message: `Slot ${p.slot} does not exist in this league.` });
      continue;
    }
    if (!isEligibleForSlot(p.positions, p.slot)) {
      problems.push({ playerId: p.playerId, message: `${p.name} cannot play ${slotGroup(p.slot)}.` });
    }
    if (p.slot !== BENCH) {
      const other = used.get(p.slot);
      if (other) problems.push({ slot: p.slot, message: `Two players are in the ${p.slot} slot.` });
      used.set(p.slot, p.playerId);
    }
    if (p.locked && current.get(p.playerId) !== p.slot) {
      problems.push({ playerId: p.playerId, message: `${p.name} is locked until tomorrow.` });
    }
  }
  return problems;
}

/**
 * "Start active players": fills empty or bench-occupied starting slots with eligible bench
 * players who play today, preferring the most specific position match. Locked players are
 * never moved. Returns a new lineup; the manager still has to save it.
 */
export function autofillLineup(players: readonly LineupPlayer[], slots: readonly string[]): LineupPlayer[] {
  const out = players.map((p) => ({ ...p }));
  const occupied = new Map<string, LineupPlayer>();
  for (const p of out) if (p.slot !== BENCH) occupied.set(p.slot, p);

  // Free up starters who are not playing today (and are not locked) for bench players who are.
  const benchPlayingToday = out.filter((p) => p.slot === BENCH && p.playsToday && !p.locked);
  if (benchPlayingToday.length > 0) {
    for (const [slot, p] of occupied) {
      if (!p.playsToday && !p.locked) {
        p.slot = BENCH;
        occupied.delete(slot);
      }
    }
  }

  const candidates = out
    .filter((p) => p.slot === BENCH && !p.locked)
    .sort((a, b) => Number(b.playsToday ?? false) - Number(a.playsToday ?? false) || a.positions.length - b.positions.length);

  // Fill specific-position slots first, UTIL last, so UTIL takes whoever is left over.
  const ordered = [...slots].sort((a, b) => Number(slotGroup(a) === "UTIL") - Number(slotGroup(b) === "UTIL"));
  for (const slot of ordered) {
    if (occupied.has(slot)) continue;
    const pick = candidates.find((c) => c.slot === BENCH && isEligibleForSlot(c.positions, slot));
    if (pick) {
      pick.slot = slot;
      occupied.set(slot, pick);
    }
  }
  return out;
}
