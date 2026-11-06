/**
 * USportVB data source adapter.
 *
 * Verified 6 Nov 2026 (docs/PHASE1_SOURCE_REPORT.md):
 *  - GET /api/players?gender=womens&conference=OUA  -> players with per-match stats (no login)
 *  - GET /api/fantasy/league/{id}, /api/fantasy/league/{id}/teams -> league, teams, rosters
 * Used with the USportVB developer's permission. Responses are validated with zod before use
 * so a format change in the source stops the import/sync instead of corrupting data.
 */
import { z } from "zod";
import type { CoreStatKey, ScoringRule, StatLine } from "@/lib/scoring/engine";
import universityNames from "./usportvb-universities.json";

export const SOURCE_SYSTEM = "usportvb";

/* ----------------------------------------------------------------------------------------
 * Response schemas
 * -------------------------------------------------------------------------------------- */

const num = z.number().finite();

export const gameRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opponent: z.string().min(1),
  kills: num,
  errors: num,
  attempts: num,
  assists: num,
  aces: num,
  serveMisses: num,
  digs: num,
  blockSolo: num,
  blockAssist: num,
  sets: num.optional(),
});
export type UsvbGameRow = z.infer<typeof gameRowSchema>;

export const playerSchema = z.object({
  publicId: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  position: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  jerseyNumber: num.nullable().optional(),
  mens: z.boolean(),
  isActive: z.boolean().nullable().optional(),
  conference: z.string().nullable().optional(),
  gameData: z.array(gameRowSchema).nullable().optional(),
});
export type UsvbPlayer = z.infer<typeof playerSchema>;
export const playersResponseSchema = z.array(playerSchema);

const pointsSchema = z.object({
  aces: num,
  digs: num,
  kills: num,
  errors: num,
  assists: num,
  attempts: num,
  blockSolo: num,
  blockAssist: num,
  serveMisses: num,
});

export const leagueSchema = z.object({
  publicId: z.string(),
  year: z.number().int(),
  name: z.string(),
  commissionerId: z.string(),
  teams: z.array(z.string()),
  draft: z.object({
    draftComplete: z.boolean().optional(),
    picks: z.array(z.object({ pickNumber: z.number().int(), teamId: z.string(), playerId: z.string() })).default([]),
  }),
  criticalSettings: z.object({
    gender: z.enum(["womens", "mens", "both"]),
    conferences: z.array(z.string()),
    leagueSize: z.number().int(),
    roster: z.object({
      S: z.number().int(),
      OH: z.number().int(),
      M: z.number().int(),
      L: z.number().int(),
      UTIL: z.number().int(),
      TOTAL: z.number().int(),
    }),
  }),
  adjustableSettings: z.object({ points: pointsSchema }),
  matchups: z
    .array(
      z.object({
        week: z.number().int(),
        matchupData: z.object({
          team1Id: z.string(),
          team2Id: z.string(),
          team1Score: num,
          team2Score: num,
          winnerId: z.string(),
          playoffGameId: z.string().optional(),
        }),
      }),
    )
    .default([]),
});
export type UsvbLeague = z.infer<typeof leagueSchema>;

export const teamSchema = z.object({
  publicId: z.string(),
  leagueId: z.string(),
  name: z.string(),
  managerId: z.string(),
  players: z.array(z.object({ publicId: z.string(), position: z.string() })),
  points: z.array(z.object({ week: z.number().int(), points: num })).default([]),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type UsvbTeam = z.infer<typeof teamSchema>;
export const teamsResponseSchema = z.array(teamSchema);

/* ----------------------------------------------------------------------------------------
 * Field mapping (verified: recomputing USportVB's published points with this mapping
 * matched 187 of 187 players exactly)
 * -------------------------------------------------------------------------------------- */

export const USVB_STAT_TO_CORE: Record<keyof z.infer<typeof pointsSchema>, CoreStatKey> = {
  kills: "kills",
  errors: "attack_errors",
  attempts: "attack_attempts",
  assists: "assists",
  aces: "service_aces",
  serveMisses: "service_errors",
  digs: "digs",
  blockSolo: "solo_blocks",
  blockAssist: "block_assists",
};

/** Labels as shown on the USportVB league settings page. */
const USVB_LABELS: Record<keyof typeof USVB_STAT_TO_CORE, string> = {
  aces: "Aces",
  digs: "Digs",
  kills: "Kills",
  errors: "Errors (attack errors)",
  assists: "Assists",
  blockSolo: "Block Solo",
  blockAssist: "Block Assist",
  serveMisses: "Serve Misses",
  attempts: "Attempts (attack attempts)",
};

export function gameRowToStatLine(row: UsvbGameRow): StatLine {
  return {
    kills: row.kills,
    attack_errors: row.errors,
    attack_attempts: row.attempts,
    assists: row.assists,
    service_aces: row.aces,
    service_errors: row.serveMisses,
    digs: row.digs,
    solo_blocks: row.blockSolo,
    block_assists: row.blockAssist,
  };
}

export function leaguePointsToRules(points: z.infer<typeof pointsSchema>): ScoringRule[] {
  return (Object.keys(USVB_STAT_TO_CORE) as Array<keyof typeof USVB_STAT_TO_CORE>).map((k) => ({
    statKey: USVB_STAT_TO_CORE[k],
    label: USVB_LABELS[k],
    points: points[k],
    active: true,
  }));
}

/** USportVB's built-in defaults (from the site code). Used only to verify our formula. */
export const USVB_DEFAULT_POINTS = {
  aces: 2,
  digs: 0.5,
  kills: 1,
  errors: -1,
  assists: 0.1,
  blockSolo: 2,
  blockAssist: 0.8,
  serveMisses: -0.5,
  attempts: 0,
};

export function universityName(sourceId: string): { name: string; conference: string | null; known: boolean } {
  const entry = (universityNames as Record<string, { name: string | null; conference: string | null }>)[sourceId];
  if (entry?.name) return { name: entry.name, conference: entry.conference, known: true };
  return { name: `Unknown team (${sourceId})`, conference: null, known: false };
}

/* ----------------------------------------------------------------------------------------
 * HTTP client: polite, identified, validated
 * -------------------------------------------------------------------------------------- */

export interface FetchOptions {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function getJson(path: string, opts: FetchOptions): Promise<unknown> {
  const base = opts.baseUrl ?? process.env.USPORTVB_API_BASE;
  if (!base) throw new Error("USPORTVB_API_BASE is not configured.");
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await f(`${base}${path}`, {
      headers: {
        "User-Agent": opts.userAgent ?? process.env.SOURCE_USER_AGENT ?? "SideoutFantasy/0.1",
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`USportVB ${path} responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPlayers(gender: "womens" | "mens", conference: string, opts: FetchOptions = {}) {
  const raw = await getJson(`/api/players?gender=${gender}&conference=${encodeURIComponent(conference)}`, opts);
  return playersResponseSchema.parse(raw);
}

export async function fetchLeague(leagueId: string, opts: FetchOptions = {}) {
  const raw = await getJson(`/api/fantasy/league/${encodeURIComponent(leagueId)}`, opts);
  return leagueSchema.parse(raw);
}

export async function fetchLeagueTeams(leagueId: string, opts: FetchOptions = {}) {
  const raw = await getJson(`/api/fantasy/league/${encodeURIComponent(leagueId)}/teams`, opts);
  return teamsResponseSchema.parse(raw);
}

/** Removes secrets (league password, any email) from a raw source payload before saving. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /^(password|email|token|access_token|refresh_token)$/i.test(k) ? "<REDACTED>" : redactSecrets(v);
    }
    return out as T;
  }
  return value;
}
