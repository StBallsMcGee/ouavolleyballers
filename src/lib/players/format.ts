import type { CoreStatKey, StatLine } from "@/lib/scoring/engine";

const ORDER: Array<[CoreStatKey, string]> = [
  ["kills", "K"], ["attack_errors", "E"], ["assists", "A"], ["service_aces", "SA"], ["service_errors", "SE"],
  ["digs", "D"], ["solo_blocks", "BS"], ["block_assists", "BA"],
];

/** Compact one-line stat summary for phones, e.g. "12 K · 3 E · 6 D · 2 SA". Zeros are left out. */
export function statSummary(line: StatLine): string {
  const parts = ORDER.filter(([k]) => (line[k] ?? 0) !== 0).map(([k, l]) => `${line[k]} ${l}`);
  return parts.length ? parts.join(" · ") : "No stats";
}
