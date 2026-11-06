# Project Specification: Private OUA Women's Volleyball Fantasy League

## 1. Project Overview

Build a private, browser-based fantasy volleyball application for an existing fantasy league of approximately 16 managers.

The league is based on women's university volleyball in the Ontario University Athletics (OUA) conference.

The existing fantasy league is currently hosted on USportVB.ca. All managers have already drafted their teams. The new application must preserve the existing league, including:

- All existing managers and their accounts or team ownership.
- Every existing fantasy team.
- Every drafted player's current fantasy-team ownership.
- Existing roster configurations.
- Existing league settings.
- Existing customized fantasy scoring rules.
- Historical results and standings wherever the available data permits.

**The existing managers must not have to redraft.**

The purpose is to create a substantially better experience than the existing platform, with a modern interface, reliable player statistics, automated scoring, roster management, lineup changes, match results, and league standings.

The application is private and intended for the existing group of approximately 16 friends.

The developer should prioritize data integrity and accurate fantasy scoring over visual features.

---

## 2. Core Development Principles

1. Never destroy or overwrite existing league data during development or migration.
2. Never assume that a player belongs to a particular fantasy team without verifying the existing roster data.
3. Never assume the league has standard fantasy scoring. Import and preserve the actual customized scoring rules.
4. Keep real-world volleyball statistics separate from fantasy scoring calculations.
5. Make the scoring system configurable by the league administrator.
6. Make player statistics and game results update automatically whenever a reliable data source supports it.
7. Do not require the administrator's laptop to remain turned on.
8. Build the application so it can be hosted in the cloud and accessed from phones, tablets, and computers.
9. Keep the application private. Only authorized league members should be able to access their league.
10. Build incrementally, with backups, validation, and tests at every migration stage.

Before writing code, inspect the existing repository and explain the proposed implementation plan. Do not overwrite existing files or make destructive database changes without approval.

---

## 3. Recommended Technology Stack

Use the following architecture unless inspection of the existing project reveals a compelling reason to change it.

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- A modern component library where useful
- Responsive design for desktop and mobile

The interface should feel like a polished fantasy sports application rather than a generic administrative website.

### Database and backend

Use Supabase:

- PostgreSQL database.
- Supabase authentication.
- Row Level Security (RLS).
- Database migrations.
- Server-side functions where appropriate.

### Hosting

Use Vercel for the Next.js application.

Use Supabase for the database and authentication.

Use scheduled server-side jobs or another reliable cloud scheduler for data synchronization.

**The application must continue operating when the administrator's computer is turned off.**

### Development

Use:

- TypeScript for application code.
- SQL migrations for database changes.
- Automated tests for scoring and data migration.
- Environment variables for credentials.
- Git for version control.

Do not commit API keys, passwords, authentication tokens, or private HAR files to the repository.

---

## 4. Existing USportVB Data Investigation

Previous investigation of browser Network HAR files identified several useful data sources.

These findings should be treated as starting points and verified against the actual responses before implementation.

### 4.1 USportVB backend

The previously observed backend host was:

`relevant-benni-volleyball-app-71b883ac.koyeb.app`

The following endpoints were identified:

- `/api/fantasy/league/{id}` — league configuration and team information.
- `/api/fantasy/team/{id}` — individual fantasy team information.
- `/api/fantasy/team/{id}/players` — roster and player statistics.
- `/api/auth/profile` — authenticated profile information.
- `/api/team-rankings` — team rankings.
- `/api/players` — player information and statistics.

The `/api/players` response was approximately 614 KB and contained player information, including names, positions, team IDs, jersey numbers, conference information, and match-related statistics.

The league response appeared to contain 17 team entries. There are approximately 16 actual league managers, so investigate the extra entry rather than assuming it is a real manager.

The application should identify and preserve the correct relationship between:

- League.
- Fantasy manager.
- Fantasy team.
- Player.
- Player's real university team.
- Fantasy roster ownership.

Do not assume the USportVB team ID and real-world volleyball team ID represent the same thing.

### 4.2 Data migration requirements

Investigate the available endpoints and determine whether the existing league can be imported automatically.

Create a migration utility that can:

