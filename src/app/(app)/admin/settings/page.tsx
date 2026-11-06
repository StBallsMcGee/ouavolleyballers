import { requireAdmin } from "@/lib/data/context";
import { AdminNav } from "@/components/admin/admin-nav";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "League settings" };

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  return (
    <>
      <PageHeader title="League settings" subtitle="Every change is recorded in the audit log." />
      <AdminNav current="/admin/settings" />
      <SettingsForm name={ctx.league.name} status={ctx.league.status} settings={ctx.league.settings} />
    </>
  );
}
