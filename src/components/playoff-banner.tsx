import Link from "next/link";
import type { MatchupScore } from "@/lib/data/queries";

/**
 * Shown on Home and the Matchup screen during the playoffs, for the signed-in manager's own
 * game: gold for the title race, silver for the 5th–8th place games, violet for the consolation
 * ladder. Says what's at stake.
 */
export function PlayoffBanner({ matchup, myTeamId, href }: { matchup: MatchupScore; myTeamId: string; href?: string }) {
  if (!matchup.label || matchup.place_base == null || matchup.status === "final") return null;
  const base = matchup.place_base;
  const round = matchup.playoff_round ?? 1;
  const mySeed = matchup.home_team_id === myTeamId ? matchup.seed_home : matchup.seed_away;
  const theirSeed = matchup.home_team_id === myTeamId ? matchup.seed_away : matchup.seed_home;
  const stake =
    base === 1 && round === 1 ? "Win to reach the semifinals."
      : base === 1 && round === 2 ? "Win to play for the championship. Lose and you play for bronze."
        : base === 1 ? "Winner takes the league title."
          : base === 3 ? "Win to take the bronze medal."
            : round === 3 ? `Win to finish ${matchup.label?.replace(" place", "")}.`
              : base >= 9 && round === 1 ? "Win to keep climbing the consolation ladder."
                : "Win to finish higher.";
  const tone = base <= 3
    ? { box: "tile-gold", icon: base === 3 ? "🥉" : round === 3 ? "🏆" : "🏆", kicker: "Playoffs" }
    : base <= 8
      ? { box: "bg-gradient-to-br from-[#eef1f5] to-[#a8b0bd] text-charcoal", icon: "🎖️", kicker: "Playoffs · placement" }
      : { box: "tile-violet", icon: "🪜", kicker: "Consolation ladder" };
  const body = (
    <div className={`relative mx-3 flex items-center gap-3 overflow-hidden rounded-3xl p-4 shadow-xl shadow-black/30 sm:mx-0 ${tone.box}`}>
      <span aria-hidden className="pointer-events-none absolute -right-4 -top-6 text-[96px] leading-none opacity-15">{tone.icon}</span>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/40 text-2xl shadow-inner" aria-hidden>{tone.icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] opacity-70">{tone.kicker}{mySeed ? ` · seed #${mySeed}${theirSeed ? ` vs #${theirSeed}` : ""}` : ""}</p>
        <p className="text-lg font-black leading-tight">{matchup.label}</p>
        <p className="text-[12px] font-semibold opacity-80">{stake}</p>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block active:opacity-95">{body}</Link> : body;
}
