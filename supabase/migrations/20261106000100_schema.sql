-- Sideout Fantasy: core schema
-- Design notes (plain English):
--  * Real volleyball data (universities, players, matches, player_match_statistics) is kept
--    separate from fantasy data (leagues, teams, rosters, lineups, matchups, scoring).
--  * Every imported row keeps its original source system + source id, and a unique index on
--    (source_system, source_id) makes imports repeatable without creating duplicates.
--  * Fantasy points are never stored as editable numbers. They are calculated by views from
--    raw stats + the scoring rule set in force + who was in the starting lineup when the
--    match locked. This means there is exactly one source of truth.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'manager');
create type public.match_status as enum ('scheduled', 'live', 'final', 'postponed', 'cancelled');
create type public.matchup_status as enum ('scheduled', 'in_progress', 'final', 'void');
create type public.trade_status as enum (
  'proposed', 'pending_review', 'completed', 'rejected', 'cancelled', 'vetoed', 'failed'
);
create type public.transaction_type as enum ('import', 'add', 'drop', 'trade', 'admin_move');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text not null default '',
  is_site_admin boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- League
-- ---------------------------------------------------------------------------
create table public.leagues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  season_label  text not null,               -- e.g. '2026-27'
  source_year   int,                         -- USportVB labels seasons by ending year (2027)
  conference    text not null,
  gender        text not null check (gender in ('womens', 'mens')),
  status        text not null default 'setup' check (status in ('setup', 'active', 'complete')),
  timezone      text not null default 'America/Toronto',
  -- Validated by the app (src/lib/league/settings.ts). Holds roster slots, lineup lock rules,
  -- free agency / trade switches and playoff configuration.
  settings      jsonb not null default '{}'::jsonb,
  source_system text,
  source_id     text,
  created_at    timestamptz not null default now(),
  unique (source_system, source_id)
);

