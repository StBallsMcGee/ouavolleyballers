import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
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
  /** When the team's picture last changed (null = no picture). */
  logo_v: number | null;
}

/** The week containing today; during breaks, the next week to start; after the season, the last. */
export function currentWeekFor(weeks: readonly WeekRow[], today: string): number | null {
  if (weeks.length === 0) return null;
  const inside = weeks.find((w) => w.starts_on <= today && today <= w.ends_on);
  if (inside) return inside.week;
  const next = weeks.find((w) => w.starts_on > today);
  return next ? next.week : weeks[weeks.length - 1]!.week;
}

/** The user the middleware verified on this request (see middleware.ts), if any. */
function verifiedUser(raw: string | null): { id: string; email: string | null } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as { id?: unknown; email?: unknown };
    return typeof v.id === "string" ? { id: v.id, email: typeof v.email === "string" ? v.email : null } : null;
  } catch {
    return null;
  }
}

/**
 * Everything most pages need: the signed-in user, their league, role and team, the league
 * calendar and the team list. Cached for the duration of one request.
 */
export const getContext = cache(async () => {
  const [supabase, h] = await Promise.all([supabaseServer(), headers()]);
  const user = verifiedUser(h.get("x-sideout-verified-user")) ?? (await supabase.auth.getUser()).data.user;
  if (!user) redirect("/login");

  // One round trip (database function my_context); the step-by-step queries below are the
  // fallback for a database that hasn't had that function added yet.
  type Raw = {
    profile: { id: string; email: string; display_name: string; is_site_admin: boolean } | null;
    memberships: { league_id: string; role: string }[];
    league: (Omit<LeagueRow, "settings"> & { settings: unknown }) | null;
    teams: (Omit<TeamWithManager, "manager" | "logo_v"> & { owner_name?: string | null; logo_v?: number | null })[];
    weeks: WeekRow[];
  };
  let raw: Raw | null = null;
  const rpc = await supabase.rpc("my_context");
  if (!rpc.error && rpc.data) raw = rpc.data as Raw;
  else raw = await loadContextStepByStep(supabase, user.id);
  const { profile, memberships } = raw;

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
  const leagueRaw = raw.league;
  if (!leagueRaw) return empty;
  const league: LeagueRow = { ...leagueRaw, settings: parseSettings(leagueRaw.settings) };
  const role = (memberships.find((m) => m.league_id === league.id)?.role as "admin" | "manager" | undefined) ?? null;
  const isAdmin = role === "admin" || !!profile?.is_site_admin;
  const teamsWithManagers: TeamWithManager[] = raw.teams.map(({ owner_name, ...t }) => ({
    ...t,
    logo_v: (t as { logo_v?: number | null }).logo_v ?? null,
    manager: owner_name || t.manager_display_name || "Unclaimed",
  }));
  const weeks = raw.weeks;
  const today = localDate(new Date(), league.timezone);

  return {
    ...empty,
    league,
    role,
    isAdmin,
    myTeam: teamsWithManagers.find((t) => t.owner_user_id === user.id) ?? null,
    teams: teamsWithManagers,
    weeks,
    slots: startingSlots(league.settings.roster),
    today,
    currentWeek: currentWeekFor(weeks, today),
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

/** The same information as my_context(), fetched step by step (older databases). */
async function loadContextStepByStep(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string) {
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("id, email, display_name, is_site_admin").eq("id", userId).maybeSingle(),
    supabase.from("league_members").select("league_id, role").eq("user_id", userId),
  ]);
  let leagueId = memberships?.[0]?.league_id as string | undefined;
  if (!leagueId && profile?.is_site_admin) {
    const { data: first } = await supabase.from("leagues").select("id").order("created_at").limit(1).maybeSingle();
    leagueId = first?.id;
  }
  const base = { profile: profile ?? null, memberships: memberships ?? [], league: null, teams: [], weeks: [] };
  if (!leagueId) return base;
  const [{ data: league }, { data: teams }, { data: weeks }] = await Promise.all([
    supabase.from("leagues").select("id, name, season_label, status, timezone, settings").eq("id", leagueId).single(),
    supabase.from("fantasy_teams").select("id, name, owner_user_id, manager_display_name, active").eq("league_id", leagueId).eq("active", true).order("name"),
    supabase.from("matchup_weeks").select("week, starts_on, ends_on, is_playoff").eq("league_id", leagueId).order("week"),
  ]);
  const ownerIds = (teams ?? []).map((t) => t.owner_user_id).filter(Boolean) as string[];
  const { data: owners } = ownerIds.length ? await supabase.from("profiles").select("id, display_name").in("id", ownerIds) : { data: [] as { id: string; display_name: string }[] };
  const ownerName = new Map((owners ?? []).map((o) => [o.id as string, o.display_name as string]));
  return {
    ...base,
    league,
    teams: (teams ?? []).map((t) => ({ ...t, owner_name: t.owner_user_id ? ownerName.get(t.owner_user_id) ?? null : null })),
    weeks: (weeks ?? []) as WeekRow[],
  };
}
