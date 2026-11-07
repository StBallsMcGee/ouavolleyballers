import { describe, expect, it } from "vitest";
import { captionMatches, parseSidearmSchedule } from "./sidearm-boxscore";

describe("school schedule and box score helpers", () => {
  it("dates games in the right season year", () => {
    const html = `<li class="sidearm-schedule-game a"><div class="sidearm-schedule-game-opponent-date">Jan 9 (Sat) 2:00 PM</div><div class="sidearm-schedule-game-opponent-name">York</div><a href="/x/boxscore/5">B</a></li>
                  <li class="sidearm-schedule-game a"><div class="sidearm-schedule-game-opponent-date">Nov 6 (Fri) 6:00 PM</div><a href="/x/boxscore/6">B</a></li>
                  <li class="sidearm-schedule-game a"><div class="sidearm-schedule-game-opponent-date">Nov 13 (Fri)</div></li>`;
    expect(parseSidearmSchedule(html, "https://s.example/sports/v/schedule", 2026).map((e) => [e.date, e.boxScoreUrl])).toEqual([
      ["2027-01-09", "https://s.example/x/boxscore/5"],
      ["2026-11-06", "https://s.example/x/boxscore/6"],
    ]);
  });
  it("recognises team captions", () => {
    expect(captionMatches("QUEEN'S", { name: "Queen's", short_name: "QU" })).toBe(true);
    expect(captionMatches("TORONTO METROPOLITAN", { name: "Toronto Metropolitan", short_name: "TMU" })).toBe(true);
    expect(captionMatches("TMU", { name: "Toronto Metropolitan", short_name: "TMU" })).toBe(true);
    expect(captionMatches("WESTERN", { name: "Windsor", short_name: "WIN" })).toBe(false);
  });
});
