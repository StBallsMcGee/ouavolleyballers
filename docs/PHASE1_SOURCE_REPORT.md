# Phase 1 — Source Data Report and Migration Plan

**Date of investigation:** 6 November 2026 (2026-27 season, matchup week 3)
**Status:** League data verified (section 12). Awaiting administrator decisions (section 13). No league data has been imported or written anywhere.

Legend used throughout:

- **VERIFIED** — confirmed against a live response or the live site's code during this investigation.
- **STRONG EVIDENCE** — supported by the live site's code, but not yet confirmed against our league's actual data.
- **UNVERIFIED** — not yet confirmed; must not be relied on.
- **BLOCKED** — could not be checked; the reason is given.

---

## 1. Summary in plain English

1. **The repository is empty apart from `PROJECT_SPEC.md`.** No code, HAR files, or extracted data exist, so there is nothing to reuse and nothing that could be accidentally overwritten. Phase 1 started from scratch.
2. **Player information and match-by-match player statistics can be retrieved automatically** from a public USportVB endpoint that needs no login. I confirmed it returns all 432 OUA women's players (271 active) with per-match stats back to October 2024. (VERIFIED)
3. **I can reproduce USportVB's fantasy-point calculation exactly.** Using the site's default scoring values, I recalculated this season's week-2 points for all 187 players who scored, and all 187 matched the site to the decimal. This shows we understand the statistic fields and the formula. (VERIFIED)
4. **The ambiguous scoring labels are now answered.** "Errors" means *attack* errors, "Attempts" means *total attack attempts*, and "Missed serves" means *service errors*. (STRONG EVIDENCE + VERIFIED by the 187/187 match)
5. **[UPDATE 6 Nov: resolved, see section 12.]** ~~Your league's own settings (managers, teams, rosters, custom scoring, matchups) were not retrieved.~~ I don't have your league ID, and I deliberately didn't search for it. This is the main thing I need from you (see section 9).
6. **The official USports box-score site blocked every request** (a "403 Request blocked" page from its CloudFront network). USportVB's own server also couldn't reach USports while I was testing. **This is the biggest risk to automatic stat updates** and needs a decision (section 7).
7. **Your league appears to use head-to-head weekly matchups with wins and losses, playoffs, a bench, and day-by-day lineup locking.** It is not simply "most total points". (STRONG EVIDENCE from the site's code and update notes; needs confirming for your league.)

---

## 2. What I did (and did not do)

All requests were read-only `GET` requests. They used an honest user-agent, were spaced at least 1 second apart (the site's `Crawl-delay: 1`), and **never logged in or sent cookies or tokens**. About 30 requests were made in total, most of them for the site's own page scripts, which every visitor's browser downloads anyway.

| Action | Result |
|---|---|
| Inspected repository | Only `PROJECT_SPEC.md` (one commit). |
| Re-checked `usportvb.ca/robots.txt` | Same as the spec's historical copy (see section 6). |
| Looked for terms of service / privacy policy | **None exist** (`/terms`, `/privacy`, `/legal`, `/about`, etc. all return 404). |
| Read the public sitemap and update-notes page | Sitemap lists `/`, `/players`, `/scores`, `/fantasy`, `/update-notes`. The update notes describe features, history and a support email (`usportvb@gmail.com`). |
| Read the public JavaScript the site sends to every browser | Confirmed the backend host, the list of API endpoints, the data shapes, default scoring, roster defaults and the season week calendar. |
| `GET /api/players?gender=womens&conference=OUA` (once) | 200 OK, 1.29 MB, 432 players. |
| `GET /api/games-by-date?date=2026-10-31&isMens=false` (once) | 405, body `{"error":"Failed to fetch data from USport"}`. USportVB fetches this from USports live, and that fetch failed. |
| `GET en.usports.ca/robots.txt` and the example box-score XML (once each) | **403 "Request blocked" from CloudFront.** I did not try to get around this. |
| Did **not** do | Log in; call any `/api/fantasy/...` endpoint; guess or enumerate league/team IDs; call Supabase directly (would have required lifting a key out of site code); use write endpoints; disguise requests as a browser. |

Raw downloaded data is kept in a private scratch folder for this session only. It is **not** committed to Git.

**One environment change:** this cloud session originally couldn't reach these websites. I created a personal cloud environment called **`ouavolleyballers`**, which allows only `usportvb.ca`, `www.usportvb.ca`, the USportVB backend (`relevant-benni-volleyball-app-71b883ac.koyeb.app`), the old scores database (`jittmooanbkqvomwyjaf.supabase.co`) and `en.usports.ca`. You approved this on a prompt. It doesn't affect any of your data.

---

## 3. The source systems, as they actually are today

```
usportvb.ca (website, Next.js)
   │  browser calls ↓
relevant-benni-volleyball-app-71b883ac.koyeb.app  (USportVB backend API)   ← VERIFIED still live
   │  fetches/parses ↓
en.usports.ca box scores (official USports / PrestoSports pages)           ← blocks us (403)
```

- The spec's Supabase `games` request (`jittmooanbkqvomwyjaf.supabase.co`) is **no longer referenced** by the site's homepage code. Game lists now come through the backend's `/api/games-by-date` and `/api/games-by-date-range`. Whether the Supabase table still exists is UNVERIFIED and no longer matters much.
- The update notes say USportVB **parses USports HTML box scores** ("Adjust to USports new HTML structure for boxscores", v2.1.0). So USportVB is itself a *copy* of USports data, not an original source.
- The update notes say "PlayerIds are now internal and non-reliant on usports" (v1.3.1). **USportVB player IDs are USportVB's own IDs and do not match USports' IDs.** Any link to USports box scores will have to match players by team + name + jersey number.

### 3.1 Backend endpoints found in the site code (VERIFIED to exist in code; not all called)

Relevant to migration:

| Endpoint | Sends a login token? | Purpose |
|---|---|---|
| `GET /api/players` (filters: `gender`, `conference`, `isActive`, `season`) | No (public) | All players + per-match stats. **Called and verified.** |
| `GET /api/players/{id}` | No | One player |
| `GET /api/fantasy/league/{leagueId}` | No (see section 6.3) | League settings, scoring, matchups, draft |
| `GET /api/fantasy/league/{leagueId}/teams` | No | All fantasy teams in the league |
| `GET /api/fantasy/team/{teamId}` | No | One fantasy team (owner, roster, wins/losses, weekly points) |
| `GET /api/fantasy/team/{teamId}/players` | No | A team's roster with stats |
| `GET /api/fantasy/users-by-ids` | Unknown | Manager names for IDs |
| `GET /api/fantasy/user-leagues/{userId}` | Unknown | Which leagues a user is in |
| `GET /api/games-by-date`, `/api/games-by-date-range` | No | Match list (fetched live from USports) |
| `GET /api/standings`, `/api/team-rankings` | No | Real-world OUA standings/rankings |
| `GET /api/auth/profile` | Yes | The logged-in user's profile; not needed |

There are many admin and write endpoints (`/api/cron/*`, `/api/fantasy/trade/*`, `.../player-position`, etc.). **We will never call these.**

---

## 4. Data shapes (from the site's own validation code — STRONG EVIDENCE)

These are the data structures the USportVB website itself expects. I've translated the names.

### 4.1 Fantasy league
| Field | Meaning |
|---|---|
| `publicId` | League ID |
| `year` | Season, labelled by **ending** year (`2027` = the 2026-27 season) |
| `name` | League name |
| `password` | **League join password — must never be copied into our system or into Git** |
| `commissionerId` | Administrator's user ID |
| `teams[]` | Fantasy team IDs |
| `draft` | Draft settings, order and every pick (`pickNumber`, `teamId`, `playerId`) |
| `criticalSettings.gender / conferences / leagueSize (2–32)` | League scope |
| `criticalSettings.roster` | `OH`, `M`, `L`, `S`, `UTIL` slot counts and `TOTAL` roster size |
| `adjustableSettings.points` | **The league's scoring values** (9 categories, section 5) |
| `matchups[]` | `week`, `team1Id`, `team2Id`, `team1Score`, `team2Score`, `winnerId` (can be `"TIE"`), `playoffGameId` |
| `tradedThisWeek[]`, `finalStandings[]` | Trade limit tracking; final order for completed seasons |

### 4.2 Fantasy team
`publicId`, `leagueId`, `name`, `managerId`, `players[]` (each `{publicId, position}`; I believe `position` is the lineup slot, e.g. OH/M/bench, which is UNVERIFIED), `points[]` (`{week, points}` — **weekly history**), `wins`, `losses`. Daily lineups are stored as `{date, lineup[], points}`.

### 4.3 Player (VERIFIED against live data)
`publicId`, `firstName`, `lastName`, `position`, `teamId` (real university, USportVB's own ID), `jerseyNumber`, `mens`, `isActive`, `conference`, `gameData[]` (one row per match), `fantasyPoints[]` (season and weekly totals at **default** scoring).

Per-match row: `date`, `opponent` (university ID), `kills`, `errors`, `attempts`, `assists`, `aces`, `serveMisses`, `digs`, `blockSolo`, `blockAssist`, `sets` (only on this season's rows).

---

## 5. Scoring — what is verified

### 5.1 The nine categories (complete list — STRONG EVIDENCE)
USportVB's scoring settings have exactly **nine** categories, and leagues cannot add others. They match the spec's nine labels one-for-one.

| Spec label | USportVB field | Real statistic | USportVB **default** | Spec's candidate value for **our league** |
|---|---|---|---:|---:|
| Aces | `aces` | Service aces | +2.0 | +2.0 |
| Digs | `digs` | Digs | +0.5 | +0.5 |
| Kills | `kills` | Kills | +1.0 | +1.0 |
| Errors | `errors` | **Attack errors** | −1.0 | −1.0 |
| Assists | `assists` | Assists (setting) | **+0.1** | **+0.3** |
| Attempts | `attempts` | **Total attack attempts** | **0** | **−0.5** |
| Solo blocks | `blockSolo` | Solo blocks | +2.0 | +2.0 |
| Block assists | `blockAssist` | Block assists | +0.8 | +0.8 |
| Missed serves | `serveMisses` | **Service errors** | −0.5 | −0.5 |

How the label meanings were confirmed: the site's box-score structure lists `kills, errors, totalAttacks, hittingPercentage, assists, serviceAces, serviceErrors, …`. `errors` sits with the attacking stats and service errors are a separate field. On top of that, recalculating with these meanings reproduced the site's numbers exactly (5.2).

**Not scored at all:** reception errors, block errors, ball-handling errors, points, sets played. Our scoring engine will store these statistics if the source provides them, but give them no points unless you add them later.

### 5.2 Formula check (VERIFIED)
`points = Σ (stat × value)`, added up over each match in the period. For week 2 of 2026-27 (26 Oct – 1 Nov), all **187 / 187** players with points matched USportVB's published figure exactly when using the default values.

### 5.3 What is still UNVERIFIED
> **Update:** the league's real values are now VERIFIED (section 12). Attempts = **0**, assists = **0.3**.

- **Your league's actual values.** The spec's candidates differ from the defaults in exactly two places (assists 0.3, attempts −0.5). That fits a customised league, but **−0.5 per attack attempt is a very heavy penalty.** For example, 10 kills on 30 attempts with 3 errors would score −8. That's possible, but please confirm it on your league's settings page. If it actually reads "Attempts −0.05" or similar, this matters a lot.
- Whether **bench players** score: the update notes say "players on bench will not earn fantasy points". This needs confirming for weekly totals.
- How USportVB rounds weekly totals, and how it treats a match a player appears in twice (a USportVB data error).

---

## 6. Access rules and permissions

### 6.1 robots.txt (re-checked today, unchanged)
- `User-agent: *` → `Allow: /`, `Crawl-delay: 1`.
- The `Disallow: /admin/ /api/ /_next/ /private/` lines technically sit under the `Slurp` (Yahoo) group, so strictly they apply to Yahoo only. **But** the file's own comment says "Disallow admin and private areas", which suggests the site owner *meant* `/api/` to be off-limits to robots generally.

**My recommendation:** treat USportVB's `/api/` as "permitted use unclear". It's fine for one-off migration reads of **our own league** with your approval. It should **not** become the permanent automatic data feed for the new app unless the USportVB developer agrees.

### 6.2 Terms of service
There are none. A support email is listed: **usportvb@gmail.com**. The site is evidently run by one volunteer developer.

### 6.3 A privacy concern in USportVB (reported to the administrator privately)
A possible access-control weakness in USportVB was noted and passed to the administrator privately, for the USportVB developer. Details are deliberately left out of this public repository. For our migration: league responses include the league join password, which our import tool always strips out before saving anything.

### 6.4 USports (en.usports.ca)
Every request, including `robots.txt`, got **403 "Request blocked" from CloudFront**. That usually means the site blocks cloud servers or automated clients. Working around a block like this is exactly what the spec forbids. USportVB's own cloud server also got "Failed to fetch data from USport" while I tested, so this may be affecting USportVB too, right now.

---

## 7. Match data, box scores and live updates

| Question (spec §6) | Answer |
|---|---|
| Does the box-score XML contain per-player stats? | **BLOCKED.** I couldn't fetch it. The per-match stats USportVB derived from USports (section 4.3) show the source does contain kills, errors, attempts, assists, aces, service errors, digs, solo blocks, block assists and sets. |
| How are players identified in the XML? | **BLOCKED.** We know USportVB doesn't reuse USports IDs, so matching will be by university + name + jersey number. |
| Are box scores available / updating during live matches? | **UNVERIFIED.** USportVB's notes mention "live game boxscores" (v1.7.4), which suggests partial live data exists, but this hasn't been tested. |
| Does the games list filter server-side? | The old Supabase call didn't (spec §6). The new backend endpoint filters by gender (`isMens`) but not by conference. **We must always filter by conference, gender and season ourselves.** |
| Can a cloud scheduler reach USports? | **Currently no** (from this environment). This is the single biggest risk to automatic updates. |

**Options for the permanent stats feed (your decision, section 9):**
1. **Ask USports / its stats provider for permission or a feed.** Best long term, but slow and uncertain.
2. **Ask the USportVB developer** whether we may poll their public `/api/players` (filtered to OUA women's, every few hours). It's cheap (one ~1.3 MB request), and it gives exactly the stats our scoring needs. The downside is that we depend on a hobby site.
3. **Administrator-assisted import:** you open or save the box-score files from your own browser and upload them to the admin page. This works, but it isn't automatic, which goes against the spec's "laptop off" goal.
4. Re-test USports access from the real hosting platform (Vercel). It may behave differently from this test environment, but we shouldn't count on it.

The new app will be designed so the stats source is a replaceable "adapter". Scoring, rosters and standings won't care which option is used.

---

## 8. Player database findings (VERIFIED)

- **432** OUA women's players across **15 universities**: Brock, Guelph, Lakehead, McMaster, Nipissing, Ottawa, Queen's, RMC, Toronto, Toronto Metropolitan, Trent, Waterloo, Western, Windsor, York. **271 are active.**
- Positions on file: OH 152, M 83, S 55, L 49, UTIL 3. There are also **multi-position** players (OH/L, S/OH, M/OH, L/OH, S/L, OH/S — 13 players), and 77 have no position (all inactive). **Position eligibility can't be a single value.** Our design must support a player who qualifies for more than one slot, and we must confirm how USportVB lets those players fill slots.
- **7,202** player-match stat rows from 10 Oct 2024 to 1 Nov 2026, covering three seasons (2024-25, 2025-26, 2026-27). No duplicate rows for the same player, date and opponent were found.
- This season's OUA women's games so far: 30 Oct, 31 Oct and 1 Nov 2026 (week 1, 19–25 Oct, had no games).
- **Data-quality problem: 4 duplicated players.** Julia Breen, Olivia Zhu, Sydney Zakutney and Giulia Chimilovski each have a second record whose surname starts with a space. One of Zakutney's matches is stored on the duplicate. **The migration must check which record each fantasy roster points to and flag it, never silently merge.**
- University IDs (`teamId`) are USportVB's own codes (e.g. `d5fxlv5sp7d57j2i` = Western). They are completely separate from fantasy team IDs, as the spec warned.
- `isActive` is a USportVB flag; one "inactive" player has a 2026-27 match. Its exact meaning needs verifying.

### Season/week calendar (from site code — STRONG EVIDENCE)
2026-27 matchup weeks: W1 19–25 Oct · W2 26 Oct–1 Nov · W3 2–8 Nov · W4 9–15 Nov · W5 16–22 Nov · W6 23–29 Nov · (winter break) · W7 4–10 Jan · W8 11–17 Jan · W9 18–24 Jan · W10 25–31 Jan · W11 1–7 Feb · W12 8–14 Feb · W13 15–21 Feb. Playoff weeks are UNVERIFIED. (The 2024-25 calendar in the site's code contains an invalid date, "2024-11-31", a reminder not to trust source data blindly.)

---

## 9. Still unknown — and what I need from you
> **Update:** items 1–5 are resolved (section 12). Items 6–9 remain, plus the decisions in section 13.


| # | Unknown | How to resolve | Who |
|---|---|---|---|
| 1 | **League ID** | Open your league on usportvb.ca. The ID is the code in the address bar (`/fantasy/leagues/<ID>` or similar). Send it to me. It's not a password, but please don't post it publicly. | You |
| 2 | **Permission to read the league data** | Approve me to make a one-time read of `/api/fantasy/league/{id}`, `/league/{id}/teams` and each `/team/{id}` (~20 requests, 1 per second). The saved copy will have the league password and any emails removed. | You |
| 3 | Number of managers (16 vs 17 entries) | Answered by #2. Likely explanations: a commissioner team, an abandoned or test team, or a manager who left. I won't guess. | Me, after #2 |
| 4 | Your league's scoring values | Answered by #2. **Also please screenshot the league's scoring settings page** so we have two independent sources. | Both |
| 5 | Roster slots / bench size | Answered by #2 + screenshot. Site default is 3 OH, 2 M, 1 L, 1 S, 1 UTIL, 10 total (so likely 2 bench). | Both |
| 6 | Trades / free agency enabled? Playoff format? Tiebreakers? | #2 shows trades; the playoff and tiebreaker rules live on USportVB's server, so **please describe them** or screenshot the settings. | You |
| 7 | Managers' emails for invitations | **You provide these**; we will not scrape them. | You |
| 8 | Permanent stats source | Choose an option from section 7. I suggest emailing usportvb@gmail.com: ask permission for (a) our one-time league export and (b) light polling of `/api/players`, and mention the security issue in 6.3. | You |
| 9 | Box-score structure | If you can, open `https://en.usports.ca/sports/wvball/2026-27/boxscores/20261031_9e9k.xml` in your own browser and **save the file** (it contains no personal data). I can then inspect its structure safely. | You |

---

## 10. Proposed architecture

The repository is empty, so there's no reason to change the spec's recommended stack:

- **Next.js + React + TypeScript + Tailwind** for the website. It works on phones, tablets and computers.
- **Supabase** (PostgreSQL database + login + Row Level Security) for data and accounts. Row Level Security means the database itself refuses to let one manager edit another's team, even if the website code had a bug.
- **Vercel** to host the website, plus **scheduled jobs** for syncing. These run in the cloud, so your laptop can be off. The exact scheduler will be chosen once the stats source (section 7) is decided.

### Plain-English design decisions
1. **Real stats and fantasy points are kept apart.** We store the raw match stats once. Fantasy points are *calculated* from them using a versioned scoring rule set. Changing scoring never edits the raw stats, and old results keep the rule version they were calculated with unless you choose to recalculate.
2. **Every imported record remembers where it came from** (source system + source ID). A separate "ID map" table links USportVB IDs to our permanent IDs. Re-running the import updates the same records instead of creating duplicates.
3. **Imports are two-step: preview, then apply.** The tool first produces a report (counts, mismatches, duplicates, unverified items). It writes nothing until you approve.
4. **Raw source snapshots are kept** (with the league password and emails stripped), so we can always prove what the old site said.
5. **One source of truth for standings:** standings are calculated from completed matchup results, not stored separately.
6. **Stats source as an adapter:** "USportVB players feed", "USports box score" and "manual upload" are interchangeable plug-ins behind one interface.

### Schema changes from the spec, based on these findings
On top of the spec's tables (section 8), I propose:
- `seasons` (with USportVB's year label, e.g. 2027 = 2026-27) and `matchup_weeks` (the calendar in section 8).
- `universities` (real teams, with their own source IDs). Kept separate from `fantasy_teams`.
- `player_position_eligibility` (a player can qualify for several positions).
- `matchups` (head-to-head: week, team A, team B, scores, winner/tie, playoff flag).
- **Daily** lineups (USportVB locks player-by-player, day-by-day), rather than per-match only.
- `scoring_rule_sets` + `scoring_rules` (versioned), `source_snapshots`, `source_id_map`, `import_runs`, `sync_runs`, `audit_log`.
- Keep match-level stats for every statistic the source provides, including `sets`.

### Environment variables (names only; values never go in Git)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public connection details for the website.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only** admin key for imports and sync jobs.
- `CRON_SECRET` — stops strangers from triggering sync jobs.
- `USPORTVB_API_BASE` — the old site's backend address, used only by the migration tool.
- `SOURCE_CONTACT` — contact string sent in our user-agent so source sites can reach us.

---

## 11. Migration plan (Phase 2 preview — nothing runs until you approve)

1. **Fetch** (with your approval): league → teams → each team → players. Polite pacing, saved as redacted snapshots.
2. **Validate the snapshot against itself:** the team count equals the league's `teams[]`; every roster player exists in the player feed; no player is on two fantasy teams; each roster fits the slot rules; draft picks agree with current rosters plus trades; the 4 duplicate players are flagged; the 17th team is explained.
3. **Cross-check scoring:** recalculate each team's stored weekly points from raw stats + the league's scoring + lineups. Any mismatch is reported, not "fixed".
4. **Dry-run report** with the counts required by spec §4.3 (managers, teams, players, roster assignments, scoring rules, duplicates, unmatched, unverified).
5. **You review and approve.**
6. Import into a **test** Supabase database only. Re-run it to prove no duplicates appear.
7. Post-import validation report. Production import only after a backup and your second approval.

---

## 12. League verification results (added 6 Nov 2026, after administrator approval)

The administrator supplied the league settings screenshots and approved a one-time read of the league data (the USportVB developer has given permission). Three requests were made: the league, the league's team list, and one team as a cross-check. The per-team requests added nothing beyond the team list, so they weren't repeated for the other 16 teams.

**This public repository deliberately contains no league ID, manager IDs, team names or rosters.** Those are in a private, redacted snapshot and a detailed report given to the administrator.

| Check | Result |
|---|---|
| League settings vs screenshots | **VERIFIED — identical.** Women's, OUA only, league size 17, season 2026-27. |
| Scoring (9 categories) | **VERIFIED:** aces +2, digs +0.5, kills +1, attack errors −1, assists **+0.3**, solo blocks +2, block assists +0.8, service errors −0.5, attack attempts **0**. The spec's provisional "attempts −0.5" was **wrong**; the real value is 0. The only difference from USportVB's defaults is assists (0.3 vs 0.1). |
| Roster configuration | **VERIFIED:** 3 OH, 2 M, 1 L, 1 S, 1 UTIL (8 starters), **11 total**. That leaves 3 bench spots, but the draft was **10 rounds**, so every team has 1 open roster spot. |
| Lineup slot names | `S`, `OH1–3`, `M1–2`, `L`, `UTIL`, `BENCH` |
| Teams | **17** team records; the league's list and team endpoint agree exactly. 17 distinct managers, no manager owns two teams. The commissioner owns one team. |
| The "17th entry" | **Explained:** one real team with a real manager that has **0 players, made no draft picks, and is in no matchup.** It joined but did not draft. **Administrator decision needed** (section 13). |
| Draft | Complete: 160 picks (16 teams × 10 rounds), pick numbers 1–160 with no gaps, no player drafted twice. |
| Rosters | **160 rostered players, all unique** (no player on two teams). All 160 found in the player feed, all active, none of them the duplicate-record players. |
| Changes since the draft | **4 free-agent drop/add swaps on 2 teams** (4 drafted players dropped, 4 undrafted players added). No trades. Current rosters, not draft picks, are the source of truth. |
| Lineup validity | Every starter is in a slot matching their listed position. 3 teams have never set a lineup (all 10 players on the bench). |
| Competition format | **VERIFIED head-to-head:** 72 matchups, weeks 2–10, 8 per week, 16 teams, no repeat pairings. Weeks 11–13 have no matchups, presumably reserved for playoffs (format UNVERIFIED). |
| Historical results | **None exist yet.** All records 0–0, all matchup scores 0, no weekly points. The draft was 3 Nov 2026 and there have been no OUA women's games since. **No history needs migrating.** |
| Lineup history | Not exposed by any endpoint we use. Not needed, since nothing has been scored. |

### Source health at time of check
- Player stats feed (`/api/players`): working; latest rows dated 1 Nov 2026.
- USportVB match lists (`/api/games-by-date`, `/api/games-by-date-range`): **returning errors or empty results even for dates with known games.** These appear to depend on USports.
- USports box scores: still 403-blocked from this cloud environment.
- **To watch:** whether the player feed picks up this weekend's (6–8 Nov) matches. If it doesn't, USportVB's own stats pipeline is affected by the USports block too.

## 13. Decisions needed from the administrator

1. **The empty 17th team.** Options: (a) import it as an inactive team with no roster and no matchups (exactly mirrors USportVB; **recommended**); (b) give it players from free agency; (c) leave it out. Nothing will be deleted either way.
2. **The 11th roster spot.** Rosters allow 11 but everyone has 10. Should the open spot stay open, or can managers fill it from free agency (USportVB allows free agency)?
3. **Free agency / trades** in the new app: USportVB had both enabled in practice. Enable them in the new app, or freeze rosters?
4. **Playoffs:** how many teams qualify, which weeks, and the tiebreakers.
5. **Bench scoring:** confirm bench players score 0 (USportVB states this).
6. **Timing:** week 3 matches are this weekend and will be scored on USportVB. The new app should take over at a week boundary, ideally before week 4 or a later Monday, and import USportVB's completed weekly results up to that point.
7. **Repository visibility:** this GitHub repository is **public**. The spec calls for a private app; please consider making the repo private (GitHub → Settings → General → Danger Zone → Change visibility). Either way, no league data or secrets will be committed.

## 14. Next steps

1. **Administrator:** answer the decisions in section 13.
2. **Me:** re-check the player feed after this weekend's matches (one request) to confirm USportVB's stats are still updating.
3. **Me, once approved:** start Phase 2. That means creating the database schema, running the import tool in dry-run mode against a **test** database using the saved snapshot, and building automated tests for scoring and duplicate prevention. Real-league writes only after the dry-run report is approved.