1. Retrieve league configuration.
2. Retrieve all existing fantasy teams.
3. Retrieve all roster assignments.
4. Retrieve player information.
5. Retrieve customized scoring rules.
6. Retrieve available standings and historical information.
7. Map source IDs to permanent internal IDs.
8. Import the data into the new database.
9. Validate the imported data against the source.
10. Produce an import report.

The migration must be repeatable without duplicating records.

Use stable source identifiers wherever available.

Store the original source ID on imported records.

Use an import process with a preview or dry-run mode before writing data to the production database.

### 4.3 Data validation

After migration, produce a report showing:

- Number of managers imported.
- Number of fantasy teams imported.
- Number of players imported.
- Number of roster assignments imported.
- Number of scoring rules imported.
- Any duplicate records.
- Any players that could not be matched.
- Any teams or ownership assignments that could not be verified.

The administrator must be able to review the report before the new league becomes active.

**Do not silently discard records that fail validation.**

---

## 5. Robots.txt Investigation and Scraping Considerations

A robots.txt file was previously inspected on USportVB.ca.

The following directives were observed:

- `User-agent: *`
- `Allow: /`
- Sitemap: `https://usportvb.ca/sitemap.xml`
- `Crawl-delay: 1`
- Separate Googlebot and Bingbot groups allowing `/`.
- A Slurp group with `Allow: /`, followed by more specific disallow rules for:
  - `/admin/`
  - `/api/`
  - `/_next/`
  - `/private/`
- The Slurp group also listed allowed paths:
  - `/players`
  - `/scores`
  - `/fantasy`
  - `/fantasy/leagues`

Important interpretation:

The more specific disallow rules appeared under the Slurp user-agent group. They should not automatically be interpreted as restrictions applying to every crawler.

The wildcard group allowed `/`, and the Googlebot and Bingbot groups also allowed `/`.

However, robots.txt is not authorization, authentication, or permission to access restricted information.

### Implementation requirements

Before implementing any scraper or automated data collector:

1. Check the current robots.txt file again.
2. Review the website's terms of service and applicable data-use restrictions.
3. Determine whether the relevant endpoints are intended for public access.
4. Do not bypass authentication, paywalls, access controls, rate limits, or technical restrictions.
5. Do not scrape administrative or private pages.
6. Do not collect personal information that is not necessary for the fantasy league.
7. Respect any applicable rate limits and crawl-delay guidance.
8. Prefer an official public data feed or documented API where available.
9. Use cached responses and incremental updates rather than repeatedly downloading entire datasets.

The previously observed robots.txt file is historical evidence, not a guarantee of the site's current policies.

If access to a source is not authorized or its permitted use is unclear, stop and request administrator approval rather than attempting to work around restrictions.

---

## 6. Official Match Data and Box Scores

A separate data source was discovered during investigation of the USportVB scores page.

The scores page used the following URL pattern:

`https://usportvb.ca/scores?date=2026-10-31&conferences=OUA&genders=womens&useLocalTime=true`

A Supabase REST request was observed:

`https://jittmooanbkqvomwyjaf.supabase.co/rest/v1/games?select=*&date=eq.2026-10-31&order=gameTime.asc`

The request returned game records with fields including:

- `id`
- `date`
- `homeTeam`
- `awayTeam`
- `homeScore`
- `awayScore`
- `status`
- `isMens`
- `gameUrl`
- `gameTime`
- `gameTimezone`
- `gameOfDay`

Important observation:

The request returned games from multiple conferences and both genders, even though the browser page was filtered to OUA women's games.

Therefore, the application must independently filter the returned records by the correct conference, gender, season, and date.

Do not assume the endpoint applies all browser filters server-side.

### 6.1 Box score XML

The games response included links to official-looking USports box score XML files.

One example discovered during investigation was:

`https://en.usports.ca/sports/wvball/2026-27/boxscores/20261031_9e9k.xml`

This was a Windsor versus Western women's volleyball match on October 31, 2026.

The match record indicated:

- Western: 3 sets.
- Windsor: 1 set.
- Completed match.

The XML URL was present in the game record, but the previous HAR did not establish that the XML itself had been fetched or fully inspected.

