import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runSync } from "@/lib/sync/run";

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
 * Called by the cloud scheduler (Vercel Cron and/or Supabase pg_cron). Requires
 * "Authorization: Bearer <CRON_SECRET>". Runs one sync and reports what happened.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runSync();
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}

export const POST = GET;
