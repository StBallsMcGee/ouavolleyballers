import Link from "next/link";
import { requireLeague } from "@/lib/data/context";
import { getRuleSets, ruleSetInForce } from "@/lib/data/queries";
import { startingSlots, slotGroup } from "@/lib/league/settings";
import { PageHeader } from "@/components/ui";
import { PositionTile } from "@/components/position";

export const metadata = { title: "How it works" };

const TILES = ["tile-gold", "tile-blue", "tile-green", "tile-violet", "tile-orange", "tile-teal", "tile-pink"];

/** The league guide: fantasy basics and this league's rules, using the league's real settings. */
export default async function HelpPage() {
  const ctx = await requireLeague();
  const { league } = ctx;
  const s = league.settings;
  const rules = ruleSetInForce(await getRuleSets(ctx.supabase, league.id), ctx.currentWeek ?? 1)?.rules.filter((r) => r.active && Number(r.points) !== 0) ?? [];
  const slots = startingSlots(s.roster);
  const groups = [...new Set(slots.map(slotGroup))].map((g) => ({ g, n: slots.filter((x) => slotGroup(x) === g).length }));
  const starters = slots.length;
  const bench = Math.max(0, s.roster.TOTAL - starters);
  const lastRegular = s.playoffs.enabled ? s.playoffs.startWeek - 1 : null;
  const fmt = (p: number) => (p > 0 ? `+${p}` : String(p));
  let n = 0;
  const section = (title: string, emoji: string, body: React.ReactNode, open = false) => (
    <details className="group mx-3 overflow-hidden rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className={`${TILES[n++ % TILES.length]} grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg shadow-md`} aria-hidden>{emoji}</span>
        <span className="flex-1 text-[15px] font-extrabold">{title}</span>
        <span className="text-gray-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2.5 border-t border-gray-100 px-4 py-3 text-[14px] leading-relaxed text-gray-700 [&_b]:text-gray-900">{body}</div>
    </details>
  );

  return (
    <>
      <PageHeader title="How does this all work?" subtitle="Fantasy basics and this league's rules" tone="gold" />
      <div className="space-y-3">
        {section("Fantasy volleyball in 30 seconds", "🏐", <>
          <p>You manage a fantasy team made of <b>real OUA women&apos;s volleyball players</b>. When they play real matches, their stats (kills, digs, assists, aces, blocks…) earn your team <b>fantasy points</b>.</p>
          <p>Every week you face one other team in the league. Whoever&apos;s <b>starters</b> score more points that week wins. Win enough weeks and you make the playoffs.</p>
          <p>Your job: pick who starts each day, pick up players who are playing well, and make trades.</p>
        </>, true)}

        {section("Your roster and lineup", "📋", <>
          <p>Each team has <b>{s.roster.TOTAL} players</b>: <b>{starters} starters</b> and {bench} on the bench. Only starters score; bench points don&apos;t count.</p>
          <div className="flex flex-wrap gap-2">
            {groups.map(({ g, n: c }) => (
              <span key={g} className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-2 py-1 text-[13px] font-bold">
                <PositionTile label={g} size="sm" /> × {c}
              </span>
            ))}
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>S</b> setter · <b>OH</b> outside hitter · <b>M</b> middle · <b>L</b> libero. A player can only start in a position she&apos;s listed at.</li>
            {s.roster.FLEX ? <li><b>OH/M (Flex)</b> takes an outside hitter <i>or</i> a middle.</li> : null}
            {s.roster.UTIL ? <li><b>UTIL</b> takes any position.</li> : null}
            <li>Change your lineup under <Link href="/team" className="link">My Team</Link>; it saves by itself. Pick any day with the day strip, including future days, to set lineups ahead of time.</li>
            <li><b>Start active players</b> fills your lineup with players who have a game that day.</li>
          </ul>
        </>)}

        {section("When players lock", "🔒", <>
          <p>A player <b>locks when her match starts</b> and stays locked until <b>midnight</b> (Toronto time). Once locked she can&apos;t be moved in or out of your lineup that day. A trade involving her takes effect at midnight.</p>
          <p>Each player locks on her own schedule, so you can still change players whose games are later that day. If a match has no listed start time, it locks at {s.lineupLock.fallbackLocalTime.replace(/^0/, "")}.</p>
          <p>Points count for whoever was in your starting lineup <b>when her match locked</b>.</p>
        </>)}

        {section("Scoring", "⭐", <>
          <p>Every stat a starter records is worth points:</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 sm:grid-cols-3">
            {rules.map((r) => (
              <div key={r.stat_key} className="flex justify-between gap-2 text-[13px]">
                <span>{r.label}</span><b className={Number(r.points) < 0 ? "!text-red-500" : ""}>{fmt(Number(r.points))}</b>
              </div>
            ))}
          </div>
          <p>Points update <b>every minute during games</b> from the OUA&apos;s live stats, and are confirmed from the final box scores. If a stat is corrected later, points update too. The full table is on the <Link href="/scoring" className="link">Scoring</Link> page.</p>
        </>)}

        {section("Weekly matchups and standings", "🆚", <>
          <p>Fantasy weeks run <b>Monday to Sunday</b>. Your score is the total of your starters&apos; points that week; the higher total wins. Equal scores are a tie.</p>
          <p>A week becomes final once every match in it has finished. <Link href="/standings" className="link">Standings</Link> rank teams by winning percentage, then total points scored. The Playoffs % column estimates each team&apos;s chances from the rest of the schedule.</p>
        </>)}

        {section("Free agents and waivers", "➕", <>
          <p>Any player not on a team is a <b>free agent</b>. Find them under <Link href="/players?view=available" className="link">Players → Available</Link> (sort by points, per game, projected or last 3).</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Add</b>: if her game today hasn&apos;t started, she joins your bench right away.</li>
            <li><b>Claim</b>: once her game has started that day, you put in a claim instead, decided at <b>midnight</b>.</li>
            <li><b>Waivers</b>: a player who was just dropped is on waivers until the <b>second midnight</b> after the drop, so everyone gets a day or two to see her. You can claim her any time; claims are decided when her waiver period ends. She shows a <b>Waivers</b> badge.</li>
            <li><b>Waiver order</b>: when several teams claim the same player, the team highest in the waiver order gets her, and then moves to the <b>back</b> of the order. The order started as the standings reversed (last place first).</li>
            <li>If your roster is full, you choose who to drop when you add or claim.</li>
          </ul>
          {!s.freeAgency.enabled ? <p className="font-bold text-amber-600">Free agency is currently closed by the commissioner.</p> : null}
        </>)}

        {section("Trades", "🔄", <>
          {s.trades.enabled ? <>
            <ul className="list-disc space-y-1 pl-5">
              <li>Propose a trade under <Link href="/players?view=trades" className="link">Players → Trades</Link>: pick a team and the players on each side. The other manager accepts or declines.</li>
              {s.trades.review === "commissioner" ? <li>Accepted trades then go to the <b>commissioner for approval</b>.</li> : null}
              <li>Players switch teams <b>right away</b>, unless one of them has already played that day; then the trade happens at <b>midnight</b>.</li>
              <li>A trade can take your roster over {s.roster.TOTAL}. If it does, you must drop players before you can change your lineup.</li>
              <li>If a player in an offer is traded or dropped elsewhere first, the offer is cancelled.</li>
              {s.trades.deadlineWeek ? <li><b>Trade deadline:</b> the end of week {s.trades.deadlineWeek}.</li> : null}
            </ul>
          </> : <p className="font-bold text-amber-600">Trading is currently closed by the commissioner.</p>}
        </>)}

        {section("Playoffs", "🏆", s.playoffs.enabled ? <>
          <p>The regular season is weeks 1 to {lastRegular}. Then, automatically:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Week {s.playoffs.startWeek}: quarterfinals</b> for the top 8 (1 v 8, 4 v 5, 2 v 7, 3 v 6).</li>
            <li><b>Week {s.playoffs.startWeek + 1}: semifinals</b> for the winners; the others play for 5th–8th.</li>
            <li><b>Week {s.playoffs.startWeek + 2}: the championship</b> and <b>bronze medal</b> games, plus games for every other place.</li>
            <li>Teams 9th and lower play a <b>consolation ladder</b> the same way, for the places below.</li>
            <li>A tied playoff game goes to the <b>higher seed</b>. Playoff and ladder games don&apos;t change the regular-season standings.</li>
          </ul>
          <p>Everyone plays every week, so lineups still matter all the way through.</p>
        </> : <p>The commissioner hasn&apos;t set up the playoffs yet.</p>)}

        {section("Players, projections and news", "📰", <>
          <ul className="list-disc space-y-1 pl-5">
            <li><Link href="/players" className="link">Players → Leaders</Link> ranks everyone by points for any week or the season, by position.</li>
            <li>Tap any player for her stats, trend chart, <b>projected points</b> (based mostly on her recent games) and a <b>weekly news story</b> written every Monday morning about her week.</li>
            <li><b>Guest player:</b> Micah Huisman from the Windsor <i>men&apos;s</i> team is in the player pool too. He works like everyone else, with his own men&apos;s schedule and stats.</li>
            <li>Watch games live on OUA.TV from the bottom of the Home screen.</li>
          </ul>
        </>)}

        {section("The commissioner", "🧑‍⚖️", <>
          <p>The commissioner runs the league and can change settings, fix rosters, approve trades (if set up that way), and <b>dissolve a team</b>: its players go to waivers, and the team keeps its record. Its remaining matchups are still played (it scores 0), so results against it still count.</p>
          <p>Every roster move, trade and settings change is recorded, and the full history is under <Link href="/activity" className="link">League activity</Link>.</p>
        </>)}

        {section("Account and sign-in help", "🔑", <>
          <ul className="list-disc space-y-1 pl-5">
            <li>Sign in with your email and password, or tap <b>Email me a code</b> and type the code from the email.</li>
            <li>Forgot your password? Use <b>Forgot your password?</b> on the sign-in screen, or ask the commissioner to set a temporary one.</li>
            <li>Change your name, team name, team picture or password under <Link href="/account" className="link">Account</Link>.</li>
            <li>Tip: add Sideout to your phone&apos;s home screen (Share → Add to Home Screen) to use it like an app.</li>
          </ul>
        </>)}
      </div>
    </>
  );
}
