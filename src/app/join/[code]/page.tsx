import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JoinPickTeam, JoinSignup } from "./join-forms";

export const metadata = { title: "Join the league" };
export const dynamic = "force-dynamic";

/**
 * The page behind the league's shareable invite link: create an account (or sign in), then
 * pick which team is yours from the ones nobody has claimed yet.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const sb = await supabaseServer();
  const [{ data: info }, { data: auth }] = await Promise.all([sb.rpc("join_link_info", { p_code: code }), sb.auth.getUser()]);
  const league = Array.isArray(info) ? (info[0] as { league_name: string; open_teams: number } | undefined) : undefined;

  let body: React.ReactNode;
  if (!league) {
    body = (
      <>
        <h1 className="text-xl font-extrabold">This invite link has expired</h1>
        <p className="text-sm text-gray-600">Ask the league admin to text you the current link.</p>
        <Link href="/login" className="btn-secondary w-full">Sign in instead</Link>
      </>
    );
  } else if (!auth.user) {
    body = (
      <>
        <Header league={league.league_name} />
        <JoinSignup code={code} />
      </>
    );
  } else {
    const [{ data: owned }, { data: teams, error }, { data: profile }] = await Promise.all([
      sb.from("fantasy_teams").select("name").eq("owner_user_id", auth.user.id).limit(1),
      sb.rpc("join_link_teams", { p_code: code }),
      sb.from("profiles").select("display_name").eq("id", auth.user.id).maybeSingle(),
    ]);
    if (owned && owned.length > 0) {
      body = (
        <>
          <Header league={league.league_name} />
          <p className="text-sm text-gray-600">You&apos;re already the manager of <b>{owned[0]!.name}</b>.</p>
          <a href="/team" className="btn-primary w-full">Go to my team</a>
        </>
      );
    } else if (error) {
      body = <p className="text-sm text-red-600">{error.message}</p>;
    } else {
      body = (
        <>
          <Header league={league.league_name} />
          <JoinPickTeam code={code} email={auth.user.email ?? ""} defaultName={profile?.display_name ?? ""} teams={(teams ?? []) as { id: string; name: string; manager_hint: string | null }[]} />
        </>
      );
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#ffe0d6_0%,#f2f4f7_55%)] px-4 py-10">
      <div className="mx-auto w-full max-w-sm animate-page-in">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-xl font-black text-white">S</div>
          <p className="text-sm font-bold text-gray-500">Sideout</p>
        </div>
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-surface p-5 shadow-sm">{body}</div>
      </div>
    </main>
  );
}

function Header({ league }: { league: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-brand-300">You&apos;re invited</p>
      <h1 className="text-xl font-extrabold leading-tight">Join {league}</h1>
    </div>
  );
}
