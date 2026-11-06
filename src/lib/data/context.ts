import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { parseSettings, startingSlots, type LeagueSettings } from "@/lib/league/settings";
import { localDate } from "@/lib/time";
import { supabaseServer } from "@/lib/supabase/server";

export interface LeagueRow {
  id: string;
  name: string;
  season_label: string;
  status: string;
  timezone: string;
  settings: LeagueSettings;
}
export interface WeekRow {
  week: number;
  starts_on: string;
  ends_on: string;
  is_playoff: boolean;
}
export interface TeamWithManager {
  id: string;
  name: string;
  owner_user_id: string | null;
  manager_display_name: string | null;
  active: boolean;
  manager: string;
}

/** The week containing today; during breaks, the next week to start; after the season, the last. */
export function currentWeekFor(weeks: readonly WeekRow[], today: string): number | null {
  if (weeks.length === 0) return null;
  const inside = weeks.find((w) => w.starts_on <= today && today <= w.ends_on);
  if (inside) return inside.week;
  const next = weeks.find((w) => w.starts_on > today);
  return next ? next.week : weeks[weeks.length - 1]!.week;
}

/**
 * Everything most pages need: the signed-in user, their league, role and team, the league
 * calendar and the team list. Cached for the duration of one request.
 */
export const getContext = cache(async () => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const user = auth.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, is_site_admin")
    .eq("id", user.id)
    .maybeSingle();
  const { data: memberships } = await supabase.from("league_members").select("league_id, role").eq("user_id", user.id);

  let leagueId = memberships?.[0]?.league_id as string | undefined;
  if (!leagueId && profile?.is_site_admin) {
    const { data: first } = await supabase.from("leagues").select("id").order("created_at").limit(1).maybeSingle();
    leagueId = first?.id;
  }

  const empty = {
    supabase,
    user,
    profile,
    league: null as LeagueRow | null,
    role: null as "admin" | "manager" | null,
    isAdmin: false,
    myTeam: null as TeamWithManager | null,
    teams: [] as TeamWithManager[],
    weeks: [] as WeekRow[],
    slots: [] as string[],
    today: localDate(),
    currentWeek: null as number | null,
  };
  if (!leagueId) return empty;

  const [{ data: leagueRaw }, { data: teams }, { data: weeks }] = await Promise.all([
    supabase.from("leagues").select("id, name, season_label, status, timezone, settings").eq("id", leagueId).single(),
    supabase
      .from("fantasy_teams")
      .select("id, name, owner_user_id, manager_display_name, active")
      .eq("league_id", leagueId)
      .eq("active", true)
      .order("name"),
    supabase.from("matchup_weeks").select("week, starts_on, ends_on, is_playoff").eq("league_id", leagueId).order("week"),
  ]);
  if (!leagueRaw) return empty;
  const league: LeagueRow = { ...leagueRaw, settings: parseSettings(leagueRaw.settings) };
  const role = (memberships?.find((m) => m.league_id === leagueId)?.role as "admin" | "manager" | undefined) ?? null;
  const isAdmin = role === "admin" || !!profile?.is_site_admin;

  const ownerIds = (teams ?? []).map((t) => t.owner_user_id).filter(Boolean) as string[];
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ownerIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const ownerName = new Map((owners ?? []).map((o) => [o.id as string, o.display_name as string]));
  const teamsWithManagers: TeamWithManager[] = (teams ?? []).map((t) => ({
    ...t,
    manager: (t.owner_user_id && ownerName.get(t.owner_user_id)) || t.manager_display_name || "Unclaimed",
  }));
  const today = localDate(new Date(), league.timezone);

  return {
    ...empty,
    league,
    role,
    isAdmin,
    myTeam: teamsWithManagers.find((t) => t.owner_user_id === user.id) ?? null,
    teams: teamsWithManagers,
    weeks: (weeks ?? []) as WeekRow[],
    slots: startingSlots(league.settings.roster),
    today,
    currentWeek: currentWeekFor((weeks ?? []) as WeekRow[], today),
  };
});

export async function requireLeague() {
  const ctx = await getContext();
  if (!ctx.league) redirect("/welcome");
  return ctx as typeof ctx & { league: LeagueRow };
}

export async function requireAdmin() {
  const ctx = await requireLeague();
  if (!ctx.isAdmin) redirect("/");
  return ctx;
}
