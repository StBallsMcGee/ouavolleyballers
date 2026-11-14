import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * A team's picture. Only league members can load it (the database checks). The address carries
 * a version number, so phones can keep the image until the team changes it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const sb = await supabaseServer();
  const { data } = await sb.from("team_logos").select("image").eq("fantasy_team_id", id).maybeSingle();
  const m = (data?.image as string | undefined)?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(m[2]!, "base64"), {
    headers: { "content-type": m[1]!, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
