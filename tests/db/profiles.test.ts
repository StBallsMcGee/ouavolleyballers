import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createTestDb } from "./helpers";
import { writeProfiles } from "@/lib/ingest/profiles";

let client: pg.Client;
let drop: () => Promise<void>;
const prof = (name: string, jersey: number | null, extra = {}) => ({
  name, jersey, position: "Outside Hitter", height: "6 ft", academicYear: "2", hometown: "London, ON", previousTeam: null,
  photoUrl: `https://school.example/images/${jersey}.jpg`, profileUrl: `https://school.example/roster/${jersey}`, ...extra,
});

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  const u = (await client.query(`insert into universities (name, source_system, source_id) values ('Western', 'usportvb', 'W1') returning id`)).rows[0].id;
  for (const [first, last, j] of [["Emma", "Buntic", 1], ["Zoë", "Smith", 4], ["Kate", "Mcclennon", 19]] as const) {
    await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, jersey_number, source_system, source_id) values ($1,$2,$1||' '||$2,$3,'OUA','womens',$4,'usportvb',$1)`, [first, last, u, j]);
  }
  await client.query(`insert into auth.users (email) values ('m@example.test')`);
});
afterAll(async () => drop());

describe("player profiles", () => {
  const schools = [{ key: "western", label: "Western Mustangs", universitySourceId: "W1", site: "school.example", profiles: [prof("Emma Buntic", 1), prof("Zoe Smith", 4), prof("Z. Smith-Jones", 33), prof("Brand New", 9)] }];
  it("matches by name (accents ignored), reports the rest, and never guesses", async () => {
    const r = await writeProfiles(client, schools);
    expect([r.received, r.matched, r.saved]).toEqual([4, 2, 2]);
    expect(r.unmatched).toEqual(["Western Mustangs: Z. Smith-Jones #33", "Western Mustangs: Brand New #9"]);
    expect(r.withoutProfile).toEqual(["Western Mustangs: Kate Mcclennon"]);
  });
  it("re-running updates instead of duplicating", async () => {
    await writeProfiles(client, [{ ...schools[0]!, profiles: [prof("Emma Buntic", 1, { hometown: "Mississauga, ON" })] }]);
    const rows = (await client.query(`select hometown from player_profiles pp join players p on p.id = pp.player_id where p.last_name = 'Buntic'`)).rows;
    expect(rows).toEqual([{ hometown: "Mississauga, ON" }]);
    expect((await client.query(`select count(*)::int n from player_profiles`)).rows[0].n).toBe(2);
  });
  it("signed-in users can read profiles but cannot change them", async () => {
    const uid = (await client.query(`select id from auth.users limit 1`)).rows[0].id;
    expect((await asUser(client, uid, () => client.query(`select count(*)::int n from player_profiles`))).rows[0].n).toBe(2);
    await expect(asUser(client, uid, () => client.query(`update player_profiles set hometown = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(client, null, () => client.query(`select * from player_profiles`))).rejects.toThrow(/permission denied/);
  });
});
