# How Sideout works (plain English)

## The big picture

```
 USportVB players feed ──(every 30 min in the evening)──▶  Sync job  ──▶  Supabase database
 (stats per player per match)                                              │
                                                                           ▼
 Managers' phones / laptops  ◀── Sideout website (Vercel) ◀── reads, and asks the database
                                                              to make changes
```

- **The database (Supabase/PostgreSQL)** stores everything and does all the important checking.
- **The website (Next.js on Vercel)** shows the data and passes managers' requests (set lineup,
  add player, propose trade) to the database.
- **The sync job** runs on a schedule in the cloud. It downloads the latest statistics, stores
  any new or corrected numbers, and finalises weeks that have ended.

## Design decisions and why

| Decision | Why |
|---|---|
| **Real stats are stored separately from fantasy data.** | Stats never change because of fantasy decisions, and fantasy points can be recalculated from them at any time. |
| **Fantasy points are calculated, not stored.** Database "views" compute points from stats × scoring × lineups whenever a page asks. | One source of truth. A corrected stat or approved scoring change is reflected everywhere instantly, and it's impossible for the standings and the box scores to disagree. |
| **Scoring is versioned.** Each change creates a new version with a "starts from week N". | Changing scoring never silently rewrites history. You choose between "from next week" and "recalculate the season". |
| **Lineups are kept as a history**, with a start and end time for every slot assignment. | A player's points count for the team that started them at the moment their match locked. Changes after the lock can't affect that match, and you can see who started when. |
| **Locks are per player, per day.** | Matches the existing league's rule ("locked player-by-player, day-by-day"). |
| **All changes go through database functions** (`set_lineup`, `add_drop`, `propose_trade`, …). | Each one checks who you are, validates the change, and applies it completely or not at all. A bug in the website cannot bypass these checks. |
| **Row Level Security**: browsers can only read, and only their own league. | Even if someone found the database address, they couldn't read another league or change anything directly. Tested in `tests/db/league-actions.test.ts`. |
| **Every imported record keeps its source ID**, with unique rules on (source, ID). | Imports and syncs can run repeatedly without creating duplicates. |
| **Duplicate player records are flagged, never merged.** | USportVB has 4 players listed twice. We show them as duplicates and block adding them, but don't delete anything. |
| **Weeks before the switch keep USportVB's results.** | We don't have USportVB's lineup history, so we can't recompute those weeks. Their recorded results are kept as they were. |
| **The data source sits behind an "adapter"** (`src/lib/sources/usportvb.ts`). | If we later get permission for official USports data, only that one file changes. |

## Free agency and trades

- **Add/drop**: any active OUA women's player not on a team can be added. They go to the bench.
  If the roster is full (11), you must drop someone in the same action. Two managers can never
  get the same player: the database processes roster changes one at a time.
- **Trades**: propose → the other manager accepts or declines → processed immediately, or after
  commissioner approval if you turn that on. Traded players arrive on the bench. If a roster
  would go over 11, the trade is refused. If another trade already moved one of the players,
  remaining offers involving them are cancelled automatically.
- Points already earned stay with the team that had the player when the match locked.

## Data source limitations (important)

| What | Status |
|---|---|
| Player stats per match | ✅ From the USportVB players feed (verified to match USportVB's own points exactly). |
| Upcoming schedule / match start times | ✅ From USportVB's per-team season schedules (refreshed every 3 hours). Lineups lock at the real start time; games without a listed time use the **default lock time** (18:00 Toronto, editable), and admins can set exact times in Admin → Matches & locks. Each player shows their games this week, or **BYE**. |
| Live in-match stats | ❌ No reliable live source. Stats appear when USportVB publishes them, and every page shows when the data was last updated. Nothing is shown as "live" unless the source says so. |
| Official USports box scores | ❌ Blocked (403) for automated access. Not used. |

If any of these become available later, they plug into the same adapter.

## Database tables (summary)

Real world: `universities`, `players`, `matches`, `player_match_statistics`.
League: `leagues` (with settings), `league_members` (admin/manager roles), `matchup_weeks`,
`fantasy_teams`, `team_invitations` (admin-only), `roster_assignments` (who owns whom, with
history), `lineup_entries` (slot history), `scoring_rule_sets` + `scoring_rules` (versioned),
`matchups`, `trades` + `trade_items`, `transactions` (add/drop/trade feed).
Operations: `audit_log`, `import_runs`, `sync_runs`, `source_snapshots`.
Calculated views: `v_player_match_points`, `v_team_player_match_points`, `v_team_week_points`,
`v_matchup_scores`, `v_standings`.

## Testing

- `npm test`: 45 unit tests, covering every scoring category, positive/negative/zero values, missing
  stats, duplicate imports, recalculation after a scoring change, multiple matches, players on
  different teams, mid-week trades, lineup locks, standings, playoff seeding, and 40 real players
  whose points match USportVB's published numbers exactly.
- `npm run test:db`: 35 database tests on a real PostgreSQL, covering privacy rules, lineups and locks,
  free agency, trades and commissioner review, admin permissions, the scoring views, and the sync
  job (repeatable, applies corrections, refuses a suspiciously empty feed, survives an outage).
- GitHub runs both automatically on every push (`.github/workflows/ci.yml`).
