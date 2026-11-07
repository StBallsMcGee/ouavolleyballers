import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { TeamView } from "@/components/team/team-view";
import { parseDay } from "@/lib/time";

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const [{ id }, { day }] = await Promise.all([params, searchParams]);
  const ctx = await requireLeague();
  const team = ctx.teams.find((t) => t.id === id);
  if (!team) notFound();
  const mine = ctx.myTeam?.id === id;
  return (
    <>
      <TeamView teamId={id} editable={mine || ctx.isAdmin} day={parseDay(day)} path={`/teams/${id}`} />
      {!mine && ctx.myTeam ? <div className="px-4 pb-6 sm:px-0"><Link href={`/trades/new?with=${id}`} className="btn-secondary w-full sm:w-auto">Propose a trade with {team.name}</Link></div> : null}
    </>
  );
}
