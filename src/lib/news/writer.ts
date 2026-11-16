/**
 * Writes the weekly player news stories. Runs from /api/cron/news after midnight Sunday:
 * for each player who played in the week that just ended and doesn't have a story yet, Claude
 * writes one from her fact sheet. Each request carries the headlines already used this week and
 * her own recent stories, so the stories don't repeat each other. Stories are saved as they're
 * written, so a run that stops early just carries on next time.
 *
 * Without ANTHROPIC_API_KEY the template writer in src/lib/players/news.ts is used instead.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type pg from "pg";
import { buildWeeklyNews, type NewsGame, type NewsInput, type NewsStory } from "@/lib/players/news";
import { CORE_STAT_KEYS, type StatLine } from "@/lib/scoring/engine";
import { formatDate, localDate } from "@/lib/time";
import { newsFacts, type NewsExtra } from "./facts";

export const NEWS_MODEL = "claude-opus-5-5";

const STYLE_GUIDE = `You are a sports reporter writing short weekly notes on players in Ontario university (OUA) women's volleyball for a fantasy league's app. Each note is read on the player's page, right under her bio.

Write like a real beat reporter who watched the week: specific, warm, a little punchy, never robotic. Vary everything from story to story:
- Open in different ways: a key moment, a number, the team result, a comparison with her earlier weeks, a scene-setter about the opponent or the weekend. Do not start with her full name and school as a formula.
- Vary sentence length and paragraph count (two or three short paragraphs, 90-170 words in total).
- Find the angle that makes THIS week interesting (a season high, a cold or hot streak, efficiency, a five-set fight, a sweep, a quiet week, her role in a loss) and build the story around it, rather than listing every stat.
- Talk about the stats that matter for her position. Setters: assists and running the offence. Liberos: digs and defence. Middles: kills, blocks, efficiency. Outside hitters and right sides: kills and hitting percentage. Mention other stats only when they stand out.
- Mention her team's results (wins, losses, set scores) naturally.
- Mention fantasy points once at most, lightly, near the end, and only if it adds something.

Strict rules:
- Use ONLY facts from the fact sheet. Never invent quotes, coach comments, injuries, crowd details, rankings, records, streaks, standings, or anything about the opponents beyond their name. If a number isn't on the sheet, don't state it.
- Don't do new arithmetic; use the figures given. Write hitting percentage the volleyball way (.312, not 31.2%).
- Use she/her. Canadian spelling (offence, defence).
- Plain text only: no markdown, no emoji, no hashtags.
- The headline: under 10 words, specific to her week, in headline style. It must not repeat or closely imitate any headline in the "already used" list (no shared structure like "X heating up" or "Big week for X").
- Avoid stock phrases: "on fire", "stuffed the stat sheet", "made her presence felt", "a force to be reckoned with", "showcased", "proved", "in a big way", "turned heads", "electric", "dominant performance".`;

const StorySchema = z.object({
  headline: z.string(),
  paragraphs: z.array(z.string()).min(1).max(4),
});

export async function writeWithClaude(client: Anthropic, facts: string, avoid: { usedHeadlines: string[]; herPrevious: string[] }): Promise<NewsStory | null> {
  const avoidText = [
    avoid.usedHeadlines.length ? `Headlines already used this week (don't reuse their wording or pattern):\n${avoid.usedHeadlines.map((h) => `- ${h}`).join("\n")}` : "",
    avoid.herPrevious.length ? `Her earlier stories began like this (write something that reads differently):\n${avoid.herPrevious.map((h) => `- ${h}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const response = await client.beta.messages.parse({
    model: NEWS_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(StorySchema) },
    system: [{ type: "text", text: STYLE_GUIDE, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Fact sheet:\n${facts}${avoidText ? `\n\n${avoidText}` : ""}\n\nWrite her story for this week.` }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const out = response.parsed_output;
  if (!out || !out.headline.trim() || out.paragraphs.every((p) => !p.trim())) return null;
  return { headline: out.headline.trim(), paragraphs: out.paragraphs.map((p) => p.trim()).filter(Boolean) };
}

interface StatRow {
  player_id: string; first_name: string; last_name: string; position_label: string | null; university_id: string | null;
  match_id: string; match_date: string; home_university_id: string | null; away_university_id: string | null;
  home_sets: number | null; away_sets: number | null; sets_played: number | null; points: string | null; week: number | null;
  [k: string]: unknown;
}

export interface NewsRunResult {
  league: string | null;
  week: number | null;
  due: number;
  written: number;
  byClaude: number;
  byTemplate: number;
  remaining: number;
  errors: string[];
}

/** Writes any missing stories for the most recent completed week, until the deadline. */
export async function runNewsWriter(pool: pg.Pool, opts: { deadline: number; parallel?: number; maxStories?: number; client?: Anthropic | null; today?: string }): Promise<NewsRunResult> {
  const result: NewsRunResult = { league: null, week: null, due: 0, written: 0, byClaude: 0, byTemplate: 0, remaining: 0, errors: [] };
  const client = opts.client !== undefined ? opts.client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const { rows: leagues } = await pool.query<{ id: string; season_label: string; timezone: string }>(
    `select id, season_label, timezone from public.leagues where status in ('setup', 'active') order by created_at`);
  for (const league of leagues) {
    const today = opts.today ?? localDate(new Date(), league.timezone);
    const { rows: [wk] } = await pool.query<{ week: number; starts_on: string; ends_on: string }>(
      `select week, starts_on::text, ends_on::text from public.matchup_weeks where league_id = $1 and ends_on < $2 order by week desc limit 1`,
      [league.id, today]);
    if (!wk) continue;
    result.league = league.id;
    result.week = wk.week;

    const statCols = CORE_STAT_KEYS.map((k) => `s.${k}`).join(", ");
    const { rows } = await pool.query<StatRow>(
      `select s.player_id, p.first_name, p.last_name, p.position_label, p.university_id, ${statCols}, s.sets_played,
              m.id as match_id, m.match_date::text, m.home_university_id, m.away_university_id, m.home_sets, m.away_sets,
              pmp.points, pmp.week
         from public.player_match_statistics s
         join public.matches m on m.id = s.match_id
         join public.players p on p.id = s.player_id
         left join public.v_player_match_points pmp on pmp.match_id = s.match_id and pmp.player_id = s.player_id and pmp.league_id = $1
        where m.season_label = $2 and m.match_date <= $3 and p.duplicate_of is null
          and m.status = 'final'`,
      [league.id, league.season_label, wk.ends_on]);
    const { rows: unis } = await pool.query<{ id: string; name: string; short_name: string | null }>(`select id, name, short_name from public.universities`);
    const uniName = new Map(unis.map((u) => [u.id, u.short_name ?? u.name]));
    const { rows: existing } = await pool.query<{ player_id: string; week: number; headline: string; first: string | null }>(
      `select player_id, week, headline, paragraphs->>0 as first from public.player_news where league_id = $1 and week >= $2 - 3`, [league.id, wk.week]);
    const done = new Set(existing.filter((e) => e.week === wk.week).map((e) => e.player_id));
    const usedHeadlines = existing.filter((e) => e.week === wk.week).map((e) => e.headline);
    const previousOf = new Map<string, string[]>();
    for (const e of existing.filter((x) => x.week < wk.week)) {
      previousOf.set(e.player_id, [...(previousOf.get(e.player_id) ?? []), `${e.headline} — ${(e.first ?? "").slice(0, 140)}`]);
    }

    const byPlayer = new Map<string, StatRow[]>();
    for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
    const due = [...byPlayer.entries()]
      .filter(([pid, rs]) => !done.has(pid) && rs.some((r) => r.match_date >= wk.starts_on && r.match_date <= wk.ends_on))
      // Players with the biggest weeks first, so the stars are written first.
      .sort((a, b) => weekPoints(b[1], wk) - weekPoints(a[1], wk));
    result.due += due.length;

    const toGame = (r: StatRow): NewsGame => {
      const home = r.home_university_id === r.university_id;
      const opp = home ? r.away_university_id : r.home_university_id;
      return {
        date: r.match_date, opponent: opp ? uniName.get(opp) ?? "?" : "?",
        setsFor: home ? r.home_sets : r.away_sets, setsAgainst: home ? r.away_sets : r.home_sets, sets: r.sets_played,
        line: Object.fromEntries(CORE_STAT_KEYS.map((k) => [k, Number(r[k] ?? 0)])) as StatLine,
        points: Number(r.points ?? 0),
      };
    };
    const parallel = opts.parallel ?? 4;
    let i = 0;
    while (i < due.length && Date.now() < opts.deadline && (opts.maxStories === undefined || result.written < opts.maxStories)) {
      const batch = due.slice(i, i + parallel);
      i += batch.length;
      const stories = await Promise.all(batch.map(async ([pid, rs]) => {
        const first = rs[0]!;
        const input: NewsInput = {
          playerId: pid, firstName: first.first_name, lastName: first.last_name, position: first.position_label,
          school: first.university_id ? uniName.get(first.university_id) ?? "her school" : "her school",
          weekLabel: `Week ${wk.week}`,
          week: rs.filter((r) => r.match_date >= wk.starts_on && r.match_date <= wk.ends_on).sort((a, b) => a.match_date.localeCompare(b.match_date)).map(toGame),
          before: rs.filter((r) => r.match_date < wk.starts_on).sort((a, b) => b.match_date.localeCompare(a.match_date)).map(toGame),
        };
        const weekly = new Map<number, { points: number; games: number }>();
        for (const r of rs) if (r.week !== null) {
          const w = weekly.get(r.week) ?? { points: 0, games: 0 };
          weekly.set(r.week, { points: w.points + Number(r.points ?? 0), games: w.games + 1 });
        }
        const extra: NewsExtra = {
          weekDates: `${formatDate(wk.starts_on, { month: "short", day: "numeric" })} to ${formatDate(wk.ends_on, { month: "short", day: "numeric" })}`,
          weeklyPoints: [...weekly.entries()].sort((a, b) => a[0] - b[0]).map(([week, v]) => ({ week, ...v })),
        };
        if (client) {
          try {
            const s = await writeWithClaude(client, newsFacts(input, extra), { usedHeadlines, herPrevious: previousOf.get(pid) ?? [] });
            if (s) return { pid, story: s, by: "claude" as const };
          } catch (e) {
            result.errors.push(`${first.last_name}: ${(e as Error).message.slice(0, 160)}`);
            // Out of credit, bad key and the like: stop for now and try again on the next run.
            if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.RateLimitError) return null;
            if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) return null;
          }
          return null;
        }
        return { pid, story: templateStory(input, usedHeadlines), by: "template" as const };
      }));
      for (const s of stories) {
        if (!s?.story) continue;
        await pool.query(
          `insert into public.player_news (league_id, player_id, week, headline, paragraphs, written_by)
           values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (league_id, player_id, week) do nothing`,
          [league.id, s.pid, wk.week, s.story.headline, JSON.stringify(s.story.paragraphs), s.by]);
        usedHeadlines.push(s.story.headline);
        result.written++;
        if (s.by === "claude") result.byClaude++; else result.byTemplate++;
      }
      if (client && stories.every((s) => s === null) && result.errors.length) break; // the API is unavailable right now
    }
  }
  result.remaining = result.due - result.written;
  return result;
}

function weekPoints(rs: StatRow[], wk: { starts_on: string; ends_on: string }): number {
  return rs.filter((r) => r.match_date >= wk.starts_on && r.match_date <= wk.ends_on).reduce((a, r) => a + Number(r.points ?? 0), 0);
}

/** The template story, re-worded until its headline hasn't been used this week. */
export function templateStory(input: NewsInput, used: readonly string[]): NewsStory | null {
  const taken = new Set(used.map((h) => h.toLowerCase()));
  let story: NewsStory | null = null;
  for (let k = 0; k < 12; k++) {
    story = buildWeeklyNews(input, String(k));
    if (!story || !taken.has(story.headline.toLowerCase())) return story;
  }
  return story;
}
