import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withTransaction } from "@/lib/db/pg";
import { writeProfiles, type SchoolProfiles } from "@/lib/ingest/profiles";
import { OTTAWA_SOURCE_ID, PRESTO_SCHOOLS, parsePrestoRoster, type PrestoSchool } from "@/lib/sources/presto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const OTTAWA_HOSTS = new Set(["geegees.ca", "www.geegees.ca", "ottawa.prestosports.com"]);

/**
 * Reads the Trent and Lakehead roster pages (and Ottawa's, given ?ottawa=<roster url>) from this
 * server and saves each player's photo link and profile. ?dry=1 shows what would be saved.
 * Protected by CRON_SECRET. One request per school.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const schools: PrestoSchool[] = [...PRESTO_SCHOOLS];
  const ottawa = req.nextUrl.searchParams.get("ottawa");
  if (ottawa) {
    let host = "";
    try { host = new URL(ottawa).hostname; } catch { /* checked below */ }
    if (!OTTAWA_HOSTS.has(host) || !ottawa.startsWith("https://")) return NextResponse.json({ error: "Ottawa roster must be an https geegees.ca page" }, { status: 400 });
    schools.push({ key: "ottawa", label: "Ottawa Gee-Gees", universitySourceId: OTTAWA_SOURCE_ID, rosterUrl: ottawa });
  }

  const report: Array<{ school: string; status: number | string; players: number; withPhoto: number }> = [];
  const collected: SchoolProfiles[] = [];
  for (const s of schools) {
    try {
      const res = await fetch(s.rosterUrl, {
        headers: { "user-agent": "Sideout fantasy league (non-commercial; roster photos with school permission)", accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const html = res.ok ? await res.text() : "";
      const site = new URL(res.url || s.rosterUrl).hostname;
      // Keep only links on the school's own site.
      const profiles = parsePrestoRoster(html, res.url || s.rosterUrl).map((p) => ({
        ...p,
        photoUrl: p.photoUrl && new URL(p.photoUrl).hostname === site ? p.photoUrl : null,
        profileUrl: p.profileUrl && new URL(p.profileUrl).hostname === site ? p.profileUrl : null,
      }));
      report.push({ school: s.label, status: res.status, players: profiles.length, withPhoto: profiles.filter((p) => p.photoUrl).length });
      if (profiles.length) collected.push({ key: s.key, label: s.label, universitySourceId: s.universitySourceId, site, profiles });
    } catch (e) {
      report.push({ school: s.label, status: (e as Error).message, players: 0, withPhoto: 0 });
    }
  }

  try {
    const result = await withTransaction((db) => writeProfiles(db, collected), { commit: !dry });
    return NextResponse.json({ ok: true, dry, report, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, report, error: (e as Error).message }, { status: 500 });
  }
}
