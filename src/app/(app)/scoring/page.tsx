import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getRuleSets, ruleSetInForce } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Scoring" };

export default async function ScoringPage() {
  const ctx = await requireLeague();
  const sets = await getRuleSets(ctx.supabase, ctx.league.id);
  const current = ruleSetInForce(sets, ctx.currentWeek ?? 1);
  return (
    <>
      <PageHeader title="Scoring" subtitle="Fantasy points = each statistic × its value, added up. Only starters score." actions={ctx.isAdmin ? <Link href="/admin/scoring" className="btn-secondary">Edit scoring</Link> : null} />
      {!current ? <Empty>No scoring rules yet.</Empty> : (
        <Card title={`In force now · version ${current.version}`}>
          <table className="table">
            <thead><tr><th>Statistic</th><th className="text-right">Points each</th></tr></thead>
            <tbody>
              {current.rules.filter((r) => r.active).map((r) => (
                <tr key={r.stat_key}><td>{r.label}</td><td className={`text-right font-mono font-bold ${r.points > 0 ? "text-mint-400" : r.points < 0 ? "text-red-300" : "text-slate-400"}`}>{r.points > 0 ? "+" : ""}{r.points}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">&quot;Errors&quot; are attack errors. &quot;Serve misses&quot; are service errors. &quot;Attempts&quot; are total attack attempts. Reception, block and ball-handling errors are not scored.</p>
        </Card>
      )}
      {sets.length > 1 ? (
        <Card title="Scoring history" className="mt-4">
          <ul className="space-y-2 text-sm">
            {sets.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={s.id === current?.id ? "mint" : "slate"}>v{s.version}</Badge>
                <span>From week {s.effective_from_week}</span>
                <span className="text-slate-500">· {formatDateTime(s.created_at)}{s.note ? ` · ${s.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
