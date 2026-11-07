import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { Empty, PageHeader } from "@/components/ui";
import { TeamView } from "@/components/team/team-view";
import { parseDay } from "@/lib/time";

export const metadata = { title: "My Team" };

export default async function MyTeamPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day } = await searchParams;
  const ctx = await requireLeague();
  if (!ctx.myTeam) {
    return (
      <>
        <PageHeader title="My Team" />
        <Empty>No team is linked to your account. {ctx.isAdmin ? <Link href="/admin/teams" className="link">Assign teams</Link> : "Ask the league administrator to link your team."}</Empty>
      </>
    );
  }
  return (
    <TeamView teamId={ctx.myTeam.id} editable day={parseDay(day)} path="/team" />
  );
}
