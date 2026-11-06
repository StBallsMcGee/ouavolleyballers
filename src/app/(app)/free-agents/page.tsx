import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getOwnership, getRoster, getSeasonPlayerPoints, lockedUniversities } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";
import { PlayerList } from "@/components/player-list";
import { AddPlayerButton } from "@/components/add-player-button";

export const metadata = { title: "Free agents" };

export default async function FreeAgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const { supabase: sb, league, myTeam, today } = ctx;
  const [sched, players, season, owner, roster, todays] = await Promise.all([
    loadScheduleContext(sb, ctx.weeks, ctx.currentWeek, today),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: true }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
    myTeam ? getRoster(sb, myTeam.id) : Promise.resolve([]),
    getMatchesBetween(sb, today, today),
  ]);
  const locked = lockedUniversities(todays);
  const rows = players
    .filter((p) => !owner.has(p.id) && !p.duplicate_of)
    .filter((p) => (sp.week === "playing" ? sched.playsThisWeek(p.university_id) : true))
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, gp: season.get(p.id)?.games ?? 0 }))
    .sort((a, b) => b.pts - a.pts || a.display_name.localeCompare(b.display_name));
  const limit = league.settings.roster.TOTAL;
  const enabled = league.settings.freeAgency.enabled;
  const myRoster = roster.map((r) => ({ id: r.playerId, name: r.name, locked: r.universityId ? locked.has(r.universityId) : false }));
  return (
    <>
      <PageHeader title="Free agents" subtitle={myTeam ? `Your roster ${roster.length}/${limit} · added players join your bench` : undefined} />
      {!enabled ? <div className="mb-3"><Notice tone="amber">Free agency is currently closed by the league administrator.</Notice></div> : null}
      <PlayerFilters unis={[...sched.unis.values()]} sp={sp} showStatus={false} />
      <Card flush title={`${rows.length} available`}>
        {rows.length === 0 ? <Empty>No free agents match these filters.</Empty> : (
          <PlayerList
            showOwner={false}
            items={rows.slice(0, 120).map((p) => ({
              id: p.id, name: p.display_name, code: sched.code(p.university_id), position: p.position_label,
              games: sched.chipsFor(p.university_id), points: p.pts, gamesPlayed: p.gp,
              action: myTeam && enabled ? <AddPlayerButton teamId={myTeam.id} playerId={p.id} playerName={p.display_name} rosterFull={roster.length >= limit} roster={myRoster} /> : undefined,
            }))}
          />
        )}
      </Card>
    </>
  );
}
