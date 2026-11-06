/**
 * Short, factual player write-ups. Built ONLY from the official school roster details and our own
 * statistics: nothing is looked up elsewhere and nothing is invented.
 */

export interface BlurbProfile {
  position: string | null;
  academicYear: string | null;
  hometown: string | null;
  previousTeam: string | null;
}

export interface BlurbSeason {
  matches: number;
  sets: number;
  kills: number;
  digs: number;
  assists: number;
  aces: number;
  soloBlocks: number;
  blockAssists: number;
  fantasyPoints: number;
}

const YEAR_WORDS: Record<string, string> = {
  "1": "First-year", "2": "Second-year", "3": "Third-year", "4": "Fourth-year", "5": "Fifth-year", "6": "Sixth-year",
  fr: "First-year", so: "Second-year", jr: "Third-year", sr: "Fourth-year", gr: "Graduate", grad: "Graduate",
  rookie: "Rookie", "1st": "First-year", "2nd": "Second-year", "3rd": "Third-year", "4th": "Fourth-year", "5th": "Fifth-year",
};

export function yearLabel(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/\.$/, "").replace(/\s*year$/, "");
  return YEAR_WORDS[k] ?? null;
}

export function positionLabel(raw: string | null, fallback: string | null): string | null {
  const p = (raw ?? fallback ?? "").trim();
  if (!p) return null;
  const abbreviations: Record<string, string> = { OH: "outside hitter", M: "middle", MB: "middle blocker", S: "setter", L: "libero", RS: "right side", OPP: "opposite", UTIL: "utility player", DS: "defensive specialist" };
  if (abbreviations[p.toUpperCase()]) return abbreviations[p.toUpperCase()]!;
  return p.toLowerCase().replace(/\s*\/\s*/g, "/");
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function perSet(n: number, sets: number) {
  return String(Number((n / sets).toFixed(2)));
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function buildBlurb(input: {
  profile: BlurbProfile | null;
  ourPosition: string | null;
  university: string;
  season: BlurbSeason | null;
  teamRank?: { rank: number; of: number } | null;
}): string {
  const { profile, season } = input;
  const sentences: string[] = [];

  const year = yearLabel(profile?.academicYear ?? null);
  const pos = positionLabel(profile?.position ?? null, input.ourPosition);
  const who = [year, pos].filter(Boolean).join(" ");
  if (who) {
    let s = `${capitalise(who)} for ${input.university}`;
    if (profile?.hometown) s += ` from ${profile.hometown}`;
    sentences.push(`${s}.`);
  } else {
    sentences.push(`Plays for ${input.university}${profile?.hometown ? ` (from ${profile.hometown})` : ""}.`);
  }
  if (profile?.previousTeam) sentences.push(`Previously with ${profile.previousTeam}.`);

  if (season && season.matches > 0) {
    const sets = season.sets;
    const lead: string[] = [];
    const isSetter = /setter/.test(pos ?? "") || season.assists > season.kills * 2;
    const isLibero = /libero|defensive/.test(pos ?? "");
    if (sets > 0) {
      if (isSetter) lead.push(`${perSet(season.assists, sets)} assists per set`);
      if (isLibero) lead.push(`${perSet(season.digs, sets)} digs per set`);
      if (!isSetter && !isLibero) {
        lead.push(`${perSet(season.kills, sets)} kills per set`);
        const blocks = season.soloBlocks + season.blockAssists * 0.5;
        if (blocks / sets >= 0.4) lead.push(`${perSet(blocks, sets)} blocks per set`);
      }
      if (!isLibero && season.digs / sets >= 2) lead.push(`${perSet(season.digs, sets)} digs per set`);
    }
    const fpm = season.fantasyPoints / season.matches;
    sentences.push(
      `This season: ${season.matches} match${season.matches === 1 ? "" : "es"}${sets ? ` (${sets} sets)` : ""}` +
        (lead.length ? `, averaging ${lead.join(" and ")}` : "") +
        `, with ${fpm.toFixed(1)} fantasy points per match.`,
    );
    if (input.teamRank && input.teamRank.rank <= 3 && input.teamRank.of >= 5) {
      sentences.push(`That ranks ${ordinal(input.teamRank.rank)} on the team in fantasy points.`);
    }
  } else {
    sentences.push("No statistics recorded yet this season.");
  }
  return sentences.join(" ");
}
