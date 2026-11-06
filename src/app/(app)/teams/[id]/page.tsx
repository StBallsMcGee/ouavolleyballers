import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { TeamView } from "@/components/team/team-view";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const team = ctx.teams.find((t) => t.id === id);
  if (!team) notFound();
  const mine = ctx.myTeam?.id === id;
  return (
    <>
      <TeamView teamId={id} editable={mine || ctx.isAdmin} />
      {!mine && ctx.myTeam ? <div className="px-4 pb-6 sm:px-0"><Link href={`/trades/new?with=${id}`} className="btn-secondary w-full sm:w-auto">Propose a trade with {team.name}</Link></div> : null}
    </>
  );
}
