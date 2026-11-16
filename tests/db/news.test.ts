import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type Anthropic from "@anthropic-ai/sdk";
import { runNewsWriter } from "@/lib/news/writer";
import { addMatch, addStat, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
  // Week 1 (Nov 9-15): X beat Y 3-1 on Friday, then lost to Z 2-3 on Saturday. A week-2 game too.
  const m1 = await addMatch(client, f, { date: "2026-11-13", lockAt: "2026-11-13T23:00:00Z", a: f.uniX, b: f.uniY });
  await client.query(`update matches set home_sets = 3, away_sets = 1 where id = $1`, [m1]);
  const m2 = await addMatch(client, f, { date: "2026-11-14", lockAt: "2026-11-14T23:00:00Z", a: f.uniZ, b: f.uniX });
  await client.query(`update matches set home_sets = 3, away_sets = 2 where id = $1`, [m2]);
  const m3 = await addMatch(client, f, { date: "2026-11-20", lockAt: "2026-11-20T23:00:00Z", a: f.uniX, b: f.uniY });
  await addStat(client, f.players.oh1!, m1, { kills: 14, attack_errors: 3, digs: 6 });
  await addStat(client, f.players.oh1!, m2, { kills: 19, attack_errors: 5, digs: 9, service_aces: 2 });
  await addStat(client, f.players.oh2!, m1, { kills: 8, digs: 4 });
  await addStat(client, f.players.ohB!, m2, { kills: 11, digs: 3 });
  await addStat(client, f.players.m1!, m3, { kills: 5 }); // only played in week 2: no week-1 story
});
afterAll(async () => drop());

const pool = () => client as unknown as pg.Pool;

/** A stand-in for the Claude API that records what it was asked. */
function fakeClaude(calls: string[]) {
  let n = 0;
  return {
    beta: { messages: { parse: async (req: { messages: Array<{ content: string }>; system: Array<{ text: string }> }) => {
      calls.push(req.messages[0]!.content);
      n++;
      return { stop_reason: "end_turn", parsed_output: { headline: `Story number ${n}`, paragraphs: ["First paragraph.", "Second paragraph."] } };
    } } },
  } as unknown as Anthropic;
}

describe("weekly news writer", () => {
  it("writes one story per player who played in the week that just ended, from her real numbers", async () => {
    const calls: string[] = [];
    const r = await runNewsWriter(pool(), { deadline: Date.now() + 20_000, client: fakeClaude(calls), today: "2026-11-16", parallel: 1 });
    expect(r.week).toBe(1);
    expect(r.written).toBe(3);
    expect(r.byClaude).toBe(3);
    const rows = (await client.query(`select player_id, headline, paragraphs, written_by from player_news order by headline`)).rows;
    expect(rows.map((x) => x.player_id).sort()).toEqual([f.players.oh1, f.players.oh2, f.players.ohB].sort());
    expect(rows[0].paragraphs).toEqual(["First paragraph.", "Second paragraph."]);
    // The fact sheet has her matches with results, and the totals worked out.
    const oh1 = calls.find((c) => c.includes("Player: oh1 Test"))!;
    expect(oh1).toMatch(/vs Y: her team WON 3-1/);
    expect(oh1).toMatch(/vs Z: her team LOST 3-2/);
    expect(oh1).toMatch(/33 kills/);
    expect(oh1).toMatch(/team record 1-1/);
    // Later requests are told which headlines are already taken.
    expect(calls[calls.length - 1]).toMatch(/Headlines already used this week/);
  });

  it("does nothing on the next run: stories are written once and kept", async () => {
    const calls: string[] = [];
    const r = await runNewsWriter(pool(), { deadline: Date.now() + 20_000, client: fakeClaude(calls), today: "2026-11-17" });
    expect(r.written).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("without an API key, writes template stories with different headlines", async () => {
    await client.query(`delete from player_news`);
    const r = await runNewsWriter(pool(), { deadline: Date.now() + 20_000, client: null, today: "2026-11-16" });
    expect(r.byTemplate).toBe(3);
    const heads = (await client.query(`select headline from player_news`)).rows.map((x) => x.headline);
    expect(new Set(heads).size).toBe(3);
  });

  it("players can read their league's stories", async () => {
    const { asUser } = await import("./helpers");
    const seen = await asUser(client, f.alice, () => client.query(`select count(*)::int n from player_news`));
    expect(seen.rows[0].n).toBe(3);
  });
});
