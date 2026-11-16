import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db/pg";
import { runNewsWriter } from "@/lib/news/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Writes the weekly player news stories for the week that just ended (from pg_cron, every few
 * minutes early on Monday, plus a daily catch-up). Does nothing once every story is written.
 * ?max=N limits how many stories one run writes (for trying it out).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const max = Number.parseInt(req.nextUrl.searchParams.get("max") ?? "", 10);
  const result = await runNewsWriter(getPool(), {
    deadline: Date.now() + 40_000,
    maxStories: Number.isFinite(max) && max > 0 ? max : undefined,
  });
  return NextResponse.json({ ok: true, ...result });
}

export const POST = GET;
