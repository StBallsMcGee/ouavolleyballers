import Link from "next/link";
import { CourtLines } from "@/components/court";
import { PlayerPhoto } from "@/components/player-photo";
import { TeamAvatar, type TeamLike } from "@/components/team-avatar";
import type { CourtPlayer, CourtRole } from "@/lib/data/court";

// Where each role stands on the left half (x, y in % of the card); the right half is mirrored.
// Front row by the net: outside, middle, outside. Back row: outside, libero, setter.
const SPOTS: Record<string, [number, number]> = {
  "OH-0": [38, 24], "M-0": [41, 50], "OH-1": [38, 76],
  "OH-2": [16, 24], "L-0": [13, 50], "S-0": [17, 76],
};

function spots(players: CourtPlayer[], side: "left" | "right") {
  const seen: Record<string, number> = {};
  return players.map((p, i) => {
    const n = seen[p.role] ?? 0;
    seen[p.role] = n + 1;
    const [x, y] = SPOTS[`${p.role}-${n}`] ?? [20 + (i % 2) * 18, 20 + i * 12];
    return { p, x: side === "left" ? x : 100 - x, y, i };
  });
}

/**
 * Your matchup as a volleyball court: six players from each team on their own side, drifting
 * around as if the rally is on, with the ball flying over the net. Tapping opens the matchup.
 */
export function CourtScene({
  href, home, away, homeScore, awayScore, homePlayers, awayPlayers, status, myTeamId,
}: {
  href: string;
  home: TeamLike | undefined;
  away: TeamLike | undefined;
  homeScore: number;
  awayScore: number;
  homePlayers: CourtPlayer[];
  awayPlayers: CourtPlayer[];
  status: string;
  myTeamId: string | null;
}) {
  const roleLabel: Record<CourtRole, string> = { OH: "Outside hitter", M: "Middle", S: "Setter", L: "Libero" };
  const side = (t: TeamLike | undefined, score: number, align: "left" | "right") => (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <TeamAvatar team={t} size={28} ring={t?.id === myTeamId} />
      <div className="min-w-0">
        <div className={`truncate text-[12px] font-extrabold ${t?.id === myTeamId ? "text-gold-300" : "text-white"}`}>{t?.name}</div>
        <div className="text-xl font-black leading-none tabular-nums text-white">{score.toFixed(1)}</div>
      </div>
    </div>
  );
  return (
    <Link href={href} className="group relative mx-3 block overflow-hidden rounded-3xl bg-gradient-to-br from-[#8fe3d6] via-[#9f9bff] to-[#ffb38a] p-3 shadow-xl shadow-black/40 active:opacity-95 sm:mx-0" aria-label="Open your matchup">
      {/* Score bar */}
      <div className="relative z-10 mb-2 flex items-center gap-2 rounded-2xl bg-charcoal/70 px-3 py-2 backdrop-blur">
        {side(home, homeScore, "left")}
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-gold-300">
          {status === "in_progress" ? "● Live" : status === "final" ? "Final" : "Your matchup"}
        </span>
        {side(away, awayScore, "right")}
      </div>
      {/* The court */}
      <div className="relative aspect-[2/1] w-full">
        <CourtLines className="absolute inset-0 h-full w-full" floor="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.95)" />
        {[...spots(homePlayers, "left"), ...spots(awayPlayers, "right")].map(({ p, x, y }, k) => (
          <div
            key={`${p.id}-${k}`}
            className="vb-player absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%`, animationName: `vb-drift-${(k % 3) + 1}`, animationDuration: `${2.4 + ((k * 7) % 10) / 10}s`, animationDelay: `-${(k * 0.37) % 2}s` }}
            title={`${p.name} · ${roleLabel[p.role]}`}
          >
            <span className="block rounded-full ring-2 ring-white shadow-md shadow-black/30">
              <PlayerPhoto name={p.name} photo={p.photo} size={30} />
            </span>
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-charcoal/80 px-1 text-[7px] font-extrabold leading-tight text-white">{p.role}</span>
          </div>
        ))}
        {/* The ball, flying over the net */}
        <span className="vb-ball absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-gold-200 to-gold-500 shadow-[0_0_10px_rgba(249,194,46,0.8)] ring-1 ring-brand-700" aria-hidden />
      </div>
    </Link>
  );
}
