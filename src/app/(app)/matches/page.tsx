import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getUniversities } from "@/lib/data/queries";
import { addDays, formatDate, formatDateTime } from "@/lib/time";
import { Card, Empty, Freshness, MatchStatus, PageHeader } from "@/components/ui";

export const metadata = { title: "Match centre" };

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : addDays(ctx.today, -3);
  const to = addDays(from, 6);
  const [matches, unis] = await Promise.all([getMatchesBetween(ctx.supabase, from, to), getUniversities(ctx.supabase)]);
  const days = [...new Set(matches.map((m) => m.match_date))];
  const newest = matches.reduce<string | null>((a, m) => (!a || m.last_updated_at > a ? m.last_updated_at : a), null);
  return (
    <>
      <PageHeader title="Match centre" subtitle={`${formatDate(from)} – ${formatDate(to)} · OUA women`} actions={<Freshness at={newest} />} />
      <div className="mb-4 flex gap-2">
        <Link href={`/matches?from=${addDays(from, -7)}`} className="btn-secondary">← Earlier</Link>
        <Link href="/matches" className="btn-ghost">This week</Link>
        <Link href={`/matches?from=${addDays(from, 7)}`} className="btn-secondary">Later →</Link>
      </div>
      {days.length === 0 ? (
        <Empty>No matches recorded in this period. Our current data source only provides matches once player statistics exist, so upcoming matches may not be listed yet.</Empty>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d} title={formatDate(d, { weekday: "long", month: "long", day: "numeric" })}>
              <ul className="divide-y divide-white/5">
                {matches.filter((m) => m.match_date === d).map((m) => (
                  <li key={m.id}>
                    <Link href={`/matches/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-white/[0.02]">
                      <span className="font-semibold">{unis.get(m.home_university_id)?.name} <span className="text-slate-500">{m.home_away_known ? "vs" : "&"}</span> {unis.get(m.away_university_id)?.name}</span>
                      <span className="flex items-center gap-3 text-xs text-slate-400">
                        {m.home_sets !== null && m.away_sets !== null ? <span className="font-mono text-sm text-slate-200">{m.home_sets}–{m.away_sets}</span> : null}
                        <span>Locks {formatDateTime(m.lock_at)}{m.lock_source === "fallback" ? "*" : ""}</span>
                        <MatchStatus status={m.status} statsAvailable={m.stats_available} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">* Start time not provided by the source; lineups lock at the league&apos;s default time on match day. Live point-by-point statistics are not available from our source: player stats appear once the source publishes them, and each match shows when it was last updated.</p>
    </>
  );
}
