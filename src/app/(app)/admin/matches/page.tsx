import { requireAdmin } from "@/lib/data/context";
import { getMatchesBetween, getUniversities } from "@/lib/data/queries";
import { addDays, formatDate } from "@/lib/time";
import { AdminNav } from "@/components/admin/admin-nav";
import { MatchRowEditor } from "@/components/admin/match-admin";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Matches & locks" };

export default async function AdminMatchesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : addDays(ctx.today, -7);
  const to = addDays(from, 20);
  const [matches, unis] = await Promise.all([getMatchesBetween(ctx.supabase, from, to), getUniversities(ctx.supabase)]);
  return (
    <>
      <PageHeader title="Matches & locks" subtitle={`${formatDate(from)} – ${formatDate(to)} · Toronto time. Untick "counts" for exhibitions.`} />
      <AdminNav current="/admin/matches" />
      <div className="mb-3 flex gap-2 px-4 sm:px-0"><a className="btn-secondary" href={`/admin/matches?from=${addDays(from, -14)}`}>← Earlier</a><a className="btn-secondary" href={`/admin/matches?from=${addDays(from, 14)}`}>Later →</a></div>
      <Card flush>
        {matches.length === 0 ? <Empty>No matches in this period.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {matches.map((m) => (
              <li key={m.id} className="space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-semibold">{unis.get(m.away_university_id)?.short_name ?? unis.get(m.away_university_id)?.name} @ {unis.get(m.home_university_id)?.short_name ?? unis.get(m.home_university_id)?.name}</span>
                  <span className="shrink-0 text-xs text-gray-500">{formatDate(m.match_date)} · {m.lock_source === "fallback" ? "default lock" : m.lock_source === "admin" ? "set by admin" : "start time"}</span>
                </div>
                <MatchRowEditor id={m.id} lockAt={m.lock_at} counts={m.counts_for_fantasy} status={m.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
