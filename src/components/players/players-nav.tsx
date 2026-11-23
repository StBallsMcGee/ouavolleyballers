import Link from "next/link";

const ICONS = {
  leaders: "M5 20V10h3v10H5zm5.5 0V4h3v16h-3zM16 20v-7h3v7h-3z",
  search: "M10 4a6 6 0 104.47 10l5.27 5.27 1.41-1.41-5.27-5.27A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z",
  available: "M12 4a4 4 0 110 8 4 4 0 010-8zM4 20a8 8 0 0116 0H4zM19 3v2h2v2h-2v2h-2V7h-2V5h2V3h2z",
  trades: "M7 7h11l-3-3 1.4-1.4L21.8 8l-5.4 5.4L15 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2.2 16l5.4-5.4L9 12l-3 3h11v2z",
};

/** The row of pastel squares at the top of the Players tab; each switches what is shown underneath. */
export function PlayersNav({ active }: { active: "leaders" | "search" | "available" | "trades" }) {
  const tile = (key: keyof typeof ICONS, label: string, href: string, color: string, on: boolean) => (
    <Link
      href={href}
      scroll={false}
      className={`${color} flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl text-[12px] font-extrabold text-charcoal shadow-lg shadow-black/30 transition duration-200 active:scale-95 ${on ? "scale-[1.04] ring-[3px] ring-white/80" : "opacity-90 hover:opacity-100"}`}
      aria-current={on ? "page" : undefined}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${on ? "bg-charcoal text-gold-300" : "bg-white/35"}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d={ICONS[key]} /></svg>
      </span>
      {label}
    </Link>
  );
  return (
    <nav className="mx-3 mb-3 grid grid-cols-4 gap-2.5 sm:mx-0" aria-label="Players">
      {tile("leaders", "Leaders", "/players", "tile-gold", active === "leaders")}
      {tile("search", "Search", "/players?view=search", "tile-violet", active === "search")}
      {tile("available", "Available", "/players?view=available", "tile-green", active === "available")}
      {tile("trades", "Trades", "/players?view=trades", "tile-orange", active === "trades")}
    </nav>
  );
}
