"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <h1 className="text-xl font-bold">Choose your password</h1>
        <p className="text-sm text-slate-400">You&apos;ll use this with your email to sign in from any device.</p>
        <div>
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </main>
  );
}
