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
      <PageHeader title="Matches & locks" subtitle={`${formatDate(from)} – ${formatDate(to)}. Lock times are in Toronto time. Untick "counts" for exhibition matches that shouldn't score.`} />
      <AdminNav current="/admin/matches" />
      <div className="mb-4 flex gap-2"><a className="btn-secondary" href={`/admin/matches?from=${addDays(from, -14)}`}>← Earlier</a><a className="btn-secondary" href={`/admin/matches?from=${addDays(from, 14)}`}>Later →</a></div>
      <Card>
        {matches.length === 0 ? <Empty>No matches in this period.</Empty> : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="table">
              <thead><tr><th>Date</th><th>Match</th><th>Lock source</th><th>Lock time · status · counts</th></tr></thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.match_date)}</td>
                    <td>{unis.get(m.home_university_id)?.name} – {unis.get(m.away_university_id)?.name}</td>
                    <td className="text-xs text-gray-500">{m.lock_source === "fallback" ? "default time" : m.lock_source}</td>
                    <td><MatchRowEditor id={m.id} lockAt={m.lock_at} counts={m.counts_for_fantasy} status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
