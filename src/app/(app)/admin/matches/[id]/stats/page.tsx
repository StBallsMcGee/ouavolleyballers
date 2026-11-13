import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/data/context";
import { getUniversities } from "@/lib/data/queries";
import { formatDate } from "@/lib/time";
import { AdminNav } from "@/components/admin/admin-nav";
import { StatEntryForm, type StatEntryPlayer } from "@/components/admin/stat-entry";
import { PageHeader } from "@/components/ui";
import { CORE_STAT_KEYS } from "@/lib/scoring/engine";

export const metadata = { title: "Enter stats" };

/** Admin: type in a game's box score by hand, for games no source has published. */
export default async function MatchStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAdmin();
  const sb = ctx.supabase;
  const { data: m } = await sb.from("matches").select("id, match_date, home_university_id, away_university_id, status, home_sets, away_sets").eq("id", id).maybeSingle();
  if (!m) notFound();
  const [unis, { data: players }, { data: stats }] = await Promise.all([
    getUniversities(sb),
    sb.from("players").select("id, display_name, jersey_number, position_label, university_id, active")
      .in("university_id", [m.home_university_id, m.away_university_id]).is("duplicate_of", null).order("jersey_number", { nullsFirst: false }),
    sb.from("player_match_statistics").select("*").eq("match_id", id),
  ]);
  const statOf = new Map((stats ?? []).map((s) => [s.player_id as string, s]));
  const toPlayer = (p: NonNullable<typeof players>[number]): StatEntryPlayer => {
    const s = statOf.get(p.id);
    return {
      id: p.id,
      name: p.display_name,
      jersey: p.jersey_number,
      position: p.position_label,
      source: (s?.source_system as string | undefined) ?? null,
      values: s ? { ...Object.fromEntries(CORE_STAT_KEYS.map((k) => [k, Number(s[k] ?? 0)])), sets_played: s.sets_played ?? null } : null,
    };
  };
  const team = (uni: string) => ({
    name: unis.get(uni)?.name ?? "?",
    players: (players ?? []).filter((p) => p.university_id === uni && (p.active || statOf.has(p.id))).map(toPlayer),
  });
  const home = unis.get(m.home_university_id);
  const away = unis.get(m.away_university_id);
  return (
    <>
      <PageHeader
        title="Enter stats"
        subtitle={`${away?.short_name ?? away?.name} @ ${home?.short_name ?? home?.name} · ${formatDate(m.match_date)}${m.home_sets !== null && m.away_sets !== null ? ` · ${m.away_sets}–${m.home_sets}` : ""}`}
      />
      <AdminNav current="/admin/matches" />
      <div className="mb-3 px-4 text-sm text-gray-600 sm:px-0">
        Type each player&apos;s numbers from the box score; leave players who didn&apos;t play empty. If an official source publishes this game later, its numbers replace yours. <Link href={`/matches/${id}`} className="link">View match</Link>
      </div>
      <StatEntryForm matchId={id} teams={[team(m.away_university_id), team(m.home_university_id)]} />
    </>
  );
}
