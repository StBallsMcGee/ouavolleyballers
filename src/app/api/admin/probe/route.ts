import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Only these public stats sites can be checked.
const ALLOWED_HOSTS = new Set(["oua.ca", "www.oua.ca"]);

/**
 * One ordinary request from the app's server to a public OUA stats page, to see whether the site
 * answers it and what the page looks like (protected by CRON_SECRET; for setting up a stats source).
 *   GET /api/admin/probe?url=https://oua.ca/sports/wvball/2026-27/boxscores/....xml
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let target: URL;
  try {
    target = new URL(req.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ error: "Give a full url." }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: "Only https://oua.ca pages can be checked." }, { status: 400 });
  }
  const started = Date.now();
  try {
    const res = await fetch(target, {
      headers: { "user-agent": "Sideout fantasy league stats (non-commercial; contact via league admin)", accept: "text/html,application/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    return NextResponse.json({
      url: target.toString(),
      finalUrl: res.url,
      status: res.status,
      ms: Date.now() - started,
      region: process.env.VERCEL_REGION ?? null,
      contentType: res.headers.get("content-type"),
      server: res.headers.get("server"),
      length: body.length,
      body: body.slice(0, 300_000),
    });
  } catch (e) {
    return NextResponse.json({ url: target.toString(), error: (e as Error).message, ms: Date.now() - started }, { status: 502 });
  }
}
