import { describe, expect, it } from "vitest";
import { matchSourceId, normalizeFeed } from "./normalize";
import type { UsvbPlayer } from "@/lib/sources/usportvb";

const row = (date: string, opponent: string, kills = 1) =>
  ({ date, opponent, kills, errors: 0, attempts: 0, assists: 0, aces: 0, serveMisses: 0, digs: 0, blockSolo: 0, blockAssist: 0 });
const player = (id: string, team: string, last: string, games: ReturnType<typeof row>[], active = true): UsvbPlayer =>
  ({ publicId: id, firstName: "Ann", lastName: last, position: "OH/L", teamId: team, jerseyNumber: 1, mens: false, isActive: active, conference: "OUA", gameData: games });

describe("feed normalisation", () => {
  it("both teams' players point at the same match", () => {
    const n = normalizeFeed([player("a", "T1", "One", [row("2026-10-31", "T2")]), player("b", "T2", "Two", [row("2026-10-31", "T1")])]);
    expect(n.matches).toHaveLength(1);
    expect(n.stats.map((s) => s.matchSourceId)).toEqual([matchSourceId("2026-10-31", "T1", "T2"), matchSourceId("2026-10-31", "T2", "T1")]);
    expect(n.matches[0]!.seasonLabel).toBe("2026-27");
  });
  it("flags (but does not merge) duplicate player records with a stray leading space", () => {
    const n = normalizeFeed([player("good", "T1", "Breen", [row("2026-10-31", "T2")]), player("dup", "T1", " Breen", [], false)]);
    expect(n.players.find((p) => p.sourceId === "dup")!.duplicateOfSourceId).toBe("good");
    expect(n.players.find((p) => p.sourceId === "dup")!.lastName).toBe("Breen");
    expect(n.players).toHaveLength(2);
  });
  it("skips rows where a team plays itself and duplicate rows for one match, with warnings", () => {
    const n = normalizeFeed([player("a", "T1", "One", [row("2026-10-31", "T1"), row("2026-11-01", "T2"), row("2026-11-01", "T2", 5)])]);
    expect(n.stats).toHaveLength(1);
    expect(n.warnings.filter((w) => /their own team|two stat rows/.test(w))).toHaveLength(2);
  });
  it("parses multi-position labels and warns about unknown universities", () => {
    const n = normalizeFeed([player("a", "T1", "One", [])]);
    expect(n.players[0]!.positions).toEqual(["OH", "L"]);
    expect(n.warnings.some((w) => w.includes("not in the name list"))).toBe(true);
  });
  it("a corrected stat line gets a different hash", () => {
    const a = normalizeFeed([player("a", "T1", "One", [row("2026-10-31", "T2", 1)])]).stats[0]!.hash;
    const b = normalizeFeed([player("a", "T1", "One", [row("2026-10-31", "T2", 2)])]).stats[0]!.hash;
    expect(a).not.toBe(b);
  });
});
