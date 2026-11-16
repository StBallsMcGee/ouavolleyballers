/**
 * Writes the weekly player news stories. Runs from /api/cron/news after midnight Sunday:
 * for each player who played in the week that just ended and doesn't have a story yet, Claude
 * writes one from her fact sheet. Each request carries the headlines already used this week and
 * her own recent stories, so the stories don't repeat each other. Stories are saved as they're
 * written, so a run that stops early just carries on next time.
 *
 * Who writes: Gemini when GEMINI_API_KEY is set (free tier), otherwise Claude when
 * ANTHROPIC_API_KEY is set, otherwise the template writer in src/lib/players/news.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type pg from "pg";
import { buildWeeklyNews, type NewsGame, type NewsInput, type NewsStory } from "@/lib/players/news";
import { CORE_STAT_KEYS, type StatLine } from "@/lib/scoring/engine";
import { formatDate, localDate } from "@/lib/time";
import { GoogleGenAI } from "@google/genai";
import { newsFacts, type NewsExtra } from "./facts";
import { GeminiRateLimited, writeWithGemini } from "./gemini";

export const NEWS_MODEL = "claude-opus-5-5";

const STYLE_GUIDE = `You write weekly notes on players in Ontario university (OUA) women's volleyball for a fantasy league's app. Each note appears on the player's page, right under her bio.

The league's instructions, which come first:
1. Write this like a sports journalist.
2. Avoid repeating the same phrases or headlines as much as possible.
3. Cover the player's relevant stats.
4. Include a sentence or two on how she's expected to perform next week.

How to do that:
- Sound like a real beat reporter who watched the week: specific, warm, a little punchy, never robotic.
- No repetition: every note must read differently from the others. Vary the opening (a key moment, a number, the team result, a comparison with her earlier weeks, the weekend's opponents), sentence length, rhythm, verbs and paragraph count. Don't start with her full name and school as a formula. Don't reuse the wording or structure of any headline or opening you're shown as already used.
- Find the angle that makes THIS week interesting (a season high, a hot or cold stretch, efficiency, a five-set fight, a sweep, a quiet week, her role in a loss) and build the note around it rather than listing every number.
- Relevant stats by position. Setters: assists, assists per set, running the offence. Liberos and defensive specialists: digs, digs per set, defence. Middles: kills, blocks, hitting percentage. Outside hitters and right sides: kills and hitting percentage. Bring in other stats only when they stand out.
- Work her team's results (wins, losses, set scores) in naturally.
- Close with a sentence or two on next week, using only the NEXT WEEK section: how many matches and against whom (home or away), and what her projection suggests. Frame it as an expectation ("should", "projects to", "will look to"), never a guarantee. If her team has a bye, say she's idle next week.
- Fantasy points: mention them at most once or twice, lightly.
- Two or three short paragraphs, 100-180 words in total.

Strict rules:
- Use ONLY facts from the fact sheet. Never invent quotes, coach comments, injuries, crowd details, rankings, records, streaks, standings, or anything about the opponents beyond their names. If a number isn't on the sheet, don't state it.
- Don't do new arithmetic; use the figures given. Write hitting percentage the volleyball way (.312, not 31.2%).
- Use she/her. Canadian spelling (offence, defence).
- Plain text only: no markdown, no emoji, no hashtags.
- Headline: under 10 words, specific to her week, in headline style, and different in wording and pattern from every headline listed as already used (no shared templates like "X heating up" or "Big week for X").
- Avoid stock phrases: "on fire", "stuffed the stat sheet", "made her presence felt", "a force to be reckoned with", "showcased", "proved", "in a big way", "turned heads", "electric", "dominant performance", "look to build on", "carry that momentum".`;

const StorySchema = z.object({
  headline: z.string(),
  paragraphs: z.array(z.string()).min(1).max(4),
});

export interface Avoid { usedHeadlines: string[]; herPrevious: string[] }

/** The request text: her fact sheet, plus what's already been written (so nothing repeats). */
export function storyPrompt(facts: string, avoid: Avoid): string {
  const avoidText = [
    avoid.usedHeadlines.length ? `Headlines already used this week (don't reuse their wording or pattern):\n${avoid.usedHeadlines.map((h) => `- ${h}`).join("\n")}` : "",
    avoid.herPrevious.length ? `Her earlier stories began like this (write something that reads differently):\n${avoid.herPrevious.map((h) => `- ${h}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return `Fact sheet:\n${facts}${avoidText ? `\n\n${avoidText}` : ""}\n\nWrite her story for this week. Reply with JSON: {"headline": "...", "paragraphs": ["...", "..."]}.`;
}

/** An AI story writer: who it is, how many requests at once, and the pause between batches. */
export interface StoryWriter {
  by: "claude" | "gemini";
  parallel: number;
  gapMs: number;
  write: (facts: string, avoid: Avoid, deadline: number) => Promise<NewsStory | null>;
}

export function geminiWriter(ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })): StoryWriter {
  // Free tier: roughly 10 requests a minute, so one at a time, about 6.5 seconds apart.
  return { by: "gemini", parallel: 1, gapMs: 6500, write: (facts, avoid, deadline) => writeWithGemini(ai, STYLE_GUIDE, storyPrompt(facts, avoid), deadline) };
}

