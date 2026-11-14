"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/data/context";
import { leagueSettingsSchema } from "@/lib/league/settings";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase/server";

/**
 * Every action here calls a database function as the signed-in user. The database checks
 * permissions and validates the change again; nothing here is trusted on its own.
 */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const uuid = z.string().uuid();

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong.";
  return { ok: false, error: msg };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function refresh(...paths: string[]) {
  for (const p of ["/", ...paths]) revalidatePath(p);
}

/* ---------------------------------------------------------------- Manager actions */

const lineupSchema = z.array(z.object({ player_id: uuid, slot: z.string().regex(/^(BENCH|UTIL\d*|S\d*|L\d*|OH\d*|M\d*)$/) })).max(40);

export async function saveLineup(teamId: string, lineup: Array<{ player_id: string; slot: string }>): Promise<ActionResult> {
  try {
    await rpc("set_lineup", { p_team: uuid.parse(teamId), p_lineup: lineupSchema.parse(lineup) });
    refresh("/team", `/teams/${teamId}`, "/matchups");
    return { ok: true, message: "Lineup saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function addDrop(teamId: string, addPlayerId: string | null, dropPlayerId: string | null): Promise<ActionResult> {
  try {
    await rpc("add_drop", {
      p_team: uuid.parse(teamId),
      p_add: addPlayerId ? uuid.parse(addPlayerId) : null,
      p_drop: dropPlayerId ? uuid.parse(dropPlayerId) : null,
    });
    refresh("/team", "/free-agents", "/players", "/activity");
    return { ok: true, message: addPlayerId ? "Player added to your bench." : "Player dropped." };
  } catch (e) {
    return fail(e);
  }
}

export async function proposeTrade(form: { fromTeam: string; toTeam: string; give: string[]; receive: string[]; message: string }): Promise<ActionResult> {
  try {
    await rpc("propose_trade", {
      p_from_team: uuid.parse(form.fromTeam),
      p_to_team: uuid.parse(form.toTeam),
      p_give: z.array(uuid).max(11).parse(form.give),
      p_receive: z.array(uuid).max(11).parse(form.receive),
      p_message: z.string().max(500).parse(form.message ?? ""),
    });
    refresh("/trades");
    return { ok: true, message: "Trade offer sent." };
  } catch (e) {
    return fail(e);
  }
}

export async function respondTrade(tradeId: string, accept: boolean): Promise<ActionResult> {
  try {
    const status = await rpc("respond_trade", { p_trade: uuid.parse(tradeId), p_accept: accept });
    refresh("/trades", "/team", "/activity");
    const msg = status === "completed" ? "Trade completed. New players are on your bench." : status === "pending_review" ? "Accepted. Waiting for the commissioner's approval." : status === "failed" ? "The trade could not be completed (rosters changed)." : "Trade declined.";
    return { ok: true, message: msg };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelTrade(tradeId: string): Promise<ActionResult> {
  try {
    await rpc("cancel_trade", { p_trade: uuid.parse(tradeId) });
    refresh("/trades");
    return { ok: true, message: "Offer withdrawn." };
  } catch (e) {
    return fail(e);
  }
}

export async function renameTeam(teamId: string, name: string): Promise<ActionResult> {
  try {
    await rpc("rename_my_team", { p_team: uuid.parse(teamId), p_name: name });
    refresh("/team", "/account", "/standings");
    return { ok: true, message: "Team name updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDisplayName(name: string): Promise<ActionResult> {
  try {
    await rpc("update_my_display_name", { p_name: name });
    refresh("/account");
    return { ok: true, message: "Name updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

/* ---------------------------------------------------------------- Administrator actions */

export async function reviewTrade(tradeId: string, approve: boolean, reason: string): Promise<ActionResult> {
  try {
    await rpc("review_trade", { p_trade: uuid.parse(tradeId), p_approve: approve, p_reason: reason || null });
    refresh("/trades", "/admin");
    return { ok: true, message: approve ? "Trade approved and processed." : "Trade vetoed." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateLeague(input: { name: string; status: string; settings: unknown }): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    const settings = leagueSettingsSchema.parse(input.settings);
    await rpc("admin_update_league", { p_league: ctx.league.id, p_name: input.name, p_settings: settings, p_status: input.status });
    refresh("/admin", "/admin/settings", "/team", "/free-agents", "/trades");
    return { ok: true, message: "League settings saved." };
  } catch (e) {
    return fail(e);
  }
}

const ruleInput = z.object({
  stat_key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: z.string().min(1).max(60),
  points: z.number().finite().min(-100).max(100),
  active: z.boolean(),
});

export async function createScoringVersion(input: { rules: unknown; effectiveFromWeek: number; note: string }): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    const rules = z.array(ruleInput).min(1).max(40).parse(input.rules);
    const version = await rpc("admin_create_scoring_rule_set", {
      p_league: ctx.league.id,
      p_rules: rules,
      p_effective_from_week: z.number().int().min(1).parse(input.effectiveFromWeek),
      p_note: input.note || null,
    });
    refresh("/scoring", "/admin/scoring", "/matchups", "/standings", "/players");
    return { ok: true, message: `Scoring version ${version} saved.` };
  } catch (e) {
    return fail(e);
  }
}

export async function adminMovePlayer(playerId: string, toTeamId: string | null, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    await rpc("admin_move_player", { p_league: ctx.league.id, p_player: uuid.parse(playerId), p_to_team: toTeamId ? uuid.parse(toTeamId) : null, p_reason: reason });
    refresh("/admin/teams", "/team", "/free-agents");
    return { ok: true, message: "Roster corrected." };
  } catch (e) {
    return fail(e);
  }
}

export async function inviteManager(teamId: string, email: string, displayName: string, sendEmail: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    const cleanEmail = z.string().email().parse(email.trim().toLowerCase());
    await rpc("admin_invite_manager", { p_team: uuid.parse(teamId), p_email: cleanEmail, p_display_name: displayName });
    if (sendEmail) {
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
      const { error } = await supabaseServiceRole().auth.admin.inviteUserByEmail(cleanEmail, {
        redirectTo: `${site}/auth/callback?next=/auth/update-password`,
        data: { display_name: displayName },
      });
      if (error && !/already been registered/i.test(error.message)) {
        return { ok: false, error: `Saved, but the email could not be sent: ${error.message}` };
      }
      if (error) return { ok: true, message: "This person already has an account. They will get the team next time they sign in." };
    }
    refresh("/admin/teams");
    return { ok: true, message: sendEmail ? "Invitation sent." : "Saved. They can sign in with this email to claim the team." };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------------------------------------------------------- Shareable invite link */

/** Admin: the league's invite link code (reset = make a new one; the old link stops working). */
export async function adminJoinCode(reset: boolean): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const code = (await rpc("admin_join_code", { p_league: ctx.league.id, p_reset: reset })) as string;
    return { ok: true, code };
  } catch (e) {
    return fail(e) as { ok: false; error: string };
  }
}

const joinSchema = z.object({
  code: z.string().regex(/^[0-9a-f]{16}$/, "This invite link is not valid."),
  name: z.string().trim().min(1, "Enter your name.").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(72),
});

/**
 * From the invite link: create an account (no email needed) and sign in. The link's code is
 * checked first, so accounts can only be made by people who were sent the link.
 */
export async function joinCreateAccount(input: { code: string; name: string; email: string; password: string }): Promise<ActionResult> {
  try {
    const v = joinSchema.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the form." };
    const { code, name, email, password } = v.data;
    const sb = await supabaseServer();
    const { data: info } = await sb.rpc("join_link_info", { p_code: code });
    if (!Array.isArray(info) || info.length === 0) return { ok: false, error: "This invite link is no longer valid. Ask the league admin for the new one." };
    const { error } = await supabaseServiceRole().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (error) {
      if (/not allowed|not_admin/i.test(error.message)) return { ok: false, error: "The site can't create accounts yet (its Supabase service key isn't accepted). Please tell the league admin." };
      if (/already|registered|exists/i.test(error.message)) return { ok: false, error: "There's already an account with this email. Use \"I already have an account\" below to sign in." };
      return { ok: false, error: error.message };
    }
    const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
    if (signInError) return { ok: false, error: signInError.message };
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** From the invite link, signed in: take an unclaimed team. */
export async function joinClaimTeam(code: string, teamId: string, name: string): Promise<ActionResult> {
  try {
    await rpc("join_with_link", { p_code: code, p_team: uuid.parse(teamId), p_display_name: name || null });
    refresh("/team", "/standings", "/admin/teams");
    return { ok: true, message: "You're in!" };
  } catch (e) {
    return fail(e);
  }
}

export async function unassignOwner(teamId: string): Promise<ActionResult> {
  try {
    await rpc("admin_unassign_owner", { p_team: uuid.parse(teamId) });
    refresh("/admin/teams");
    return { ok: true, message: "Manager removed from team. Roster unchanged." };
  } catch (e) {
    return fail(e);
  }
}

export async function setMemberRole(userId: string, role: "admin" | "manager"): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    await rpc("admin_set_member_role", { p_league: ctx.league.id, p_user: uuid.parse(userId), p_role: role });
    refresh("/admin/teams");
    return { ok: true, message: "Role updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function setMatchupStatus(matchupId: string, status: "scheduled" | "in_progress" | "final" | "void"): Promise<ActionResult> {
  try {
    await rpc("admin_set_matchup_status", { p_matchup: uuid.parse(matchupId), p_status: status });
    refresh("/matchups", "/standings", "/admin/matchups");
    return { ok: true, message: "Matchup updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateMatch(matchId: string, lockAtIso: string | null, counts: boolean | null, status: string | null): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    await rpc("admin_update_match", {
      p_match: uuid.parse(matchId),
      p_league: ctx.league.id,
      p_lock_at: lockAtIso,
      p_counts: counts,
      p_status: status,
    });
    refresh("/matches", "/admin/matches", "/team");
    return { ok: true, message: "Match updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function createPlayoffRound(week: number, pairs: Array<{ home_team_id: string; away_team_id: string; round: number }>): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin();
    const n = await rpc("admin_create_playoff_matchups", { p_league: ctx.league.id, p_week: week, p_pairs: pairs });
    refresh("/matchups", "/admin/matchups");
    return { ok: true, message: `${n} playoff matchups created for week ${week}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function runSyncNow(): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { runSync } = await import("@/lib/sync/run");
    const r = await runSync({ scheduleMaxAgeHours: 0 }); // "Sync now" also refreshes schedules
    refresh("/admin", "/admin/sync", "/matches", "/team");
    return r.status === "succeeded"
      ? { ok: true, message: `Sync finished: ${r.inserted} new and ${r.updated} updated records.` }
      : { ok: false, error: r.error ?? r.status };
  } catch (e) {
    return fail(e);
  }
}

/** Called after sign-in: links any team the administrator assigned to this email. */
export async function claimTeams(): Promise<number> {
  try {
    return Number(await rpc("claim_my_teams", {}));
  } catch {
    return 0;
  }
}

/* ---------------------------------------------------------------- Scoring preview */

export interface ScoringPreviewRow {
  teamId: string;
  week: number;
  current: number;
  proposed: number;
}

/**
 * Recalculates completed weeks with proposed rules, using the exact lineups that were in
 * place when each match locked. Nothing is saved; this only shows the effect of a change.
 */
export async function previewScoring(rules: unknown): Promise<{ ok: true; rows: ScoringPreviewRow[] } | { ok: false; error: string }> {
  try {
    const ctx = await requireAdmin();
    const parsed = z.array(ruleInput).min(1).max(40).parse(rules);
    const { fetchAll } = await import("@/lib/data/queries");
    const { scoreStatLine, sumPoints, CORE_STAT_KEYS } = await import("@/lib/scoring/engine");
    const sb = ctx.supabase;
    const credited = await fetchAll<{ fantasy_team_id: string; player_id: string; match_id: string; week: number; points: number }>((from, to) =>
      sb.from("v_team_player_match_points").select("fantasy_team_id, player_id, match_id, week, points").eq("league_id", ctx.league.id).eq("counted", true).range(from, to) as never);
    const matchIds = [...new Set(credited.map((c) => c.match_id))];
    const stats = new Map<string, Record<string, number>>();
    for (let i = 0; i < matchIds.length; i += 100) {
      const { data } = await sb.from("player_match_statistics").select("*").in("match_id", matchIds.slice(i, i + 100));
      for (const s of data ?? []) stats.set(`${s.player_id}:${s.match_id}`, s);
    }
    const rs = parsed.map((r) => ({ statKey: r.stat_key, label: r.label, points: r.points, active: r.active }));
    const acc = new Map<string, { cur: number[]; next: number[] }>();
    for (const c of credited) {
      const s = stats.get(`${c.player_id}:${c.match_id}`);
      if (!s) continue;
      const line = { ...Object.fromEntries(CORE_STAT_KEYS.map((k) => [k, s[k] ?? 0])), other: (s.other_statistics ?? {}) as Record<string, number> };
      const key = `${c.fantasy_team_id}:${c.week}`;
      const a = acc.get(key) ?? { cur: [], next: [] };
      a.cur.push(Number(c.points));
      a.next.push(scoreStatLine(line, rs));
      acc.set(key, a);
    }
    const rows: ScoringPreviewRow[] = [...acc.entries()].map(([k, v]) => {
      const [teamId, week] = k.split(":");
      return { teamId: teamId!, week: Number(week), current: sumPoints(v.cur), proposed: sumPoints(v.next) };
    });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed." };
  }
}

/* ---------------------------------------------------------------- League refresh from USportVB */

export async function refreshFromUsportvb(apply: boolean): Promise<{ ok: boolean; markdown?: string; error?: string }> {
  try {
    const ctx = await requireAdmin();
    if (ctx.league.status !== "setup") return { ok: false, error: "The league is active, so re-importing is switched off to protect managers' changes." };
    const { importFromUsportvb } = await import("@/lib/migration/run-import");
    const r = await importFromUsportvb({ mode: apply ? "apply" : "dry_run", refresh: true, createdBy: ctx.user.email ?? ctx.user.id });
    if (apply && r.ok) refresh("/admin", "/admin/import", "/team", "/matchups", "/standings");
    return { ok: r.ok, markdown: r.markdown, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}

/* ---------------------------------------------------------------- Admin: typed-in box scores */

const statRowSchema = z.object({
  player_id: uuid,
  remove: z.boolean().optional(),
  kills: z.number().int().min(0).max(300).optional(),
  attack_errors: z.number().int().min(0).max(300).optional(),
  attack_attempts: z.number().int().min(0).max(300).optional(),
  assists: z.number().int().min(0).max(300).optional(),
  service_aces: z.number().int().min(0).max(300).optional(),
  service_errors: z.number().int().min(0).max(300).optional(),
  digs: z.number().int().min(0).max(300).optional(),
  solo_blocks: z.number().int().min(0).max(300).optional(),
  block_assists: z.number().int().min(0).max(300).optional(),
  sets_played: z.number().int().min(0).max(5).nullable().optional(),
});

/** Admin: save a game's stats typed in by hand (when no source has the box score). */
export async function adminSaveMatchStats(matchId: string, rows: unknown[]): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = z.array(statRowSchema).max(60).parse(rows);
    if (parsed.length === 0) return { ok: false, error: "Nothing to save." };
    const n = (await rpc("admin_set_match_stats_and_refresh", { p_match: uuid.parse(matchId), p_rows: parsed })) as number;
    refresh("/team", "/matchups", "/standings", "/players", `/matches/${matchId}`, "/admin/matches");
    return { ok: true, message: `Saved ${n} player line${n === 1 ? "" : "s"}. Points, matchups and standings are updated.` };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------------------------------------------------------- Waiver claims */

/** Claim a free agent (optionally naming a player to drop). Claims are decided at midnight. */
export async function submitWaiverClaim(teamId: string, addPlayerId: string, dropPlayerId: string | null): Promise<ActionResult> {
  try {
    await rpc("submit_waiver_claim", { p_team: uuid.parse(teamId), p_add: uuid.parse(addPlayerId), p_drop: dropPlayerId ? uuid.parse(dropPlayerId) : null });
    refresh("/free-agents", "/team", "/players");
    return { ok: true, message: "Claim placed. It's decided at midnight." };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelWaiverClaim(claimId: string): Promise<ActionResult> {
  try {
    await rpc("cancel_waiver_claim", { p_claim: uuid.parse(claimId) });
    refresh("/free-agents", "/team");
    return { ok: true, message: "Claim cancelled." };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------------------------------------------------------- Team pictures */

/** Set (or remove, with null) a team's picture: a small image already resized in the browser. */
export async function setTeamLogo(teamId: string, image: string | null): Promise<ActionResult> {
  try {
    if (image !== null && (image.length > 400_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) {
      return { ok: false, error: "That image could not be used. Try a JPG or PNG." };
    }
    await rpc("set_team_logo", { p_team: uuid.parse(teamId), p_image: image });
    revalidatePath("/", "layout");
    return { ok: true, message: image ? "Team picture updated." : "Team picture removed." };
  } catch (e) {
    return fail(e);
  }
}
