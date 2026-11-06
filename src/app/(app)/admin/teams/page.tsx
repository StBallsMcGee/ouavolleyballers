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
      <PageHeader title="Teams & managers" subtitle="Invite each manager by email. When they accept and sign in, their team is linked to their account automatically." />
      <AdminNav current="/admin/teams" />
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="table">
            <thead><tr><th>Team</th><th>Manager</th><th>Status</th><th>Invitation</th></tr></thead>
            <tbody>
              {teams.map((t) => {
                const i = inv.get(t.id);
                return (
                  <tr key={t.id} className="align-top">
                    <td><TeamLink id={t.id} name={t.name} /></td>
                    <td>{t.manager}{t.owner_user_id && role.get(t.owner_user_id) === "admin" ? <span className="ml-2"><Badge tone="coral">Admin</Badge></span> : null}</td>
                    <td>{t.owner_user_id ? <div className="space-y-1"><Badge tone="mint">Claimed</Badge><TeamOwnerButtons teamId={t.id} ownerId={t.owner_user_id} isAdmin={role.get(t.owner_user_id) === "admin"} /></div> : i ? <Badge tone="amber">Invited</Badge> : <Badge>Not invited</Badge>}</td>
                    <td><InviteForm teamId={t.id} email={i?.email ?? ""} name={i?.display_name ?? t.manager_display_name ?? ""} claimed={!!t.owner_user_id} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Roster correction" className="mt-4">
        <p className="mb-3 text-sm text-gray-500">For fixing mistakes only. Normal moves should go through free agency or trades. Corrections are recorded in the audit log and the league activity feed.</p>
        <RosterCorrection players={players.map((p) => ({ id: p.id, name: p.display_name, team: owner.get(p.id) ?? null }))} teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </Card>
    </>
  );
}