The developer must inspect the XML structure and determine whether it contains the individual player statistics needed by the fantasy scoring engine.

Potential statistics to look for:

- Kills.
- Attack attempts.
- Attack errors.
- Assists.
- Service aces.
- Service errors.
- Digs.
- Solo blocks.
- Block assists.
- Block errors, if available.
- Other relevant volleyball statistics.

Determine how players and teams are identified in the XML and how they map to the player database.

### 6.2 Live match updates

An important requirement is to update fantasy points during matches if the source supports it.

However, the existence of a completed-match XML file does not prove that it updates during a live match.

Investigate:

1. Whether XML files are available before matches finish.
2. Whether the XML changes during live matches.
3. How frequently it is updated.
4. Whether the source permits automated polling.
5. Whether match status and scores update separately from individual player statistics.

If live data is available and permitted, use a reasonable polling interval and avoid unnecessary requests.

If only completed-match data is reliable, automatically update after the match and clearly show the last update time.

Never invent live statistics or display stale data as current.

---

## 7. Player Database

Create a comprehensive player database.

Each player should have fields for:

- Internal player ID.
- Original source player ID.
- First name.
- Last name.
- Full display name.
- University.
- Conference.
- Gender.
- Position.
- Jersey number.
- Active/inactive status.
- Season.
- Source information.
- Last data update.

Where possible, retain player statistics by individual match and season.

A player may appear in multiple seasons, so historical statistics should not be overwritten when a new season begins.

### Player positions

The previously observed roster configuration appeared to include:

- 1 Libero.
- 2 Middles.
- 1 Setter.
- 3 Outside Hitters.
- 1 Utility.
- Additional roster slots that have not yet been verified.

These are preliminary findings only.

Verify the exact roster size and position requirements against the existing league configuration before enforcing any restrictions.

Do not assume every position can be filled interchangeably.

---

## 8. Fantasy League Database Design

Design a normalized relational database.

Suggested tables:

### `leagues`

- id
- name
- season
- conference
- gender
- league_status
- settings
- created_at

### `users`

- id
- email
- display_name
- authentication_id
- role
- created_at

### `fantasy_teams`

- id
- league_id
- owner_user_id
- team_name
- original_source_team_id
- created_at

### `players`

- id
- original_source_player_id
- first_name
- last_name
- display_name
- university
- position
- jersey_number
- conference
- gender
- active

### `roster_assignments`

- id
- fantasy_team_id
- player_id
- acquired_at
- released_at
- source_assignment_id

This table should preserve the current ownership of every drafted player.

### `lineups`

- id
- fantasy_team_id
- match_id
- created_at
- updated_at
- locked_at

### `lineup_players`

- id
- lineup_id
- player_id
- lineup_position
- is_starter
- is_bench

### `matches`

- id
- source_match_id
- date
- start_time
- timezone
- home_team
- away_team
- home_score
- away_score
- status
- source_box_score_url
- last_updated_at

### `player_match_statistics`

- id
- player_id
- match_id
- kills
- attack_attempts
- attack_errors
- assists
- service_aces
- service_errors
- digs
- solo_blocks
- block_assists
- other_statistics
- source_updated_at
- imported_at

### `scoring_rules`

- id
- league_id
- statistic_name
- points_per_stat
- active
- effective_from
- effective_to

### `fantasy_match_points`

- id
- fantasy_team_id
- player_id
- match_id
- statistic_total
- fantasy_points
- scoring_version
- calculated_at

### `league_standings`

Either calculate standings dynamically from completed fantasy match results or maintain a properly synchronized standings table.

Do not maintain two competing sources of truth.

Additional tables may be added for transactions, schedules, audit logs, invitations, notifications, and historical scoring versions.

---

## 9. Fantasy Scoring Engine

The scoring engine is one of the most important parts of the application.

The existing league has customized scoring configured. The new application must import and preserve those actual rules.

A previous investigation identified the following candidate scoring values:

| Statistic | Candidate fantasy value |
|---|---:|
| Aces | +2.0 |
| Digs | +0.5 |
| Kills | +1.0 |
| Errors | -1.0 |
| Assists | +0.3 |
| Attempts | -0.5 |
| Solo blocks | +2.0 |
| Block assists | +0.8 |
| Missed serves | -0.5 |

