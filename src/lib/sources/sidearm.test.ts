import { describe, expect, it } from "vitest";
import { nameKey, parseSidearmRoster } from "./sidearm";

// Minimal sample in the SIDEARM roster markup (test data, not a real player).
const html = `
<li class="sidearm-roster-player" data-player-url="/sports/womens-volleyball/roster/jane-sample/123">
  <div class="sidearm-roster-player-image column"><img class="lazyload" data-src="/images/2026/10/20/Jane_HS.png?width=80&amp;quality=90" alt=""></div>
  <div class="sidearm-roster-player-position"><span class="text-bold"><span class="sidearm-roster-player-position-long-short hide-on-small-down"> Outside Hitter </span><span class="sidearm-roster-player-position-long-short hide-on-medium"> OH </span></span><span class="sidearm-roster-player-height">5'11&quot;</span></div>
  <div class="sidearm-roster-player-name"><span class="sidearm-roster-player-jersey-number"> 7 </span><p><h2><a href="#">Jane Sample</a></h2></p></div>
  <span class="sidearm-roster-player-academic-year">3</span><span class="sidearm-roster-player-major">Secret Major</span>
  <span class="sidearm-roster-player-hometown">Oakville, ON</span><span class="sidearm-roster-player-previous-school">Halton Hills VC</span>
</li>
<li class="sidearm-roster-player" data-player-url="/x/2">
  <img data-src="/images/placeholder-silhouette.png"><div class="sidearm-roster-player-name"><h3><a>Ana Ãlvarez</a></h3></div>
</li>`;

describe("SIDEARM roster reader", () => {
  const [a, b] = parseSidearmRoster(html, "https://example.ca/sports/womens-volleyball/roster");
  it("reads the fields we keep, with absolute links and no size parameters", () => {
    expect(a).toEqual({
      name: "Jane Sample", jersey: 7, position: "Outside Hitter", height: "5'11\"", academicYear: "3", hometown: "Oakville, ON",
      previousTeam: "Halton Hills VC", photoUrl: "https://example.ca/images/2026/10/20/Jane_HS.png",
      profileUrl: "https://example.ca/sports/womens-volleyball/roster/jane-sample/123",
    });
    expect(JSON.stringify(a)).not.toContain("Secret Major"); // program of study is never kept
  });
  it("ignores placeholder silhouettes", () => {
    expect(b?.photoUrl).toBeNull();
  });
  it("matches names regardless of accents and spacing", () => {
    expect(nameKey(" Ana  Alvarez")).toBe(nameKey("Ána Álvarez"));
  });
});
