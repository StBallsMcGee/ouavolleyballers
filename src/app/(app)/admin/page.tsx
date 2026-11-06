import Link from "next/link";
import { requireAdmin } from "@/lib/data/context";
import { formatDateTime, timeAgo } from "@/lib/time";
import { runSyncNow, updateLeague } from "@/app/actions";
import { AdminNav } from "@/components/admin/admin-nav";
import { ActionButton } from "@/components/admin/action-button";
import { Badge, Card, Empty, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const ctx = await requireAdmin();
  const { supabase: sb, league, teams } = ctx;
  const [{ data: runs }, { data: lastOk }, { data: imports }, { data: pendingTrades }, { count: rosterCount }] = await Promise.all([
    sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
    sb.from("sync_runs").select("finished_at").eq("status", "succeeded").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("import_runs").select("id, started_at, mode, status, source").order("started_at", { ascending: false }).limit(5),
    sb.from("trades").select("id").eq("league_id", league.id).eq("status", "pending_review"),
    sb.from("roster_assignments").select("id", { count: "exact", head: true }).eq("league_id", league.id).is("released_at", null),
  ]);
  const unclaimed = teams.filter((t) => !t.owner_user_id);
  const last = runs?.[0];
  const stale = !lastOk?.finished_at || Date.now() - new Date(lastOk.finished_at).getTime() > 36 * 3600 * 1000;
  return (
    <>
      <PageHeader title="Admin" subtitle={`${league.name} · ${league.season_label}`} />
      <AdminNav current="/admin" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="League status">
          <p className="mb-3 text-sm">Status: <Badge tone={league.status === "active" ? "mint" : "amber"}>{league.status}</Badge></p>
          {league.status === "setup" ? (
            <>
              <p className="mb-3 text-sm text-gray-500">While in <b>setup</b>, managers can sign in and look around. Activate the league once you&apos;ve checked the import report, rosters and scoring. Activation also blocks the import tool from running again, so it can&apos;t overwrite managers&apos; changes.</p>
              <ActionButton className="btn-primary" label="Activate league" confirmText="Activate the league? Do this after reviewing the import report." action={async () => { "use server"; return updateLeague({ name: league.name, status: "active", settings: league.settings }); }} />
            </>
          ) : <p className="text-sm text-gray-500">The league is live.</p>}
          <ul className="mt-4 space-y-1 text-sm">
            <li>{teams.length} teams · {rosterCount ?? 0} rostered players</li>
            <li>{unclaimed.length === 0 ? "All teams claimed by their managers ✓" : <><Link href="/admin/teams" className="link">{unclaimed.length} teams</Link> not yet claimed by a manager</>}</li>
            <li>{(pendingTrades ?? []).length ? <Link href="/trades" className="link">{pendingTrades!.length} trades waiting for your approval</Link> : "No trades waiting for approval"}</li>
          </ul>
        </Card>

        <Card title="Data sync" action={<ActionButton label="Sync now" action={runSyncNow} />}>
          {stale ? <div className="mb-3"><Notice tone="amber">No successful sync in the last 36 hours. Check the scheduler and the errors below.</Notice></div> : null}
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Last successful</dt><dd>{lastOk?.finished_at ? `${timeAgo(lastOk.finished_at)} (${formatDateTime(lastOk.finished_at)})` : "never"}</dd>
            <dt className="text-gray-500">Last attempt</dt><dd>{last ? `${timeAgo(last.started_at)} · ${last.status}` : "never"}</dd>
          </dl>
          {!runs?.length ? <div className="mt-3"><Empty>No sync has run yet.</Empty></div> : (
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="py-2" title={r.error ?? (r.warnings as string[]).slice(0, 5).join("\n")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600">{formatDateTime(r.started_at)} · {r.job === "usportvb-schedule" ? "schedule" : "stats"}</span>
                    <Badge tone={r.status === "succeeded" ? "mint" : r.status === "failed" ? "red" : "slate"}>{r.status}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">{r.matches_checked} matches checked · {r.records_inserted} new · {r.records_updated} updated{(r.warnings as string[]).length ? ` · ${(r.warnings as string[]).length} warnings` : ""}</div>
                  {r.error ? <div className="break-words text-xs text-red-600">{r.error}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Import history">
          {!imports?.length ? <Empty>No imports recorded.</Empty> : (
            <ul className="space-y-1 text-sm">{imports.map((i) => <li key={i.id}>{formatDateTime(i.started_at)} · {i.source} · {i.mode} · <Badge tone={i.status === "succeeded" ? "mint" : "red"}>{i.status}</Badge></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-gray-500">The full import report (counts, warnings, excluded teams) is saved with each run in the database table import_runs and in the reports folder of whoever ran the import.</p>
        </Card>
      </div>
    </>
  );
}
