import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { fetchAll, getMatchesBetween, getOwnership, getProjections, getRoster, getSeasonPlayerPoints, lockedUniversities } from "@/lib/data/queries";
import { listPlayers } from "@/lib/data/players";
import { loadScheduleContext } from "@/lib/data/schedule-context";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";
import { PlayerFilters } from "@/components/player-filters";
import { PlayerList } from "@/components/player-list";
import { PlayersNav } from "@/components/players/players-nav";
import { PeriodSelect } from "@/components/players/period-select";
import { LeadersList, type LeaderRow } from "@/components/players/leaders-list";
import { AddPlayerButton } from "@/components/add-player-button";
import { parsePeriod, positionGroup, STAT_KEY_HELP, statCells, totalsFor, type WeekStatRow } from "@/lib/players/leaders";
import { formatDate } from "@/lib/time";
import { positionChipClass } from "@/components/position";

export const metadata = { title: "Players" };

type Sp = Record<string, string | undefined>;
type LeagueContext = Awaited<ReturnType<typeof requireLeague>>;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const ctx = await requireLeague();
  // Search keeps every filter it had; a search or filter in the address opens it directly.
  const searching = sp.view === "search" || !!(sp.q || sp.uni || sp.week || sp.sort || sp.status);
  return (
    <>
      <PageHeader title="Players" tone="blue" />
      <PlayersNav active={searching ? "search" : "leaders"} />
      {searching ? <SearchView ctx={ctx} sp={sp} /> : <LeadersView ctx={ctx} sp={sp} />}
    </>
  );
}

// ---------------------------------------------------------------- Search (unchanged behaviour)

