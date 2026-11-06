import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getUniversities, type MatchRow } from "@/lib/data/queries";
import { addDays, formatDate, LEAGUE_TZ } from "@/lib/time";
import { Card, Empty, Freshness, MatchStatus, PageHeader } from "@/components/ui";

export const metadata = { title: "Match centre" };

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_TZ, hour: "numeric", minute: "2-digit" });

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : addDays(ctx.today, -2);
  const to = addDays(from, 6);
  const [all, unis] = await Promise.all([getMatchesBetween(ctx.supabase, from, to), getUniversities(ctx.supabase)]);
  // Conference games first; exhibition opponents are still shown.
  const matches = all;
  const days = [...new Set(matches.map((m) => m.match_date))];
  const newest = matches.reduce<string | null>((a, m) => (m.last_checked_at && (!a || m.last_checked_at > a) ? m.last_checked_at : a), null);
  const code = (id: string) => unis.get(id)?.short_name ?? unis.get(id)?.name ?? "?";
  const name = (id: string) => unis.get(id)?.name ?? "?";

  const Row = ({ m }: { m: MatchRow }) => {
    const done = m.status === "final" || m.status === "live";
    const hs = m.home_sets ?? null;
    const as = m.away_sets ?? null;
    const team = (id: string, sets: number | null, won: boolean) => (
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate text-[14px] ${won ? "font-extrabold" : "font-semibold text-gray-700"}`}><span className="inline-block w-11 text-[11px] font-extrabold text-gray-500">{code(id)}</span>{name(id)}</span>
        {done && sets !== null ? <span className={`text-[15px] tabular-nums ${won ? "font-extrabold" : "text-gray-500"}`}>{sets}</span> : null}
      </div>
    );
    return (
      <li>
        <Link href={`/matches/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-gray-50">
          <div className="min-w-0 flex-1 space-y-0.5">
            {team(m.away_university_id, as, done && as !== null && hs !== null && as > hs)}
            {team(m.home_university_id, hs, done && as !== null && hs !== null && hs > as)}
          </div>
          <div className="w-20 shrink-0 text-right text-[11px] text-gray-500">
            {m.status === "scheduled" ? <span className="font-bold text-gray-800">{m.start_time ? timeFmt.format(new Date(m.start_time)) : "Time TBD"}</span> : <MatchStatus status={m.status} statsAvailable={m.stats_available} />}
            {m.status !== "scheduled" && !m.stats_available ? <div>no stats yet</div> : null}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Match centre" subtitle={`${formatDate(from, { month: "short", day: "numeric" })} – ${formatDate(to, { month: "short", day: "numeric" })} · Toronto time`} actions={<Freshness label="Checked" at={newest} />} />
      <div className="mb-3 flex gap-2 px-4 sm:px-0">
        <Link href={`/matches?from=${addDays(from, -7)}`} className="btn-secondary min-h-[34px] px-3 py-1 text-xs">← Earlier</Link>
        <Link href="/matches" className="btn-ghost min-h-[34px] px-3 py-1 text-xs">Today</Link>
        <Link href={`/matches?from=${addDays(from, 7)}`} className="btn-secondary min-h-[34px] px-3 py-1 text-xs">Later →</Link>
      </div>
      {days.length === 0 ? <Card><Empty>No matches in this period (bye week or break).</Empty></Card> : (
        <div className="space-y-3">
          {days.map((d) => (
            <Card key={d} flush title={d === ctx.today ? `Today · ${formatDate(d, { weekday: "long", month: "short", day: "numeric" })}` : formatDate(d, { weekday: "long", month: "short", day: "numeric" })}>
              <ul className="divide-y divide-gray-100">{matches.filter((m) => m.match_date === d).map((m) => <Row key={m.id} m={m} />)}</ul>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 px-4 pb-4 text-xs text-gray-500 sm:px-0">Away team listed first. Live point-by-point stats aren&apos;t available from our source; player stats appear once published, and each page shows when it was last checked.</p>
    </>
  );
}
