import { describe, expect, it } from "vitest";
import { buildWeeklyNews, roleOf, type NewsGame } from "./news";

const g = (opponent: string, setsFor: number, setsAgainst: number, line: Record<string, number>, points: number): NewsGame => ({
  date: "2026-11-14", opponent, setsFor, setsAgainst, sets: setsFor + setsAgainst, line, points,
});

describe("roleOf", () => {
  it("maps positions to the stat that matters", () => {
    expect(roleOf("S")).toBe("setter");
    expect(roleOf("Libero")).toBe("libero");
    expect(roleOf("MB")).toBe("middle");
    expect(roleOf("Outside Hitter")).toBe("attacker");
    expect(roleOf(null)).toBe("attacker");
  });
});

describe("buildWeeklyNews", () => {
  const before = [
    g("Brock", 3, 1, { kills: 8, attack_errors: 3, attack_attempts: 30, digs: 5 }, 14),
    g("York", 1, 3, { kills: 9, attack_errors: 4, attack_attempts: 35, digs: 4 }, 13),
  ];

  it("writes up an attacker's week with results, kills, hitting and fantasy points", () => {
    const s = buildWeeklyNews({
      playerId: "p1", firstName: "Jane", lastName: "Sample", position: "OH", school: "Queen's", weekLabel: "Week 6",
      week: [g("Toronto", 3, 0, { kills: 15, attack_errors: 2, attack_attempts: 32, digs: 6, service_aces: 2 }, 24),
             g("TMU", 3, 2, { kills: 18, attack_errors: 5, attack_attempts: 45, digs: 7, service_aces: 1 }, 27)],
      before,
    })!;
    const text = [s.headline, ...s.paragraphs].join(" ");
    expect(s.headline).toMatch(/Sample/);
    expect(text).toMatch(/33 kills/);
    expect(text).toMatch(/2-0/);
    expect(text).toMatch(/Toronto/);
    expect(text).toMatch(/\.338/); // (33 - 7) / 77
    expect(text).toMatch(/51\.0 points/);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("leads with assists for a setter and digs for a libero", () => {
    const setter = buildWeeklyNews({
      playerId: "p2", firstName: "Ann", lastName: "Example", position: "S", school: "Guelph", weekLabel: "Week 6",
      week: [g("Waterloo", 0, 3, { assists: 31, digs: 6, kills: 1 }, 12)], before: [],
    })!;
    expect(setter.paragraphs[0]).toMatch(/31 assists/);
    expect(setter.paragraphs.join(" ")).toMatch(/assists per set/);
    expect(setter.paragraphs[0]).toMatch(/loss|defeat/);

    const libero = buildWeeklyNews({
      playerId: "p3", firstName: "Bo", lastName: "Test", position: "L", school: "York", weekLabel: "Week 6",
      week: [g("Brock", 3, 1, { digs: 22, assists: 3 }, 15)], before: [],
    })!;
    expect(libero.paragraphs[0]).toMatch(/22 digs/);
    expect(libero.paragraphs.join(" ")).toMatch(/digs per set/);
  });

  it("returns nothing when she didn't play that week", () => {
    expect(buildWeeklyNews({ playerId: "x", firstName: "A", lastName: "B", position: "OH", school: "Y", weekLabel: "Week 1", week: [], before: [] })).toBeNull();
  });

  it("is the same on every page load", () => {
    const input = { playerId: "p1", firstName: "Jane", lastName: "Sample", position: "OH", school: "Queen's", weekLabel: "Week 6",
      week: [g("Toronto", 3, 0, { kills: 12, attack_attempts: 30 }, 20)], before };
    expect(buildWeeklyNews(input)).toEqual(buildWeeklyNews(input));
  });
});