async function SearchView({ ctx, sp }: { ctx: LeagueContext; sp: Sp }) {
  const { supabase: sb, league } = ctx;
  const status = sp.status ?? "active";
  const [sched, players, season, owner, proj] = await Promise.all([
    loadScheduleContext(sb, ctx.weeks, ctx.currentWeek, ctx.today),
    listPlayers(sb, { q: sp.q, uni: sp.uni, pos: sp.pos, activeOnly: status !== "all" }),
    getSeasonPlayerPoints(sb, league.id),
    getOwnership(sb, league.id),
    getProjections(sb, league.id),
  ]);
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const rows = players
    .filter((p) => (status === "available" ? !owner.has(p.id) && !p.duplicate_of : status === "rostered" ? owner.has(p.id) : true))
    .filter((p) => (sp.week === "playing" ? sched.playsThisWeek(p.university_id) : true))
    .map((p) => ({ ...p, pts: season.get(p.id)?.points ?? 0, gp: season.get(p.id)?.games ?? 0, proj: proj.get(p.id)?.perGame ?? null, last3: proj.get(p.id)?.last3 ?? null }))
    .sort((a, b) => {
      const v = (x: typeof a) => (sp.sort === "proj" ? x.proj : sp.sort === "last3" ? x.last3 : sp.sort === "pergame" ? (x.gp ? x.pts / x.gp : null) : 0);
      return ((v(b) ?? -999) - (v(a) ?? -999)) || b.pts - a.pts || a.display_name.localeCompare(b.display_name);
    });
  return (
    <>
      <PlayerFilters unis={[...sched.unis.values()]} sp={sp} hidden={{ view: "search" }} />
      <Card flush title={`${rows.length} players`}>
        {rows.length === 0 ? <Empty>No players match these filters.</Empty> : (
          <PlayerList
            items={rows.slice(0, 150).map((p) => {
              const o = owner.get(p.id);
              return {
                id: p.id, name: p.display_name, photo: p.photo, code: sched.code(p.university_id), position: p.position_label,
                games: sched.chipsFor(p.university_id), points: p.pts, gamesPlayed: p.gp, proj: p.proj,
                owner: o ? { id: o, name: team.get(o)?.name ?? "", mine: o === ctx.myTeam?.id } : null,
                flags: [...(p.duplicate_of ? ["Duplicate"] : []), ...(!p.active ? ["Inactive"] : [])],
              };
            })}
          />
        )}
        {rows.length > 150 ? <p className="px-4 py-3 text-xs text-gray-500">Showing the top 150 of {rows.length}. Use search or filters to narrow the list.</p> : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Leaders

const POSITIONS = ["OH", "M", "S", "L"] as const;
const POSITION_NAMES: Record<string, string> = { OH: "outside hitters", M: "middles", S: "setters", L: "liberos" };

async function LeadersView({ ctx, sp }: { ctx: LeagueContext; sp: Sp }) {
  const { supabase: sb, league, myTeam, today } = ctx;
  const [sched, players, owner, statRows, roster, todays, { data: pendingClaims }] = await Promise.all([
    loadScheduleContext(sb, ctx.weeks, ctx.currentWeek, today),
    listPlayers(sb, { activeOnly: false }),
    getOwnership(sb, league.id),
    loadWeekStats(ctx),
    myTeam ? getRoster(sb, myTeam.id) : Promise.resolve([]),
    getMatchesBetween(sb, today, today),
    myTeam
      ? sb.from("waiver_claims").select("player_id").eq("fantasy_team_id", myTeam.id).eq("status", "pending")
      : Promise.resolve({ data: [] as Array<{ player_id: string }> }),
  ]);

  // Weeks that have started, newest first; the default is the newest one with stats.
  const started = ctx.weeks.filter((w) => w.starts_on <= today).sort((a, b) => b.week - a.week);
  const withStats = new Set(statRows.rows.map((r) => r.week));
  const defaultPeriod = started.find((w) => withStats.has(w.week))?.week ?? "season";
  const period = parsePeriod(sp.period, started.map((w) => w.week), defaultPeriod);
  const totals = totalsFor(statRows.rows, period);

  const pos = POSITIONS.includes(sp.pos as (typeof POSITIONS)[number]) ? sp.pos! : "ALL";
  const faOnly = sp.fa === "1";
  const showStats = sp.stats !== "off";
  const team = new Map(ctx.teams.map((t) => [t.id, t]));
  const locked = lockedUniversities(todays);
  const claimed = new Set((pendingClaims ?? []).map((c) => c.player_id));
  const enabled = league.settings.freeAgency.enabled;
  const limit = league.settings.roster.TOTAL;
  const season = totalsFor(statRows.rows, "season");
  const myRoster = roster
    .map((r) => ({ id: r.playerId, name: r.name, locked: r.universityId ? locked.has(r.universityId) : false, photo: r.photoUrl, position: r.positionLabel, slot: r.slot, points: season.get(r.playerId)?.points ?? 0 }))
    .sort((a, b) => Number(a.slot !== "BENCH") - Number(b.slot !== "BENCH") || a.points - b.points);

  const ranked = players
    .filter((p) => !p.duplicate_of && totals.has(p.id))
    .filter((p) => pos === "ALL" || p.positions.includes(pos) || positionGroup(p.position_label) === pos)
    .filter((p) => !faOnly || !owner.has(p.id))
    .map((p) => ({ p, t: totals.get(p.id)! }))
    .sort((a, b) => b.t.points - a.t.points || a.p.display_name.localeCompare(b.p.display_name));

  const rows: LeaderRow[] = ranked.slice(0, 100).map(({ p, t }, i) => {
    const o = owner.get(p.id) ?? null;
    const mine = !!o && o === myTeam?.id;
    let action: React.ReactNode = null;
    if (!o && myTeam && enabled) {
      action = <AddPlayerButton teamId={myTeam.id} playerId={p.id} playerName={p.display_name} rosterFull={roster.length >= limit} roster={myRoster} claimed={claimed.has(p.id)} locked={!!p.university_id && locked.has(p.university_id)} />;
    } else if (mine) {
      action = <RoundLink href="/team" label={`Manage ${p.display_name} on your team`} tone="red">−</RoundLink>;
    } else if (o && myTeam) {
      action = <RoundLink href={`/trades/new?with=${o}`} label={`Trade for ${p.display_name}`} tone="brand">⇄</RoundLink>;
    }
    return {
      id: p.id, rank: i + 1, name: p.display_name, photo: p.photo, position: p.position_label, code: sched.code(p.university_id),
      games: sched.chipsFor(p.university_id), points: t.points,
      owner: o ? { id: o, name: team.get(o)?.name ?? "", mine } : null,
      stats: statCells(p.position_label, t), action,
    };
  });

  const link = (changes: Sp) => {
    const next = new URLSearchParams();
    const merged: Sp = { period: sp.period, pos: sp.pos, fa: sp.fa, stats: sp.stats, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return `/players${qs ? `?${qs}` : ""}`;
  };
  const chip = (label: string, href: string, on: boolean, className: string, title?: string) => (
    <Link key={label} href={href} scroll={false} title={title} aria-current={on ? "true" : undefined} className={className}>
      {label}
    </Link>
  );
  const periodLabel = period === "season" ? "Season" : `Week ${period}`;
  const options = [
    { value: "season", label: "Season stats" },
    ...started.map((w) => ({
      value: String(w.week),
      label: `Week ${w.week}${w.week === ctx.currentWeek ? " · this week" : ""} (${formatDate(w.starts_on, { month: "short", day: "numeric" })})`,
    })),
  ];

  return (
    <>
      {statRows.missingView ? (
        <div className="mb-3"><Notice tone="amber">Showing points only. Run <code>supabase/migrations/20261122000100_player_week_stats.sql</code> in Supabase to add the stats under each player.</Notice></div>
      ) : null}
      <section className="mx-3 overflow-hidden rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold">Leaders</h2>
            <Link href={link({ stats: showStats ? "off" : undefined })} scroll={false}
              className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${showStats ? "bg-gold-400" : "bg-surface-3"}`}
              aria-label={showStats ? "Hide stats" : "Show stats"} title={showStats ? "Hide stats" : "Show stats"}>
              <span className={`h-5 w-5 rounded-full bg-white shadow transition ${showStats ? "translate-x-5" : ""}`} />
            </Link>
          </div>
          <PeriodSelect value={String(period)} options={options} />
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none]">
          {chip("☆ FA", link({ fa: faOnly ? undefined : "1" }), faOnly,
            `shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-extrabold transition active:scale-95 ${faOnly ? "tile-green text-charcoal shadow-md shadow-black/30 ring-2 ring-white/70" : "border border-current bg-surface-2 text-emerald-700 hover:bg-surface-3"}`,
            "Free agents only")}
          {chip("ALL", link({ pos: undefined }), pos === "ALL", positionChipClass("ALL", pos === "ALL"))}
          {POSITIONS.map((x) => chip(x, link({ pos: x }), pos === x, positionChipClass(x, pos === x)))}
        </div>
        {rows.length === 0 ? (
          <Empty>{period === "season" ? "No stats yet this season." : `No ${pos === "ALL" ? "players" : POSITION_NAMES[pos]}${faOnly ? " available" : ""} have played in week ${period} yet.`}</Empty>
        ) : (
          <LeadersList rows={rows} showStats={showStats} pointsLabel={`${periodLabel} pts`} />
        )}
        <p className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-400">
          Ranked by fantasy points{period === "season" ? " this season" : ` in week ${period}`}{ranked.length > 100 ? ` · top 100 of ${ranked.length}` : ""}. {showStats ? STAT_KEY_HELP : ""}
        </p>
      </section>
    </>
  );
}

function RoundLink({ href, label, tone, children }: { href: string; label: string; tone: "red" | "brand"; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label}
      className={`grid h-8 w-8 place-items-center rounded-full border-2 text-[15px] font-black transition active:scale-90 ${tone === "red" ? "border-red-500/70 text-red-500" : "border-brand-400/70 text-brand-300"}`}>
      {children}
    </Link>
  );
}

/** Every player's weekly stats and points this season (points only if the stats view isn't set up yet). */
async function loadWeekStats(ctx: LeagueContext): Promise<{ rows: WeekStatRow[]; missingView: boolean }> {
  const sb = ctx.supabase;
  try {
    const rows = await fetchAll<WeekStatRow>((from, to) =>
      sb.from("v_player_week_stats").select("player_id, week, games, sets, kills, attack_errors, attack_attempts, assists, service_aces, service_errors, digs, solo_blocks, block_assists, points")
        .eq("league_id", ctx.league.id).range(from, to) as never);
    return { rows, missingView: false };
  } catch {
    const pts = await fetchAll<{ player_id: string; week: number; points: number }>((from, to) =>
      sb.from("v_player_match_points").select("player_id, week, points").eq("league_id", ctx.league.id).range(from, to) as never);
    const zero = { games: 1, sets: 0, kills: 0, attack_errors: 0, attack_attempts: 0, assists: 0, service_aces: 0, service_errors: 0, digs: 0, solo_blocks: 0, block_assists: 0 };
    return { rows: pts.map((r) => ({ ...zero, player_id: r.player_id, week: r.week, points: r.points })), missingView: true };
  }
}
