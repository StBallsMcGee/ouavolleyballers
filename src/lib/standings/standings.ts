/**
 * Head-to-head standings and playoff seeding.
 *
 * Standings are always derived from final matchup results (never stored separately), so there
 * is only one source of truth. The database view public.v_standings uses the same ordering:
 * 1. win percentage (a tie counts as half a win), 2. total points scored.
 * Further tiebreakers (head-to-head, then points against) are applied here for display and
 * playoff seeding. The existing league's own tiebreak rules were not verifiable, so the
 * administrator should confirm these.
 */

export interface MatchupResult {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  final: boolean;
  playoffRound: number | null;
}

export interface StandingRow {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  winPct: number;
  rank: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeStandings(teamIds: readonly string[], results: readonly MatchupResult[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, { teamId: id, wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0, pointsAgainst: 0, winPct: 0, rank: 0 });
  }
  const regular = results.filter((r) => r.final && r.playoffRound === null);
  for (const r of regular) {
    const home = rows.get(r.homeTeamId);
    const away = rows.get(r.awayTeamId);
    if (!home || !away) continue;
    home.games++;
    away.games++;
    home.pointsFor += r.homeScore;
    home.pointsAgainst += r.awayScore;
    away.pointsFor += r.awayScore;
    away.pointsAgainst += r.homeScore;
    if (r.homeScore > r.awayScore) {
      home.wins++;
      away.losses++;
    } else if (r.awayScore > r.homeScore) {
      away.wins++;
      home.losses++;
    } else {
      home.ties++;
      away.ties++;
    }
  }
  for (const row of rows.values()) {
    row.pointsFor = round2(row.pointsFor);
    row.pointsAgainst = round2(row.pointsAgainst);
    row.winPct = row.games === 0 ? 0 : (row.wins + 0.5 * row.ties) / row.games;
  }

  const headToHead = (a: string, b: string): number => {
    let aw = 0;
    let bw = 0;
    for (const r of regular) {
      if (r.homeTeamId === a && r.awayTeamId === b) {
        if (r.homeScore > r.awayScore) aw++;
        else if (r.awayScore > r.homeScore) bw++;
      } else if (r.homeTeamId === b && r.awayTeamId === a) {
        if (r.homeScore > r.awayScore) bw++;
        else if (r.awayScore > r.homeScore) aw++;
      }
    }
    return bw - aw; // negative => a ahead
  };

  const sorted = [...rows.values()].sort(
    (a, b) =>
      b.winPct - a.winPct ||
      b.pointsFor - a.pointsFor ||
      headToHead(a.teamId, b.teamId) ||
      a.pointsAgainst - b.pointsAgainst ||
      a.teamId.localeCompare(b.teamId),
  );
  // Rank: teams equal on win% and points for share a rank (same as the database view).
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    row.rank = prev && prev.winPct === row.winPct && prev.pointsFor === row.pointsFor ? prev.rank : i + 1;
  });
  return sorted;
}

export interface PlayoffPair {
  homeTeamId: string;
  awayTeamId: string;
  round: number;
  homeSeed: number;
  awaySeed: number;
}

/**
 * First playoff round: seed 1 v lowest seed, 2 v second lowest, etc. If the number of playoff
 * teams is not a power of two, the top seeds receive byes so the next round is a power of two.
 */
export function firstRoundPairs(seededTeamIds: readonly string[], playoffTeams: number): { pairs: PlayoffPair[]; byes: string[] } {
  const field = seededTeamIds.slice(0, Math.min(playoffTeams, seededTeamIds.length));
  if (field.length < 2) return { pairs: [], byes: [...field] };
  let bracket = 1;
  while (bracket * 2 <= field.length) bracket *= 2;
  // Teams that must play to reduce the field to `bracket` teams.
  const playing = bracket === field.length ? field.length : (field.length - bracket) * 2;
  const byeCount = field.length - playing;
  const byes = field.slice(0, byeCount);
  const contenders = field.slice(byeCount);
  const pairs: PlayoffPair[] = [];
  for (let i = 0; i < contenders.length / 2; i++) {
    const hi = contenders[i]!;
    const lo = contenders[contenders.length - 1 - i]!;
    pairs.push({ homeTeamId: hi, awayTeamId: lo, round: 1, homeSeed: byeCount + i + 1, awaySeed: field.length - i });
  }
  return { pairs, byes };
}

/**
 * Next playoff round from the previous round's winners plus any byes, re-seeded so the best
 * remaining seed plays the worst remaining seed.
 */
export function nextRoundPairs(
  advancingTeamIds: readonly string[],
  seedOf: ReadonlyMap<string, number>,
  round: number,
): PlayoffPair[] {
  const ordered = [...advancingTeamIds].sort((a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99));
  const pairs: PlayoffPair[] = [];
  for (let i = 0; i < Math.floor(ordered.length / 2); i++) {
    const hi = ordered[i]!;
    const lo = ordered[ordered.length - 1 - i]!;
    pairs.push({ homeTeamId: hi, awayTeamId: lo, round, homeSeed: seedOf.get(hi) ?? 0, awaySeed: seedOf.get(lo) ?? 0 });
  }
  return pairs;
}
