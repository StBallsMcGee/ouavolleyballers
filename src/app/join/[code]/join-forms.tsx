"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinClaimTeam, joinCreateAccount, signOut } from "@/app/actions";

/** Step 1: make an account with just a name, email and password (no email to confirm). */
export function JoinSignup({ code }: { code: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await joinCreateAccount({ code, name, email, password });
          if (!r.ok) return setError(r.error);
          router.refresh(); // now signed in: the page shows the team list
        });
      }}
    >
      <p className="text-sm text-gray-600">Create your account, then pick your team.</p>
      <div>
        <label className="label" htmlFor="j-name">Your name</label>
        <input id="j-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="j-email">Email</label>
        <input id="j-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="j-pw">Choose a password</label>
        <div className="flex gap-2">
          <input id="j-pw" className="input min-w-0 flex-1" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" className="btn-ghost shrink-0 px-3 text-xs" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
        </div>
        <p className="mt-1 text-xs text-gray-500">At least 8 characters. You&apos;ll use your email and this password to sign in.</p>
      </div>
      {error ? <p className="animate-fade-in text-sm text-red-600" role="alert">{error}</p> : null}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creating account…" : "Continue"}</button>
      <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className="block text-center text-sm font-semibold text-coral-600">I already have an account</Link>
    </form>
  );
}

/** Step 2: pick your team from the ones nobody has claimed yet. */
export function JoinPickTeam({ code, email, defaultName, teams }: { code: string; email: string; defaultName: string; teams: { id: string; name: string; manager_hint: string | null }[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const team = teams.find((t) => t.id === picked);
  if (teams.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Every team already has a manager. If one of them should be yours, ask the league admin.</p>
        <form action={signOut}><button className="btn-secondary w-full">Sign out</button></form>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Signed in as <b>{email}</b>. Which team is yours?</p>
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" role="radiogroup">
        {teams.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              role="radio"
              aria-checked={picked === t.id}
              onClick={() => { setPicked(t.id); setError(null); }}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200 ${picked === t.id ? "border-coral-500 bg-coral-50 shadow-sm" : "border-gray-200 bg-white active:bg-gray-50"}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition ${picked === t.id ? "border-coral-500" : "border-gray-300"}`}>
                <span className={`h-2.5 w-2.5 rounded-full bg-coral-500 transition-transform duration-200 ${picked === t.id ? "scale-100" : "scale-0"}`} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold">{t.name}</span>
                {t.manager_hint ? <span className="block truncate text-xs text-gray-500">Manager on USportVB: {t.manager_hint}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <label className="label" htmlFor="j-name2">Your name (shown to the league)</label>
        <input id="j-name2" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error ? <p className="animate-fade-in text-sm text-red-600" role="alert">{error}</p> : null}
      <button
        className="btn-primary w-full"
        disabled={!team || pending}
        onClick={() => {
          if (!team || !confirm(`Claim ${team.name} as your team? Only the league admin can change this afterwards.`)) return;
          start(async () => {
            const r = await joinClaimTeam(code, team.id, name.trim());
            if (!r.ok) return setError(r.error);
            window.location.assign("/team");
          });
        }}
      >
        {pending ? "Joining…" : team ? `This is my team: ${team.name}` : "Pick your team"}
      </button>
    </div>
  );
}