export function claudeWriter(client = new Anthropic()): StoryWriter {
  return { by: "claude", parallel: 4, gapMs: 0, write: (facts, avoid) => writeWithClaude(client, facts, avoid) };
}

/** The writer the environment is set up for (null = templates). */
export function defaultWriter(): StoryWriter | null {
  if (process.env.GEMINI_API_KEY) return geminiWriter();
  if (process.env.ANTHROPIC_API_KEY) return claudeWriter();
  return null;
}

export async function writeWithClaude(client: Anthropic, facts: string, avoid: Avoid): Promise<NewsStory | null> {
  const response = await client.beta.messages.parse({
    model: NEWS_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(StorySchema) },
    system: [{ type: "text", text: STYLE_GUIDE, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: storyPrompt(facts, avoid) }],
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
  byAi: number;
  writer: "claude" | "gemini" | "template";
  /** The stories written in this run (so a run can be checked). */
  stories: Array<{ player: string; headline: string; paragraphs: string[] }>;
  byTemplate: number;
  remaining: number;
  errors: string[];
}

/** Writes any missing stories for the most recent completed week, until the deadline. */
export async function runNewsWriter(pool: pg.Pool, opts: { deadline: number; parallel?: number; maxStories?: number; writer?: StoryWriter | null; today?: string }): Promise<NewsRunResult> {
  const writer = opts.writer !== undefined ? opts.writer : defaultWriter();
  const result: NewsRunResult = { league: null, week: null, due: 0, written: 0, byAi: 0, byTemplate: 0, remaining: 0, errors: [], writer: writer?.by ?? "template", stories: [] };
  let stop = false;
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
    const uniName = new Map(unis.map((u) => [u.id, u.name])); // full names ("Lakehead", not "LU") so stories read naturally
    const { rows: existing } = await pool.query<{ player_id: string; week: number; headline: string; first: string | null }>(
      `select player_id, week, headline, paragraphs->>0 as first from public.player_news where league_id = $1 and week >= $2 - 3`, [league.id, wk.week]);
    const done = new Set(existing.filter((e) => e.week === wk.week).map((e) => e.player_id));
    const usedHeadlines = existing.filter((e) => e.week === wk.week).map((e) => e.headline);
    const previousOf = new Map<string, string[]>();
    for (const e of existing.filter((x) => x.week < wk.week)) {
      previousOf.set(e.player_id, [...(previousOf.get(e.player_id) ?? []), `${e.headline} — ${(e.first ?? "").slice(0, 140)}`]);
    }

    // The coming week: her team's schedule and her projection, for the outlook.
    const { rows: [nextWk] } = await pool.query<{ week: number; starts_on: string; ends_on: string }>(
      `select week, starts_on::text, ends_on::text from public.matchup_weeks where league_id = $1 and week = $2`, [league.id, wk.week + 1]);
    const { rows: upcoming } = nextWk ? await pool.query<{ match_date: string; home_university_id: string | null; away_university_id: string | null; home_away_known: boolean }>(
      `select match_date::text, home_university_id, away_university_id, home_away_known from public.matches
        where match_date between $1 and $2 and status not in ('cancelled', 'postponed') and counts_for_fantasy order by match_date`,
      [nextWk.starts_on, nextWk.ends_on]) : { rows: [] };
    const { rows: projRows } = await pool.query<{ player_id: string; proj_per_game: string | null; last3_avg: string | null; avg_points: string | null }>(
      `select player_id, proj_per_game, last3_avg, avg_points from public.player_projections where league_id = $1`, [league.id]);
    const projections = new Map(projRows.map((r) => [r.player_id, r]));

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
    const parallel = opts.parallel ?? writer?.parallel ?? 4;
    let i = 0;
    while (!stop && i < due.length && Date.now() < opts.deadline && (opts.maxStories === undefined || result.written < opts.maxStories)) {
      if (i > 0 && writer?.gapMs) {
        if (Date.now() + writer.gapMs + 15_000 > opts.deadline) break; // not enough time for another request
        await new Promise((r) => setTimeout(r, writer.gapMs));
      }
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
        const pr = projections.get(pid);
        const extra: NewsExtra = {
          weekDates: `${formatDate(wk.starts_on, { month: "short", day: "numeric" })} to ${formatDate(wk.ends_on, { month: "short", day: "numeric" })}`,
          weeklyPoints: [...weekly.entries()].sort((a, b) => a[0] - b[0]).map(([week, v]) => ({ week, ...v })),
          nextWeek: nextWk ? {
            week: nextWk.week,
            dates: `${formatDate(nextWk.starts_on, { month: "short", day: "numeric" })} to ${formatDate(nextWk.ends_on, { month: "short", day: "numeric" })}`,
            matches: upcoming.filter((m) => m.home_university_id === first.university_id || m.away_university_id === first.university_id).map((m) => {
              const home = m.home_university_id === first.university_id;
              const opp = home ? m.away_university_id : m.home_university_id;
              return { date: m.match_date, opponent: opp ? uniName.get(opp) ?? "?" : "?", home: m.home_away_known ? home : null };
            }),
          } : null,
          projection: pr ? { perGame: num(pr.proj_per_game), last3Avg: num(pr.last3_avg), seasonAvg: num(pr.avg_points) } : null,
        };
        input.next = extra.nextWeek ? { matches: extra.nextWeek.matches.length, opponents: extra.nextWeek.matches.map((m) => m.opponent), projPerGame: extra.projection?.perGame ?? null } : null;
        if (writer) {
          try {
            const s = await writer.write(newsFacts(input, extra), { usedHeadlines, herPrevious: previousOf.get(pid) ?? [] }, opts.deadline);
            if (s) return { pid, name: `${first.first_name} ${first.last_name}`, story: s, by: writer.by };
          } catch (e) {
            result.errors.push(`${first.last_name}: ${(e as Error).message.slice(0, 160)}`);
            // Rate limit, bad key, outage: stop for now; the next scheduled run carries on.
            if (e instanceof GeminiRateLimited || !(e instanceof SyntaxError)) stop = true;
          }
          return null;
        }
        return { pid, name: `${first.first_name} ${first.last_name}`, story: templateStory(input, usedHeadlines), by: "template" as const };
      }));
      for (const s of stories) {
        if (!s?.story) continue;
        await pool.query(
          `insert into public.player_news (league_id, player_id, week, headline, paragraphs, written_by)
           values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (league_id, player_id, week) do nothing`,
          [league.id, s.pid, wk.week, s.story.headline, JSON.stringify(s.story.paragraphs), s.by]);
        usedHeadlines.push(s.story.headline);
        result.stories.push({ player: s.name, headline: s.story.headline, paragraphs: s.story.paragraphs });
        result.written++;
        if (s.by === "template") result.byTemplate++; else result.byAi++;
      }
    }
  }
  result.remaining = result.due - result.written;
  return result;
}

const num = (v: string | null) => (v === null ? null : Number(v));

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
