"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const MAIN = [
  { href: "/", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/team", label: "My Team", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" },
  { href: "/matchups", label: "Matchups", icon: "M4 6h7v12H4zM13 6h7v12h-7z" },
  { href: "/players", label: "Players", icon: "M10 4a6 6 0 104.47 10l5.27 5.27 1.41-1.41-5.27-5.27A6 6 0 0010 4z" },
  { href: "/matches", label: "Matches", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18" },
] as const;

const MORE = [
  { href: "/standings", label: "Standings" },
  { href: "/free-agents", label: "Free agents" },
  { href: "/trades", label: "Trades" },
  { href: "/scoring", label: "Scoring" },
  { href: "/activity", label: "Activity" },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Nav({ leagueName, isAdmin, userName }: { leagueName: string; isAdmin: boolean; userName: string }) {
  const path = usePathname();
  const more = [...MORE, ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []), { href: "/account", label: "Account" }];
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/5 bg-court-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-coral-500 text-sm font-black text-white">S</span>
            <span className="leading-tight">
              <span className="block text-sm font-extrabold tracking-tight">Sideout</span>
              <span className="block max-w-[10rem] truncate text-[11px] text-slate-400">{leagueName}</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {[...MAIN, ...more].map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active(path, l.href) ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <details className="relative ml-auto lg:hidden">
            <summary className="btn-ghost cursor-pointer list-none px-3 py-1.5">More ▾</summary>
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-white/10 bg-court-900 p-1 shadow-xl">
              {more.map((l) => (
                <Link key={l.href} href={l.href} className={`block rounded-lg px-3 py-2 text-sm ${active(path, l.href) ? "bg-white/10" : "hover:bg-white/5"}`}>
                  {l.label}
                </Link>
              ))}
            </div>
          </details>
          <span className="hidden text-xs text-slate-500 lg:ml-auto lg:block">{userName}</span>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-court-950/95 backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MAIN.map((l) => (
            <Link key={l.href} href={l.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${active(path, l.href) ? "text-coral-400" : "text-slate-400"}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={l.icon} /></svg>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
