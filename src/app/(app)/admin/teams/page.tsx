import { requireAdmin } from "@/lib/data/context";
import { fetchAll, getOwnership } from "@/lib/data/queries";
import { AdminNav } from "@/components/admin/admin-nav";
import { InviteForm, RosterCorrection, TeamOwnerButtons } from "@/components/admin/team-admin";
import { Badge, Card, PageHeader, TeamLink } from "@/components/ui";

export const metadata = { title: "Teams & managers" };

export default async function AdminTeamsPage() {
  const ctx = await requireAdmin();
  const { supabase: sb, league, teams } = ctx;
  const [{ data: invites }, { data: members }, owner, players] = await Promise.all([
    sb.from("team_invitations").select("fantasy_team_id, email, display_name, claimed_at"),
    sb.from("league_members").select("user_id, role").eq("league_id", league.id),
    getOwnership(sb, league.id),
    fetchAll<{ id: string; display_name: string }>((from, to) => sb.from("players").select("id, display_name").eq("active", true).eq("conference", "OUA").eq("gender", "womens").is("duplicate_of", null).order("display_name").range(from, to) as never),
  ]);
  const inv = new Map((invites ?? []).map((i) => [i.fantasy_team_id, i]));
  const role = new Map((members ?? []).map((m) => [m.user_id, m.role]));
  return (
    <>
      <PageHeader title="Teams & managers" subtitle="Invite each manager by email; their team links to them when they sign in." />
      <AdminNav current="/admin/teams" />
      <Card flush>
        <ul className="divide-y divide-gray-100">
          {teams.map((t) => {
            const i = inv.get(t.id);
            return (
              <li key={t.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate"><TeamLink id={t.id} name={t.name} /></div>
                    <div className="truncate text-xs text-gray-500">{t.manager}{t.owner_user_id && role.get(t.owner_user_id) === "admin" ? " · admin" : ""}</div>
                  </div>
                  <div className="shrink-0">{t.owner_user_id ? <Badge tone="mint">Claimed</Badge> : i ? <Badge tone="amber">Invited</Badge> : <Badge>Not invited</Badge>}</div>
                </div>
                <details className="group">
                  <summary className="cursor-pointer list-none text-xs font-bold text-coral-600">{t.owner_user_id ? "Manage" : i ? `Invited: ${i.email} · change` : "Invite manager"} <span className="inline-block transition group-open:rotate-90">›</span></summary>
                  <div className="mt-2 space-y-2">
                    {t.owner_user_id ? <TeamOwnerButtons teamId={t.id} ownerId={t.owner_user_id} isAdmin={role.get(t.owner_user_id) === "admin"} /> : null}
                    <InviteForm teamId={t.id} email={i?.email ?? ""} name={i?.display_name ?? t.manager_display_name ?? ""} claimed={!!t.owner_user_id} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Roster correction" className="mt-3">
        <p className="mb-3 text-sm text-gray-500">For fixing mistakes only. Recorded in the audit log.</p>
        <RosterCorrection players={players.map((p) => ({ id: p.id, name: p.display_name, team: owner.get(p.id) ?? null }))} teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </Card>
    </>
  );
}
