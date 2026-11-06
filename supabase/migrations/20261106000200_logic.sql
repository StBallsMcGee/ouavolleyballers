-- Sideout Fantasy: helper functions, scoring views, permissions and league actions.
--
-- Security model (plain English):
--  * Browsers can only READ data, and only for leagues they belong to (Row Level Security).
--  * Every change a manager or admin makes goes through one of the functions below. Each
--    function checks who is calling, validates the change, applies it in one database
--    transaction and writes an audit-log entry. Nothing can be half-applied.
--  * Background jobs (import, sync) connect with the database owner role and are not
--    restricted by these rules.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_site_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_site_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_league_member(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_site_admin() or exists (
    select 1 from public.league_members where league_id = p_league and user_id = auth.uid());
$$;

create or replace function public.is_league_admin(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_site_admin() or exists (
    select 1 from public.league_members
    where league_id = p_league and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_any_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_site_admin() or exists (
    select 1 from public.league_members where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.shares_league_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or public.is_site_admin() or exists (
    select 1 from public.league_members a join public.league_members b using (league_id)
    where a.user_id = auth.uid() and b.user_id = p_user);
$$;

create or replace function public.league_local_date(p_league uuid, p_at timestamptz default now())
returns date language sql stable set search_path = public as $$
  select (p_at at time zone (select timezone from public.leagues where id = p_league))::date;
$$;

-- The matchup week a date falls in (null during breaks).
create or replace function public.league_week_for_date(p_league uuid, p_date date) returns int
language sql stable set search_path = public as $$
  select week from public.matchup_weeks
  where league_id = p_league and p_date between starts_on and ends_on;
$$;

-- The "current" week for deadlines: the week containing today, or the most recent one started.
create or replace function public.league_current_week(p_league uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(
    public.league_week_for_date(p_league, public.league_local_date(p_league)),
    (select max(week) from public.matchup_weeks
      where league_id = p_league and starts_on <= public.league_local_date(p_league)),
    0);
$$;

create or replace function public.slot_base(p_slot text) returns text
language sql immutable as $$ select regexp_replace(p_slot, '[0-9]+$', ''); $$;

-- Starting slots generated from league settings, e.g. {S, OH1, OH2, OH3, M1, M2, L, UTIL}.
create or replace function public.league_starting_slots(p_league uuid) returns text[]
language sql stable set search_path = public as $$
  with r as (select settings -> 'roster' as roster from public.leagues where id = p_league),
  pos as (
    select p.code, p.ord, coalesce((r.roster ->> p.code)::int, 0) as n
    from r, (values ('S', 1), ('OH', 2), ('M', 3), ('L', 4), ('UTIL', 5)) as p(code, ord))
  select coalesce(array_agg(case when n = 1 then code else code || i end order by ord, i), '{}')
  from pos, generate_series(1, greatest(n, 0)) as i
  where n > 0;
$$;

create or replace function public.league_roster_limit(p_league uuid) returns int
language sql stable set search_path = public as $$
  select coalesce((settings -> 'roster' ->> 'TOTAL')::int, 0) from public.leagues where id = p_league;
$$;

create or replace function public.player_eligible_for_slot(p_positions text[], p_slot text)
returns boolean language sql immutable as $$
  select case public.slot_base(p_slot)
    when 'BENCH' then true
    when 'UTIL' then true
    else public.slot_base(p_slot) = any (coalesce(p_positions, '{}'))
  end;
$$;

-- A player is locked once their university's match on the current local day has reached its
-- lock time. They stay locked for the rest of that day (player-by-player, day-by-day).
create or replace function public.player_is_locked(p_league uuid, p_player uuid, p_at timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
    from public.players pl
    join public.matches m
      on pl.university_id in (m.home_university_id, m.away_university_id)
    where pl.id = p_player
      and m.match_date = public.league_local_date(p_league, p_at)
      and m.lock_at <= p_at
      and m.status not in ('cancelled', 'postponed'));
$$;

create or replace function public.write_audit(
  p_league uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, league_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_league, p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- Serialises all roster-changing actions inside one league, so two managers can never
-- claim the same free agent at the same instant.
create or replace function public.lock_league(p_league uuid) returns void
language sql as $$ select pg_advisory_xact_lock(hashtext('league:' || p_league::text)); $$;

-- ---------------------------------------------------------------------------
-- New users get a profile row automatically
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Scoring views (the single source of truth for points, results and standings)
-- ---------------------------------------------------------------------------
create or replace function public.stat_value(s public.player_match_statistics, k text)
returns numeric language sql immutable as $$
  select case k
    when 'kills' then s.kills
    when 'attack_errors' then s.attack_errors
    when 'attack_attempts' then s.attack_attempts
    when 'assists' then s.assists
    when 'service_aces' then s.service_aces
    when 'service_errors' then s.service_errors
    when 'digs' then s.digs
    when 'solo_blocks' then s.solo_blocks
    when 'block_assists' then s.block_assists
    else coalesce((s.other_statistics ->> k)::numeric, 0)
  end::numeric;
$$;

-- Which league week each match belongs to.
create view public.v_match_league_weeks with (security_invoker = true) as
select m.id as match_id, w.league_id, w.week, w.is_playoff
from public.matches m
join public.matchup_weeks w on m.match_date between w.starts_on and w.ends_on
where m.counts_for_fantasy and m.status <> 'cancelled';

-- Fantasy points for every player in every match, using the rule set in force for that week.
create view public.v_player_match_points with (security_invoker = true) as
select s.player_id, s.match_id, mw.league_id, mw.week,
       rs.id as rule_set_id, rs.version as scoring_version,
       coalesce(sum(r.points * public.stat_value(s, r.stat_key)), 0)::numeric(10, 2) as points
from public.player_match_statistics s
join public.v_match_league_weeks mw on mw.match_id = s.match_id
join lateral (
  select x.id, x.version from public.scoring_rule_sets x
  where x.league_id = mw.league_id and x.effective_from_week <= mw.week
  order by x.effective_from_week desc, x.version desc limit 1) rs on true
left join public.scoring_rules r on r.rule_set_id = rs.id and r.active
group by s.player_id, s.match_id, mw.league_id, mw.week, rs.id, rs.version;

-- Points credited to a fantasy team: the player must have been on the team AND in the slot
-- recorded at the moment the match locked. Bench players are shown but not counted.
create view public.v_team_player_match_points with (security_invoker = true) as
select pmp.league_id, ra.fantasy_team_id, pmp.player_id, pmp.match_id, pmp.week,
       le.slot, (le.slot <> 'BENCH') as counted, pmp.points, pmp.scoring_version
from public.v_player_match_points pmp
join public.matches m on m.id = pmp.match_id
join public.roster_assignments ra
  on ra.league_id = pmp.league_id and ra.player_id = pmp.player_id
 and ra.acquired_at <= m.lock_at and (ra.released_at is null or ra.released_at > m.lock_at)
join public.lineup_entries le
  on le.roster_assignment_id = ra.id
 and le.valid_from <= m.lock_at and (le.valid_to is null or le.valid_to > m.lock_at);

create view public.v_team_week_points with (security_invoker = true) as
select league_id, fantasy_team_id, week,
       coalesce(sum(points) filter (where counted), 0)::numeric(10, 2) as points,
       coalesce(sum(points) filter (where not counted), 0)::numeric(10, 2) as bench_points
from public.v_team_player_match_points
group by league_id, fantasy_team_id, week;

create view public.v_matchup_scores with (security_invoker = true) as
select mu.id, mu.league_id, mu.week, mu.home_team_id, mu.away_team_id, mu.status,
       mu.score_source, mu.playoff_round, mu.finalized_at,
       sc.home_score, sc.away_score,
       case when mu.status = 'final' and sc.home_score > sc.away_score then mu.home_team_id
            when mu.status = 'final' and sc.away_score > sc.home_score then mu.away_team_id end as winner_team_id,
       (mu.status = 'final' and sc.home_score = sc.away_score) as is_tie
from public.matchups mu
cross join lateral (
  select
    case when mu.score_source = 'imported' then coalesce(mu.imported_home_score, 0)
         else coalesce((select points from public.v_team_week_points t
                        where t.fantasy_team_id = mu.home_team_id and t.week = mu.week), 0) end::numeric(10, 2) as home_score,
    case when mu.score_source = 'imported' then coalesce(mu.imported_away_score, 0)
         else coalesce((select points from public.v_team_week_points t
                        where t.fantasy_team_id = mu.away_team_id and t.week = mu.week), 0) end::numeric(10, 2) as away_score
) sc;

-- Regular-season standings, derived only from final matchups.
create view public.v_standings with (security_invoker = true) as
with results as (
  select league_id, home_team_id as team_id, home_score as pf, away_score as pa
  from public.v_matchup_scores where status = 'final' and playoff_round is null
  union all
  select league_id, away_team_id, away_score, home_score
  from public.v_matchup_scores where status = 'final' and playoff_round is null
), agg as (
  select t.league_id, t.id as fantasy_team_id, t.name,
         count(r.team_id) filter (where r.pf > r.pa)::int as wins,
         count(r.team_id) filter (where r.pf < r.pa)::int as losses,
         count(r.team_id) filter (where r.pf = r.pa)::int as ties,
         count(r.team_id)::int as games,
         coalesce(sum(r.pf), 0)::numeric(10, 2) as points_for,
         coalesce(sum(r.pa), 0)::numeric(10, 2) as points_against
  from public.fantasy_teams t
  left join results r on r.team_id = t.id
  where t.active
  group by t.league_id, t.id, t.name)
select agg.*,
       case when games = 0 then 0 else round((wins + 0.5 * ties) / games::numeric, 4) end as win_pct,
       rank() over (partition by league_id
                    order by case when games = 0 then 0 else (wins + 0.5 * ties) / games::numeric end desc,
                             points_for desc) as rank
from agg;

-- ---------------------------------------------------------------------------
-- Permissions: read-only for signed-in league members, nothing for anonymous visitors
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.matchup_weeks enable row level security;
alter table public.universities enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.player_match_statistics enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.team_invitations enable row level security;
alter table public.roster_assignments enable row level security;
alter table public.lineup_entries enable row level security;
alter table public.scoring_rule_sets enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.matchups enable row level security;
alter table public.trades enable row level security;
alter table public.trade_items enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_log enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.import_runs enable row level security;
alter table public.sync_runs enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (public.shares_league_with(id));
create policy leagues_read on public.leagues for select to authenticated
  using (public.is_league_member(id));
create policy league_members_read on public.league_members for select to authenticated
  using (public.is_league_member(league_id));
create policy weeks_read on public.matchup_weeks for select to authenticated
  using (public.is_league_member(league_id));
create policy universities_read on public.universities for select to authenticated using (true);
create policy players_read on public.players for select to authenticated using (true);
create policy matches_read on public.matches for select to authenticated using (true);
create policy stats_read on public.player_match_statistics for select to authenticated using (true);
create policy teams_read on public.fantasy_teams for select to authenticated
  using (public.is_league_member(league_id));
create policy invitations_read on public.team_invitations for select to authenticated
  using (exists (select 1 from public.fantasy_teams t
                 where t.id = fantasy_team_id and public.is_league_admin(t.league_id)));
create policy roster_read on public.roster_assignments for select to authenticated
  using (public.is_league_member(league_id));
create policy lineup_read on public.lineup_entries for select to authenticated
  using (exists (select 1 from public.fantasy_teams t
                 where t.id = fantasy_team_id and public.is_league_member(t.league_id)));
create policy rule_sets_read on public.scoring_rule_sets for select to authenticated
  using (public.is_league_member(league_id));
create policy rules_read on public.scoring_rules for select to authenticated
  using (exists (select 1 from public.scoring_rule_sets s
                 where s.id = rule_set_id and public.is_league_member(s.league_id)));
create policy matchups_read on public.matchups for select to authenticated
  using (public.is_league_member(league_id));
create policy trades_read on public.trades for select to authenticated
  using (public.is_league_member(league_id));
create policy trade_items_read on public.trade_items for select to authenticated
  using (exists (select 1 from public.trades t
                 where t.id = trade_id and public.is_league_member(t.league_id)));
create policy transactions_read on public.transactions for select to authenticated
  using (public.is_league_member(league_id));
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_league_admin(league_id));
create policy snapshots_read on public.source_snapshots for select to authenticated
  using (public.is_any_admin());
create policy import_runs_read on public.import_runs for select to authenticated
  using (public.is_any_admin());
create policy sync_runs_read on public.sync_runs for select to authenticated
  using (public.is_any_admin());

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Caller checks
-- ---------------------------------------------------------------------------
create or replace function public.require_user() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  return auth.uid();
end;
$$;

-- Returns the team if the caller manages it (or is a league admin); otherwise raises.
create or replace function public.require_team_manager(p_team uuid)
returns public.fantasy_teams language plpgsql stable security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  perform public.require_user();
  select * into t from public.fantasy_teams where id = p_team;
  if not found or not t.active then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if t.owner_user_id is distinct from auth.uid() and not public.is_league_admin(t.league_id) then
    raise exception 'You can only manage your own team.' using errcode = '42501';
  end if;
  return t;
end;
$$;

create or replace function public.require_league_admin(p_league uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_user();
  if not public.is_league_admin(p_league) then
    raise exception 'Only the league administrator can do this.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lineups
-- ---------------------------------------------------------------------------
-- p_lineup: [{"player_id": "...", "slot": "OH1"}, ...] covering every rostered player once.
create or replace function public.set_lineup(p_team uuid, p_lineup jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  slots text[];
  rec record;
  new_slot text;
  roster_count int;
  changed uuid[] := '{}';
  before_state jsonb;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
  slots := public.league_starting_slots(t.league_id);

  if jsonb_typeof(p_lineup) <> 'array' then
    raise exception 'Lineup must be a list.';
  end if;

  select count(*) into roster_count from public.roster_assignments
   where fantasy_team_id = p_team and released_at is null;

  if jsonb_array_length(p_lineup) <> roster_count
     or (select count(distinct e ->> 'player_id') from jsonb_array_elements(p_lineup) e) <> roster_count then
    raise exception 'The lineup must list every player on your roster exactly once.';
  end if;

  if exists (select e ->> 'slot' from jsonb_array_elements(p_lineup) e
             where e ->> 'slot' <> 'BENCH' group by e ->> 'slot' having count(*) > 1) then
    raise exception 'Each starting slot can only hold one player.';
  end if;

  select jsonb_agg(jsonb_build_object('player_id', le.player_id, 'slot', le.slot)) into before_state
    from public.lineup_entries le where le.fantasy_team_id = p_team and le.valid_to is null;

  for rec in
    select ra.id as ra_id, ra.player_id, pl.positions, pl.display_name, le.slot as cur_slot
    from public.roster_assignments ra
    join public.players pl on pl.id = ra.player_id
    left join public.lineup_entries le on le.roster_assignment_id = ra.id and le.valid_to is null
    where ra.fantasy_team_id = p_team and ra.released_at is null
  loop
    select e ->> 'slot' into new_slot from jsonb_array_elements(p_lineup) e
     where (e ->> 'player_id')::uuid = rec.player_id;
    if new_slot is null then
      raise exception 'The lineup must list every player on your roster exactly once.';
    end if;
    if new_slot <> 'BENCH' and not (new_slot = any (slots)) then
      raise exception 'Slot % does not exist in this league.', new_slot;
    end if;
    if not public.player_eligible_for_slot(rec.positions, new_slot) then
      raise exception '% is not eligible for the % slot.', rec.display_name, new_slot;
    end if;
    if new_slot is distinct from rec.cur_slot then
      if public.player_is_locked(t.league_id, rec.player_id) then
        raise exception '% is locked because their match today has started.', rec.display_name;
      end if;
      changed := changed || rec.ra_id;
    end if;
  end loop;

  if array_length(changed, 1) is null then
    return;
  end if;

  update public.lineup_entries set valid_to = now()
   where roster_assignment_id = any (changed) and valid_to is null;

  insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, changed_by)
  select ra.id, p_team, ra.player_id,
         (select e ->> 'slot' from jsonb_array_elements(p_lineup) e where (e ->> 'player_id')::uuid = ra.player_id),
         auth.uid()
  from public.roster_assignments ra where ra.id = any (changed);

  perform public.write_audit(t.league_id, 'lineup.set', 'fantasy_team', p_team::text, before_state, p_lineup);
end;
$$;

-- ---------------------------------------------------------------------------
-- Free agency
-- ---------------------------------------------------------------------------
create or replace function public.internal_release_player(p_team uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ra_id uuid;
begin
  select id into ra_id from public.roster_assignments
   where fantasy_team_id = p_team and player_id = p_player and released_at is null;
  if ra_id is null then
    raise exception 'That player is not on this roster.';
  end if;
  update public.lineup_entries set valid_to = now() where roster_assignment_id = ra_id and valid_to is null;
  update public.roster_assignments set released_at = now() where id = ra_id;
end;
$$;

create or replace function public.internal_assign_player(
  p_league uuid, p_team uuid, p_player uuid, p_type public.transaction_type)
returns void language plpgsql security definer set search_path = public as $$
declare ra_id uuid;
begin
  if exists (select 1 from public.roster_assignments
             where league_id = p_league and player_id = p_player and released_at is null) then
    raise exception 'That player is already on a team in this league.';
  end if;
  insert into public.roster_assignments (league_id, fantasy_team_id, player_id, acquisition_type)
  values (p_league, p_team, p_player, p_type) returning id into ra_id;
  -- New arrivals always start on the bench; the manager decides when to start them.
  insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, changed_by)
  values (ra_id, p_team, p_player, 'BENCH', auth.uid());
end;
$$;

create or replace function public.team_roster_count(p_team uuid) returns int
language sql stable set search_path = public as $$
  select count(*)::int from public.roster_assignments where fantasy_team_id = p_team and released_at is null;
$$;

-- Add a free agent, drop a player, or both at once (p_add / p_drop may be null).
create or replace function public.add_drop(p_team uuid, p_add uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  lg public.leagues;
  pl public.players;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
  select * into lg from public.leagues where id = t.league_id;

  if p_add is null and p_drop is null then
    raise exception 'Choose a player to add or drop.';
  end if;
  if coalesce((lg.settings -> 'freeAgency' ->> 'enabled')::boolean, false) is not true
     and not public.is_league_admin(lg.id) then
    raise exception 'Free agency is currently closed in this league.';
  end if;

  if p_drop is not null then
    perform public.internal_release_player(p_team, p_drop);
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by)
    values (lg.id, 'drop', p_team, p_drop, auth.uid());
  end if;

  if p_add is not null then
    select * into pl from public.players where id = p_add;
    if not found then
      raise exception 'Player not found.';
    end if;
    if pl.gender <> lg.gender or pl.conference is distinct from lg.conference then
      raise exception '% is not eligible for this league.', pl.display_name;
    end if;
    if pl.duplicate_of is not null then
      raise exception 'This is a duplicate player record. Add % using the main record.', pl.display_name;
    end if;
    if not pl.active then
      raise exception '% is not on an active roster.', pl.display_name;
    end if;
    if public.team_roster_count(p_team) >= public.league_roster_limit(lg.id) then
      raise exception 'Your roster is full (% players). Drop a player to make room.', public.league_roster_limit(lg.id);
    end if;
    perform public.internal_assign_player(lg.id, p_team, p_add, 'add');
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by)
    values (lg.id, 'add', p_team, p_add, auth.uid());
  end if;

  perform public.write_audit(lg.id, 'roster.add_drop', 'fantasy_team', p_team::text, null,
    jsonb_build_object('add', p_add, 'drop', p_drop));
end;
$$;

-- ---------------------------------------------------------------------------
-- Trades
-- ---------------------------------------------------------------------------
create or replace function public.internal_validate_trade(p_trade uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  tr public.trades;
  bad record;
  limit_n int;
  from_out int; from_in int; to_out int; to_in int;
begin
  select * into tr from public.trades where id = p_trade;
  for bad in
    select ti.player_id, pl.display_name from public.trade_items ti
    join public.players pl on pl.id = ti.player_id
    where ti.trade_id = p_trade and not exists (
      select 1 from public.roster_assignments ra
      where ra.player_id = ti.player_id and ra.fantasy_team_id = ti.from_team_id and ra.released_at is null)
  loop
    return bad.display_name || ' is no longer on the expected team.';
  end loop;

  limit_n := public.league_roster_limit(tr.league_id);
  select count(*) filter (where from_team_id = tr.proposing_team_id),
         count(*) filter (where to_team_id = tr.proposing_team_id)
    into from_out, from_in from public.trade_items where trade_id = p_trade;
  to_out := from_in; to_in := from_out;
  if public.team_roster_count(tr.proposing_team_id) - from_out + from_in > limit_n then
    return 'The proposing team would exceed the roster limit of ' || limit_n || '.';
  end if;
  if public.team_roster_count(tr.receiving_team_id) - to_out + to_in > limit_n then
    return 'The receiving team would exceed the roster limit of ' || limit_n || '.';
  end if;
  return null;
end;
$$;

create or replace function public.internal_execute_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tr public.trades;
  problem text;
  item record;
begin
  select * into tr from public.trades where id = p_trade for update;
  problem := public.internal_validate_trade(p_trade);
  if problem is not null then
    update public.trades set status = 'failed', status_reason = problem, processed_at = now() where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.failed', 'trade', p_trade::text, null,
      jsonb_build_object('reason', problem));
    return;
  end if;

  for item in select * from public.trade_items where trade_id = p_trade loop
    perform public.internal_release_player(item.from_team_id, item.player_id);
  end loop;
  for item in select * from public.trade_items where trade_id = p_trade loop
    perform public.internal_assign_player(tr.league_id, item.to_team_id, item.player_id, 'trade');
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, trade_id, created_by, details)
    values (tr.league_id, 'trade', item.to_team_id, item.player_id, p_trade, auth.uid(),
            jsonb_build_object('from_team_id', item.from_team_id));
  end loop;

  update public.trades set status = 'completed', processed_at = now() where id = p_trade;

  -- Any other open offer that involves these players can no longer happen.
  update public.trades o set status = 'failed', processed_at = now(),
         status_reason = 'A player in this offer was traded in another deal.'
   where o.league_id = tr.league_id and o.id <> p_trade and o.status in ('proposed', 'pending_review')
     and exists (select 1 from public.trade_items a join public.trade_items b on a.player_id = b.player_id
                 where a.trade_id = o.id and b.trade_id = p_trade);

  perform public.write_audit(tr.league_id, 'trade.completed', 'trade', p_trade::text, null,
    (select jsonb_agg(to_jsonb(ti)) from public.trade_items ti where ti.trade_id = p_trade));
end;
$$;

create or replace function public.propose_trade(
  p_from_team uuid, p_to_team uuid, p_give uuid[], p_receive uuid[], p_message text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  other public.fantasy_teams;
  lg public.leagues;
  trade_id uuid;
  problem text;
  deadline int;
begin
  t := public.require_team_manager(p_from_team);
  perform public.lock_league(t.league_id);
  select * into other from public.fantasy_teams where id = p_to_team;
  if not found or other.league_id <> t.league_id or not other.active or other.id = t.id then
    raise exception 'Choose another team in your league.';
  end if;
  select * into lg from public.leagues where id = t.league_id;
  if coalesce((lg.settings -> 'trades' ->> 'enabled')::boolean, false) is not true then
    raise exception 'Trading is currently closed in this league.';
  end if;
  deadline := (lg.settings -> 'trades' ->> 'deadlineWeek')::int;
  if deadline is not null and public.league_current_week(lg.id) > deadline then
    raise exception 'The trade deadline (week %) has passed.', deadline;
  end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_receive, 1), 0) = 0 then
    raise exception 'A trade must include at least one player.';
  end if;
  if exists (select unnest(coalesce(p_give, '{}')) intersect select unnest(coalesce(p_receive, '{}'))) then
    raise exception 'A player cannot be on both sides of a trade.';
  end if;

  insert into public.trades (league_id, proposing_team_id, receiving_team_id, message, proposed_by)
  values (t.league_id, t.id, other.id, nullif(trim(p_message), ''), auth.uid())
  returning id into trade_id;

  insert into public.trade_items (trade_id, player_id, from_team_id, to_team_id)
  select trade_id, p, t.id, other.id from unnest(coalesce(p_give, '{}')) p
  union all
  select trade_id, p, other.id, t.id from unnest(coalesce(p_receive, '{}')) p;

  problem := public.internal_validate_trade(trade_id);
  if problem is not null then
    raise exception '%', problem;
  end if;

  perform public.write_audit(t.league_id, 'trade.proposed', 'trade', trade_id::text, null,
    jsonb_build_object('give', p_give, 'receive', p_receive, 'to_team', p_to_team));
  return trade_id;
end;
$$;

create or replace function public.respond_trade(p_trade uuid, p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path = public as $$
declare
  tr public.trades;
  lg public.leagues;
begin
  select * into tr from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform public.require_team_manager(tr.receiving_team_id);
  perform public.lock_league(tr.league_id);
  select * into tr from public.trades where id = p_trade for update;
  if tr.status <> 'proposed' then
    raise exception 'This trade is no longer open.';
  end if;
  select * into lg from public.leagues where id = tr.league_id;

  if not p_accept then
    update public.trades set status = 'rejected', responded_at = now() where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.rejected', 'trade', p_trade::text, null, null);
    return 'rejected';
  end if;

  update public.trades set responded_at = now() where id = p_trade;
  if coalesce(lg.settings -> 'trades' ->> 'review', 'none') = 'commissioner' then
    update public.trades set status = 'pending_review' where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.accepted', 'trade', p_trade::text, null, null);
    return 'pending_review';
  end if;

  perform public.internal_execute_trade(p_trade);
  return (select status from public.trades where id = p_trade);
end;
$$;

create or replace function public.cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tr public.trades;
begin
  select * into tr from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform public.require_team_manager(tr.proposing_team_id);
  if tr.status not in ('proposed', 'pending_review') then
    raise exception 'This trade can no longer be cancelled.';
  end if;
  update public.trades set status = 'cancelled', processed_at = now() where id = p_trade;
  perform public.write_audit(tr.league_id, 'trade.cancelled', 'trade', p_trade::text, null, null);
end;
$$;

create or replace function public.review_trade(p_trade uuid, p_approve boolean, p_reason text default null)
returns public.trade_status language plpgsql security definer set search_path = public as $$
declare tr public.trades;
begin
  select * into tr from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform public.require_league_admin(tr.league_id);
  perform public.lock_league(tr.league_id);
  if tr.status <> 'pending_review' then
    raise exception 'This trade is not waiting for review.';
  end if;
  if p_approve then
    perform public.internal_execute_trade(p_trade);
  else
    update public.trades set status = 'vetoed', status_reason = nullif(trim(p_reason), ''), processed_at = now()
     where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.vetoed', 'trade', p_trade::text, null,
      jsonb_build_object('reason', p_reason));
  end if;
  return (select status from public.trades where id = p_trade);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts: claiming a team after accepting an invitation
-- ---------------------------------------------------------------------------
create or replace function public.claim_my_teams() returns int
language plpgsql security definer set search_path = public as $$
declare
  my_email text;
  inv record;
  n int := 0;
begin
  perform public.require_user();
  select lower(email) into my_email from auth.users where id = auth.uid();
  for inv in
    select i.*, t.league_id from public.team_invitations i
    join public.fantasy_teams t on t.id = i.fantasy_team_id
    where lower(i.email) = my_email and i.claimed_at is null and t.owner_user_id is null
  loop
    update public.fantasy_teams set owner_user_id = auth.uid() where id = inv.fantasy_team_id;
    update public.team_invitations set claimed_at = now() where fantasy_team_id = inv.fantasy_team_id;
    insert into public.league_members (league_id, user_id, role) values (inv.league_id, auth.uid(), 'manager')
      on conflict (league_id, user_id) do nothing;
    if inv.display_name is not null then
      update public.profiles set display_name = inv.display_name
       where id = auth.uid() and (display_name = '' or display_name = split_part(email, '@', 1));
    end if;
    perform public.write_audit(inv.league_id, 'team.claimed', 'fantasy_team', inv.fantasy_team_id::text, null,
      jsonb_build_object('user_id', auth.uid()));
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.update_my_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  if length(trim(p_name)) not between 1 and 60 then
    raise exception 'Name must be 1 to 60 characters.';
  end if;
  update public.profiles set display_name = trim(p_name) where id = auth.uid();
end;
$$;

create or replace function public.rename_my_team(p_team uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  t := public.require_team_manager(p_team);
  if length(trim(p_name)) not between 1 and 60 then
    raise exception 'Team name must be 1 to 60 characters.';
  end if;
  update public.fantasy_teams set name = trim(p_name) where id = p_team;
  perform public.write_audit(t.league_id, 'team.renamed', 'fantasy_team', p_team::text,
    jsonb_build_object('name', t.name), jsonb_build_object('name', trim(p_name)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator actions
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_league(p_league uuid, p_name text, p_settings jsonb, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg public.leagues;
  max_roster int;
  starters int;
  new_total int;
begin
  perform public.require_league_admin(p_league);
  perform public.lock_league(p_league);
  select * into lg from public.leagues where id = p_league;
  new_total := (p_settings -> 'roster' ->> 'TOTAL')::int;
  starters := coalesce((p_settings -> 'roster' ->> 'S')::int, 0) + coalesce((p_settings -> 'roster' ->> 'OH')::int, 0)
            + coalesce((p_settings -> 'roster' ->> 'M')::int, 0) + coalesce((p_settings -> 'roster' ->> 'L')::int, 0)
            + coalesce((p_settings -> 'roster' ->> 'UTIL')::int, 0);
  if new_total is null or new_total < starters then
    raise exception 'Total roster size must be at least the number of starting slots (%).', starters;
  end if;
  select coalesce(max(public.team_roster_count(id)), 0) into max_roster
    from public.fantasy_teams where league_id = p_league and active;
  if new_total < max_roster then
    raise exception 'A team currently has % players; the roster limit cannot be lower than that.', max_roster;
  end if;
  if p_status not in ('setup', 'active', 'complete') then
    raise exception 'Unknown league status.';
  end if;
  update public.leagues set name = coalesce(nullif(trim(p_name), ''), name), settings = p_settings, status = p_status
   where id = p_league;
  perform public.write_audit(p_league, 'league.settings', 'league', p_league::text,
    jsonb_build_object('name', lg.name, 'settings', lg.settings, 'status', lg.status),
    jsonb_build_object('name', p_name, 'settings', p_settings, 'status', p_status));
end;
$$;

-- p_rules: [{"stat_key": "kills", "label": "Kills", "points": 1, "active": true}, ...]
create or replace function public.admin_create_scoring_rule_set(
  p_league uuid, p_rules jsonb, p_effective_from_week int, p_note text)
returns int language plpgsql security definer set search_path = public as $$
declare
  new_version int;
  set_id uuid;
begin
  perform public.require_league_admin(p_league);
  if p_effective_from_week is null or p_effective_from_week < 1 then
    raise exception 'Choose the week the new scoring starts from.';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    raise exception 'Scoring must have at least one category.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rules) e
             where coalesce(e ->> 'stat_key', '') !~ '^[a-z][a-z0-9_]{0,40}$'
                or (e ->> 'points') is null) then
    raise exception 'Each category needs a valid key and a point value.';
  end if;
  select coalesce(max(version), 0) + 1 into new_version from public.scoring_rule_sets where league_id = p_league;
  insert into public.scoring_rule_sets (league_id, version, effective_from_week, note, created_by)
  values (p_league, new_version, p_effective_from_week, p_note, auth.uid()) returning id into set_id;
  insert into public.scoring_rules (rule_set_id, stat_key, label, points, active)
  select set_id, e ->> 'stat_key', coalesce(nullif(e ->> 'label', ''), e ->> 'stat_key'),
         (e ->> 'points')::numeric, coalesce((e ->> 'active')::boolean, true)
  from jsonb_array_elements(p_rules) e;
  perform public.write_audit(p_league, 'scoring.new_version', 'scoring_rule_set', set_id::text, null,
    jsonb_build_object('version', new_version, 'effective_from_week', p_effective_from_week, 'rules', p_rules));
  return new_version;
end;
$$;

-- Roster correction. p_to_team null releases the player to free agency.
create or replace function public.admin_move_player(p_league uuid, p_player uuid, p_to_team uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare from_team uuid;
begin
  perform public.require_league_admin(p_league);
  perform public.lock_league(p_league);
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Please record a reason for this correction.';
  end if;
  select fantasy_team_id into from_team from public.roster_assignments
   where league_id = p_league and player_id = p_player and released_at is null;
  if from_team is not null then
    perform public.internal_release_player(from_team, p_player);
  end if;
  if p_to_team is not null then
    if not exists (select 1 from public.fantasy_teams where id = p_to_team and league_id = p_league) then
      raise exception 'Team not in this league.';
    end if;
    perform public.internal_assign_player(p_league, p_to_team, p_player, 'admin_move');
  end if;
  insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by, details)
  values (p_league, 'admin_move', p_to_team, p_player, auth.uid(),
          jsonb_build_object('from_team_id', from_team, 'reason', p_reason));
  perform public.write_audit(p_league, 'roster.admin_move', 'player', p_player::text,
    jsonb_build_object('team', from_team), jsonb_build_object('team', p_to_team, 'reason', p_reason));
end;
$$;

create or replace function public.admin_set_matchup_status(p_matchup uuid, p_status public.matchup_status)
returns void language plpgsql security definer set search_path = public as $$
declare mu public.matchups;
begin
  select * into mu from public.matchups where id = p_matchup;
  if not found then raise exception 'Matchup not found.'; end if;
  perform public.require_league_admin(mu.league_id);
  update public.matchups set status = p_status,
         finalized_at = case when p_status = 'final' then now() else null end
   where id = p_matchup;
  perform public.write_audit(mu.league_id, 'matchup.status', 'matchup', p_matchup::text,
    jsonb_build_object('status', mu.status), jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_update_match(
  p_match uuid, p_league uuid, p_lock_at timestamptz, p_counts boolean, p_status public.match_status)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  perform public.require_league_admin(p_league);
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found.'; end if;
  update public.matches set
    lock_at = coalesce(p_lock_at, lock_at),
    lock_source = case when p_lock_at is not null then 'admin' else lock_source end,
    counts_for_fantasy = coalesce(p_counts, counts_for_fantasy),
    status = coalesce(p_status, status),
    last_updated_at = now()
  where id = p_match;
  perform public.write_audit(p_league, 'match.update', 'match', p_match::text,
    jsonb_build_object('lock_at', m.lock_at, 'counts', m.counts_for_fantasy, 'status', m.status),
    jsonb_build_object('lock_at', p_lock_at, 'counts', p_counts, 'status', p_status));
end;
$$;

-- Records which email may claim a team. The invitation email itself is sent by the app.
create or replace function public.admin_invite_manager(p_team uuid, p_email text, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  select * into t from public.fantasy_teams where id = p_team;
  if not found then raise exception 'Team not found.'; end if;
  perform public.require_league_admin(t.league_id);
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address.';
  end if;
  insert into public.team_invitations (fantasy_team_id, email, display_name, invited_by)
  values (p_team, lower(trim(p_email)), nullif(trim(p_display_name), ''), auth.uid())
  on conflict (fantasy_team_id) do update
    set email = excluded.email, display_name = excluded.display_name,
        invited_at = now(), invited_by = excluded.invited_by, claimed_at = null;
  if nullif(trim(p_display_name), '') is not null then
    update public.fantasy_teams set manager_display_name = trim(p_display_name) where id = p_team;
  end if;
  perform public.write_audit(t.league_id, 'team.invite', 'fantasy_team', p_team::text, null,
    jsonb_build_object('display_name', p_display_name));
end;
$$;

-- Removes a manager from a team (e.g. wrong person claimed it). The roster is untouched.
create or replace function public.admin_unassign_owner(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  select * into t from public.fantasy_teams where id = p_team;
  if not found then raise exception 'Team not found.'; end if;
  perform public.require_league_admin(t.league_id);
  update public.fantasy_teams set owner_user_id = null where id = p_team;
  update public.team_invitations set claimed_at = null where fantasy_team_id = p_team;
  perform public.write_audit(t.league_id, 'team.unassign', 'fantasy_team', p_team::text,
    jsonb_build_object('owner', t.owner_user_id), null);
end;
$$;

create or replace function public.admin_set_member_role(p_league uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_league_admin(p_league);
  if p_user = auth.uid() and p_role <> 'admin'
     and (select count(*) from public.league_members where league_id = p_league and role = 'admin') <= 1 then
    raise exception 'The league must keep at least one administrator.';
  end if;
  insert into public.league_members (league_id, user_id, role) values (p_league, p_user, p_role)
    on conflict (league_id, user_id) do update set role = excluded.role;
  perform public.write_audit(p_league, 'member.role', 'user', p_user::text, null, jsonb_build_object('role', p_role));
end;
$$;

-- p_pairs: [{"home_team_id": "...", "away_team_id": "...", "round": 1}, ...]
create or replace function public.admin_create_playoff_matchups(p_league uuid, p_week int, p_pairs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_league_admin(p_league);
  if not exists (select 1 from public.matchup_weeks where league_id = p_league and week = p_week) then
    raise exception 'Week % does not exist.', p_week;
  end if;
  if exists (select 1 from public.matchups where league_id = p_league and week = p_week) then
    raise exception 'Week % already has matchups.', p_week;
  end if;
  insert into public.matchups (league_id, week, home_team_id, away_team_id, playoff_round)
  select p_league, p_week, (e ->> 'home_team_id')::uuid, (e ->> 'away_team_id')::uuid, (e ->> 'round')::int
  from jsonb_array_elements(p_pairs) e;
  get diagnostics n = row_count;
  update public.matchup_weeks set is_playoff = true where league_id = p_league and week = p_week;
  perform public.write_audit(p_league, 'playoffs.create', 'matchup_week', p_week::text, null, p_pairs);
  return n;
end;
$$;

-- Used by the scheduled sync (runs as the database owner, not exposed to browsers).
-- Weeks in progress become in_progress; weeks that ended more than p_grace ago, with every
-- counted match final, become final.
create or replace function public.refresh_matchup_statuses(p_league uuid, p_grace interval default interval '1 day')
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := public.league_local_date(p_league);
  n int := 0;
  k int;
begin
  update public.matchups mu set status = 'in_progress'
   from public.matchup_weeks w
   where w.league_id = mu.league_id and w.week = mu.week and mu.league_id = p_league
     and mu.status = 'scheduled' and mu.score_source = 'calculated' and today >= w.starts_on;
  get diagnostics k = row_count; n := n + k;

  update public.matchups mu set status = 'final', finalized_at = now()
   from public.matchup_weeks w
   where w.league_id = mu.league_id and w.week = mu.week and mu.league_id = p_league
     and mu.status in ('scheduled', 'in_progress') and mu.score_source = 'calculated'
     and (w.ends_on + 1)::timestamp + p_grace <= (now() at time zone (select timezone from public.leagues where id = p_league))
     and not exists (
       select 1 from public.matches m
       where m.match_date between w.starts_on and w.ends_on and m.counts_for_fantasy
         and m.status in ('scheduled', 'live'));
  get diagnostics k = row_count; n := n + k;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions: only the actions above are callable by signed-in users
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_site_admin(), public.is_league_member(uuid), public.is_league_admin(uuid), public.is_any_admin(),
  public.shares_league_with(uuid), public.league_local_date(uuid, timestamptz),
  public.league_week_for_date(uuid, date), public.league_current_week(uuid), public.slot_base(text),
  public.league_starting_slots(uuid), public.league_roster_limit(uuid),
  public.player_eligible_for_slot(text[], text), public.player_is_locked(uuid, uuid, timestamptz),
  public.stat_value(public.player_match_statistics, text), public.team_roster_count(uuid),
  public.set_lineup(uuid, jsonb), public.add_drop(uuid, uuid, uuid),
  public.propose_trade(uuid, uuid, uuid[], uuid[], text), public.respond_trade(uuid, boolean),
  public.cancel_trade(uuid), public.review_trade(uuid, boolean, text),
  public.claim_my_teams(), public.update_my_display_name(text), public.rename_my_team(uuid, text),
  public.admin_update_league(uuid, text, jsonb, text),
  public.admin_create_scoring_rule_set(uuid, jsonb, int, text),
  public.admin_move_player(uuid, uuid, uuid, text), public.admin_set_matchup_status(uuid, public.matchup_status),
  public.admin_update_match(uuid, uuid, timestamptz, boolean, public.match_status),
  public.admin_invite_manager(uuid, text, text), public.admin_unassign_owner(uuid),
  public.admin_set_member_role(uuid, uuid, public.member_role),
  public.admin_create_playoff_matchups(uuid, int, jsonb)
to authenticated;
