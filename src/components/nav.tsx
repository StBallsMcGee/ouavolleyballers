"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VolleyballLogo } from "@/components/logo";

const TABS = [
  { href: "/", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/team", label: "My Team", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" },
  { href: "/matchup", label: "Matchup", icon: "M4 6h7v12H4zM13 6h7v12h-7z" },
  { href: "/players", label: "Players", icon: "M10 4a6 6 0 104.47 10l5.27 5.27 1.41-1.41-5.27-5.27A6 6 0 0010 4z" },
] as const;

const MORE = [
  { href: "/standings", label: "Standings" },
  { href: "/matchups", label: "All matchups" },
  { href: "/matches", label: "Match centre" },
  { href: "/free-agents", label: "Free agents" },
  { href: "/trades", label: "Trades" },
  { href: "/activity", label: "League activity" },
  { href: "/scoring", label: "Scoring rules" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/matchup") return path.startsWith("/matchup");
  return path === href || path.startsWith(`${href}/`);
}

export function Nav({ leagueName, isAdmin, userName }: { leagueName: string; isAdmin: boolean; userName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // The tab lights up the moment it's tapped, before the new page has finished loading.
  const [tapped, setTapped] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setOpen(false);
    setClosing(false);
    setTapped(null);
  }, [path]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = () => {
    setClosing(true);
    timer.current = setTimeout(() => { setOpen(false); setClosing(false); }, 190);
  };
  const shown = tapped ?? path;
  const activeTab = TABS.findIndex((t) => isActive(shown, t.href));
  const more = [...MORE, ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []), { href: "/account", label: "Account" }];
  const moreActive = open || (more.some((m) => isActive(shown, m.href)) && activeTab < 0);

  return (
    <>
      <header className="sticky top-0 z-30 bg-charcoal/85 text-white backdrop-blur-md">
        <div className="mx-auto grid h-14 max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
          <span aria-hidden />
          <Link href="/" className="flex min-w-0 items-center justify-center gap-2.5">
            <VolleyballLogo size={34} className="shrink-0 drop-shadow-[0_2px_8px_rgba(249,194,46,0.35)]" />
            <span className="min-w-0 text-center leading-tight">
              <span className="block text-[17px] font-extrabold tracking-tight">Sideout</span>
              <span className="block max-w-[11rem] truncate text-[11px] font-medium text-gray-500">{leagueName}</span>
            </span>
          </Link>
          <span className="hidden justify-self-end truncate text-xs text-gray-500 xl:block">{userName}</span>
        </div>
        <nav className="mx-auto hidden max-w-5xl flex-wrap items-center justify-center gap-1 px-4 pb-2 lg:flex">
          {[...TABS, ...more].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setTapped(l.href)} className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors duration-200 ${isActive(shown, l.href) ? "bg-gold-400 text-charcoal" : "text-gray-600 hover:bg-white/5"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Phone: bottom tab bar, with Matchup as the raised gold button in the middle. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md lg:hidden" aria-label="Main">
        <div className="relative mx-auto grid max-w-lg grid-cols-5">
          {TABS.map((t, i) => {
            const on = isActive(shown, t.href);
            if (i === 2) {
              return (
                <Link key={t.href} href={t.href} onClick={() => setTapped(t.href)} className="relative flex flex-col items-center pb-1.5 pt-2 text-[10px] font-bold" aria-label={t.label}>
                  <span className={`-mt-7 grid h-14 w-14 rotate-45 place-items-center rounded-2xl bg-gradient-to-br from-gold-300 to-orange-400 shadow-lg transition-transform duration-200 ${on ? "scale-105 shadow-orange-500/40" : "shadow-black/40"}`}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-45 text-charcoal" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round"><path d={t.icon} /></svg>
                  </span>
                  <span className={`mt-2 transition-colors ${on ? "text-gold-300" : "text-gray-500"}`}>{t.label}</span>
                </Link>
              );
            }
            return (
              <Link key={t.href} href={t.href} onClick={() => setTapped(t.href)} className={`relative flex flex-col items-center gap-0.5 pb-1.5 pt-2.5 text-[10px] font-bold transition-colors duration-200 ${on ? "text-gold-300" : "text-gray-500"}`}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 transition-transform duration-200 ${on ? "scale-110 drop-shadow-[0_0_8px_rgba(249,194,46,0.45)]" : ""}`} fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.15 : 0} stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinejoin="round"><path d={t.icon} /></svg>
                {t.label}
              </Link>
            );
          })}
          <button onClick={() => (open ? close() : setOpen(true))} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2.5 text-[10px] font-bold transition-colors duration-200 ${moreActive ? "text-gold-300" : "text-gray-500"}`}>
            <svg viewBox="0 0 24 24" className={`h-6 w-6 transition-transform duration-200 ${open ? "rotate-90 scale-110" : ""}`} fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            More
          </button>
        </div>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className={`absolute inset-0 bg-black/30 ${closing ? "animate-fade-out" : "animate-fade-in"}`} aria-label="Close menu" onClick={close} />
          <div className={`absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-2xl ${closing ? "animate-slide-down" : "animate-slide-up"}`}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300" />
            <p className="px-5 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-gray-500">{userName}</p>
            <ul className="divide-y divide-gray-100">
              <li>
                <a href="https://oua.tv/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-5 py-3.5 text-[15px] font-semibold text-gray-900">
                  <span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500" />Watch live on OUA.TV</span><span className="text-gray-400">↗</span>
                </a>
              </li>
              {more.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} onClick={() => setTapped(m.href)} className={`flex items-center justify-between px-5 py-3.5 text-[15px] font-semibold active:bg-gray-50 ${isActive(shown, m.href) ? "text-brand-300" : "text-gray-900"}`}>
                    {m.label}<span className="text-gray-400">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
