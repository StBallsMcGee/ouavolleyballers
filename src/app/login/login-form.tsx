"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { claimTeams } from "@/app/actions";

type Mode = "password" | "link" | "reset";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const sb = supabaseBrowser();
    const callback = `${window.location.origin}/auth/callback`;
    try {
      if (mode === "password") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await claimTeams();
        router.replace(next);
        router.refresh();
      } else if (mode === "link") {
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${callback}?next=${encodeURIComponent(next)}` } });
        if (error) throw error;
        setInfo("Check your email for a sign-in link.");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${callback}?next=/auth/update-password` });
        if (error) throw error;
        setInfo("If that email has an account, a password reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card !mx-0 space-y-4 p-6">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-50 p-1 text-xs font-semibold">
        <button type="button" onClick={() => setMode("password")} className={`rounded-lg py-2 ${mode === "password" ? "bg-gray-200" : "text-gray-500"}`}>Password</button>
        <button type="button" onClick={() => setMode("link")} className={`rounded-lg py-2 ${mode === "link" ? "bg-gray-200" : "text-gray-500"}`}>Email me a link</button>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode === "password" ? (
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {info ? <p className="text-sm text-emerald-600">{info}</p> : null}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "password" ? "Sign in" : mode === "link" ? "Send sign-in link" : "Send reset link"}
      </button>
      <button type="button" onClick={() => setMode(mode === "reset" ? "password" : "reset")} className="block w-full text-center text-xs text-gray-500 hover:text-gray-900">
        {mode === "reset" ? "Back to sign in" : "Forgot your password?"}
      </button>
    </form>
  );
}
