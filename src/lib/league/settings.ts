import { z } from "zod";

/** Real-world positions a player can be listed at. */
export const POSITIONS = ["S", "OH", "M", "L"] as const;
export type Position = (typeof POSITIONS)[number];

/** Order in which starting slot groups are displayed. UTIL accepts any position. */
export const SLOT_GROUPS = ["S", "OH", "M", "L", "UTIL"] as const;
export type SlotGroup = (typeof SLOT_GROUPS)[number];
export const BENCH = "BENCH";

export const rosterSettingsSchema = z
  .object({
    S: z.number().int().min(0).max(10),
    OH: z.number().int().min(0).max(10),
    M: z.number().int().min(0).max(10),
    L: z.number().int().min(0).max(10),
    UTIL: z.number().int().min(0).max(10),
    TOTAL: z.number().int().min(1).max(30),
  })
  .refine((r) => r.TOTAL >= r.S + r.OH + r.M + r.L + r.UTIL, {
    message: "Total roster size must be at least the number of starting slots.",
  });

export const leagueSettingsSchema = z.object({
  roster: rosterSettingsSchema,
  freeAgency: z.object({ enabled: z.boolean() }),
  trades: z.object({
    enabled: z.boolean(),
    /** "none": accepted trades process immediately. "commissioner": admin must approve. */
    review: z.enum(["none", "commissioner"]),
    deadlineWeek: z.number().int().min(1).nullable(),
  }),
  lineupLock: z.object({
    /**
     * Local time used as the lock time for a match whose start time the source does not
     * provide. Players lock individually when their own match locks (day by day).
     */
    fallbackLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  playoffs: z.object({
    enabled: z.boolean(),
    teams: z.number().int().min(2).max(16),
    startWeek: z.number().int().min(1),
  }),
});

export type RosterSettings = z.infer<typeof rosterSettingsSchema>;
export type LeagueSettings = z.infer<typeof leagueSettingsSchema>;

/**
 * Defaults used when creating the league from the USportVB import. Roster numbers are
 * replaced by the verified values from the source league. Free agency and trades are on
 * (administrator decision, 6 Nov 2026). Playoffs are off until the administrator sets the
 * format, because the existing league's playoff rules have not been verified.
 */
export const DEFAULT_SETTINGS: LeagueSettings = {
  roster: { S: 1, OH: 3, M: 2, L: 1, UTIL: 1, TOTAL: 11 },
  freeAgency: { enabled: true },
  trades: { enabled: true, review: "none", deadlineWeek: null },
  lineupLock: { fallbackLocalTime: "18:00" },
  playoffs: { enabled: false, teams: 4, startWeek: 11 },
};

/** Parses stored settings, filling any missing section from the defaults. */
export function parseSettings(raw: unknown): LeagueSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return leagueSettingsSchema.parse({
    roster: { ...DEFAULT_SETTINGS.roster, ...(obj.roster as object) },
    freeAgency: { ...DEFAULT_SETTINGS.freeAgency, ...(obj.freeAgency as object) },
    trades: { ...DEFAULT_SETTINGS.trades, ...(obj.trades as object) },
    lineupLock: { ...DEFAULT_SETTINGS.lineupLock, ...(obj.lineupLock as object) },
    playoffs: { ...DEFAULT_SETTINGS.playoffs, ...(obj.playoffs as object) },
  });
}

/**
 * Starting slot names, e.g. ["S","OH1","OH2","OH3","M1","M2","L","UTIL"].
 * Must match public.league_starting_slots() in the database.
 */
export function startingSlots(roster: RosterSettings): string[] {
  const slots: string[] = [];
  for (const group of SLOT_GROUPS) {
    const n = roster[group];
    if (n === 1) slots.push(group);
    else for (let i = 1; i <= n; i++) slots.push(`${group}${i}`);
  }
  return slots;
}

export function slotGroup(slot: string): string {
  return slot.replace(/\d+$/, "");
}

/** Splits a source position label like "OH/L" into eligible positions. */
export function parsePositions(label: string | null | undefined): Position[] {
  if (!label) return [];
  const out = new Set<Position>();
  for (const part of label.split("/")) {
    const p = part.trim().toUpperCase();
    if ((POSITIONS as readonly string[]).includes(p)) out.add(p as Position);
  }
  return [...out];
}

/** Must match public.player_eligible_for_slot() in the database. */
export function isEligibleForSlot(positions: readonly string[], slot: string): boolean {
  const group = slotGroup(slot);
  if (group === BENCH || group === "UTIL") return true;
  return positions.includes(group);
}
