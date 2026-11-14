import { requireAdmin } from "@/lib/data/context";
import { formatDateTime } from "@/lib/time";
import { AdminNav } from "@/components/admin/admin-nav";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const ctx = await requireAdmin();
  const { data } = await ctx.supabase.from("audit_log").select("*").eq("league_id", ctx.league.id).order("at", { ascending: false }).limit(300);
  const actors = [...new Set((data ?? []).map((a) => a.actor).filter(Boolean))] as string[];
  const { data: profiles } = actors.length ? await ctx.supabase.from("profiles").select("id, display_name").in("id", actors) : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every lineup change, roster move, trade, scoring change and admin action. Most recent 300." />
      <AdminNav current="/admin/audit" />
      <Card>
        {(data ?? []).length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {(data ?? []).map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex flex-wrap gap-2"><span className="font-mono text-xs text-brand-600">{a.action}</span><span className="text-gray-700">{a.actor ? who.get(a.actor) ?? "unknown user" : "system"}</span><span className="ml-auto text-xs text-gray-500">{formatDateTime(a.at)}</span></div>
                <details className="text-xs text-gray-500"><summary className="cursor-pointer">Details</summary><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2">{JSON.stringify({ entity: a.entity, id: a.entity_id, before: a.before, after: a.after }, null, 2)}</pre></details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
