import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLeague } from "@/lib/data/context";
import { getMatchupScores, getTeamPlayerPoints, getUniversities } from "@/lib/data/queries";
import { formatDate } from "@/lib/time";
import { Card, Empty, MatchupStatus, Notice, PageHeader, Points } from "@/components/ui";

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLeague();
  const { supabase: sb, league } = ctx;
  const { data: row } = await sb.from("matchups").select("week").eq("id", id).maybeSingle();
  if (!row) notFound();
  const m = (await getMatchupScores(sb, league.id, row.week)).find((x) => x.id === id);
  if (!m) notFound();
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const [home, away, unis] = await Promise.all([
    getTeamPlayerPoints(sb, league.id, { teamId: m.home_team_id, week: m.week }),
    getTeamPlayerPoints(sb, league.id, { teamId: m.away_team_id, week: m.week }),
    getUniversities(sb),
  ]);
  const ids = [...new Set([...home, ...away].map((r) => r.player_id))];
  const matchIds = [...new Set([...home, ...away].map((r) => r.match_id))];
  const [{ data: players }, { data: matches }] = await Promise.all([
    ids.length ? sb.from("players").select("id, display_name, position_label, university_id").in("id", ids) : Promise.resolve({ data: [] }),
    matchIds.length ? sb.from("matches").select("id, match_date, home_university_id, away_university_id").in("id", matchIds) : Promise.resolve({ data: [] }),
  ]);
  const pl = new Map((players ?? []).map((p) => [p.id, p]));
  const mt = new Map((matches ?? []).map((x) => [x.id, x]));
  const info = ctx.weeks.find((w) => w.week === m.week);

  const side = (teamId: string, rows: typeof home, score: number) => {
    const byPlayer = new Map<string, typeof home>();
    for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
    const list = [...byPlayer.entries()].map(([pid, rs]) => ({ pid, rs, counted: rs.filter((r) => r.counted).reduce((a, r) => a + r.points, 0), bench: rs.filter((r) => !r.counted).reduce((a, r) => a + r.points, 0) }))
      .sort((a, b) => b.counted - a.counted || b.bench - a.bench);
    return (
      <Card title={<Link href={`/teams/${teamId}`} className="hover:underline">{team.get(teamId)?.name}</Link>} action={<span className="text-2xl font-black tabular-nums">{score.toFixed(1)}</span>}>
        {m.score_source === "imported" ? <Notice>This result was recorded on USportVB before the league moved to Sideout. The player breakdown isn&apos;t available.</Notice> : list.length === 0 ? <Empty>No points yet this week.</Empty> : (
          <table className="table">
            <thead><tr><th>Player</th><th>Matches</th><th className="text-right">Pts</th></tr></thead>
            <tbody>
              {list.map(({ pid, rs, counted, bench }) => {
                const p = pl.get(pid);
                return (
                  <tr key={pid} className={counted === 0 && bench !== 0 ? "opacity-60" : ""}>
                    <td><Link href={`/players/${pid}`} className="font-semibold hover:underline">{p?.display_name}</Link><div className="text-xs text-slate-500">{p?.position_label} · {p?.university_id ? unis.get(p.university_id)?.name : ""}</div></td>
                    <td className="text-xs text-slate-400">
                      {rs.map((r) => {
                        const x = mt.get(r.match_id);
                        const opp = x ? (x.home_university_id === p?.university_id ? x.away_university_id : x.home_university_id) : null;
                        return <div key={r.match_id}>{x ? formatDate(x.match_date, { weekday: "short" }) : ""} vs {opp ? unis.get(opp)?.name : "?"} · {r.slot === "BENCH" ? "bench" : r.slot} · {r.points.toFixed(1)}</div>;
                      })}
                    </td>
                    <td className="text-right"><Points value={counted} />{bench !== 0 ? <div className="text-[11px] text-slate-500">bench {bench.toFixed(1)}</div> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title={`Week ${m.week} matchup`} subtitle={info ? `${formatDate(info.starts_on)} – ${formatDate(info.ends_on)}` : undefined} actions={<MatchupStatus status={m.status} source={m.score_source} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        {side(m.home_team_id, home, m.home_score)}
        {side(m.away_team_id, away, m.away_score)}
      </div>
    </>
  );
}