create table public.league_members (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'manager',
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.matchup_weeks (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues (id) on delete cascade,
  week       int not null check (week > 0),
  starts_on  date not null,
  ends_on    date not null,
  is_playoff boolean not null default false,
  unique (league_id, week),
  check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- Real-world volleyball data
-- ---------------------------------------------------------------------------
create table public.universities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text,
  conference    text,
  gender        text,
  source_system text not null,
  source_id     text not null,
  created_at    timestamptz not null default now(),
  unique (source_system, source_id)
);

create table public.players (
  id                uuid primary key default gen_random_uuid(),
  first_name        text not null,
  last_name         text not null,
  display_name      text not null,
  university_id     uuid references public.universities (id),
  conference        text,
  gender            text not null check (gender in ('womens', 'mens')),
  position_label    text,                                -- raw label, e.g. 'OH/L'
  positions         text[] not null default '{}',        -- eligibility, e.g. {OH,L}
  jersey_number     int,
  active            boolean not null default true,
  -- Possible duplicate of another record in the source (flagged, never auto-merged).
  duplicate_of      uuid references public.players (id),
  source_system     text not null,
  source_id         text not null,
  source_updated_at timestamptz,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  unique (source_system, source_id)
);
create index players_university_idx on public.players (university_id);
create index players_name_idx on public.players (lower(display_name));

create table public.matches (
  id                  uuid primary key default gen_random_uuid(),
  season_label        text not null,
  match_date          date not null,                 -- local (league) calendar date
  start_time          timestamptz,                   -- null when the source has no start time
  -- When lineups lock for players in this match. Always set: start_time if known, otherwise
  -- the league's fallback lock time on match_date. Admins can override.
  lock_at             timestamptz not null,
  lock_source         text not null default 'fallback' check (lock_source in ('source', 'fallback', 'admin')),
  home_university_id  uuid references public.universities (id),
  away_university_id  uuid references public.universities (id),
  home_away_known     boolean not null default false,
  home_sets           int,
  away_sets           int,
  status              public.match_status not null default 'scheduled',
  stats_available     boolean not null default false,
  counts_for_fantasy  boolean not null default true,
  source_box_score_url text,
  source_system       text not null,
  source_id           text not null,
  last_updated_at     timestamptz not null default now(),   -- last time data actually changed
  last_checked_at     timestamptz,                           -- last time the source was checked
  created_at          timestamptz not null default now(),
  unique (source_system, source_id),
  check (home_university_id is distinct from away_university_id)
);
create index matches_date_idx on public.matches (match_date);
create index matches_home_idx on public.matches (home_university_id, match_date);
create index matches_away_idx on public.matches (away_university_id, match_date);

create table public.player_match_statistics (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.players (id),
  match_id          uuid not null references public.matches (id),
  university_id     uuid references public.universities (id),
  kills             int not null default 0,
  attack_errors     int not null default 0,
  attack_attempts   int not null default 0,
  assists           int not null default 0,
  service_aces      int not null default 0,
  service_errors    int not null default 0,
  digs              int not null default 0,
  solo_blocks       int not null default 0,
  block_assists     int not null default 0,
  sets_played       int,
  other_statistics  jsonb not null default '{}'::jsonb,
  source_system     text not null,
  source_hash       text not null,          -- detects corrected stats from the source
  source_updated_at timestamptz,
  imported_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One row per player per match: re-importing a match updates instead of double counting.
  unique (player_id, match_id)
);
create index pms_match_idx on public.player_match_statistics (match_id);

-- ---------------------------------------------------------------------------
-- Fantasy teams, rosters, lineups
-- ---------------------------------------------------------------------------
create table public.fantasy_teams (
  id                   uuid primary key default gen_random_uuid(),
  league_id            uuid not null references public.leagues (id) on delete cascade,
  name                 text not null,
  owner_user_id        uuid references auth.users (id),
  manager_display_name text,               -- shown until the manager claims the team
  active               boolean not null default true,
  source_system        text,
  source_id            text,
  source_owner_id      text,               -- the manager id in the source system
  created_at           timestamptz not null default now(),
  unique (league_id, source_system, source_id)
);
create unique index fantasy_teams_owner_uq on public.fantasy_teams (league_id, owner_user_id)
  where owner_user_id is not null;

-- Admin-only: which email address may claim which team (kept out of fantasy_teams so
-- managers cannot read each other's email addresses).
create table public.team_invitations (
  fantasy_team_id uuid primary key references public.fantasy_teams (id) on delete cascade,
  email           text not null,
  display_name    text,
  invited_at      timestamptz not null default now(),
  invited_by      uuid,
  claimed_at      timestamptz
);
create index team_invitations_email_idx on public.team_invitations (lower(email));

create table public.roster_assignments (
  id                   uuid primary key default gen_random_uuid(),
  league_id            uuid not null references public.leagues (id) on delete cascade,
  fantasy_team_id      uuid not null references public.fantasy_teams (id),
  player_id            uuid not null references public.players (id),
  acquired_at          timestamptz not null default now(),
  released_at          timestamptz,
  acquisition_type     public.transaction_type not null,
  source_assignment_id text,
  created_at           timestamptz not null default now(),
  check (released_at is null or released_at >= acquired_at)
);
-- A player can only be on one fantasy team in a league at a time.
create unique index roster_one_team_per_player
  on public.roster_assignments (league_id, player_id) where released_at is null;
create index roster_team_idx on public.roster_assignments (fantasy_team_id) where released_at is null;

-- Lineup history: which slot a rostered player occupied, and from when to when.
-- Slot names: S, OH1..OHn, M1..Mn, L, UTIL, BENCH (generated from league settings).
create table public.lineup_entries (
  id                   uuid primary key default gen_random_uuid(),
  roster_assignment_id uuid not null references public.roster_assignments (id),
  fantasy_team_id      uuid not null references public.fantasy_teams (id),
  player_id            uuid not null references public.players (id),
  slot                 text not null check (slot ~ '^(BENCH|UTIL[0-9]*|S[0-9]*|L[0-9]*|OH[0-9]*|M[0-9]*)$'),
  valid_from           timestamptz not null default now(),
  valid_to             timestamptz,
  changed_by           uuid,
  check (valid_to is null or valid_to >= valid_from)
);
create unique index lineup_one_open_entry
  on public.lineup_entries (roster_assignment_id) where valid_to is null;
create unique index lineup_one_player_per_slot
  on public.lineup_entries (fantasy_team_id, slot) where valid_to is null and slot <> 'BENCH';
create index lineup_team_idx on public.lineup_entries (fantasy_team_id, valid_from);

-- ---------------------------------------------------------------------------
-- Scoring (versioned)
-- ---------------------------------------------------------------------------
create table public.scoring_rule_sets (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references public.leagues (id) on delete cascade,
  version             int not null,
  -- Applies to matches in this matchup week and later, until a newer set takes over.
  -- "Prospective" changes use a future week; "recalculate history" uses week 1.
  effective_from_week int not null default 1,
  note                text,
  source_system       text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (league_id, version)
);

create table public.scoring_rules (
  id          uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.scoring_rule_sets (id) on delete cascade,
  stat_key    text not null,
  label       text not null,
  points      numeric(8, 3) not null,
  active      boolean not null default true,
  unique (rule_set_id, stat_key)
);

-- ---------------------------------------------------------------------------
-- Head-to-head matchups
-- ---------------------------------------------------------------------------
create table public.matchups (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references public.leagues (id) on delete cascade,
  week                int not null,
  home_team_id        uuid not null references public.fantasy_teams (id),
  away_team_id        uuid not null references public.fantasy_teams (id),
  status              public.matchup_status not null default 'scheduled',
  -- 'calculated': scores come from v_team_week_points. 'imported': scores were final in
  -- the previous platform and are kept as they were.
  score_source        text not null default 'calculated' check (score_source in ('calculated', 'imported')),
  imported_home_score numeric(10, 2),
  imported_away_score numeric(10, 2),
  playoff_round       int,
  source_system       text,
  source_id           text,
  created_at          timestamptz not null default now(),
  finalized_at        timestamptz,
  check (home_team_id <> away_team_id),
  unique (league_id, week, home_team_id),
  unique (league_id, week, away_team_id)
);

-- ---------------------------------------------------------------------------
-- Transactions: free agency and trades
-- ---------------------------------------------------------------------------
create table public.trades (
  id                uuid primary key default gen_random_uuid(),
  league_id         uuid not null references public.leagues (id) on delete cascade,
  proposing_team_id uuid not null references public.fantasy_teams (id),
  receiving_team_id uuid not null references public.fantasy_teams (id),
  status            public.trade_status not null default 'proposed',
  message           text,
  status_reason     text,
  proposed_by       uuid,
  created_at        timestamptz not null default now(),
  responded_at      timestamptz,
  processed_at      timestamptz,
  check (proposing_team_id <> receiving_team_id)
);

create table public.trade_items (
  id           uuid primary key default gen_random_uuid(),
  trade_id     uuid not null references public.trades (id) on delete cascade,
  player_id    uuid not null references public.players (id),
  from_team_id uuid not null references public.fantasy_teams (id),
  to_team_id   uuid not null references public.fantasy_teams (id),
  unique (trade_id, player_id)
);

create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues (id) on delete cascade,
  type            public.transaction_type not null,
  fantasy_team_id uuid references public.fantasy_teams (id),
  player_id       uuid references public.players (id),
  trade_id        uuid references public.trades (id),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  details         jsonb not null default '{}'::jsonb
);
create index transactions_league_idx on public.transactions (league_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Operations: audit, imports, sync, snapshots
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  league_id  uuid references public.leagues (id) on delete cascade,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb
);
create index audit_league_idx on public.audit_log (league_id, at desc);

create table public.source_snapshots (
  id          uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  source      text not null,
  sha256      text not null unique,
  payload     jsonb not null           -- secrets (league password, emails) removed before saving
);

create table public.import_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  mode        text not null check (mode in ('dry_run', 'apply')),
  source      text not null,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  snapshot_id uuid references public.source_snapshots (id),
  report      jsonb,
  created_by  text
);

create table public.sync_runs (
  id               uuid primary key default gen_random_uuid(),
  job              text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  matches_checked  int not null default 0,
  records_inserted int not null default 0,
  records_updated  int not null default 0,
  warnings         jsonb not null default '[]'::jsonb,
  error            text,
  next_run_hint    timestamptz
);
create index sync_runs_started_idx on public.sync_runs (started_at desc);
