"use client";
import { useState } from "react";
import { updateMyPassword } from "@/app/auth-actions";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    setBusy(true);
    const r = await updateMyPassword(password).catch(() => ({ ok: false as const, error: "Couldn't reach the app. Check your connection and try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign("/");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card !mx-0 w-full max-w-sm space-y-4 p-6">
        <h1 className="text-xl font-bold">Choose your password</h1>
        <p className="text-sm text-gray-500">You&apos;ll use this with your email to sign in from any device.</p>
        <div>
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </main>
  );
}
