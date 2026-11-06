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
    <nav className="mb-3 flex flex-wrap gap-1.5 px-4 sm:px-0">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${current === href ? "bg-coral-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{label}</Link>
      ))}
    </nav>
  );
}
