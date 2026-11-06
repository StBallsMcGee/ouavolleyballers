import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { PageHeader } from "@/components/ui";
import { TeamView } from "@/components/team/team-view";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const team = ctx.teams.find((t) => t.id === id);
  if (!team) notFound();
  const mine = ctx.myTeam?.id === id;
  return (
    <>
      <PageHeader
        title={team.name}
        subtitle={`Managed by ${team.manager}`}
        actions={!mine && ctx.myTeam ? <Link href={`/trades/new?with=${id}`} className="btn-secondary">Propose trade</Link> : null}
      />
      <TeamView teamId={id} editable={mine || ctx.isAdmin} />
    </>
  );
}
