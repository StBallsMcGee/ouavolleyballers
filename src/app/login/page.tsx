import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,#2a2f55_0%,#131419_60%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 rotate-45 place-items-center rounded-2xl bg-gradient-to-br from-gold-300 to-orange-400 shadow-lg shadow-orange-500/30"><span className="-rotate-45 text-2xl font-black text-charcoal">S</span></div>
          <h1 className="text-3xl font-extrabold tracking-tight">Sideout</h1>
          <p className="mt-1 text-sm text-gray-500">Private OUA women&apos;s volleyball fantasy league</p>
        </div>
        <LoginForm next={next} initialError={sp.error ? "That sign-in link has expired or was already used. Please try again." : null} />
        <p className="mt-6 text-center text-xs text-gray-500">Accounts are created by invitation from the league administrator.</p>
      </div>
    </main>
  );
}
