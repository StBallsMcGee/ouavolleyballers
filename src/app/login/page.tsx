import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,#26305c_0%,#0b1020_60%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-coral-500 text-2xl font-black">S</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Sideout</h1>
          <p className="mt-1 text-sm text-slate-400">Private OUA women&apos;s volleyball fantasy league</p>
        </div>
        <LoginForm next={next} initialError={sp.error ? "That sign-in link has expired or was already used. Please try again." : null} />
        <p className="mt-6 text-center text-xs text-slate-500">Accounts are created by invitation from the league administrator.</p>
      </div>
    </main>
  );
}