These values must be treated as provisional until verified against the actual existing league configuration.

Do not assume that this list is complete or that the statistic labels map directly to the official box score fields.

For example, determine whether "errors" means attack errors, service errors, or a combination. Determine whether "attempts" means attack attempts.

The new application should reproduce the existing scoring exactly before any scoring changes are made.

### 9.1 Scoring calculation

The calculation should be:

Fantasy points = sum of (statistic count × scoring value)

For example:

A player with:

- 5 kills at +1.0.
- 10 digs at +0.5.
- 2 aces at +2.0.
- 1 service error at -0.5.

Would receive:

5 + 5 + 4 - 0.5 = 13.5 fantasy points.

This is an example only, not an assertion about an actual player.

### 9.2 Administrator scoring controls

The league administrator must be able to:

- Add scoring categories.
- Remove or disable categories.
- Change point values.
- Use positive or negative values.
- Review the current scoring system.
- Save changes.
- See how a scoring change affects projected results.
- Recalculate fantasy scores when authorized.

Maintain historical scoring versions.

Changing scoring rules should not silently rewrite historical standings.

Provide a clear choice between applying new scoring rules prospectively and recalculating historical results.

### 9.3 Scoring tests

Create automated tests for:

- Each individual scoring category.
- Positive scoring.
- Negative scoring.
- Zero values.
- Missing statistics.
- Duplicate match imports.
- Recalculation after a scoring change.
- Multiple matches for one player.
- Players on different fantasy teams.
- Roster ownership changes, if transactions are supported.

The scoring engine must not count the same statistics twice when a match is imported more than once.

---

## 10. Fantasy Team and Roster Management

Each manager should have their own fantasy team.

Managers should be able to:

- View their entire roster.
- View player positions.
- View individual player statistics.
- View player fantasy points.
- See upcoming matches.
- View completed match performance.
- Set their lineup.
- Make permitted lineup changes.
- View their team's total fantasy score.
- View their team's standing in the league.

The initial imported rosters must remain exactly as they are in the existing league.

The application must not automatically move players between teams.

### Roster controls

The administrator should be able to configure:

- Total roster size.
- Position requirements.
- Starter positions.
- Bench positions.
- Lineup deadlines.
- Whether lineup changes are allowed during a match.
- Whether players can be traded.
- Whether free-agent pickups are permitted.

Do not implement trades, waivers, free agents, or redrafting unless the administrator explicitly enables those features.

### Lineup locking

Allow managers to set their starting lineup before a match.

Provide a configurable lineup-lock deadline.

Once a match starts, apply the configured lock policy consistently.

Store lineup history so the administrator can review who started and when changes were made.

---

## 11. Application Pages and User Interface

The interface should be attractive, simple, and easy to navigate.

Build the following pages.

### 11.1 Login

- Private login.
- Invitation or administrator-controlled account creation.
- Password reset.
- Secure session management.

### 11.2 League Dashboard

Display:

- League name.
- Current season.
- Current standings.
- Latest match results.
- Upcoming matches.
- Recent player performances.
- Fantasy points leaders.
- League announcements, if implemented.

### 11.3 My Team

Display:

- Fantasy team name.
- Manager name.
- Complete roster.
- Player positions.
- Player statistics.
- Fantasy points.
- Upcoming match information.
- Starting lineup and bench.

Allow permitted lineup changes.

### 11.4 Players

Provide a searchable player database.

Filters should include:

- University.
- Position.
- Player name.
- Season.
- Conference.

Display player profiles with season statistics and individual match performances.

### 11.5 Match Center

Display:

- Upcoming matches.
- Live matches, when supported.
- Completed matches.
- Match scores.
- Match status.
- Individual player statistics.
- Fantasy points earned during each match.

Make it clear whether a match is scheduled, live, final, or awaiting statistics.

### 11.6 Standings

Display:

- Rank.
- Fantasy team name.
- Manager.
- Total fantasy points.
- Weekly or matchday performance.
- Win/loss record if the league uses head-to-head scoring.

Verify the existing league's competition format before implementing win/loss logic.

