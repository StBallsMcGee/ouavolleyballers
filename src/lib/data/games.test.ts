import { describe, expect, it } from "vitest";
import { gameChips } from "./games";
import type { MatchRow, University } from "./queries";

const unis = new Map<string, University>([
  ["wes", { id: "wes", name: "Western", short_name: "WES" }],
  ["gph", { id: "gph", name: "Guelph", short_name: "GPH" }],
  ["tor", { id: "tor", name: "Toronto", short_name: "TOR" }],
]);
const m = (id: string, date: string, home: string, away: string, extra: Partial<MatchRow> = {}): MatchRow => ({
  id, match_date: date, start_time: null, lock_at: `${date}T23:00:00Z`, lock_source: "fallback", home_university_id: home, away_university_id: away,
  home_away_known: true, home_sets: null, away_sets: null, status: "scheduled", stats_available: false, counts_for_fantasy: true,
  last_updated_at: "", last_checked_at: null, ...extra,
});
const week = { starts_on: "2026-11-09", ends_on: "2026-11-15" };

describe("player game line", () => {
  it("shows day, Toronto time and opponent, with @ for away games", () => {
    const chips = gameChips("wes", [m("1", "2026-11-13", "gph", "wes", { start_time: "2026-11-13T23:00:00Z" }), m("2", "2026-11-14", "wes", "gph")], unis, week, "2026-11-10");
    expect(chips.map((c) => c.text)).toEqual(["Fri 6:00 PM @ GPH", "Sat TBD vs GPH"]);
  });
  it("marks today, live and finished games", () => {
    const chips = gameChips("wes", [
      m("1", "2026-11-13", "wes", "gph", { status: "final", home_sets: 3, away_sets: 1 }),
      m("2", "2026-11-14", "tor", "wes", { status: "live" }),
      m("3", "2026-11-15", "wes", "tor", { start_time: "2026-11-15T19:00:00Z" }),
    ], unis, week, "2026-11-15");
    expect(chips.map((c) => c.text)).toEqual(["W 3-1 vs GPH", "LIVE @ TOR", "Today 2:00 PM vs TOR"]);
    expect(chips.map((c) => c.tone)).toEqual(["final", "live", "today"]);
  });
  it("shows BYE when the team has no game this week, plus the next game", () => {
    const chips = gameChips("tor", [m("1", "2026-11-13", "wes", "gph"), m("2", "2026-11-20", "tor", "gph")], unis, week, "2026-11-10");
    expect(chips.map((c) => c.text)).toEqual(["BYE", "Next Nov 20 vs GPH"]);
  });
  it("ignores cancelled games", () => {
    expect(gameChips("wes", [m("1", "2026-11-13", "wes", "gph", { status: "cancelled" })], unis, week, "2026-11-10")[0]!.text).toBe("BYE");
  });
});
