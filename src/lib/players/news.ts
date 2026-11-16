/**
 * The weekly "News" write-up on a player's page, in the voice of a sports reporter.
 * Claude writes the published stories from `newsFacts` (src/lib/news/writer.ts); the template
 * below is the fallback when no API key is set.
 * Built only from our own statistics and match results for the most recent completed fantasy
 * week (Monday–Sunday), so it changes over at league midnight between Sunday and Monday.
 * Nothing is invented: every number in the text comes from the inputs.
 */
import type { StatLine } from "@/lib/scoring/engine";

export interface NewsGame {
  date: string;
  opponent: string;
  /** Sets won and lost by her team (null when the result isn't known). */
  setsFor: number | null;
  setsAgainst: number | null;
  sets: number | null;
  line: StatLine;
  points: number;
}

export interface NewsInput {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string | null;
  school: string;
  weekLabel: string;
  /** Her games in the week being written up, oldest first. */
  week: NewsGame[];
  /** Her earlier games this season (before that week), newest first. */
  before: NewsGame[];
}

export interface NewsStory {
  headline: string;
  paragraphs: string[];
}

type Role = "setter" | "libero" | "middle" | "attacker";

export function roleOf(position: string | null): Role {
  const p = (position ?? "").trim().toUpperCase();
  if (p === "S" || p.startsWith("SET")) return "setter";
  if (p === "L" || p === "DS" || p.startsWith("LIB") || p.startsWith("DEF")) return "libero";
  if (p === "M" || p === "MB" || p.startsWith("MID")) return "middle";
  return "attacker";
}

const n = (l: StatLine, k: keyof StatLine) => Number(l[k] ?? 0);
const total = (gs: readonly NewsGame[], k: keyof StatLine) => gs.reduce((a, g) => a + n(g.line, k), 0);
const blocks = (gs: readonly NewsGame[]) => total(gs, "solo_blocks") + total(gs, "block_assists") * 0.5;
const fmtBlocks = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const plural = (v: number, word: string, many = `${word}s`) => `${v} ${v === 1 ? word : many}`;

/** A small deterministic choice so the wording varies between players and weeks, but never between page loads. */
function picker(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return <T,>(options: readonly T[]): T => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return options[Math.abs(h) % options.length]!;
  };
}

export function hittingPct(gs: readonly NewsGame[]): number | null {
  const ta = total(gs, "attack_attempts");
  if (ta < 10) return null;
  return (total(gs, "kills") - total(gs, "attack_errors")) / ta;
}
export const fmtPct = (v: number) => (v < 0 ? "-" : "") + "." + String(Math.round(Math.abs(v) * 1000)).padStart(3, "0");

/** The headline stat for her role, per game. */
function keyStat(role: Role): { key: keyof StatLine | "blocks"; word: string; many: string } {
  switch (role) {
    case "setter": return { key: "assists", word: "assist", many: "assists" };
    case "libero": return { key: "digs", word: "dig", many: "digs" };
    case "middle": return { key: "kills", word: "kill", many: "kills" };
    default: return { key: "kills", word: "kill", many: "kills" };
  }
}
const statOf = (gs: readonly NewsGame[], key: keyof StatLine | "blocks") => (key === "blocks" ? blocks(gs) : total(gs, key));

function resultPhrase(g: NewsGame, pick: ReturnType<typeof picker>): string | null {
  if (g.setsFor === null || g.setsAgainst === null || g.setsFor === g.setsAgainst) return null;
  const score = `${g.setsFor}-${g.setsAgainst}`;
  if (g.setsFor > g.setsAgainst) {
    if (g.setsAgainst === 0) return pick([`a ${score} sweep of ${g.opponent}`, `a straight-sets win over ${g.opponent}`]);
    if (g.setsAgainst === 2) return pick([`a five-set thriller against ${g.opponent}`, `a ${score} battle with ${g.opponent} that went the distance`]);
    return `a ${score} win over ${g.opponent}`;
  }
  if (g.setsFor === 0) return pick([`a ${g.setsAgainst}-0 loss to ${g.opponent}`, `a straight-sets defeat at the hands of ${g.opponent}`]);
  if (g.setsFor === 2) return `a heartbreaking five-set loss to ${g.opponent}`;
  return `a ${g.setsAgainst}-${g.setsFor} loss to ${g.opponent}`;
}

