import { requireAdmin } from "@/lib/data/context";
import { getRuleSets, ruleSetInForce } from "@/lib/data/queries";
import { AdminNav } from "@/components/admin/admin-nav";
import { ScoringEditor } from "@/components/admin/scoring-editor";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit scoring" };

export default async function AdminScoringPage() {
  const ctx = await requireAdmin();
  const sets = await getRuleSets(ctx.supabase, ctx.league.id);
  const week = ctx.currentWeek ?? 1;
  const latest = sets[0] ?? null;
  const current = ruleSetInForce(sets, week);
  return (
    <>
      <PageHeader title="Edit scoring" subtitle={`Saving creates a new version. Old versions are kept${latest && current && latest.id !== current.id ? `. Note: version ${latest.version} is scheduled from week ${latest.effective_from_week}.` : "."}`} />
      <AdminNav current="/admin/scoring" />
      <ScoringEditor initial={(latest ?? current)?.rules ?? []} currentWeek={week} teams={Object.fromEntries(ctx.teams.map((t) => [t.id, t.name]))} />
    </>
  );
}
