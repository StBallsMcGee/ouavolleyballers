/**
 * Collects player photos/bios from the official SIDEARM roster pages and sends them to the site.
 *
 *   npx tsx scripts/collect-roster-profiles.ts --out profiles.json            # fetch + save only
 *   npx tsx scripts/collect-roster-profiles.ts --from-dir saved/ --post https://ouavolleyballers.vercel.app
 *
 * Polite: one roster page per school (each school is a different server), 5 s apart, so every
 * site's 30-second crawl delay is respected. Images are never downloaded.
 * --post needs CRON_SECRET in the environment (sent as "Authorization: Bearer ...").
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { parseSidearmRoster, SIDEARM_SCHOOLS } from "../src/lib/sources/sidearm";

const { values } = parseArgs({ options: { out: { type: "string" }, "from-dir": { type: "string" }, post: { type: "string" } } });
const UA = process.env.SOURCE_USER_AGENT ?? "SideoutFantasy/1.0 (private OUA fantasy league; roster photos and bios)";

async function main() {
  const schools = [];
  for (const [i, s] of SIDEARM_SCHOOLS.entries()) {
    let html: string;
    if (values["from-dir"]) html = fs.readFileSync(`${values["from-dir"]}/${s.key}.html`, "utf8");
    else {
      if (i > 0) await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(s.rosterUrl, { headers: { "User-Agent": UA } });
      if (!res.ok) { console.error(`${s.key}: HTTP ${res.status}, skipped`); continue; }
      html = await res.text();
    }
    const profiles = parseSidearmRoster(html, s.rosterUrl);
    console.log(`${s.label}: ${profiles.length} players, ${profiles.filter((p) => p.photoUrl).length} photos`);
    schools.push({ key: s.key, label: s.label, universitySourceId: s.universitySourceId, site: new URL(s.rosterUrl).hostname, profiles });
  }
  if (values.out) fs.writeFileSync(values.out, JSON.stringify({ schools }, null, 1));
  if (values.post) {
    const res = await fetch(`${values.post.replace(/\/$/, "")}/api/admin/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      body: JSON.stringify({ schools }),
    });
    console.log(res.status, JSON.stringify(await res.json(), null, 1));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
