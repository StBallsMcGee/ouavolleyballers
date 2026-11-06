/**
 * Makes a signed-up user the administrator of the imported league(s).
 *   npx tsx scripts/grant-admin.ts --email you@example.com [--team <source team id>]
 * --team also assigns that fantasy team to the same person (e.g. the commissioner's own team).
 */
import { parseArgs } from "node:util";
import { closePool, withTransaction } from "../src/lib/db/pg";

const { values } = parseArgs({ options: { email: { type: "string" }, team: { type: "string" } } });

async function main() {
  if (!values.email) throw new Error("--email is required");
  await withTransaction(async (db) => {
    const u = await db.query<{ id: string }>(`select id from auth.users where lower(email) = lower($1)`, [values.email]);
    const userId = u.rows[0]?.id;
    if (!userId) throw new Error("No account with that email yet. Sign up / accept an invite first.");
    await db.query(`insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing`, [userId, values.email]);
    await db.query(`update public.profiles set is_site_admin = true where id = $1`, [userId]);
    const leagues = await db.query<{ id: string; name: string }>(`select id, name from public.leagues`);
    for (const l of leagues.rows) {
      await db.query(
        `insert into public.league_members (league_id, user_id, role) values ($1, $2, 'admin')
         on conflict (league_id, user_id) do update set role = 'admin'`, [l.id, userId]);
      await db.query(`insert into public.audit_log (league_id, action, entity, entity_id, after)
                      values ($1, 'member.role', 'user', $2, '{"role":"admin","via":"grant-admin script"}')`, [l.id, userId]);
      console.log(`Admin of "${l.name}"`);
    }
    if (values.team) {
      const t = await db.query(`update public.fantasy_teams set owner_user_id = $1 where source_id = $2 and owner_user_id is null returning name`,
        [userId, values.team]);
      console.log(t.rowCount ? `Assigned team "${t.rows[0].name}"` : "Team not found or already owned; not changed.");
    }
  }, { commit: true });
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => closePool());
