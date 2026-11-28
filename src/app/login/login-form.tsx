"use client";
import { useState } from "react";
import { sendEmailCode, signInPassword, verifyEmailCode } from "@/app/auth-actions";

type Mode = "password" | "code" | "reset";

/**
 * Sign in with a password, or with a code sent by email (works on any device or browser, unlike a
 * link). "Forgot your password?" sends a code too, then asks for a new password. Everything goes
 * through the app's server.
 */
export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);

  const switchTo = (m: Mode) => {
    setMode(m);
    setCodeSent(false);
    setCode("");
    setError(null);
    setInfo(null);
  };
  // A full page load, so the new sign-in cookie is used everywhere straight away.
  const go = (to: string) => window.location.assign(to);

  async function send() {
    const r = await sendEmailCode({ email, purpose: mode === "reset" ? "reset" : "signin", next });
    if (!r.ok) return setError(r.error);
    setCodeSent(true);
    setInfo(`We emailed a code to ${email.trim().toLowerCase()}. It can take a minute; check spam too. Type the code below (or tap the link in the email on this device).`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "password") {
        const r = await signInPassword({ email, password });
        if (!r.ok) return setError(r.error);
        go(next);
      } else if (!codeSent) {
        await send();
      } else {
        const r = await verifyEmailCode({ email, code, purpose: mode === "reset" ? "reset" : "signin", next });
        if (!r.ok) return setError(r.error);
        go(r.next ?? next);
      }
    } catch {
      setError("Couldn't reach the app. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card !mx-0 space-y-4 p-6">
      {mode !== "reset" ? (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-xs font-bold" role="tablist" aria-label="How to sign in">
          <button type="button" role="tab" aria-selected={mode === "password"} onClick={() => switchTo("password")} className={`rounded-lg py-2 transition ${mode === "password" ? "tile-gold text-charcoal shadow-md" : "text-gray-500"}`}>Password</button>
          <button type="button" role="tab" aria-selected={mode === "code"} onClick={() => switchTo("code")} className={`rounded-lg py-2 transition ${mode === "code" ? "tile-gold text-charcoal shadow-md" : "text-gray-500"}`}>Email me a code</button>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-bold">Reset your password</h2>
          <p className="text-sm text-gray-500">We&apos;ll email you a code, then you choose a new password.</p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email"
          className="input" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={codeSent} />
      </div>
      {mode === "password" ? (
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      ) : codeSent ? (
        <div>
          <label className="label" htmlFor="code">Code from the email</label>
          <input id="code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]*" maxLength={12} placeholder="123456"
            className="input text-center text-xl font-bold tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {info ? <p className="text-sm text-emerald-600" role="status">{info}</p> : null}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "password" ? "Sign in" : codeSent ? (mode === "reset" ? "Continue" : "Sign in") : "Email me a code"}
      </button>
      {codeSent ? (
        <div className="flex justify-between text-xs">
          <button type="button" className="text-gray-500 hover:text-gray-900" disabled={busy} onClick={() => { setBusy(true); setError(null); send().finally(() => setBusy(false)); }}>Send a new code</button>
          <button type="button" className="text-gray-500 hover:text-gray-900" onClick={() => { setCodeSent(false); setCode(""); setInfo(null); }}>Use a different email</button>
        </div>
      ) : null}
      <button type="button" onClick={() => switchTo(mode === "reset" ? "password" : "reset")} className="block w-full text-center text-xs text-gray-500 hover:text-gray-900">
        {mode === "reset" ? "Back to sign in" : "Forgot your password?"}
      </button>
    </form>
  );
}
