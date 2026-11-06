/**
 * Import the existing USportVB league into the new database.
 *
 *   npm run migrate:usportvb -- --league <ID> --live --exclude-team <ID> --cutover-week 4
 *   npm run migrate:usportvb -- --snapshot path/to/snapshot.json --players path/to/players.json ...
 *
 * DRY RUN BY DEFAULT: nothing is saved unless you add  --apply --yes.
 * Optional: --managers managers.csv   (columns: source_team_id,email,display_name)
 * Reports are written to ./reports (git-ignored, may contain member names).
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { closePool, withTransaction } from "../src/lib/db/pg";
import { reportToMarkdown, runLeagueImport, type LeagueImportReport, type ManagerInvite } from "../src/lib/migration/league";
import {
  fetchLeague, fetchLeagueTeams, fetchPlayers, leagueSchema, playersResponseSchema, teamsResponseSchema,
} from "../src/lib/sources/usportvb";

const { values } = parseArgs({
  options: {
    league: { type: "string" },
    live: { type: "boolean", default: false },
    snapshot: { type: "string" },
    players: { type: "string" },
    "exclude-team": { type: "string", multiple: true, default: [] },
    "cutover-week": { type: "string" },
    managers: { type: "string" },
    apply: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    out: { type: "string", default: "reports" },
  },
});

function parseManagers(file: string): ManagerInvite[] {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const [header, ...data] = rows;
  if (!header?.toLowerCase().startsWith("source_team_id")) throw new Error("Managers CSV must start with: source_team_id,email,display_name");
  return data.map((line) => {
    const [sourceTeamId, email, ...name] = line.split(",");
    if (!sourceTeamId || !email) throw new Error(`Bad managers row: ${line}`);
    return { sourceTeamId: sourceTeamId.trim(), email: email.trim(), displayName: name.join(",").trim() || null };
  }).filter((m) => m.email.includes("@"));
}

async function main() {
  const cutover = Number(values["cutover-week"]);
  if (!Number.isInteger(cutover) || cutover < 1) throw new Error("--cutover-week is required (first week the new app scores).");
  const mode = values.apply ? "apply" : "dry_run";
  if (mode === "apply" && !values.yes) throw new Error("Applying writes to the database. Re-run with --apply --yes after reviewing a dry run.");

  let league, teams;
  if (values.snapshot) {
    const snap = JSON.parse(fs.readFileSync(values.snapshot, "utf8"));
    league = leagueSchema.parse(snap.league);
    teams = teamsResponseSchema.parse(snap.teams);
  } else if (values.live && values.league) {
    league = await fetchLeague(values.league);
    await new Promise((r) => setTimeout(r, 1000)); // crawl-delay: 1 second between requests
    teams = await fetchLeagueTeams(values.league);
  } else {
    throw new Error("Use --snapshot <file> or --live --league <id>.");
  }
  let players;
  if (values.players) players = playersResponseSchema.parse(JSON.parse(fs.readFileSync(values.players, "utf8")));
  else {
    await new Promise((r) => setTimeout(r, 1000));
    players = await fetchPlayers("womens", "OUA");
  }

  let report: LeagueImportReport;
  try {
    report = await withTransaction(
      (db) => runLeagueImport(db, { league, teams, players, mode, createdBy: process.env.USER ?? "cli" }, {
        excludeTeamIds: values["exclude-team"] ?? [],
        cutoverWeek: cutover,
        managers: values.managers ? parseManagers(values.managers) : [],
      }),
      { commit: mode === "apply" },
    );
  } catch (e) {
    const r = (e as { report?: LeagueImportReport }).report;
    if (r) report = r;
    else throw e;
    console.error(String((e as Error).message));
  }

  fs.mkdirSync(values.out!, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(values.out!, `import-${mode}-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${base}.md`, reportToMarkdown(report));
  console.log(reportToMarkdown(report));
  console.log(`Report saved to ${base}.md`);
  const errors = report.issues.filter((i) => i.level === "error").length;
  process.exitCode = errors ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => closePool());
