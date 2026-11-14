/**
 * Playoff odds by simulation. Each team's weekly score is drawn from a normal distribution
 * with its own average and spread so far (pulled toward the league average early in the season,
 * when there's little to go on). The rest of the regular season is played out many times; a
 * team's odds are the share of runs in which it finishes in the top N (by win %, then points
 * for, like the real standings). Seeded, so the same inputs give the same numbers.
 */
export interface OddsTeam {
  id: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Final weekly scores so far (for the team's average and spread). */
  history: number[];
}
export interface OddsGame {
  home: string;
  away: string;
  /** Points already scored this week (in-progress weeks), and the share of the week still to play (0–1). */
  homeNow?: number;
  awayNow?: number;
  remaining?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function playoffOdds(teams: readonly OddsTeam[], games: readonly OddsGame[], spots: number, opts: { runs?: number; seed?: number } = {}): Map<string, number> {
  const out = new Map<string, number>();
  if (teams.length === 0) return out;
  const all = teams.flatMap((t) => t.history);
  const leagueMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 50;
  const leagueSd = all.length > 1 ? Math.sqrt(all.reduce((a, b) => a + (b - leagueMean) ** 2, 0) / (all.length - 1)) : 15;
  const K = 2; // weeks of "league average" mixed in
  const model = new Map(teams.map((t) => {
    const n = t.history.length;
    const avg = n ? t.history.reduce((a, b) => a + b, 0) / n : leagueMean;
    const sd = n > 1 ? Math.sqrt(t.history.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1)) : leagueSd;
    return [t.id, { mean: (n * avg + K * leagueMean) / (n + K), sd: Math.max(5, (n * sd + K * leagueSd) / (n + K)) }];
  }));
  const rand = rng(opts.seed ?? 12345);
  const normal = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const runs = opts.runs ?? 4000;
  const made = new Map(teams.map((t) => [t.id, 0]));
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const W = new Float64Array(teams.length), L = new Float64Array(teams.length), T = new Float64Array(teams.length), PF = new Float64Array(teams.length);
  const order = teams.map((_, i) => i);
  for (let r = 0; r < runs; r++) {
    teams.forEach((t, i) => { W[i] = t.wins; L[i] = t.losses; T[i] = t.ties; PF[i] = t.pointsFor; });
    for (const g of games) {
      const hi = idx.get(g.home), ai = idx.get(g.away);
      if (hi === undefined || ai === undefined) continue;
      const f = Math.min(Math.max(g.remaining ?? 1, 0), 1);
      const hm = model.get(g.home)!, am = model.get(g.away)!;
      const hs = (g.homeNow ?? 0) + Math.max(0, hm.mean * f + hm.sd * Math.sqrt(f) * normal());
      const as = (g.awayNow ?? 0) + Math.max(0, am.mean * f + am.sd * Math.sqrt(f) * normal());
      PF[hi] = PF[hi]! + hs; PF[ai] = PF[ai]! + as;
      if (hs > as) { W[hi] = W[hi]! + 1; L[ai] = L[ai]! + 1; } else if (as > hs) { W[ai] = W[ai]! + 1; L[hi] = L[hi]! + 1; } else { T[hi] = T[hi]! + 1; T[ai] = T[ai]! + 1; }
    }
    order.sort((a, b) => {
      const ga = W[a]! + L[a]! + T[a]!, gb = W[b]! + L[b]! + T[b]!;
      const pa = ga ? (W[a]! + T[a]! / 2) / ga : 0, pb = gb ? (W[b]! + T[b]! / 2) / gb : 0;
      return pb - pa || PF[b]! - PF[a]!;
    });
    for (let k = 0; k < Math.min(spots, order.length); k++) made.set(teams[order[k]!]!.id, made.get(teams[order[k]!]!.id)! + 1);
  }
  for (const [id, n] of made) out.set(id, n / runs);
  return out;
}

/** Builds the simulation inputs from the league's matchups and standings and runs it. */
export function leaguePlayoffOdds(args: {
  matchups: ReadonlyArray<{ week: number; status: string; playoff_round: number | null; home_team_id: string; away_team_id: string; home_score: number; away_score: number }>;
  standings: ReadonlyArray<{ teamId: string; wins: number; losses: number; ties: number; pointsFor: number }>;
  weeks: ReadonlyArray<{ week: number; starts_on: string; ends_on: string }>;
  startWeek: number;
  spots: number;
  today: string;
}): Map<string, number> {
  const regular = args.matchups.filter((m) => m.playoff_round === null && m.week < args.startWeek);
  const history = new Map<string, number[]>();
  for (const m of regular.filter((x) => x.status === "final")) {
    history.set(m.home_team_id, [...(history.get(m.home_team_id) ?? []), m.home_score]);
    history.set(m.away_team_id, [...(history.get(m.away_team_id) ?? []), m.away_score]);
  }
  const weekOf = new Map(args.weeks.map((w) => [w.week, w]));
  const dayMs = 86_400_000;
  const games = regular.filter((m) => m.status === "scheduled" || m.status === "in_progress").map((m) => {
    if (m.status !== "in_progress") return { home: m.home_team_id, away: m.away_team_id };
    const w = weekOf.get(m.week);
    const left = w ? Math.max(0, (Date.parse(`${w.ends_on}T12:00:00Z`) - Date.parse(`${args.today}T12:00:00Z`)) / dayMs + 1) : 7;
    return { home: m.home_team_id, away: m.away_team_id, homeNow: m.home_score, awayNow: m.away_score, remaining: Math.min(1, left / 7) };
  });
  let seed = 0;
  for (const ch of args.today) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return playoffOdds(
    args.standings.map((s) => ({ id: s.teamId, wins: s.wins, losses: s.losses, ties: s.ties, pointsFor: s.pointsFor, history: history.get(s.teamId) ?? [] })),
    games,
    args.spots,
    { seed },
  );
}
