import { describe, expect, it } from "vitest";
import { buildBlurb, yearLabel } from "./blurb";

const season = { matches: 4, sets: 14, kills: 49, digs: 20, assists: 3, aces: 5, soloBlocks: 2, blockAssists: 4, fantasyPoints: 62 };

describe("player write-ups", () => {
  it("uses only the official bio and our stats", () => {
    expect(buildBlurb({ profile: { position: "Outside Hitter", academicYear: "3", hometown: "Mississauga, ON", previousTeam: "Mavericks VC" }, ourPosition: "OH", university: "Western", season, teamRank: { rank: 1, of: 15 } }))
      .toBe("Third-year outside hitter for Western from Mississauga, ON. Previously with Mavericks VC. This season: 4 matches (14 sets), averaging 3.5 kills per set, with 15.5 fantasy points per match. That ranks 1st on the team in fantasy points.");
  });
  it("highlights assists for setters and digs for liberos", () => {
    expect(buildBlurb({ profile: { position: "Setter", academicYear: null, hometown: null, previousTeam: null }, ourPosition: "S", university: "Guelph", season: { ...season, assists: 140, kills: 4 } }))
      .toContain("averaging 10 assists per set");
    expect(buildBlurb({ profile: null, ourPosition: "L", university: "York", season: { ...season, digs: 56 } })).toContain("4 digs per set");
  });
  it("handles a player without a school profile or stats", () => {
    expect(buildBlurb({ profile: null, ourPosition: null, university: "RMC", season: null })).toBe("Plays for RMC. No statistics recorded yet this season.");
  });
  it("understands different year formats", () => {
    expect([yearLabel("Jr."), yearLabel("1"), yearLabel("Gr."), yearLabel("weird")]).toEqual(["Third-year", "First-year", "Graduate", null]);
  });
});
