import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "./queries";

export interface PlayerListRow {
  id: string;
  display_name: string;
  position_label: string | null;
  positions: string[];
  university_id: string | null;
  jersey_number: number | null;
  active: boolean;
  duplicate_of: string | null;
  photo: string | null;
}

export async function listPlayers(sb: SupabaseClient, f: { q?: string; uni?: string; pos?: string; activeOnly?: boolean }) {
  const rows = await fetchAll<Omit<PlayerListRow, "photo"> & { player_profiles: { photo_url: string | null } | Array<{ photo_url: string | null }> | null }>((from, to) => {
    let q = sb.from("players").select("id, display_name, position_label, positions, university_id, jersey_number, active, duplicate_of, player_profiles(photo_url)").eq("gender", "womens").eq("conference", "OUA");
    if (f.q) q = q.ilike("display_name", `%${f.q.replace(/[%_,()]/g, "")}%`);
    if (f.uni) q = q.eq("university_id", f.uni);
    if (f.pos) q = q.contains("positions", [f.pos]);
    if (f.activeOnly) q = q.eq("active", true);
    return q.order("display_name").range(from, to) as never;
  });
  return rows.map(({ player_profiles: pp, ...p }) => ({ ...p, photo: (Array.isArray(pp) ? pp[0]?.photo_url : pp?.photo_url) ?? null }));
}
