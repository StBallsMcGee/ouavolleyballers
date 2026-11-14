import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addMatch, addStat, asUser, createTestDb, seed, type Fixture } from "./helpers";

let client: pg.Client;
let drop: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ client, drop } = await createTestDb());
  f = await seed(client);
});
afterAll(async () => drop());

const rpc = (user: string | null, sql: string, params: unknown[] = []) => asUser(client, user, () => client.query(sql, params));
const lineupOf = async (team: string) =>
  Object.fromEntries((await client.query(`select player_id, slot from lineup_entries where fantasy_team_id = $1 and valid_to is null`, [team])).rows.map((r) => [r.player_id, r.slot]));

describe("privacy and permissions (Row Level Security)", () => {
  it("anonymous visitors can read nothing", async () => {
    await expect(rpc(null, `select * from players`)).rejects.toThrow(/permission denied/);
    await expect(rpc(null, `select * from leagues`)).rejects.toThrow(/permission denied/);
  });
  it("signed-in users outside the league cannot see it", async () => {
    const r = await rpc(f.carol, `select count(*)::int n from fantasy_teams`);
    expect(r.rows[0].n).toBe(0);
    expect((await rpc(f.carol, `select count(*)::int n from leagues`)).rows[0].n).toBe(0);
  });
  it("league members can see teams and rosters", async () => {
    expect((await rpc(f.alice, `select count(*)::int n from fantasy_teams`)).rows[0].n).toBe(2);
    expect((await rpc(f.alice, `select count(*)::int n from roster_assignments`)).rows[0].n).toBe(5);
  });
  it("nobody can write tables directly, even their own roster", async () => {
    await expect(rpc(f.alice, `delete from roster_assignments where fantasy_team_id = $1`, [f.teamA])).rejects.toThrow(/permission denied/);
    await expect(rpc(f.admin, `update scoring_rules set points = 100`)).rejects.toThrow(/permission denied/);
  });
  it("managers cannot read invitation emails or the audit log", async () => {
    await client.query(`insert into team_invitations (fantasy_team_id, email) values ($1, 'x@example.test')`, [f.teamB]);
    expect((await rpc(f.alice, `select count(*)::int n from team_invitations`)).rows[0].n).toBe(0);
    expect((await rpc(f.admin, `select count(*)::int n from team_invitations`)).rows[0].n).toBe(1);
    expect((await rpc(f.alice, `select count(*)::int n from audit_log`)).rows[0].n).toBe(0);
  });
  it("internal functions cannot be called directly", async () => {
    await expect(rpc(f.alice, `select internal_assign_player($1, $2, $3, 'add')`, [f.leagueId, f.teamA, f.players.fa1])).rejects.toThrow(/permission denied/);
  });
});

describe("lineups", () => {
  it("a manager can change their own lineup, and history is kept", async () => {
    const lineup = [
      { player_id: f.players.oh1, slot: "UTIL" }, { player_id: f.players.m1, slot: "M" }, { player_id: f.players.ohB, slot: "OH" },
    ];
    await rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify(lineup)]);
    expect(await lineupOf(f.teamA)).toEqual({ [f.players.oh1!]: "UTIL", [f.players.m1!]: "M", [f.players.ohB!]: "OH" });
    const hist = await client.query(`select count(*)::int n from lineup_entries where player_id = $1`, [f.players.oh1]);
    expect(hist.rows[0].n).toBe(2);
  });
  it("cannot edit another manager's lineup", async () => {
    await expect(rpc(f.alice, `select set_lineup($1, $2)`, [f.teamB, JSON.stringify([{ player_id: f.players.oh2, slot: "BENCH" }, { player_id: f.players.m2, slot: "BENCH" }])])).rejects.toThrow(/your own team/);
  });
  it("rejects ineligible positions, duplicate slots and incomplete lineups", async () => {
    await expect(rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "M" }, { player_id: f.players.m1, slot: "BENCH" }, { player_id: f.players.ohB, slot: "BENCH" }])])).rejects.toThrow(/not eligible/);
    await expect(rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "OH" }, { player_id: f.players.m1, slot: "BENCH" }, { player_id: f.players.ohB, slot: "OH" }])])).rejects.toThrow(/only hold one/);
    await expect(rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "OH" }])])).rejects.toThrow(/exactly once/);
  });
  it("a player whose match today has started is locked", async () => {
    const today = (await client.query(`select (now() at time zone 'America/Toronto')::date::text d`)).rows[0].d;
    const m = await addMatch(client, f, { date: today, lockAt: new Date(Date.now() - 60_000).toISOString(), a: f.uniX, b: f.uniY, status: "live" });
    await expect(rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "BENCH" }, { player_id: f.players.m1, slot: "M" }, { player_id: f.players.ohB, slot: "OH" }])])).rejects.toThrow(/locked/);
    // ohB (university Z) is not playing, so moving only ohB is still allowed.
    await rpc(f.alice, `select set_lineup($1, $2)`, [f.teamA, JSON.stringify([{ player_id: f.players.oh1, slot: "UTIL" }, { player_id: f.players.m1, slot: "M" }, { player_id: f.players.ohB, slot: "BENCH" }])]);
    await client.query(`delete from matches where id = $1`, [m]);
  });
});

