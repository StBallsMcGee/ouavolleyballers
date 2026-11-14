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
  BN: "bg-surface-3 text-gray-500",
};
const TEXT: Record<string, string> = {
  S: "text-[#ff9cc0]",
  OH: "text-[#8fc0ff]",
  M: "text-[#7fe0a6]",
  L: "text-[#ffc785]",
  UTIL: "text-[#c3adff]",
};

function key(label: string | null | undefined): string {
  const k = (label ?? "").trim().toUpperCase().split(/[\s/,]+/)[0] ?? "";
  if (k === "BENCH") return "BN";
  if (k.startsWith("UTIL")) return "UTIL";
  if (k === "LIB" || k === "LIBERO") return "L";
  if (k === "MB" || k === "MIDDLE") return "M";
  if (k === "SETTER") return "S";
  if (k === "OUTSIDE" || k === "RS" || k === "OPP") return "OH";
  return k;
}

/** The coloured slot tile in a lineup row (OH, M, S, L, UTIL, BN). */
export function PositionTile({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
  const k = key(label);
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg font-extrabold shadow-sm ${TILE[k] ?? "bg-surface-3 text-gray-700"} ${size === "sm" ? "h-6 w-9 text-[10px]" : "h-8 w-11 text-[11px]"}`}>
      {k === "BN" ? "BN" : label}
    </span>
  );
}

/** Text colour for a player's position (matches her slot tile). */
export function positionText(label: string | null | undefined): string {
  return TEXT[key(label)] ?? "text-gray-500";
}
