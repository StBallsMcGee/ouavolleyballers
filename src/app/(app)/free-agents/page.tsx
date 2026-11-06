import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getMatchesBetween, getOwnership, getRoster, getSeasonPlayerPoints, getUniversities, lockedUniversities } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { Card, Empty, Notice, PageHeader, Points, PositionTag } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";
import { AddPlayerButton } from "@/components/add-player-button";

export const metadata = { title: "Free agents" };

export default async function FreeAgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  const { supabase: sb, league, myTeam, today } = ctx;
  const [unis, players, season, owner, roster, todays] = await Promise.all([
    getUniversities(sb),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: true }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
    myTeam ? getRoster(sb, myTeam.id) : Promise.resolve([]),
    getMatchesBetween(sb, today, today),
  ]);
  const locked = lockedUniversities(todays);
  const rows = players
    .filter((p) => !owner.has(p.id) && !p.duplicate_of)
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, games: season.get(p.id)?.games ?? 0 }))
    .sort((a, b) => b.pts - a.pts || a.display_name.localeCompare(b.display_name));
  const limit = league.settings.roster.TOTAL;
  const enabled = league.settings.freeAgency.enabled;
  const myRoster = roster.map((r) => ({ id: r.playerId, name: r.name, locked: r.universityId ? locked.has(r.universityId) : false }));
  return (
    <>
      <PageHeader title="Free agents" subtitle={myTeam ? `Your roster: ${roster.length}/${limit}. Added players join your bench.` : undefined} />
      {!enabled ? <div className="mb-4"><Notice tone="amber">Free agency is currently closed by the league administrator.</Notice></div> : null}
      <PlayerFilters unis={[...unis.values()]} sp={sp} showStatus={false} />
      <Card>
        {rows.length === 0 ? <Empty>No free agents match these filters.</Empty> : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="table">
              <thead><tr><th>Player</th><th>Pos</th><th>University</th><th className="text-right">GP</th><th className="text-right">Pts</th><th className="text-right">Avg</th><th /></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/players/${p.id}`} className="font-semibold hover:underline">{p.display_name}</Link></td>
                    <td><PositionTag label={p.position_label} /></td>
                    <td className="text-slate-300">{p.university_id ? unis.get(p.university_id)?.name : "–"}</td>
                    <td className="text-right font-mono text-slate-400">{p.games}</td>
                    <td className="text-right"><Points value={p.pts} /></td>
                    <td className="text-right font-mono text-slate-400">{p.games ? (p.pts / p.games).toFixed(1) : "–"}</td>
                    <td className="text-right">{myTeam && enabled ? <AddPlayerButton teamId={myTeam.id} playerId={p.id} playerName={p.display_name} rosterFull={roster.length >= limit} roster={myRoster} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