// Claims are decided at midnight; tests make them due now and run the nightly step.
const runWaivers = async () => {
  await client.query(`update waiver_claims set process_after = now() - interval '1 second' where status = 'pending'`);
  return (await client.query(`select process_waivers($1) n`, [f.leagueId])).rows[0].n as number;
};

describe("free agency (waiver claims)", () => {
  it("a claim waits until midnight, then the player joins the bench", async () => {
    await rpc(f.alice, `select submit_waiver_claim($1, $2, null)`, [f.teamA, f.players.fa1]);
    expect((await client.query(`select process_waivers($1) n`, [f.leagueId])).rows[0].n).toBe(0); // not midnight yet
    expect((await lineupOf(f.teamA))[f.players.fa1!]).toBeUndefined();
    const due = (await client.query(`select process_after > now() ok from waiver_claims`)).rows[0].ok;
    expect(due).toBe(true);
    expect(await runWaivers()).toBe(1);
    expect((await lineupOf(f.teamA))[f.players.fa1!]).toBe("BENCH");
    const tx = await client.query(`select count(*)::int n from transactions where type = 'add' and player_id = $1`, [f.players.fa1]);
    expect(tx.rows[0].n).toBe(1);
  });
  it("managers can't add directly any more; admins still can", async () => {
    await expect(rpc(f.bob, `select add_drop($1, $2, null)`, [f.teamB, f.players.oh1])).rejects.toThrow(/waiver claim/);
  });
  it("a full roster needs a player to drop; the drop happens only if the claim wins", async () => {
    const extra = (await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, positions, source_system, source_id) values ('fa2','T','fa2 T',$1,'OUA','womens','{M}','test','fa2') returning id`, [f.uniZ])).rows[0].id;
    await expect(rpc(f.alice, `select submit_waiver_claim($1, $2, null)`, [f.teamA, extra])).rejects.toThrow(/roster is full/);
    await rpc(f.alice, `select submit_waiver_claim($1, $2, $3)`, [f.teamA, extra, f.players.fa1]);
    expect((await lineupOf(f.teamA))[f.players.fa1!]).toBe("BENCH"); // still here until midnight
    await runWaivers();
    const owned = await client.query(`select count(*)::int n from roster_assignments where fantasy_team_id = $1 and released_at is null`, [f.teamA]);
    expect(owned.rows[0].n).toBe(4);
    expect((await lineupOf(f.teamA))[extra]).toBe("BENCH");
  });
  it("cannot claim a player owned by another team, or a duplicate record", async () => {
    await expect(rpc(f.alice, `select submit_waiver_claim($1, $2, $3)`, [f.teamA, f.players.oh2, f.players.ohB])).rejects.toThrow(/already on a team/);
    await expect(rpc(f.bob, `select submit_waiver_claim($1, $2, null)`, [f.teamB, f.players.dup1])).rejects.toThrow(/duplicate/);
  });
  it("two claims on one player: the team lower in the standings wins, then the earlier claim", async () => {
    const p = (await client.query(`insert into players (first_name, last_name, display_name, university_id, conference, gender, positions, source_system, source_id) values ('fa3','T','fa3 T',$1,'OUA','womens','{OH}','test','fa3') returning id`, [f.uniZ])).rows[0].id;
    await rpc(f.bob, `select submit_waiver_claim($1, $2, null)`, [f.teamB, p]);
    await rpc(f.alice, `select submit_waiver_claim($1, $2, $3)`, [f.teamA, p, f.players.ohB]);
    await runWaivers();
    const res = (await client.query(`select fantasy_team_id = $2 as bob, status from waiver_claims where player_id = $1 order by created_at`, [p, f.teamB])).rows;
    expect(res).toEqual([{ bob: true, status: "won" }, { bob: false, status: "lost" }]);
    expect((await lineupOf(f.teamA))[f.players.ohB!]).toBe("BENCH"); // Alice's drop didn't happen
    await client.query(`select 1`);
    // Give the player back to free agency for the tests below.
    await rpc(f.admin, `select add_drop($1, null, $2)`, [f.teamB, p]);
  });
  it("claims are private to the team; they can be cancelled", async () => {
    const id = (await rpc(f.bob, `select submit_waiver_claim($1, $2, null) id`, [f.teamB, f.players.fa1])).rows[0].id;
    expect((await rpc(f.alice, `select count(*)::int n from waiver_claims where id = $1`, [id])).rows[0].n).toBe(0);
    expect((await rpc(f.bob, `select count(*)::int n from waiver_claims where id = $1`, [id])).rows[0].n).toBe(1);
    await expect(rpc(f.alice, `select cancel_waiver_claim($1)`, [id])).rejects.toThrow(/own team/);
    await rpc(f.bob, `select cancel_waiver_claim($1)`, [id]);
    expect((await client.query(`select status from waiver_claims where id = $1`, [id])).rows[0].status).toBe("cancelled");
  });
  it("respects the free agency switch", async () => {
    await client.query(`update leagues set settings = jsonb_set(settings, '{freeAgency,enabled}', 'false') where id = $1`, [f.leagueId]);
    await expect(rpc(f.bob, `select submit_waiver_claim($1, $2, null)`, [f.teamB, f.players.fa1])).rejects.toThrow(/closed/);
    await client.query(`update leagues set settings = jsonb_set(settings, '{freeAgency,enabled}', 'true') where id = $1`, [f.leagueId]);
  });
});

describe("trades", () => {
  it("propose, accept and execute: players swap teams onto the bench", async () => {
    const id = (await rpc(f.alice, `select propose_trade($1, $2, $3, $4, 'hi') id`, [f.teamA, f.teamB, [f.players.ohB], [f.players.m2]])).rows[0].id;
    // a second offer for the same player will become impossible
    const other = (await rpc(f.alice, `select propose_trade($1, $2, $3, $4) id`, [f.teamA, f.teamB, [f.players.m1], [f.players.m2]])).rows[0].id;
    await expect(rpc(f.alice, `select respond_trade($1, true)`, [id])).rejects.toThrow(/your own team/);
    const st = await rpc(f.bob, `select respond_trade($1, true) s`, [id]);
    expect(st.rows[0].s).toBe("completed");
    expect((await lineupOf(f.teamB))[f.players.ohB!]).toBe("BENCH");
    expect((await lineupOf(f.teamA))[f.players.m2!]).toBe("BENCH");
    expect((await client.query(`select status from trades where id = $1`, [other])).rows[0].status).toBe("failed");
  });
  it("rejects trades that would break the roster limit", async () => {
    // Alpha has 4 (limit 4). Receiving 2 for 1 would make 5.
    await expect(rpc(f.alice, `select propose_trade($1, $2, $3, $4)`, [f.teamA, f.teamB, [f.players.m1], [f.players.oh2, f.players.ohB]])).rejects.toThrow(/roster limit/);
  });
  it("commissioner review mode: admin approves or vetoes", async () => {
    await client.query(`update leagues set settings = jsonb_set(settings, '{trades,review}', '"commissioner"') where id = $1`, [f.leagueId]);
    const id = (await rpc(f.bob, `select propose_trade($1, $2, $3, $4) id`, [f.teamB, f.teamA, [f.players.ohB], [f.players.m1]])).rows[0].id;
    expect((await rpc(f.alice, `select respond_trade($1, true) s`, [id])).rows[0].s).toBe("pending_review");
    await expect(rpc(f.alice, `select review_trade($1, true)`, [id])).rejects.toThrow(/administrator/);
    expect((await rpc(f.admin, `select review_trade($1, false, 'unfair') s`, [id])).rows[0].s).toBe("vetoed");
    await client.query(`update leagues set settings = jsonb_set(settings, '{trades,review}', '"none"') where id = $1`, [f.leagueId]);
  });
  it("respects the trade switch", async () => {
    await client.query(`update leagues set settings = jsonb_set(settings, '{trades,enabled}', 'false') where id = $1`, [f.leagueId]);
    await expect(rpc(f.alice, `select propose_trade($1, $2, $3, $4)`, [f.teamA, f.teamB, [f.players.m1], [f.players.oh2]])).rejects.toThrow(/closed/);
    await client.query(`update leagues set settings = jsonb_set(settings, '{trades,enabled}', 'true') where id = $1`, [f.leagueId]);
  });
});

describe("admin actions", () => {
  it("only admins change settings, and changes are audited", async () => {
    const s = (await client.query(`select settings from leagues where id = $1`, [f.leagueId])).rows[0].settings;
    await expect(rpc(f.alice, `select admin_update_league($1, null, $2, 'active')`, [f.leagueId, s])).rejects.toThrow(/administrator/);
    await expect(rpc(f.admin, `select admin_update_league($1, null, $2, 'active')`, [f.leagueId, { ...s, roster: { ...s.roster, TOTAL: 3 } }])).rejects.toThrow(/cannot be lower/);
    await rpc(f.admin, `select admin_update_league($1, 'Renamed', $2, 'active')`, [f.leagueId, s]);
    expect((await client.query(`select count(*)::int n from audit_log where action = 'league.settings'`)).rows[0].n).toBe(1);
  });
  it("roster corrections require a reason", async () => {
    await expect(rpc(f.admin, `select admin_move_player($1, $2, $3, '')`, [f.leagueId, f.players.fa1, f.teamB])).rejects.toThrow(/reason/);
  });
  it("invited managers claim their team on sign-in", async () => {
    const dave = (await client.query(`insert into auth.users (email) values ('Dave@Example.test') returning id`)).rows[0].id;
    const t = (await client.query(`insert into fantasy_teams (league_id, name) values ($1, 'Charlie') returning id`, [f.leagueId])).rows[0].id;
    await rpc(f.admin, `select admin_invite_manager($1, 'dave@example.test', 'Dave')`, [t]);
    expect((await rpc(dave, `select claim_my_teams() n`)).rows[0].n).toBe(1);
    expect((await client.query(`select owner_user_id from fantasy_teams where id = $1`, [t])).rows[0].owner_user_id).toBe(dave);
    expect((await rpc(dave, `select count(*)::int n from fantasy_teams`)).rows[0].n).toBe(3);
  });
});

describe("page context in one call", () => {
  it("returns the member's own league, teams and weeks; nothing for outsiders", async () => {
    const a = (await rpc(f.alice, `select my_context() c`)).rows[0].c;
    expect(a.league.id).toBe(f.leagueId);
    expect(a.memberships).toEqual([{ league_id: f.leagueId, role: "manager" }]);
    expect(a.teams.length).toBeGreaterThanOrEqual(2);
    expect(a.teams.find((t: { id: string }) => t.id === f.teamA).owner_name).toBe("alice");
    expect(a.weeks[0]).toMatchObject({ week: 1, starts_on: "2026-11-09" });
    const c = (await rpc(f.carol, `select my_context() c`)).rows[0].c;
    expect([c.league, c.teams, c.memberships]).toEqual([null, [], []]);
    await expect(rpc(null, `select my_context()`)).rejects.toThrow(/permission denied/);
  });
  it("season totals match the per-match points", async () => {
    const a = (await client.query(`select player_id, points from v_player_season_points where league_id = $1 order by 1`, [f.leagueId])).rows;
    const b = (await client.query(`select player_id, sum(points)::numeric(10,2)::text points from v_player_match_points where league_id = $1 group by 1 order by 1`, [f.leagueId])).rows;
    expect(a.map((r) => [r.player_id, String(r.points)])).toEqual(b.map((r) => [r.player_id, r.points]));
  });
});

describe("team pictures", () => {
  const img = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-bytes").toString("base64");
  it("the manager sets a picture; league members can see it; others can't change it", async () => {
    await rpc(f.alice, `select set_team_logo($1, $2)`, [f.teamA, img]);
    expect((await rpc(f.bob, `select image from team_logos where fantasy_team_id = $1`, [f.teamA])).rows[0].image).toBe(img);
    expect((await rpc(f.carol, `select count(*)::int n from team_logos`)).rows[0].n).toBe(0);
    await expect(rpc(f.bob, `select set_team_logo($1, $2)`, [f.teamA, img])).rejects.toThrow(/own team/);
    await expect(rpc(f.alice, `select set_team_logo($1, 'javascript:alert(1)')`, [f.teamA])).rejects.toThrow(/could not be used/);
    const ctx = (await rpc(f.alice, `select my_context() c`)).rows[0].c;
    expect(ctx.teams.find((t: { id: string }) => t.id === f.teamA).logo_v).toBeGreaterThan(0);
    await rpc(f.alice, `select set_team_logo($1, null)`, [f.teamA]);
    expect((await client.query(`select count(*)::int n from team_logos`)).rows[0].n).toBe(0);
  });
});
