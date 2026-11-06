/**
 * Saves player profiles collected from official school roster pages.
 * Matching: same university + same name (accents/spacing ignored), then jersey + last name.
 * Unmatched entries are reported, never guessed. Existing profiles are updated, never deleted.
 */
import type { Db } from "@/lib/db/pg";
import { nameKey, type RosterProfile } from "@/lib/sources/sidearm";
import { SOURCE_SYSTEM } from "@/lib/sources/usportvb";

export interface SchoolProfiles {
  key: string;
  label: string;
  universitySourceId: string;
  site: string;
  profiles: RosterProfile[];
}

export interface ProfilesWriteResult {
  schools: number;
  received: number;
  matched: number;
  saved: number;
  unmatched: string[];
  withoutProfile: string[];
}

export async function writeProfiles(db: Db, schools: readonly SchoolProfiles[]): Promise<ProfilesWriteResult> {
  const result: ProfilesWriteResult = { schools: schools.length, received: 0, matched: 0, saved: 0, unmatched: [], withoutProfile: [] };
  const rows: Array<Record<string, unknown>> = [];
  for (const s of schools) {
    const ours = (await db.query<{ id: string; display_name: string; last_name: string; jersey_number: number | null; active: boolean }>(
      `select p.id, p.display_name, p.last_name, p.jersey_number, p.active from public.players p
       join public.universities u on u.id = p.university_id
       where u.source_system = $1 and u.source_id = $2 and p.duplicate_of is null`,
      [SOURCE_SYSTEM, s.universitySourceId])).rows;
    const byName = new Map(ours.map((o) => [nameKey(o.display_name), o]));
    const used = new Set<string>();
    for (const p of s.profiles) {
      result.received++;
      const last = nameKey(p.name.split(" ").slice(-1)[0] ?? "");
      const o = byName.get(nameKey(p.name)) ?? ours.find((x) => p.jersey !== null && x.jersey_number === p.jersey && nameKey(x.last_name) === last);
      if (!o || used.has(o.id)) {
        result.unmatched.push(`${s.label}: ${p.name}${p.jersey !== null ? ` #${p.jersey}` : ""}`);
        continue;
      }
      used.add(o.id);
      result.matched++;
      rows.push({
        player_id: o.id, photo_url: p.photoUrl, profile_url: p.profileUrl, position_label: p.position, height: p.height,
        academic_year: p.academicYear, hometown: p.hometown, previous_team: p.previousTeam, source_label: s.label, source_site: s.site,
      });
    }
    for (const o of ours) if (o.active && !used.has(o.id)) result.withoutProfile.push(`${s.label}: ${o.display_name}`);
  }
  if (rows.length) {
    const r = await db.query(
      `insert into public.player_profiles as pp (player_id, photo_url, profile_url, position_label, height, academic_year, hometown, previous_team, source_label, source_site)
       select player_id, photo_url, profile_url, position_label, height, academic_year, hometown, previous_team, source_label, source_site
       from jsonb_to_recordset($1::jsonb) as x(player_id uuid, photo_url text, profile_url text, position_label text, height text,
            academic_year text, hometown text, previous_team text, source_label text, source_site text)
       on conflict (player_id) do update set
         photo_url = excluded.photo_url, profile_url = excluded.profile_url, position_label = excluded.position_label,
         height = excluded.height, academic_year = excluded.academic_year, hometown = excluded.hometown,
         previous_team = excluded.previous_team, source_label = excluded.source_label, source_site = excluded.source_site,
         fetched_at = now(), updated_at = now()`,
      [JSON.stringify(rows)]);
    result.saved = r.rowCount ?? 0;
  }
  return result;
}
