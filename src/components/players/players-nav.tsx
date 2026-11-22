import Link from "next/link";

const ICONS = {
  leaders: "M5 20V10h3v10H5zm5.5 0V4h3v16h-3zM16 20v-7h3v7h-3z",
  search: "M10 4a6 6 0 104.47 10l5.27 5.27 1.41-1.41-5.27-5.27A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z",
  available: "M12 4a4 4 0 110 8 4 4 0 010-8zM4 20a8 8 0 0116 0H4zM19 3v2h2v2h-2v2h-2V7h-2V5h2V3h2z",
  trades: "M7 7h11l-3-3 1.4-1.4L21.8 8l-5.4 5.4L15 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2.2 16l5.4-5.4L9 12l-3 3h11v2z",
};

/** The row of tiles at the top of the Players tab. */
export function PlayersNav({ active }: { active: "leaders" | "search" }) {
  const tile = (key: keyof typeof ICONS, label: string, href: string, on: boolean) => (
    <Link
      href={href}
      scroll={false}
      className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold transition active:scale-95 ${on ? "text-gold-300" : "text-gray-500 hover:text-gray-800"}`}
      aria-current={on ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d={ICONS[key]} /></svg>
      {label}
    </Link>
  );
  return (
    <nav className="mx-3 mb-3 grid grid-cols-4 rounded-2xl bg-surface px-1 shadow-lg shadow-black/20 sm:mx-0" aria-label="Players">
      {tile("leaders", "Leaders", "/players", active === "leaders")}
      {tile("search", "Search", "/players?view=search", active === "search")}
      {tile("available", "Available", "/free-agents", false)}
      {tile("trades", "Trades", "/trades", false)}
    </nav>
  );
}
