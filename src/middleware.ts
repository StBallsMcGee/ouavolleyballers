import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookies";

// API routes listed here check their own secret (CRON_SECRET) instead of a login session.
const PUBLIC_PATHS = ["/login", "/auth", "/join", "/api/cron", "/api/admin/import", "/api/admin/profiles", "/api/admin/status", "/api/admin/probe"];

/**
 * Carries the user this middleware just verified to the page, so the page doesn't ask the login
 * service a second time (one less network round trip on every screen). Any value a browser sends
 * itself is always removed first.
 */
export const VERIFIED_USER_HEADER = "x-sideout-verified-user";

/** Refreshes the login session on every request and keeps signed-out visitors on /login. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Typically a Vercel *preview* deployment whose environment variables were only set for
    // Production. Explain instead of crashing with MIDDLEWARE_INVOCATION_FAILED.
    return new NextResponse(
      "Sideout is not configured for this deployment: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. " +
        "In Vercel, add them for this environment (Settings → Environment Variables), or use the production address.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Stay signed in through network hiccups: only a definite "this session is invalid" answer
  // from the login service signs someone out. If the check merely fails (slow phone network,
  // service briefly unreachable) and a login cookie exists, the visitor is let through.
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  let signedIn = false;
  let verified: { id: string; email: string | null } | null = null;
  try {
    // getClaims checks the sign-in token's signature locally when the project uses signing
    // keys (no network call), and only asks the login service when it has to.
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    signedIn = !!claims?.sub;
    if (claims?.sub) verified = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
    if (!signedIn && hasAuthCookie && error && !isDefinitelySignedOut(error)) signedIn = true;
  } catch {
    signedIn = hasAuthCookie;
  }
  const path = request.nextUrl.pathname;
  // Already signed in? Skip the sign-in page.
  if (signedIn && path === "/login") {
    const home = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    home.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  if (!signedIn && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }
  const headers = new Headers(request.headers);
  headers.delete(VERIFIED_USER_HEADER);
  if (verified) headers.set(VERIFIED_USER_HEADER, encodeURIComponent(JSON.stringify(verified)));
  const out = NextResponse.next({ request: { headers } });
  for (const c of response.cookies.getAll()) out.cookies.set(c);
  return out;
}

function isDefinitelySignedOut(error: { name?: string; status?: number }): boolean {
  return error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403 || error.status === 400;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
