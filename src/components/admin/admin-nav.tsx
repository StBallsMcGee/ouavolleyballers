import Link from "next/link";

const LINKS = [
  ["/admin", "Overview"],
  ["/admin/settings", "League settings"],
  ["/admin/scoring", "Scoring"],
  ["/admin/teams", "Teams & managers"],
  ["/admin/matchups", "Matchups & playoffs"],
  ["/admin/matches", "Matches & locks"],
  ["/admin/import", "Import"],
  ["/admin/audit", "Audit log"],
] as const;

export function AdminNav({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto pb-1">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${current === href ? "bg-coral-500 text-white" : "bg-court-800 text-slate-300 hover:bg-court-700"}`}>{label}</Link>
      ))}
    </nav>
  );
}
