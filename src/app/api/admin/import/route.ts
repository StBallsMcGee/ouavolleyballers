import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { importFromUsportvb } from "@/lib/migration/run-import";

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
 * League import, protected by CRON_SECRET. Dry run unless mode=apply.
 *   GET /api/admin/import?league=<id>&exclude=<teamId>&cutover=4[&mode=apply][&refresh=1]
 * Without league/cutover it reuses the options of the last successful import.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const mode = q.get("mode") === "apply" ? "apply" : "dry_run";
  const cutover = q.get("cutover") ? Number(q.get("cutover")) : undefined;
  try {
    const result = await importFromUsportvb({
      mode,
      leagueId: q.get("league") ?? undefined,
      excludeTeamIds: q.getAll("exclude").length ? q.getAll("exclude") : undefined,
      cutoverWeek: cutover,
      refresh: q.get("refresh") === "1",
      createdBy: "api",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
