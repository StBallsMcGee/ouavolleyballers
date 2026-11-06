"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
  useEffect(() => setOpen(false), [path]);
  const more = [...MORE, ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []), { href: "/account", label: "Account" }];
  const moreActive = more.some((m) => isActive(path, m.href)) && !TABS.some((t) => isActive(path, t.href));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-coral-500 text-sm font-black text-white">S</span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[15px] font-extrabold tracking-tight">Sideout</span>
              <span className="block truncate text-[11px] font-medium text-gray-500">{leagueName}</span>
            </span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {[...TABS, ...more].map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${isActive(path, l.href) ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto hidden text-xs text-gray-500 xl:block">{userName}</span>
        </div>
      </header>

      {/* Phone: bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-bold ${isActive(path, t.href) ? "text-coral-600" : "text-gray-500"}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={isActive(path, t.href) ? 2.4 : 1.8} strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.label}
            </Link>
          ))}
          <button onClick={() => setOpen(true)} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-bold ${moreActive ? "text-coral-600" : "text-gray-500"}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            More
          </button>
        </div>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/30" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-2xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300" />
            <p className="px-5 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-gray-500">{userName}</p>
            <ul className="divide-y divide-gray-100">
              {more.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} className={`flex items-center justify-between px-5 py-3.5 text-[15px] font-semibold ${isActive(path, m.href) ? "text-coral-600" : "text-gray-900"}`}>
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
