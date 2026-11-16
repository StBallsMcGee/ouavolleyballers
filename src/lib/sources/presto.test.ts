import { describe, expect, it } from "vitest";
import { parsePrestoRoster } from "./presto";

// Minimal sample in the PrestoSports headshot markup (test data, not a real player).
const card = (n: number, first: string, last: string, bg: boolean) => `
<div class="player-card-wrapper position-relative"><div class="player-card card">
  <div class="player-image">${bg
    ? `<span class="d-block" style="background-image:url('/sports/wvball/2026-27/bios/${n}.jpg?max_height=576&max_width=576&crop=1');"></span>`
    : `<img class="img-fluid w-100" src="/sports/wvball/2026-27/bios/${n}.jpg?max_height=576&max_width=576&crop=1" alt="${first} ${last} bio photo" />`}</div>
  <span class="number fw-bold fs-5 nowrap">#${n}</span>
  <div class="pl-name"><span class="firstname text-truncate">${first}</span><span class="lastname text-truncate">${last}</span></div>
  <ul><li class="p-0 m-0"><span class="fw-bold">Position:</span> Outside Hitter</li><li class="p-0 m-0"><span class="fw-bold">Class:</span> 2</li></ul>
  <a href="/sports/wvball/2026-27/bios/${last.toLowerCase()}_${first.toLowerCase()}_ab12" class="btn btn-primary full-bio">Full Bio</a>
</div></div>`;

describe("parsePrestoRoster", () => {
  it("reads name, number, position, year, photo and profile links", () => {
    const html = card(4, "Jane", "Sample", false) + card(9, "Ann", "Example", true);
    const r = parsePrestoRoster(html, "https://example.ca/sports/wvball/2026-27/roster?view=headshot");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      name: "Jane Sample", jersey: 4, position: "Outside Hitter", academicYear: "2",
      photoUrl: "https://example.ca/sports/wvball/2026-27/bios/4.jpg",
      profileUrl: "https://example.ca/sports/wvball/2026-27/bios/sample_jane_ab12",
    });
    expect(r[1]?.photoUrl).toBe("https://example.ca/sports/wvball/2026-27/bios/9.jpg");
  });
});
