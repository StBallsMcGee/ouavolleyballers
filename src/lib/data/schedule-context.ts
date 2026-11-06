import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { gameChips, isBye } from "./games";
import { getMatchesBetween, getUniversities } from "./queries";
import type { WeekRow } from "./context";

/** Loads what's needed to show each player's games this fantasy week. */
export async function loadScheduleContext(sb: SupabaseClient, weeks: readonly WeekRow[], currentWeek: number | null, today: string) {
  const week = weeks.find((w) => w.week === currentWeek) ?? null;
  const from = week && week.starts_on < today ? week.starts_on : today;
  const [unis, matches] = await Promise.all([getUniversities(sb), getMatchesBetween(sb, from, addDays(from, 75))]);
  const cache = new Map<string, ReturnType<typeof gameChips>>();
  const chipsFor = (uni: string | null) => {
    const k = uni ?? "";
    if (!cache.has(k)) cache.set(k, gameChips(uni, matches, unis, week, today));
    return cache.get(k)!;
  };
  return {
    unis,
    week,
    chipsFor,
    code: (uni: string | null) => (uni ? unis.get(uni)?.short_name ?? unis.get(uni)?.name ?? "?" : "?"),
    playsThisWeek: (uni: string | null) => !!uni && !isBye(chipsFor(uni)) && chipsFor(uni).length > 0,
  };
}
