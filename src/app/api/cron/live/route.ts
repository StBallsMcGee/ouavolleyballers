import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOuaLiveSync } from "@/lib/ingest/oua-live";
import { processDueWaivers } from "@/lib/sync/run";
import { getPool } from "@/lib/db/pg";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Live scoring tick (every few minutes, from Supabase pg_cron). Does nothing when no game is on. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Every few minutes anyway, so waiver claims are decided within minutes of midnight.
  const waiversWon = await processDueWaivers(getPool()).catch(() => 0);
  const result = await runOuaLiveSync();
  return NextResponse.json({ ...result, waiversWon }, { status: result.status === "failed" ? 502 : 200 });
}

export const POST = GET;
