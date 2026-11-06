/**
 * Official school roster pages on the SIDEARM platform (12 OUA schools).
 *
 * Permissions checked 6 Nov 2026: robots.txt "Allow: /", "Crawl-delay: 30", and images are
 * disallowed for robots. We therefore read ONE roster page per school (a different server each),
 * never download images, and only store a link to each headshot. The viewer's browser loads the
 * photo from the school's site, credited and linked back. Administrator approval: 6 Nov 2026.
 * Ottawa, Trent and Lakehead block automated access and are not read.
 *
 * Collected: name, jersey, position, height, year, hometown, previous team, photo link, profile
 * link. Deliberately NOT collected: program of study / major, social media, anything else.
 */

export interface SidearmSchool {
  key: string;
  label: string; // used in the photo credit
  universitySourceId: string; // USportVB id of the university
  rosterUrl: string;
}

export const SIDEARM_SCHOOLS: SidearmSchool[] = [
  { key: "western", label: "Western Mustangs", universitySourceId: "d5fxlv5sp7d57j2i", rosterUrl: "https://westernmustangs.ca/sports/womens-volleyball/roster" },
  { key: "guelph", label: "Guelph Gryphons", universitySourceId: "29vi5gmq9yha58r5", rosterUrl: "https://www.gryphons.ca/sports/volleyball-women/roster" },
  { key: "queens", label: "Queen's Gaels", universitySourceId: "0s0vpdtek80fc6jw", rosterUrl: "https://gogaelsgo.com/sports/womens-volleyball/roster" },
  { key: "toronto", label: "Toronto Varsity Blues", universitySourceId: "d82pln03udq5mb36", rosterUrl: "https://varsityblues.ca/sports/womens-volleyball/roster" },
  { key: "tmu", label: "TMU Bold", universitySourceId: "vfnpe1bkpkl92z4d", rosterUrl: "https://tmubold.ca/sports/womens-volleyball/roster" },
  { key: "york", label: "York Lions", universitySourceId: "55g8muig33kxzolw", rosterUrl: "https://yorkulions.ca/sports/womens-volleyball/roster" },
  { key: "waterloo", label: "Waterloo Warriors", universitySourceId: "257rc2ikmp7r2cwk", rosterUrl: "https://athletics.uwaterloo.ca/sports/womens-volleyball/roster" },
  { key: "brock", label: "Brock Badgers", universitySourceId: "r1jy4n46w6iqomue", rosterUrl: "https://gobadgers.ca/sports/womens-volleyball/roster" },
  { key: "mcmaster", label: "McMaster Marauders", universitySourceId: "ot2b0rgms7oq72ng", rosterUrl: "https://marauders.ca/sports/womens-volleyball/roster" },
  { key: "windsor", label: "Windsor Lancers", universitySourceId: "1x1r2stwudexxbtb", rosterUrl: "https://golancers.ca/sports/womens-volleyball/roster" },
  { key: "nipissing", label: "Nipissing Lakers", universitySourceId: "1thuo9nr1w2libe9", rosterUrl: "https://nulakers.ca/sports/womens-volleyball/roster" },
  { key: "rmc", label: "RMC Paladins", universitySourceId: "rb84vlgw33vy0ho6", rosterUrl: "https://gopaladinsgo.ca/sports/womens-volleyball/roster" },
];

export interface RosterProfile {
  name: string;
  jersey: number | null;
  position: string | null;
  height: string | null;
  academicYear: string | null;
  hometown: string | null;
  previousTeam: string | null;
  photoUrl: string | null; // absolute, without size parameters
  profileUrl: string | null; // absolute
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function textOf(fragment: string | undefined): string | null {
  if (!fragment) return null;
  const t = fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

function inner(block: string, cls: string): string | undefined {
  const re = new RegExp(`<([a-z0-9]+)[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, "i");
  return block.match(re)?.[2];
}

function absolute(url: string | undefined, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/&amp;/g, "&"), base);
    u.search = ""; // drop width/quality parameters; the app chooses a size when displaying
    return u.toString();
  } catch {
    return null;
  }
}

/** True for generic silhouettes/logos rather than a real headshot. */
function isPlaceholder(url: string): boolean {
  return /placeholder|silhouette|default|no[-_]?image|logo/i.test(url);
}

export function parseSidearmRoster(html: string, baseUrl: string): RosterProfile[] {
  const parts = html.split(/class="sidearm-roster-player"/).slice(1);
  const out: RosterProfile[] = [];
  for (const part of parts) {
    const block = part.slice(0, 12000);
    const name =
      textOf(inner(block, "sidearm-roster-player-name")?.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]) ??
      textOf(block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]) ??
      [textOf(inner(block, "sidearm-roster-player-first-name")), textOf(inner(block, "sidearm-roster-player-last-name"))].filter(Boolean).join(" ");
    if (!name) continue;
    const img = block.match(/<img[^>]*(?:data-src|src)="([^"]+)"/i)?.[1];
    const photo = img && !isPlaceholder(img) ? absolute(img, baseUrl) : null;
    const jersey = Number.parseInt(textOf(inner(block, "sidearm-roster-player-jersey-number")) ?? "", 10);
    const position =
      textOf(block.match(/class="sidearm-roster-player-position-long-short hide-on-small-down"[^>]*>([\s\S]*?)<\/span>/i)?.[1]) ??
      textOf(inner(block, "sidearm-roster-player-position"))?.replace(/\s*\d+'.*$/, "") ??
      null;
    out.push({
      name,
      jersey: Number.isFinite(jersey) ? jersey : null,
      position,
      height: textOf(inner(block, "sidearm-roster-player-height")),
      academicYear: textOf(inner(block, "sidearm-roster-player-academic-year")),
      hometown: textOf(inner(block, "sidearm-roster-player-hometown")),
      previousTeam: textOf(inner(block, "sidearm-roster-player-previous-school")) ?? textOf(inner(block, "sidearm-roster-player-highschool")),
      photoUrl: photo,
      profileUrl: absolute(block.match(/data-player-url="([^"]+)"/)?.[1], baseUrl),
    });
  }
  return out;
}

/** Name key for matching: lower case, accents removed, letters only. */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
