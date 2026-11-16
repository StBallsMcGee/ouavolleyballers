/**
 * Official school roster pages on the PrestoSports platform: Trent, Ottawa and Lakehead. The league administrator has permission from these schools
 * (16 Nov 2026). Their sites refuse requests from outside servers, so the app's own server reads
 * one roster page per school, identifying itself honestly. Like the SIDEARM import, images are
 * never downloaded: only a link to each headshot is stored, shown credited and linked back.
 *
 * Collected: name, jersey, position, year, photo link, profile link. Nothing else.
 */
import { textOf, type RosterProfile } from "./sidearm";

export interface PrestoSchool {
  key: string;
  label: string;
  universitySourceId: string;
  rosterUrl: string;
}

export const PRESTO_SCHOOLS: PrestoSchool[] = [
  { key: "trent", label: "Trent Excalibur", universitySourceId: "j8jvomv74zlpzuzk", rosterUrl: "https://trentexcalibur.ca/sports/wvball/2026-27/roster?view=headshot" },
  { key: "ottawa", label: "Ottawa Gee-Gees", universitySourceId: "mqzdwlflgwir1qmq", rosterUrl: "https://teams.geegees.ca/sports/wvball/2026-27/roster?view=headshot" },
  { key: "lakehead", label: "Lakehead Thunderwolves", universitySourceId: "qiowub5ypmkc3t97", rosterUrl: "https://thunderwolves.ca/sports/wvball/2026-27/roster?view=headshot" },
];

/** Ottawa's university id (for a different roster address passed as ?ottawa=). */
export const OTTAWA_SOURCE_ID = "mqzdwlflgwir1qmq";

function abs(url: string | undefined, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/&amp;/g, "&"), base);
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Reads the "headshot" view of a PrestoSports roster: one card per player. */
export function parsePrestoRoster(html: string, baseUrl: string): RosterProfile[] {
  const parts = html.split(/class="player-card-wrapper/).slice(1);
  const out: RosterProfile[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const block = part.slice(0, 15000);
    const first = textOf(block.match(/class="firstname[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const last = textOf(block.match(/class="lastname[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const alt = textOf(block.match(/alt="([^"]*?) bio photo"/i)?.[1]);
    const name = [first, last].filter(Boolean).join(" ") || alt;
    if (!name) continue;
    // The player's own headshot: any image of this sport's photos or bios (not the default silhouette).
    const img = [...block.matchAll(/(?:<img[^>]*src="|background-image:\s*url\(')([^"']+)/gi)]
      .map((m) => m[1]!)
      .find((u) => /\/sports\/[^/]+\/[^/]+\/(?:bios|photos)\//i.test(u) && /\.(?:jpe?g|png|webp)/i.test(u) && !/default|placeholder|silhouette/i.test(u));
    const jersey = Number.parseInt(textOf(block.match(/class="number[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1])?.replace("#", "") ?? "", 10);
    const field = (label: string) => textOf(block.match(new RegExp(`<span class="fw-bold">${label}:</span>([\\s\\S]*?)</li>`, "i"))?.[1]);
    const profileUrl = abs(block.match(/href="([^"]*\/bios\/[^"?#]+)"[^>]*full-bio/i)?.[1] ?? block.match(/href="([^"]*\/bios\/[^"?#.]+)"/i)?.[1], baseUrl);
    const key = `${name}|${jersey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      jersey: Number.isFinite(jersey) ? jersey : null,
      position: field("Position"),
      height: field("Height") ?? field("Ht\\."),
      academicYear: field("Class") ?? field("Year"),
      hometown: field("Hometown"),
      previousTeam: field("Previous School") ?? field("High School"),
      photoUrl: img ? abs(img, baseUrl) : null,
      profileUrl,
    });
  }
  return out;
}
