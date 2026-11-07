import { describe, expect, it } from "vitest";
import { countedTotal, daysOfWeek, mondayOf, playerDay, weekLinks } from "./days";
import { endOfDayIso, parseDay, startOfDayIso } from "@/lib/time";
import { dayChips } from "./games";

const g = (date: string, points: number, counted = true) => ({ label: "x", date, line: {}, points, counted });

describe("day view helpers", () => {
  it("finds the Monday–Sunday week", () => {
    expect(mondayOf("2026-11-07")).toBe("2026-11-02"); // Saturday
    expect(mondayOf("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(mondayOf("2026-11-08")).toBe("2026-11-02"); // Sunday
    const days = daysOfWeek("2026-11-05");
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(days[3]).toMatchObject({ weekday: "Thu", dayNum: "5" });
  });

  it("shows only that day's points, never a running total", () => {
    const games = [g("2026-11-06", 12.5), g("2026-11-07", 7.2)];
    expect(playerDay(games, "2026-11-06", []).points).toBe(12.5);
    expect(playerDay(games, "2026-11-07", []).points).toBe(7.2);
    expect(playerDay(games, "2026-11-05", []).points).toBeNull();
  });

  it("only lineup points count towards the day total", () => {
    expect(countedTotal([playerDay([g("2026-11-06", 10)], "2026-11-06", []), playerDay([g("2026-11-06", 5, false)], "2026-11-06", [])])).toBe(10);
  });

  it("links to neighbouring weeks inside the season only", () => {
    const weeks = [{ week: 1, starts_on: "2026-10-26", ends_on: "2026-11-01", is_playoff: false }, { week: 2, starts_on: "2026-11-02", ends_on: "2026-11-08", is_playoff: false }];
    expect(weekLinks(weeks, "2026-11-04", "/team")).toEqual({ prevHref: "/team?day=2026-11-01", nextHref: null });
  });

  it("knows when a Toronto day starts and ends", () => {
    expect(startOfDayIso("2026-11-07")).toBe("2026-11-07T05:00:00.000Z"); // EST
    expect(startOfDayIso("2026-10-15")).toBe("2026-10-15T04:00:00.000Z"); // EDT
    expect(endOfDayIso("2026-11-07")).toBe("2026-11-08T04:59:59.000Z");
    expect(parseDay("2026-11-07")).toBe("2026-11-07");
    expect(parseDay("nope")).toBeNull();
  });

  it("game line for a day: the game, or No game", () => {
    const unis = new Map([["a", { id: "a", name: "Alpha", short_name: "ALP" }], ["b", { id: "b", name: "Beta", short_name: "BET" }]]);
    const m = { id: "m", match_date: "2026-11-06", start_time: "2026-11-07T00:00:00Z", lock_at: "2026-11-07T00:00:00Z", status: "scheduled", home_university_id: "a", away_university_id: "b", home_sets: null, away_sets: null, home_away_known: true } as never;
    expect(dayChips("b", [m], unis, "2026-11-06", "2026-11-01")[0]!.text).toBe("7:00 PM @ ALP");
    expect(dayChips("b", [m], unis, "2026-11-05", "2026-11-01")[0]).toEqual({ text: "No game", tone: "none" });
  });
});
