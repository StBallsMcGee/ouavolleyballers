import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// API routes listed here check their own secret (CRON_SECRET) instead of a login session.
const PUBLIC_PATHS = ["/login", "/auth", "/api/cron", "/api/admin/import", "/api/admin/profiles"];

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
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // A failed session check (network blip, expired token) is treated as "signed out", never a crash.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    signedIn = !!data.user;
  } catch {
    signedIn = false;
  }
  const path = request.nextUrl.pathname;
  if (!signedIn && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
