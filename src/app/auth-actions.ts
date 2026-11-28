"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/data/context";
import { supabaseServer, supabaseServiceRole } from "@/lib/supabase/server";
import { friendlyAuthError, normalizeEmail } from "@/lib/auth/messages";

/**
 * Sign-in runs on the app's server, not in the phone's browser: the phone only ever talks to this
 * site (some school and work networks block supabase.co), and the session cookie is set by the
 * server response. Email codes work on any device or browser, unlike sign-in links, which only
 * work in the browser that asked for them.
 */
export type AuthResult = { ok: true; message?: string; next?: string } | { ok: false; error: string };

const email = z.string().transform(normalizeEmail).pipe(z.string().email("Enter a valid email address."));

async function claimTeams() {
  try {
    const sb = await supabaseServer();
    await sb.rpc("claim_my_teams");
  } catch {
    // Not fatal: teams are also claimed the next time they open the app.
  }
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ouavolleyballers.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInPassword(input: { email: string; password: string }): Promise<AuthResult> {
  const e = email.safeParse(input.email);
  if (!e.success) return { ok: false, error: "Enter a valid email address." };
  if (!input.password) return { ok: false, error: "Enter your password." };
  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword({ email: e.data, password: input.password });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    await claimTeams();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err instanceof Error ? err.message : "") };
  }
}

/** Emails a sign-in (or password reset) code. The same email also carries a link, for whoever prefers it. */
export async function sendEmailCode(input: { email: string; purpose: "signin" | "reset"; next?: string }): Promise<AuthResult> {
  const e = email.safeParse(input.email);
  if (!e.success) return { ok: false, error: "Enter a valid email address." };
  const next = input.next && input.next.startsWith("/") && !input.next.startsWith("//") ? input.next : "/";
  try {
    const sb = await supabaseServer();
    const callback = `${await siteOrigin()}/auth/callback`;
    const { error } = input.purpose === "signin"
      ? await sb.auth.signInWithOtp({ email: e.data, options: { shouldCreateUser: false, emailRedirectTo: `${callback}?next=${encodeURIComponent(next)}` } })
      : await sb.auth.resetPasswordForEmail(e.data, { redirectTo: `${callback}?next=/auth/update-password` });
    // "Signups not allowed" means there's no account with that email; don't reveal that for resets.
    if (error && !(input.purpose === "reset" && /signup|not found|not allowed/i.test(error.message))) {
      return { ok: false, error: friendlyAuthError(error.message) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err instanceof Error ? err.message : "") };
  }
}

export async function verifyEmailCode(input: { email: string; code: string; purpose: "signin" | "reset"; next?: string }): Promise<AuthResult> {
  const e = email.safeParse(input.email);
  if (!e.success) return { ok: false, error: "Enter a valid email address." };
  const code = input.code.replace(/\D/g, "");
  if (code.length < 6) return { ok: false, error: "Enter the code from the email (6 or more digits)." };
  try {
    const sb = await supabaseServer();
    const { error } = await sb.auth.verifyOtp({ email: e.data, token: code, type: input.purpose === "reset" ? "recovery" : "email" });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    await claimTeams();
    const next = input.next && input.next.startsWith("/") && !input.next.startsWith("//") ? input.next : "/";
    return { ok: true, next: input.purpose === "reset" ? "/auth/update-password" : next };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err instanceof Error ? err.message : "") };
  }
}

export async function updateMyPassword(password: string): Promise<AuthResult> {
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters." };
  if (password.length > 72) return { ok: false, error: "Use at most 72 characters." };
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (!data.user) return { ok: false, error: "Your sign-in has expired. Sign in again (or use a new email code), then set your password." };
    const { error } = await sb.auth.updateUser({ password });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true, message: "Password saved." };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err instanceof Error ? err.message : "") };
  }
}

/**
 * Commissioner rescue: sets a temporary password for a manager in this league (to text them), for
 * when emails aren't arriving. They can change it under Account → Change password.
 */
export async function adminSetPassword(userId: string, password: string): Promise<AuthResult> {
  try {
    const ctx = await requireAdmin();
    const id = z.string().uuid().parse(userId);
    if (password.length < 8 || password.length > 72) return { ok: false, error: "Use 8 to 72 characters." };
    const sb = await supabaseServer();
    const { data: member } = await sb.from("league_members").select("user_id").eq("league_id", ctx.league.id).eq("user_id", id).maybeSingle();
    if (!member) return { ok: false, error: "That person isn't in this league." };
    const { error } = await supabaseServiceRole().auth.admin.updateUserById(id, { password });
    if (error) {
      if (/not allowed|not_admin/i.test(error.message)) return { ok: false, error: "The site's Supabase service key isn't accepted, so it can't change passwords. Check SUPABASE_SERVICE_ROLE_KEY in Vercel." };
      return { ok: false, error: error.message };
    }
    return { ok: true, message: "Password set. Text it to them; they can change it under Account." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
