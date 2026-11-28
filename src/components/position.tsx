/**
 * Position colours, used for the slot tiles in lineups and the position text under each name:
 * setter pink, outside hitter blue, middle green, libero orange, utility a mix, bench grey.
 */
const TILE: Record<string, string> = {
  S: "bg-[#ff9cc0] text-charcoal",
  OH: "bg-[#8fc0ff] text-charcoal",
  M: "bg-[#7fe0a6] text-charcoal",
  L: "bg-[#ffc785] text-charcoal",
  UTIL: "bg-gradient-to-r from-[#8fc0ff] via-[#7fe0a6] to-[#ffc785] text-charcoal",
  FLEX: "bg-gradient-to-r from-[#8fc0ff] to-[#7fe0a6] text-charcoal",
  BN: "bg-surface-3 text-gray-500",
};
const TEXT: Record<string, string> = {
  S: "text-[#ff9cc0]",
  OH: "text-[#8fc0ff]",
  M: "text-[#7fe0a6]",
  L: "text-[#ffc785]",
  UTIL: "text-[#c3adff]",
  FLEX: "bg-gradient-to-r from-[#8fc0ff] to-[#7fe0a6] bg-clip-text text-transparent",
};

function key(label: string | null | undefined): string {
  const k = (label ?? "").trim().toUpperCase().split(/[\s/,]+/)[0] ?? "";
  if (k === "BENCH") return "BN";
  if (k.startsWith("UTIL")) return "UTIL";
  if (k.startsWith("FLEX")) return "FLEX";
  if (k === "LIB" || k === "LIBERO") return "L";
  if (k === "MB" || k === "MIDDLE") return "M";
  if (k === "SETTER") return "S";
  if (k === "OUTSIDE" || k === "RS" || k === "OPP") return "OH";
  return k;
}

/** The coloured slot tile in a lineup row (OH, M, S, L, FLEX shown as "OH/M", UTIL, BN). */
export function PositionTile({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
  const k = key(label);
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg font-extrabold shadow-sm ${TILE[k] ?? "bg-surface-3 text-gray-700"} ${size === "sm" ? "h-6 w-9 text-[10px]" : "h-8 w-11 text-[11px]"}`}>
      {k === "BN" ? "BN" : k === "FLEX" ? "OH/M" : label}
    </span>
  );
}

/** Text colour for a player's position (matches her slot tile). */
export function positionText(label: string | null | undefined): string {
  return TEXT[key(label)] ?? "text-gray-500";
}

/**
 * A position filter chip in that position's colour: filled when chosen, outlined otherwise.
 * "ALL" (or anything else) uses gold.
 */
export function positionChipClass(label: string, on: boolean): string {
  const k = key(label);
  const base = "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-extrabold transition active:scale-95";
  if (on) return `${base} ${TILE[k] && k !== "BN" ? TILE[k] : "tile-gold"} shadow-md shadow-black/30 ring-2 ring-white/70`;
  return `${base} border border-current bg-surface-2 ${TEXT[k] ?? "text-gold-300"} hover:bg-surface-3`;
}

/** The soft position-coloured background used behind a player's points. */
export function positionTileClass(label: string | null | undefined): string {
  return TILE[key(label)] ?? "tile-gold";
}
