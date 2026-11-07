import { requireAdmin } from "@/lib/data/context";
import { fetchAll, getOwnership } from "@/lib/data/queries";
import { AdminNav } from "@/components/admin/admin-nav";
import { headers } from "next/headers";
import { checkServiceKey } from "@/lib/supabase/server";
import { InviteForm, InviteLinkCard, RosterCorrection, TeamOwnerButtons } from "@/components/admin/team-admin";
import { Badge, Card, PageHeader, TeamLink } from "@/components/ui";

export const metadata = { title: "Teams & managers" };

export default async function AdminTeamsPage() {
  const ctx = await requireAdmin();
  const { supabase: sb, league, teams } = ctx;
  const [{ data: invites }, { data: members }, owner, players, joinCode, h, keyCheck] = await Promise.all([
    sb.from("team_invitations").select("fantasy_team_id, email, display_name, claimed_at"),
    sb.from("league_members").select("user_id, role").eq("league_id", league.id),
    getOwnership(sb, league.id),
    fetchAll<{ id: string; display_name: string }>((from, to) => sb.from("players").select("id, display_name").eq("active", true).eq("conference", "OUA").eq("gender", "womens").is("duplicate_of", null).order("display_name").range(from, to) as never),
    sb.rpc("admin_join_code", { p_league: league.id, p_reset: false }),
    headers(),
    checkServiceKey(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  // The address the admin is using right now, so the link always points at this site.
  const origin = host ? `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}` : process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const joinError = joinCode.error ? (/function|does not exist|schema cache/i.test(joinCode.error.message) ? "Invite links need one more database step: run the file supabase/migrations/20261107000200_join_links.sql in the Supabase SQL editor." : joinCode.error.message) : null;
  const inv = new Map((invites ?? []).map((i) => [i.fantasy_team_id, i]));
  const role = new Map((members ?? []).map((m) => [m.user_id, m.role]));
  return (
    <>
      <PageHeader title="Teams & managers" subtitle="Text everyone the invite link, or invite managers one by one by email." />
      <AdminNav current="/admin/teams" />
      <Card title="Invite link" className="mb-3">
        <InviteLinkCard origin={origin} initialCode={(joinCode.data as string | null) ?? null} error={joinError} />
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${keyCheck.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {keyCheck.ok ? "✓ " : "✗ "}Setup check: {keyCheck.detail}
        </p>
      </Card>
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
