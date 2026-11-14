import { describe, expect, it } from "vitest";
import { playoffOdds, type OddsTeam } from "./odds";

const t = (id: string, wins: number, losses: number, history: number[]): OddsTeam => ({ id, wins, losses, ties: 0, pointsFor: history.reduce((a, b) => a + b, 0), history });

describe("playoff odds", () => {
  it("with no games left, odds are just the current top spots", () => {
    const teams = [t("a", 3, 0, [90, 90, 90]), t("b", 2, 1, [80, 80, 80]), t("c", 1, 2, [70, 70, 70]), t("d", 0, 3, [60, 60, 60])];
    const o = playoffOdds(teams, [], 2);
    expect([o.get("a"), o.get("b"), o.get("c"), o.get("d")]).toEqual([1, 1, 0, 0]);
  });
  it("stronger teams and better records have better odds; all odds add up to the number of spots", () => {
    const teams = [t("a", 2, 0, [120, 115]), t("b", 1, 1, [80, 85]), t("c", 1, 1, [70, 75]), t("d", 0, 2, [60, 55])];
    const games = [{ home: "a", away: "d" }, { home: "b", away: "c" }, { home: "a", away: "c" }, { home: "b", away: "d" }];
    const o = playoffOdds(teams, games, 2, { runs: 3000, seed: 7 });
    expect(o.get("a")!).toBeGreaterThan(o.get("b")!);
    expect(o.get("b")!).toBeGreaterThan(o.get("c")!);
    expect(o.get("c")!).toBeGreaterThan(o.get("d")!);
    expect([...o.values()].reduce((x, y) => x + y, 0)).toBeCloseTo(2, 6);
    expect(playoffOdds(teams, games, 2, { runs: 3000, seed: 7 })).toEqual(o); // same seed, same numbers
  });
  it("points already scored in a live week count", () => {
    const teams = [t("a", 0, 0, [80]), t("b", 0, 0, [80])];
    const o = playoffOdds(teams, [{ home: "a", away: "b", homeNow: 150, awayNow: 10, remaining: 0.1 }], 1, { runs: 2000 });
    expect(o.get("a")!).toBeGreaterThan(0.95);
  });
});