### 11.7 Scoring Rules

Display all scoring categories and their values.

Allow administrator-only editing.

### 11.8 Administrator Dashboard

Provide controls for:

- League settings.
- Manager accounts.
- Fantasy team ownership.
- Player management.
- Roster validation.
- Scoring rules.
- Match imports.
- Manual data corrections.
- Sync status.
- Data import history.
- Audit logs.

---

## 12. Automated Data Synchronization

The application must update without requiring the administrator's laptop to be on.

Build a cloud-based synchronization system.

### Scheduled tasks

Potential tasks include:

- Periodic schedule updates.
- Upcoming match updates.
- Match status updates.
- Live score updates where supported.
- Individual player statistics imports.
- Fantasy point calculations.
- Standings refreshes.

Use the least frequent polling interval that still provides a useful experience and complies with source restrictions.

Do not make unnecessary repeated requests.

### Synchronization workflow

1. Retrieve permitted source data.
2. Validate the response.
3. Identify the match and players.
4. Compare source data with stored data.
5. Insert new records.
6. Update changed records.
7. Recalculate fantasy points when necessary.
8. Update standings.
9. Record the synchronization time.
10. Log any errors.

Use idempotent upserts and stable source IDs.

The system must handle:

- Missing box scores.
- Delayed results.
- Changed match status.
- Corrected statistics.
- Duplicate responses.
- Temporary network failures.
- Source downtime.
- Players whose names or identifiers do not match.

If a statistic changes after an initial import, the fantasy points must be recalculated correctly.

### Sync monitoring

The administrator dashboard should show:

- Last successful synchronization.
- Last attempted synchronization.
- Next scheduled synchronization.
- Number of matches checked.
- Number of records updated.
- Errors and warnings.

Never show an old statistic as though it were freshly updated.

---

## 13. Security and Privacy

This is a private application.

Implement:

- Secure authentication.
- Row Level Security.
- Role-based permissions.
- Server-side authorization.
- Protected administrator routes.
- Secure environment variables.
- Input validation.
- Rate limiting where appropriate.
- Audit logs for sensitive changes.

Roles should include:

**Administrator**
- Full league configuration access.
- Scoring changes.
- Data imports.
- Manager management.
- Roster corrections.

**Manager**
- View league information.
- View their own team.
- Manage their permitted lineup.
- View other teams and standings according to league visibility settings.

Managers must not be able to change another manager's roster, scoring rules, ownership, or account permissions.

Do not store source website passwords or session cookies in the application.

Do not copy authentication tokens from HAR files into source code.

HAR files may contain sensitive information, including email addresses, session credentials, and league passwords. Treat them as private. Do not commit them to Git.

---

## 14. Data Integrity and Backups

Before importing any existing league data:

1. Create a complete database backup.
2. Save a copy of the source data used for migration, with secrets removed.
3. Generate a migration preview.
4. Compare source and destination records.
5. Obtain administrator approval.
6. Run the migration.
7. Produce a post-migration validation report.

The application must support database backups and recovery.

Use audit logs for:

- Roster changes.
- Lineup changes.
- Scoring changes.
- Manager changes.
- Data corrections.
- Manual fantasy point adjustments.

Do not allow ordinary managers to modify historical statistics.

---

## 15. Development Phases

Build the application in the following order.

### Phase 1: Inspect and understand the source

- Inspect the existing project repository.
- Review the available HAR files and extracted data.
- Verify the discovered API endpoints.
- Identify the league ID and team IDs.
- Verify the exact number of managers.
- Verify every roster.
- Verify scoring settings.
- Inspect the player database.
- Inspect the match records.
- Inspect an official box score XML file.
- Determine whether live statistics are available.
- Identify any source access restrictions.

Deliverable: A written source-data report and migration plan.

Do not proceed to production migration until the administrator has reviewed the report.

### Phase 2: Database and migration

- Create the Supabase project.
- Create database schema.
- Configure authentication.
- Configure Row Level Security.
- Build migration scripts.
- Import existing league data into a test database.
- Validate all managers and rosters.
- Verify scoring rules.
- Test duplicate prevention.

