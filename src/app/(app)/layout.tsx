import { Nav } from "@/components/nav";
import { SwipeTabs } from "@/components/swipe-tabs";
import { requireLeague } from "@/lib/data/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireLeague();
  return (
    <>
      <Nav leagueName={ctx.league.name} isAdmin={ctx.isAdmin} userName={ctx.profile?.display_name || ctx.user.email || ""} />
      <main className="mx-auto max-w-5xl overflow-x-clip pb-28 sm:px-4 lg:pb-12"><SwipeTabs>{children}</SwipeTabs></main>
    </>
  );
}
