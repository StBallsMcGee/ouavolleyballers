import { Nav } from "@/components/nav";
import { requireLeague } from "@/lib/data/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireLeague();
  return (
    <>
      <Nav leagueName={ctx.league.name} isAdmin={ctx.isAdmin} userName={ctx.profile?.display_name || ctx.user.email || ""} />
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:pb-12">{children}</main>
    </>
  );
}
