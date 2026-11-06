import { Nav } from "@/components/nav";
import { requireLeague } from "@/lib/data/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireLeague();
  return (
    <>
      <Nav leagueName={ctx.league.name} isAdmin={ctx.isAdmin} userName={ctx.profile?.display_name || ctx.user.email || ""} />
      <main className="mx-auto max-w-5xl pb-24 sm:px-4 lg:pb-12">{children}</main>
    </>
  );
}
