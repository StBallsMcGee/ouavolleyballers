/**
 * Runs the USportVB league import from inside the deployed website (Vercel), using the
 * database connection stored there. Used by the protected /api/admin/import endpoint and by
 * the Admin → Import page. Dry run unless mode is "apply".
 */
import { withTransaction } from "@/lib/db/pg";
import { fetchLeague, fetchLeagueTeams, fetchPlayers } from "@/lib/sources/usportvb";
import { reportToMarkdown, runLeagueImport, type LeagueImportReport } from "./league";

export interface ImportRequest {
  mode: "dry_run" | "apply";
  leagueId?: string;
  excludeTeamIds?: string[];
  cutoverWeek?: number;
  refresh?: boolean;
  createdBy: string;
}

export interface ImportResponse {
  ok: boolean;
  error?: string;
  report?: LeagueImportReport;
  markdown?: string;
  adminsLinked?: number;
  commissionerTeamLinked?: boolean;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function importFromUsportvb(req: ImportRequest): Promise<ImportResponse> {
  // Reuse the options of the last successful import when not given (used for refreshes).
  let { leagueId, excludeTeamIds, cutoverWeek } = req;
  if (!leagueId || !cutoverWeek) {
    const last = await withTransaction(async (db) =>
      (await db.query<{ report: LeagueImportReport }>(
        `select report from public.import_runs where mode = 'apply' and status = 'succeeded' and source = 'usportvb-league'
         order by started_at desc limit 1`)).rows[0]?.report, { commit: false });
    if (!last) return { ok: false, error: "No previous import found. Provide league, exclude and cutover for the first import." };
    leagueId ??= last.source.leagueId;
    excludeTeamIds ??= last.options?.excludeTeamIds ?? [];
    cutoverWeek ??= last.options?.cutoverWeek;
  }
  if (!leagueId || !cutoverWeek) return { ok: false, error: "League id and cut-over week are required." };

  // Polite fetching: one request per second, as the source's robots.txt asks.
  const league = await fetchLeague(leagueId);
  await pause(1000);
  const teams = await fetchLeagueTeams(leagueId);
  await pause(1000);
  const players = await fetchPlayers("womens", "OUA");

  try {
    return await withTransaction(
      async (db) => {
        const report = await runLeagueImport(db, { league, teams, players, mode: req.mode, createdBy: req.createdBy }, {
          excludeTeamIds: excludeTeamIds ?? [],
          cutoverWeek: cutoverWeek!,
          refresh: req.refresh,
        });
        let adminsLinked = 0;
        let commissionerTeamLinked = false;
        if (req.mode === "apply") {
          // Site administrators become league admins.
          const a = await db.query(
            `insert into public.league_members (league_id, user_id, role)
             select l.id, p.id, 'admin' from public.leagues l cross join public.profiles p
             where p.is_site_admin and l.source_system = 'usportvb' and l.source_id = $1
             on conflict (league_id, user_id) do update set role = 'admin'`, [leagueId]);
          adminsLinked = a.rowCount ?? 0;
          // If there is exactly one site administrator, they are the commissioner who set this up:
          // link the commissioner's team to them (only if nobody owns it yet).
          const c = await db.query(
            `with admin as (select id from public.profiles where is_site_admin),
                  lg as (select id from public.leagues where source_system = 'usportvb' and source_id = $1)
             update public.fantasy_teams t set owner_user_id = (select id from admin)
             where t.league_id = (select id from lg) and t.source_owner_id = $2 and t.owner_user_id is null
               and (select count(*) from admin) = 1
               and not exists (select 1 from public.fantasy_teams o where o.league_id = t.league_id and o.owner_user_id = (select id from admin))`,
            [leagueId, league.commissionerId]);
          commissionerTeamLinked = (c.rowCount ?? 0) > 0;
        }
        return { ok: !report.issues.some((i) => i.level === "error"), report, markdown: reportToMarkdown(report), adminsLinked, commissionerTeamLinked };
      },
      { commit: req.mode === "apply" },
    );
  } catch (e) {
    const report = (e as { report?: LeagueImportReport }).report;
    return { ok: false, error: (e as Error).message, report, markdown: report ? reportToMarkdown(report) : undefined };
  }
}
