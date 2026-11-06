import { describe, expect, it } from "vitest";
import { isMondayToSunday, USVB_WEEKS } from "./usportvb-calendar";

describe("matchup calendar", () => {
  it("every 2026-27 week runs Monday to Sunday, in order, without overlaps", () => {
    const weeks = USVB_WEEKS[2027]!;
    expect(weeks).toHaveLength(13);
    for (const w of weeks) expect(isMondayToSunday(w), `week ${w.week}`).toBe(true);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i]!.start > weeks[i - 1]!.end).toBe(true);
  });
  it("rejects weeks that are not Monday to Sunday", () => {
    expect(isMondayToSunday({ week: 1, start: "2026-11-01", end: "2026-11-07" })).toBe(false); // Sunday start
    expect(isMondayToSunday({ week: 1, start: "2026-11-02", end: "2026-11-09" })).toBe(false); // 8 days
  });
});
