import { redirect } from "next/navigation";
import { getContext } from "@/lib/data/context";
import { claimTeams, signOut } from "@/app/actions";

export const metadata = { title: "Welcome" };

/** Shown to signed-in users who have not yet been linked to a team. */
export default async function WelcomePage() {
  const claimed = await claimTeams();
  const ctx = await getContext();
  if (claimed > 0 || ctx.league) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card !mx-0 max-w-md space-y-4 p-6 text-center">
        <h1 className="text-xl font-bold">You&apos;re signed in</h1>
        <p className="text-sm text-gray-500">
          Your account ({ctx.user.email}) isn&apos;t linked to a team yet. Ask the league administrator to assign your team to this email address, then reload this page.
        </p>
        <form action={signOut}>
          <button className="btn-secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