Deliverable: A verified copy of the existing league in the new database.

### Phase 3: Scoring engine

- Implement configurable scoring.
- Import existing scoring rules.
- Match box score statistics to scoring categories.
- Write automated tests.
- Compare calculated scores with known existing league results wherever available.

Deliverable: A reliable fantasy scoring engine.

### Phase 4: Main application

Build:

- Login.
- League dashboard.
- My Team.
- Player database.
- Player profiles.
- Match center.
- Standings.
- Scoring rules.
- Administrator dashboard.

Deliverable: A usable private fantasy volleyball application.

### Phase 5: Automated updates

- Build permitted data collectors.
- Build scheduled synchronization.
- Import game schedules.
- Import match scores.
- Import individual player statistics.
- Recalculate fantasy points.
- Refresh standings.
- Add sync monitoring and error handling.

Deliverable: A cloud-hosted application that updates without a local computer running.

### Phase 6: Testing and launch

Test:

- All 16 managers can log in.
- All original teams are preserved.
- Every player is assigned to the correct fantasy team.
- Scoring matches the existing league.
- Lineups work correctly.
- Match results import correctly.
- Fantasy points calculate correctly.
- Standings update correctly.
- Managers cannot change another team's roster.
- Administrator controls work.
- Mobile layouts work.
- Scheduled updates run when the administrator's computer is off.

Only launch once the administrator approves the migration and testing results.

---

## 16. Important User Experience Requirements

The app should be designed for friends who are fantasy sports participants, not developers.

Prioritize:

- Fast loading.
- Clear navigation.
- Easy lineup changes.
- Easy-to-read player statistics.
- Clear match status.
- Attractive standings.
- Mobile-friendly layouts.
- Minimal unnecessary clicks.
- Useful notifications or alerts where appropriate.

Use a visual design inspired by modern fantasy sports applications.

Do not copy another platform's proprietary branding or interface.

The application should have its own name, visual identity, and design.

---

## 17. Future Enhancements

Do not prioritize these features until the core application is working.

Potential later additions:

- Player performance graphs.
- Weekly awards.
- Top performers.
- Manager head-to-head comparisons.
- Historical season archives.
- Match notifications.
- Injury or availability notes, only from appropriate reliable sources.
- League chat.
- Trade proposals.
- Free-agent management.
- Custom league announcements.
- Advanced statistical analysis.

Keep the database architecture flexible enough to support future seasons.

---

## 18. Definition of Success

The project is successful when:

1. All existing league managers can use the new application.
2. All original fantasy teams and rosters are preserved.
3. Existing customized scoring rules are reproduced accurately.
4. Managers can view and manage their permitted lineups.
5. Individual player statistics are available.
6. Fantasy points calculate automatically and accurately.
7. Standings update correctly.
8. Match schedules and results update automatically.
9. Live updates are implemented only if a reliable permitted source supports them.
10. The application runs in the cloud without requiring the administrator's computer.
11. The application is secure and private.
12. No manager has to redraft.

---

## 19. Instructions to Claude Code

You are the lead developer responsible for implementing this project.

Work methodically and do not rush into writing the entire application at once.

Start by inspecting the existing repository and reporting:

- Current project structure.
- Existing technologies.
- Existing code that can be reused.
- Missing components.
- Recommended architecture.
- Required environment variables.
- Proposed database schema.
- Risks and uncertainties.

Then begin Phase 1.

For each phase:

1. Explain what you intend to build.
2. Identify any assumptions.
3. Identify any information you still need.
4. Implement the work.
5. Run tests.
6. Report what was completed.
7. Report any outstanding issues.
8. Wait for approval before destructive or irreversible actions.

Do not invent source data, API responses, player statistics, scoring values, roster positions, or match results.

Where source information is uncertain, explicitly mark it as unverified.

Do not replace existing league data with sample data.

Use sample data only in isolated development or testing environments.

Never expose secrets in logs, screenshots, source code, or reports.

**Most important initial task: Prove that the existing league can be imported accurately, preserving every manager, fantasy team, roster assignment, and scoring rule before building the rest of the application.**

The finished result should be a complete, reliable, private fantasy volleyball platform—not merely a visual prototype.
