"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Finishes sign-in for links that carry the login in the part of the address after "#"
 * (Supabase invitation emails sent by the Admin page work this way). That part never reaches
 * the server, so the browser reads it here, signs in, links the invited team, and moves on.
 */
export default function FinishSignIn() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const nextParam = query.get("next") ?? "/";
    const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    const type = hash.get("type");
    if (!access || !refresh) {
      const why = hash.get("error_description") ?? query.get("error_description");
      setError(why ? why.replace(/\+/g, " ") : "This link is incomplete or has already been used.");
      return;
    }
    (async () => {
      const sb = supabaseBrowser();
      const { error: e } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
      if (e) return setError(e.message);
      await sb.rpc("claim_my_teams");
      // Full page load so the server sees the new sign-in cookie.
      window.location.replace(type === "invite" || type === "recovery" ? "/auth/update-password" : next);
    })();
  }, []);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card !mx-0 w-full max-w-sm space-y-3 p-6 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-bold">That link didn&apos;t work</h1>
            <p className="text-sm text-gray-600">{error}</p>
            <p className="text-sm text-gray-600">Links expire after a while and only work once. Ask the league admin to send a new invitation, or use &quot;Forgot password&quot; on the sign-in page.</p>
            <a href="/login" className="btn-primary w-full">Go to sign in</a>
          </>
        ) : (
          <p className="text-sm font-semibold text-gray-600">Signing you in…</p>
        )}
      </div>
    </main>
  );
}
