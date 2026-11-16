import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getOwnership, getProjections, getRoster, getSeasonPlayerPoints, lockedUniversities } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";
import { PlayerList } from "@/components/player-list";
import { AddPlayerButton } from "@/components/add-player-button";
import { WaiverClaims, type ClaimRow } from "@/components/waiver-claims";

export const metadata = { title: "Free agents" };

export default async function FreeAgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const { supabase: sb, league, myTeam, today } = ctx;
  const [sched, players, season, owner, proj, roster, todays, { data: claimRows }, { data: priority }] = await Promise.all([
    loadScheduleContext(sb, ctx.weeks, ctx.currentWeek, today),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: true }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
    getProjections(sb, league.id),
    myTeam ? getRoster(sb, myTeam.id) : Promise.resolve([]),
    getMatchesBetween(sb, today, today),
    myTeam
      ? sb.from("waiver_claims").select("id, player_id, drop_player_id, status, detail, processed_at").eq("fantasy_team_id", myTeam.id).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as Array<{ id: string; player_id: string; drop_player_id: string | null; status: string; detail: string | null; processed_at: string | null }> }),
    sb.from("waiver_priority").select("fantasy_team_id, position").eq("league_id", league.id).order("position"),
  ]);
  // Rolling waiver order: 1 = picks first.
  const waiverOrder = (priority ?? []).map((w) => w.fantasy_team_id as string).filter((id) => ctx.teams.some((t) => t.id === id));
  const myPriority = myTeam ? waiverOrder.indexOf(myTeam.id) + 1 : 0;
  // Pending claims, plus results from the last three days.
  const recent = (claimRows ?? []).filter((c) => c.status === "pending" || (c.processed_at && Date.now() - new Date(c.processed_at).getTime() < 3 * 86400_000));
  const nameOf = new Map(players.map((p) => [p.id, p.display_name]));
  for (const r of roster) nameOf.set(r.playerId, r.name);
  const claims: ClaimRow[] = recent.map((c) => ({
    id: c.id, playerId: c.player_id, player: nameOf.get(c.player_id) ?? "Player", drop: c.drop_player_id ? nameOf.get(c.drop_player_id) ?? "a player" : null,
    status: c.status as ClaimRow["status"], detail: c.detail,
  }));
  const claimed = new Set(recent.filter((c) => c.status === "pending").map((c) => c.player_id));
  const locked = lockedUniversities(todays);
  const rows = players
    .filter((p) => !owner.has(p.id) && !p.duplicate_of)
    .filter((p) => (sp.week === "playing" ? sched.playsThisWeek(p.university_id) : true))
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, gp: season.get(p.id)?.games ?? 0, proj: proj.get(p.id)?.perGame ?? null }))
    .sort((a, b) => (sp.sort === "proj" ? (b.proj ?? -999) - (a.proj ?? -999) : 0) || b.pts - a.pts || a.display_name.localeCompare(b.display_name));
  const limit = league.settings.roster.TOTAL;
  const enabled = league.settings.freeAgency.enabled;
  const myRoster = roster
    .map((r) => ({ id: r.playerId, name: r.name, locked: r.universityId ? locked.has(r.universityId) : false, photo: r.photoUrl, position: r.positionLabel, slot: r.slot, points: season.get(r.playerId)?.points ?? 0 }))
    .sort((a, b) => Number(a.slot !== "BENCH") - Number(b.slot !== "BENCH") || a.points - b.points); // bench and low scorers first
  return (
    <>
      <PageHeader title="Free agents" subtitle={myTeam ? `Your roster ${roster.length}/${limit}` : undefined} />
      {!enabled ? <div className="mb-3"><Notice tone="amber">Free agency is currently closed by the league administrator.</Notice></div> : (
        <div className="mb-3"><Notice tone="slate"><b>Add</b> a free agent whose game today hasn&apos;t started and she joins your bench right away. Once her game has started she can only be <b>claimed</b>: claims are decided at midnight, in waiver order. The team highest in the order gets her, and winning a claim moves that team to the back.</Notice></div>
      )}
      {waiverOrder.length ? (
        <details className="mx-3 mb-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-gray-900"><span className="inline-block h-3.5 w-1 rounded-full bg-gold-400" aria-hidden />Waiver order</span>
            <span className="text-sm">{myPriority ? <>You&apos;re <b className="text-gold-300">#{myPriority}</b> of {waiverOrder.length}</> : null} <span className="text-gray-400">›</span></span>
          </summary>
          <ol className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 pb-3 text-[13px]">
            {waiverOrder.map((id, i) => (
              <li key={id} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 ${id === myTeam?.id ? "bg-gold-400/15 font-extrabold text-gold-300" : "text-gray-700"}`}>
                <span className="w-5 shrink-0 text-right text-[11px] font-black text-gray-400">{i + 1}</span>
                <span className="truncate">{ctx.teams.find((t) => t.id === id)?.name}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {claims.length ? <Card flush title="Your waiver claims" className="mb-3"><WaiverClaims claims={claims} /></Card> : null}
      <PlayerFilters unis={[...sched.unis.values()]} sp={sp} showStatus={false} />
      <Card flush title={`${rows.length} available`}>
        {rows.length === 0 ? <Empty>No free agents match these filters.</Empty> : (
          <PlayerList
            showOwner={false}
            items={rows.slice(0, 120).map((p) => ({
              id: p.id, name: p.display_name, photo: p.photo, code: sched.code(p.university_id), position: p.position_label,
              games: sched.chipsFor(p.university_id), points: p.pts, gamesPlayed: p.gp, proj: p.proj,
              action: myTeam && enabled ? <AddPlayerButton teamId={myTeam.id} playerId={p.id} playerName={p.display_name} rosterFull={roster.length >= limit} roster={myRoster} claimed={claimed.has(p.id)} locked={!!p.university_id && locked.has(p.university_id)} /> : undefined,
            }))}
          />
        )}
      </Card>
    </>
  );
}
