import { describe, expect, it } from "vitest";
import { parsePeriod, positionGroup, statCells, totalsFor, type WeekStatRow } from "./leaders";

const row = (player: string, week: number, s: Partial<WeekStatRow>): WeekStatRow => ({
  player_id: player, week, games: 1, sets: 3, kills: 0, attack_errors: 0, attack_attempts: 0, assists: 0,
  service_aces: 0, service_errors: 0, digs: 0, solo_blocks: 0, block_assists: 0, points: 0, ...s,
});

describe("leaders", () => {
  const rows = [
    row("a", 1, { kills: 10, attack_errors: 2, attack_attempts: 30, points: "15.5" }),
    row("a", 2, { kills: 14, attack_errors: 4, attack_attempts: 40, sets: 4, points: "20.25" }),
    row("b", 2, { assists: 40, digs: 8, points: 18 }),
  ];

  it("adds up a week or the whole season", () => {
    const season = totalsFor(rows, "season");
    expect(season.get("a")).toMatchObject({ games: 2, sets: 7, kills: 24, points: 35.75 });
    const w1 = totalsFor(rows, 1);
    expect(w1.get("a")?.points).toBe(15.5);
    expect(w1.has("b")).toBe(false); // didn't play in week 1
  });

  it("reads the period from the address", () => {
    expect(parsePeriod("season", [1, 2])).toBe("season");
    expect(parsePeriod("2", [1, 2])).toBe(2);
    expect(parsePeriod("w1", [1, 2])).toBe(1);
    expect(parsePeriod("9", [1, 2], 2)).toBe(2); // unknown week: fallback
  });

  it("shows the stats that matter for each position", () => {
    const a = totalsFor(rows, "season").get("a")!;
    const oh = statCells("OH", a);
    expect(oh.map((c) => c.label)).toEqual(["GP", "Sets", "K", "K/S", "HIT%", "E", "TA", "D", "SA", "BLK"]);
    expect(oh.find((c) => c.label === "HIT%")?.value).toBe(".257"); // (24 - 6) / 70
    expect(oh.find((c) => c.label === "K/S")?.value).toBe("3.43");
    const s = statCells("S", totalsFor(rows, 2).get("b")!);
    expect(s[2]).toEqual({ label: "A", value: "40" });
    expect(statCells("L", a).map((c) => c.label)).toContain("D/S");
    expect(statCells("M", a).map((c) => c.label)).toContain("BLK");
  });

  it("groups position labels", () => {
    expect(positionGroup("Setter")).toBe("S");
    expect(positionGroup("MB")).toBe("M");
    expect(positionGroup("Libero")).toBe("L");
    expect(positionGroup("RS")).toBe("OH");
  });
});
