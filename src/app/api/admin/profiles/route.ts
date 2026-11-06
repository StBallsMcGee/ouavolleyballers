import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "@/lib/db/pg";
import { writeProfiles } from "@/lib/ingest/profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const str = z.string().max(300).nullable();
const httpsUrl = z.string().url().refine((u) => u.startsWith("https://"), "https only").nullable();
const bodySchema = z.object({
  schools: z.array(z.object({
    key: z.string().max(40),
    label: z.string().max(80),
    universitySourceId: z.string().max(40),
    site: z.string().max(100),
    profiles: z.array(z.object({
      name: z.string().min(1).max(120), jersey: z.number().int().nullable(), position: str, height: str,
      academicYear: str, hometown: str, previousTeam: str, photoUrl: httpsUrl, profileUrl: httpsUrl,
    })).max(80),
  })).max(30),
});

/**
 * Receives player profiles collected from official school roster pages (scripts/collect-roster-profiles.ts)
 * and saves them. Protected by CRON_SECRET. All-or-nothing.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  // Photos must come from the same school site as the roster page.
  for (const s of parsed.data.schools) {
    for (const p of s.profiles) {
      for (const u of [p.photoUrl, p.profileUrl]) {
        if (u && new URL(u).hostname !== s.site) return NextResponse.json({ error: `URL ${u} is not on ${s.site}` }, { status: 400 });
      }
    }
  }
  try {
    const result = await withTransaction((db) => writeProfiles(db, parsed.data.schools), { commit: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Caller already proved it holds CRON_SECRET, so the database message is safe to return.
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
