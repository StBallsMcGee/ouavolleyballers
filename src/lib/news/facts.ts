/**
 * The fact sheet a news story is written from. Every number is worked out here, so the writer
 * only has to tell the story, never do arithmetic.
 */
import { fmtPct, hittingPct, roleOf, type NewsGame, type NewsInput } from "@/lib/players/news";
import { formatDate } from "@/lib/time";

const n = (g: NewsGame, k: string) => Number((g.line as Record<string, number>)[k] ?? 0);
const sum = (gs: readonly NewsGame[], k: string) => gs.reduce((a, g) => a + n(g, k), 0);
const blocks = (gs: readonly NewsGame[]) => sum(gs, "solo_blocks") + sum(gs, "block_assists") * 0.5;
const r1 = (v: number) => Math.round(v * 10) / 10;

const ROLE_STATS: Record<ReturnType<typeof roleOf>, string> = {
  setter: "assists (and assists per set), plus digs, aces and any attacking",
  libero: "digs (and digs per set), plus assists and aces",
  middle: "kills, blocks and hitting percentage",
  attacker: "kills and hitting percentage, plus digs, aces and blocks",
};

function gameLine(g: NewsGame): string {
  const res = g.setsFor === null || g.setsAgainst === null ? "result unknown"
    : g.setsFor > g.setsAgainst ? `WON ${g.setsFor}-${g.setsAgainst}` : `LOST ${g.setsAgainst}-${g.setsFor}`;
  const hp = hittingPct([g]);
  const parts = [
    `${n(g, "kills")} kills (${n(g, "attack_errors")} attack errors${n(g, "attack_attempts") ? ` on ${n(g, "attack_attempts")} attempts` : ""}${hp !== null ? `, hit ${fmtPct(hp)}` : ""})`,
    `${n(g, "assists")} assists`,
    `${n(g, "digs")} digs`,
    `${n(g, "service_aces")} aces (${n(g, "service_errors")} service errors)`,
    `${r1(blocks([g]))} blocks (${n(g, "solo_blocks")} solo, ${n(g, "block_assists")} assisted)`,
  ];
  return `- ${formatDate(g.date, { weekday: "long", month: "short", day: "numeric" })} vs ${g.opponent}: her team ${res}${g.sets ? `; she played ${g.sets} sets` : ""}. Her line: ${parts.join(", ")}. Fantasy points: ${r1(g.points)}.`;
}

export interface NewsExtra {
  weekDates: string;
  weeklyPoints: Array<{ week: number; points: number; games: number }>;
}

export function newsFacts(input: NewsInput, extra: NewsExtra): string {
  const { week, before } = input;
  const role = roleOf(input.position);
  const wins = week.filter((g) => g.setsFor !== null && g.setsAgainst !== null && g.setsFor > g.setsAgainst).length;
  const losses = week.filter((g) => g.setsFor !== null && g.setsAgainst !== null && g.setsFor < g.setsAgainst).length;
  const sets = week.reduce((a, g) => a + (g.sets ?? 0), 0);
  const pts = week.reduce((a, g) => a + g.points, 0);
  const hp = hittingPct(week);
  const lines: string[] = [
    `Player: ${input.firstName} ${input.lastName}`,
    `School: ${input.school}`,
    `Position: ${input.position ?? "unknown"} (what matters most for her: ${ROLE_STATS[role]})`,
    `Story covers: ${input.weekLabel} of the fantasy season (${extra.weekDates})`,
    "",
    "Her matches this week:",
    ...week.map(gameLine),
    "",
    `Week totals: ${week.length} match${week.length === 1 ? "" : "es"}, team record ${wins}-${losses}${sets ? `, ${sets} sets played` : ""}; ${sum(week, "kills")} kills, ${sum(week, "assists")} assists, ${sum(week, "digs")} digs, ${sum(week, "service_aces")} aces, ${r1(blocks(week))} blocks${hp !== null ? `, hit ${fmtPct(hp)}` : ""}${sets ? `; per set: ${r1(sum(week, "kills") / sets)} kills, ${r1(sum(week, "assists") / sets)} assists, ${r1(sum(week, "digs") / sets)} digs` : ""}.`,
    `Fantasy points this week: ${r1(pts)} (${r1(pts / week.length)} per match).`,
    "",
  ];
  if (before.length) {
    const bSets = before.reduce((a, g) => a + (g.sets ?? 0), 0);
    const bhp = hittingPct(before);
    const high = (k: string) => Math.max(...before.map((g) => (k === "blocks" ? blocks([g]) : n(g, k))));
    lines.push(
      `Earlier this season (before this week): ${before.length} matches; per match ${r1(sum(before, "kills") / before.length)} kills, ${r1(sum(before, "assists") / before.length)} assists, ${r1(sum(before, "digs") / before.length)} digs, ${r1(blocks(before) / before.length)} blocks${bSets ? `; per set ${r1(sum(before, "kills") / bSets)} kills, ${r1(sum(before, "assists") / bSets)} assists, ${r1(sum(before, "digs") / bSets)} digs` : ""}${bhp !== null ? `; hitting ${fmtPct(bhp)}` : ""}; ${r1(before.reduce((a, g) => a + g.points, 0) / before.length)} fantasy points per match.`,
      `Her single-match season highs before this week: ${high("kills")} kills, ${high("assists")} assists, ${high("digs")} digs, ${high("service_aces")} aces, ${r1(high("blocks"))} blocks. Beating one of these this week means a new season high; matching it ties it.`,
    );
  } else {
    lines.push("This was her first week with stats this season.");
  }
  if (extra.weeklyPoints.length > 1) {
    lines.push(`Her fantasy points by week this season: ${extra.weeklyPoints.map((w) => `week ${w.week}: ${r1(w.points)} in ${w.games} match${w.games === 1 ? "" : "es"}`).join("; ")}.`);
  }
  return lines.join("\n");
}
