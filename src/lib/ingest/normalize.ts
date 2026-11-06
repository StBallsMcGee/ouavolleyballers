/**
 * Converts the USportVB players feed into our own records (pure functions, no database).
 *
 * The feed gives each player's match-by-match statistics, identified by date + opponent.
 * A match is therefore identified as  date + the two universities  (sorted so both teams'
 * players point to the same match). Home/away is not known from this feed.
 */
import { createHash } from "node:crypto";
import { parsePositions } from "@/lib/league/settings";
import type { StatLine } from "@/lib/scoring/engine";
import { seasonLabelForDate } from "@/lib/sources/usportvb-calendar";
import { gameRowToStatLine, universityName, type UsvbPlayer } from "@/lib/sources/usportvb";

export interface NormUniversity {
  sourceId: string;
  name: string;
  conference: string | null;
  known: boolean;
}

export interface NormPlayer {
  sourceId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  universitySourceId: string | null;
  conference: string | null;
  gender: "womens" | "mens";
  positionLabel: string | null;
  positions: string[];
  jerseyNumber: number | null;
  active: boolean;
  /** Source id of the record this one appears to duplicate (flag only, never merged). */
  duplicateOfSourceId: string | null;
}

export interface NormMatch {
  sourceId: string; // e.g. "2026-10-31:1x1r2stwudexxbtb:d5fxlv5sp7d57j2i"
  date: string;
  seasonLabel: string;
  universityA: string;
  universityB: string;
}

export interface NormStat {
  playerSourceId: string;
  matchSourceId: string;
  universitySourceId: string;
  line: StatLine;
  setsPlayed: number | null;
  hash: string;
}

export interface NormalizedFeed {
  universities: NormUniversity[];
  players: NormPlayer[];
  matches: NormMatch[];
  stats: NormStat[];
  warnings: string[];
}

export function matchSourceId(date: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${date}:${x}:${y}`;
}

function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
}

export function normalizeFeed(feed: readonly UsvbPlayer[]): NormalizedFeed {
  const warnings: string[] = [];
  const universities = new Map<string, NormUniversity>();
  const matches = new Map<string, NormMatch>();
  const stats: NormStat[] = [];

  const addUniversity = (id: string) => {
    if (universities.has(id)) return;
    const u = universityName(id);
    universities.set(id, { sourceId: id, ...u });
    if (!u.known) warnings.push(`University ${id} is not in the name list; stored as "${u.name}".`);
  };

  // Detect duplicate player records: same name (ignoring stray spaces) at the same university.
  const groups = new Map<string, UsvbPlayer[]>();
  for (const p of feed) {
    const k = `${p.teamId ?? ""}|${nameKey(p.firstName, p.lastName)}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const duplicateOf = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Primary record: the active one, then the one with clean name spacing, then most matches.
    const ranked = [...group].sort(
      (a, b) =>
        Number(b.isActive ?? false) - Number(a.isActive ?? false) ||
        Number(a.lastName !== a.lastName.trim()) - Number(b.lastName !== b.lastName.trim()) ||
        (b.gameData?.length ?? 0) - (a.gameData?.length ?? 0),
    );
    const primary = ranked[0]!;
    for (const d of ranked.slice(1)) {
      duplicateOf.set(d.publicId, primary.publicId);
      warnings.push(
        `Possible duplicate player: "${d.firstName} ${d.lastName}" (${d.publicId}) looks like ${primary.publicId}. Flagged, not merged.`,
      );
    }
  }

  const players: NormPlayer[] = feed.map((p) => {
    const first = p.firstName.trim();
    const last = p.lastName.trim();
    if (p.teamId) addUniversity(p.teamId);
    return {
      sourceId: p.publicId,
      firstName: first,
      lastName: last,
      displayName: `${first} ${last}`.trim(),
      universitySourceId: p.teamId ?? null,
      conference: p.conference ?? null,
      gender: p.mens ? "mens" : "womens",
      positionLabel: p.position ?? null,
      positions: parsePositions(p.position),
      jerseyNumber: p.jerseyNumber ?? null,
      active: p.isActive ?? false,
      duplicateOfSourceId: duplicateOf.get(p.publicId) ?? null,
    };
  });

  for (const p of feed) {
    if (!p.teamId) {
      if ((p.gameData?.length ?? 0) > 0) warnings.push(`Player ${p.publicId} has stats but no university; stats skipped.`);
      continue;
    }
    const seen = new Set<string>();
    for (const g of p.gameData ?? []) {
      if (g.opponent === p.teamId) {
        // Known USportVB data error: a team recorded as playing itself. Opponent unknown.
        warnings.push(`Player ${p.publicId}: stat row on ${g.date} lists their own team as the opponent; skipped (source data error).`);
        continue;
      }
      addUniversity(g.opponent);
      const mid = matchSourceId(g.date, p.teamId, g.opponent);
      if (seen.has(mid)) {
        warnings.push(`Player ${p.publicId} has two stat rows for ${mid}; only the first was used.`);
        continue;
      }
      seen.add(mid);
      if (!matches.has(mid)) {
        const [a, b] = [p.teamId, g.opponent].sort() as [string, string];
        matches.set(mid, { sourceId: mid, date: g.date, seasonLabel: seasonLabelForDate(g.date), universityA: a, universityB: b });
      }
      const line = gameRowToStatLine(g);
      const sets = g.sets ?? null;
      stats.push({
        playerSourceId: p.publicId,
        matchSourceId: mid,
        universitySourceId: p.teamId,
        line,
        setsPlayed: sets,
        hash: createHash("sha256").update(JSON.stringify([line, sets])).digest("hex").slice(0, 24),
      });
    }
  }

  return { universities: [...universities.values()], players, matches: [...matches.values()], stats, warnings };
}
