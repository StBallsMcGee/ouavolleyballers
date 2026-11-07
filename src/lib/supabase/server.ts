import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

/** Supabase client acting as the signed-in user (all Row Level Security rules apply). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by middleware instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses all security rules, so it is ONLY used for sending invitation
 * emails (after the caller is verified as a league administrator) and for creating an account
 * from a valid league invite link (after the link's code is checked).
 */
export function supabaseServiceRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * For the admin page: is the service key set up correctly? Never reveals the key: only its
 * kind, the role inside it, and whether Supabase accepts it for creating accounts.
 */
export async function checkServiceKey(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return { ok: false, detail: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." };
  let kind = "an unrecognised key";
  if (key.startsWith("sb_publishable_")) kind = "the publishable (public) key";
  else if (key.startsWith("sb_secret_")) kind = "a secret key";
  else if (key.startsWith("eyJ")) {
    try {
      const role = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8")).role;
      kind = role === "service_role" ? "the service_role key" : role === "anon" ? "the anon (public) key" : `a key with role "${role}"`;
    } catch {
      kind = "a damaged key (part of it may be missing)";
    }
  }
  if (key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) kind = "the same key as NEXT_PUBLIC_SUPABASE_ANON_KEY (the public key)";
  const host = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host; } catch { return "?"; } })();
  try {
    const { error } = await supabaseServiceRole().auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!error) return { ok: true, detail: `Account creation works (using ${kind}, project ${host}).` };
    return { ok: false, detail: `Supabase refused ${kind} for project ${host}: "${error.message}".` };
  } catch (e) {
    return { ok: false, detail: `Couldn't check (${kind}): ${e instanceof Error ? e.message : String(e)}` };
  }
}
