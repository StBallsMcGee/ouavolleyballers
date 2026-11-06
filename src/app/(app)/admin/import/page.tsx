import { requireAdmin } from "@/lib/data/context";
import { formatDateTime } from "@/lib/time";
import { AdminNav } from "@/components/admin/admin-nav";
import { ImportPanel } from "@/components/admin/import-panel";
import { Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Import from USportVB" };

export default async function ImportPage() {
  const ctx = await requireAdmin();
  const { data: runs } = await ctx.supabase.from("import_runs").select("started_at, mode, status").order("started_at", { ascending: false }).limit(5);
  const setup = ctx.league.status === "setup";
  return (
    <>
      <PageHeader title="Import from USportVB" subtitle="Bring Sideout back in line with USportVB before the switch-over." />
      <AdminNav current="/admin/import" />
      <div className="space-y-4">
        {setup ? (
          <Notice>
            While the league is in <b>setup</b>, managers keep using USportVB. Before you activate Sideout, run a refresh. It copies any changes made on USportVB since the
            import: lineups, adds/drops, trades, team names, and results for weeks before the switch. It never touches statistics or scoring, and the preview shows everything first.
          </Notice>
        ) : (
          <Notice tone="amber">The league is active, so importing is switched off. Managers&apos; changes on Sideout are now the source of truth.</Notice>
        )}
        <Card title="Refresh"><ImportPanel canRun={setup} /></Card>
        <Card title="Previous imports">
          <ul className="space-y-1 text-sm">{(runs ?? []).map((r) => <li key={r.started_at}>{formatDateTime(r.started_at)} · {r.mode} · {r.status}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