/** The template version (used when Claude isn't set up). `salt` gives a different wording. */
export function buildWeeklyNews(input: NewsInput, salt = ""): NewsStory | null {
  const { week, before } = input;
  if (week.length === 0) return null;
  const pick = picker(`${input.playerId}|${input.weekLabel}|${salt}`);
  const role = roleOf(input.position);
  const ks = keyStat(role);
  const last = input.lastName;
  const gp = week.length;

  const wins = week.filter((g) => g.setsFor !== null && g.setsAgainst !== null && g.setsFor > g.setsAgainst).length;
  const losses = week.filter((g) => g.setsFor !== null && g.setsAgainst !== null && g.setsFor < g.setsAgainst).length;
  const known = wins + losses;
  const pts = week.reduce((a, g) => a + g.points, 0);
  const keyTotal = statOf(week, ks.key);
  const sets = week.reduce((a, g) => a + (g.sets ?? 0), 0);

  // ---- Headline ----
  const best = [...week].sort((a, b) => statOf([b], ks.key) - statOf([a], ks.key))[0]!;
  const bestVal = statOf([best], ks.key);
  const seasonBestBefore = before.length ? Math.max(...before.map((g) => statOf([g], ks.key))) : null;
  const careerNight = seasonBestBefore !== null && bestVal > seasonBestBefore && bestVal > 0;
  const prevPpg = before.length ? before.reduce((a, g) => a + g.points, 0) / before.length : null;
  const ppg = pts / gp;
  const hot = prevPpg !== null && before.length >= 2 && ppg >= prevPpg * 1.2 && ppg - prevPpg >= 2;
  const cold = prevPpg !== null && before.length >= 2 && ppg <= prevPpg * 0.8 && prevPpg - ppg >= 2;
  const KeyWord = ks.many[0]!.toUpperCase() + ks.many.slice(1);

  let headline: string;
  if (careerNight) headline = pick([`${last} sets season high with ${bestVal} ${ks.many}`, `Season-best ${bestVal} ${ks.many} for ${last}`]);
  else if (known > 0 && losses === 0 && gp > 1) headline = pick([`${last} helps ${input.school} to a perfect weekend`, `${input.school} goes ${wins}-0 behind ${last}`]);
  else if (hot) headline = pick([`${last} heating up`, `${last} turns it up a notch`, `Big week for ${last}`]);
  else if (cold) headline = pick([`Quiet week for ${last}`, `${last} looks to bounce back`]);
  else if (known > 0 && wins === 0) headline = pick([`${last} battles in tough week for ${input.school}`, `Tough sledding for ${input.school}, but ${last} keeps working`]);
  else headline = `${last}: ${plural(keyTotal, ks.word, ks.many)} in ${plural(gp, "match", "matches")}`;

  // ---- Lead paragraph: what happened ----
  const results = week.map((g) => resultPhrase(g, pick)).filter((x): x is string => !!x);
  const record = known ? (gp === 1 ? null : `${wins}-${losses}`) : null;
  const statBits: string[] = [];
  const kills = total(week, "kills"), digs = total(week, "digs"), assists = total(week, "assists"), aces = total(week, "service_aces");
  const blk = blocks(week);
  const ordered: Array<[number, string, string]> = [
    [role === "setter" ? assists : -1, "assist", "assists"],
    [role === "libero" ? digs : -1, "dig", "digs"],
    [kills, "kill", "kills"],
    [role === "middle" ? blk : -1, "block", "blocks"],
    [role !== "libero" ? digs : -1, "dig", "digs"],
    [role !== "setter" ? assists : -1, "assist", "assists"],
    [aces, "ace", "aces"],
    [role !== "middle" ? blk : -1, "block", "blocks"],
  ];
  const seen = new Set<string>();
  for (const [v, w, m] of ordered) {
    if (seen.has(m) || v <= 0) continue;
    // Secondary stats only when they're notable.
    const primary = statBits.length === 0;
    if (!primary && m === "assists" && role !== "setter" && v < 5) continue;
    if (!primary && m === "digs" && role !== "libero" && v < 5) continue;
    seen.add(m);
    statBits.push(m === "blocks" ? `${fmtBlocks(v)} ${v === 1 ? w : m}` : plural(v, w, m));
    if (statBits.length === 4) break;
  }
  const statText = statBits.length > 1 ? `${statBits.slice(0, -1).join(", ")} and ${statBits[statBits.length - 1]}` : statBits[0] ?? "a quiet stat line";
  const opener = pick([
    `${input.firstName} ${last} and ${input.school}`,
    `${possessive(input.school)} ${input.firstName} ${last}`,
    `${roleNoun(role)} ${input.firstName} ${last}`,
  ]);
  let lead: string;
  if (gp === 1) {
    const r = results[0];
    lead = `${opener} ${r ? `came away with ${r}` : `took on ${week[0]!.opponent}`} in ${input.weekLabel}, ${pick(["finishing with", "posting", "putting up"])} ${statText}${sets ? ` across ${plural(sets, "set")}` : ""}.`;
  } else {
    const rec = record ? (wins === gp ? `swept the week ${record}` : wins === 0 ? `dropped all ${gp} matches` : `split the week at ${record}`) : `played ${gp} matches`;
    lead = `${opener} ${rec} in ${input.weekLabel}${results.length ? `, including ${results.length > 1 ? `${results.slice(0, -1).join(", ")} and ${results[results.length - 1]}` : results[0]}` : ""}. ${pick(["Over the stretch she totalled", "Across the week she racked up", "She finished the week with"])} ${statText}${sets ? ` in ${plural(sets, "set")}` : ""}.`;
  }

  // ---- Second paragraph: the standout performance and efficiency ----
  const second: string[] = [];
  if (gp > 1 && bestVal > 0) {
    second.push(`Her best night came against ${best.opponent}, with ${ks.key === "blocks" ? fmtBlocks(bestVal) : bestVal} ${bestVal === 1 ? ks.word : ks.many}${careerNight ? ", a new season high" : ""}.`);
  } else if (careerNight) {
    second.push(`That's a new season high, topping her previous best of ${seasonBestBefore}.`);
  }
  const hp = hittingPct(week);
  if (hp !== null && (role === "attacker" || role === "middle")) {
    second.push(hp >= 0.3
      ? pick([`She was ruthlessly efficient, hitting ${fmtPct(hp)}.`, `Efficiency was the story: she hit ${fmtPct(hp)} on the week.`])
      : hp >= 0.2 ? `She hit a solid ${fmtPct(hp)}.` : hp < 0.1 ? `It wasn't always clean, though, as she hit just ${fmtPct(hp)}.` : `She hit ${fmtPct(hp)}.`);
  }
  if (role === "setter" && sets > 0) second.push(`That works out to ${one(assists / sets)} assists per set running the offence.`);
  if (role === "libero" && sets > 0) second.push(`That's ${one(digs / sets)} digs per set anchoring the back row.`);
  if (aces >= 3) second.push(pick([`She was a threat from the line too, with ${plural(aces, "ace")}.`, `Add ${plural(aces, "ace")} from the service line.`]));

  // ---- Trend paragraph ----
  const trend: string[] = [];
  if (before.length >= 2) {
    const prevKey = before.reduce((a, g) => a + statOf([g], ks.key), 0) / before.length;
    const nowKey = keyTotal / gp;
    if (prevKey > 0 && nowKey >= prevKey * 1.2) trend.push(`Her ${one(nowKey)} ${ks.many} per match this week is up from ${one(prevKey)} over her first ${plural(before.length, "match", "matches")} of the season.`);
    else if (prevKey > 0 && nowKey <= prevKey * 0.8) trend.push(`Her ${one(nowKey)} ${ks.many} per match dipped from her season average of ${one(prevKey)}.`);
    else if (prevKey > 0) trend.push(`${KeyWord} have been steady: ${one(nowKey)} per match this week against ${one(prevKey)} beforehand.`);
    const recent = before.slice(0, 3);
    if (recent.length === 3 && hot && week.every((g) => g.points > recent.reduce((a, r) => a + r.points, 0) / 3)) {
      trend.push(pick(["She's trending in the right direction.", "The arrow is pointing up."]));
    }
  } else {
    trend.push(`It's still early, with ${plural(before.length + gp, "match", "matches")} on her season so far.`);
  }

  // ---- Fantasy closer ----
  const fantasy = prevPpg !== null && before.length >= 2
    ? `In fantasy terms, that's ${one(pts)} points (${one(ppg)} per match), ${hot ? `well above her ${one(prevPpg)} average and a strong week for her managers` : cold ? `below her ${one(prevPpg)} average` : Math.abs(ppg - prevPpg) <= prevPpg * 0.1 ? `right around her ${one(prevPpg)} average` : ppg > prevPpg ? `a bit better than her ${one(prevPpg)} average` : `a little under her ${one(prevPpg)} average`}.`
    : `Fantasy managers banked ${one(pts)} points from her this week.`;

  return {
    headline,
    paragraphs: [lead, [...second, ...trend].join(" "), fantasy].filter((x) => x.trim()),
  };
}

function possessive(name: string): string {
  if (/'s$/i.test(name)) return name;
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function roleNoun(role: Role): string {
  switch (role) {
    case "setter": return "Setter";
    case "libero": return "Libero";
    case "middle": return "Middle";
    default: return "Attacker";
  }
}
