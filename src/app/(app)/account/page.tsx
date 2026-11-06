import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { signOut } from "@/app/actions";
import { Card, PageHeader } from "@/components/ui";
import { AccountForms } from "@/components/account-forms";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireLeague();
  return (
    <>
      <PageHeader title="Account" subtitle={ctx.user.email} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profile"><AccountForms displayName={ctx.profile?.display_name ?? ""} team={ctx.myTeam ? { id: ctx.myTeam.id, name: ctx.myTeam.name } : null} /></Card>
        <Card title="Security">
          <p className="mb-3 text-sm text-gray-500">Change your password or sign out of this device.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/auth/update-password" className="btn-secondary">Change password</Link>
            <form action={signOut}><button className="btn-ghost">Sign out</button></form>
          </div>
        </Card>
      </div>
    </>
  );
}
