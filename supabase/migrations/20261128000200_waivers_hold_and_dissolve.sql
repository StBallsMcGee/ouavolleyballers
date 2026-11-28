-- 1. Waiver period: every player who leaves a roster for free agency (dropped by a manager, dropped
--    for a waiver claim, released by the commissioner, or from a dissolved team) is on waivers until
--    the SECOND midnight after (e.g. dropped Tuesday afternoon -> Thursday 00:00), so everyone has
--    a day or two to see her. Claims can be made any time; they're decided when the period ends.
--    Players who move in a trade aren't affected.
-- 2. Dissolving a team (commissioner): every player goes to waivers, the manager is removed, and
--    the team stays in the league with its record. Its remaining matchups are still played (it
--    scores 0), so wins and losses against it still count.
-- 3. Guest players from men's teams (e.g. Micah Huisman) can be claimed like anyone else.

create table if not exists public.player_waivers (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  until      timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (league_id, player_id)
);
alter table public.player_waivers enable row level security;
drop policy if exists player_waivers_read on public.player_waivers;
create policy player_waivers_read on public.player_waivers for select to authenticated
  using (league_id in (select public.my_league_ids()));
revoke all on public.player_waivers from anon;
revoke insert, update, delete, truncate on public.player_waivers from authenticated;
grant select on public.player_waivers to authenticated;

-- When the player's waiver period ends (null when she isn't on waivers).
create or replace function public.player_waiver_until(p_league uuid, p_player uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select until from public.player_waivers where league_id = p_league and player_id = p_player and until > now();
$$;

-- The second midnight from now, in the league's time zone.
create or replace function public.league_waiver_end(p_league uuid, p_at timestamptz default now())
returns timestamptz language sql stable set search_path = public as $$
  select ((date_trunc('day', p_at at time zone l.timezone) + interval '2 days') at time zone l.timezone)
  from public.leagues l where l.id = p_league;
$$;

-- Checked when the change is committed, so a player moved in a trade (released, then added to the
-- other team in the same change) isn't put on waivers.
create or replace function public.tg_waivers_on_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.roster_assignments
                  where league_id = new.league_id and player_id = new.player_id and released_at is null) then
    insert into public.player_waivers (league_id, player_id, until)
    values (new.league_id, new.player_id, public.league_waiver_end(new.league_id))
    on conflict (league_id, player_id) do update set until = excluded.until, created_at = now();
  end if;
  return null;
end;
$$;
drop trigger if exists waivers_on_release on public.roster_assignments;
create constraint trigger waivers_on_release after update of released_at on public.roster_assignments
  deferrable initially deferred
  for each row when (old.released_at is null and new.released_at is not null)
  execute function public.tg_waivers_on_release();

-- Claims: decided at the next midnight, or when the player's waiver period ends if that's later.
create or replace function public.submit_waiver_claim(p_team uuid, p_add uuid, p_drop uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  lg public.leagues;
  pl public.players;
  v_id uuid;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
  if public.team_roster_count(p_team) > public.league_roster_limit(t.league_id) then
    raise exception 'Your roster is over the limit after a trade. Drop players before adding anyone.';
  end if;
  select * into lg from public.leagues where id = t.league_id;
  if coalesce((lg.settings -> 'freeAgency' ->> 'enabled')::boolean, false) is not true and not public.is_league_admin(lg.id) then
    raise exception 'Free agency is currently closed in this league.';
  end if;
  select * into pl from public.players where id = p_add;
  if not found then raise exception 'Player not found.'; end if;
  -- Guest players from men's teams (source 'guest-men') can be claimed in a women's league.
  if (pl.gender <> lg.gender and pl.source_system <> 'guest-men') or pl.conference is distinct from lg.conference then
    raise exception '% is not eligible for this league.', pl.display_name;
  end if;
  if pl.duplicate_of is not null then raise exception 'This is a duplicate player record. Claim % using the main record.', pl.display_name; end if;
  if not pl.active then raise exception '% is not on an active roster.', pl.display_name; end if;
  if exists (select 1 from public.roster_assignments where league_id = lg.id and player_id = p_add and released_at is null) then
    raise exception '% is already on a team.', pl.display_name;
  end if;
  if p_drop is not null and not exists (select 1 from public.roster_assignments where fantasy_team_id = p_team and player_id = p_drop and released_at is null) then
    raise exception 'The player to drop is not on your roster.';
  end if;
  if p_drop is null and public.team_roster_count(p_team) >= public.league_roster_limit(lg.id) then
    raise exception 'Your roster is full. Choose a player to drop if your claim wins.';
  end if;
  if exists (select 1 from public.waiver_claims where fantasy_team_id = p_team and player_id = p_add and status = 'pending') then
    raise exception 'You already have a claim on %.', pl.display_name;
  end if;
  insert into public.waiver_claims (league_id, fantasy_team_id, player_id, drop_player_id, created_by, process_after)
  values (lg.id, p_team, p_add, p_drop, auth.uid(),
          greatest(public.league_next_midnight(lg.id), coalesce(public.player_waiver_until(lg.id, p_add), '-infinity')))
  returning waiver_claims.id into v_id;
  perform public.write_audit(lg.id, 'waiver.claim', 'fantasy_team', p_team::text, null, jsonb_build_object('add', p_add, 'drop', p_drop));
  return v_id;
end;
$$;

-- Adding right away isn't possible while a player is on waivers.
create or replace function public.claim_player(p_team uuid, p_add uuid, p_drop uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  c public.waiver_claims;
  v_id uuid;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
  -- Same checks as any claim (eligible, free agent, roster room or a drop, not already claimed).
  v_id := public.submit_waiver_claim(p_team, p_add, p_drop);
  -- On waivers (dropped recently): claims only, decided when the waiver period ends.
  if coalesce(public.player_waiver_until(t.league_id, p_add) > now(), false)
     or public.player_is_locked(t.league_id, p_add)
     or exists (select 1 from public.waiver_claims where player_id = p_add and league_id = t.league_id and status = 'pending' and id <> v_id) then
    return 'claimed';
  end if;

  select * into c from public.waiver_claims where id = v_id;
  if c.drop_player_id is not null then
    perform public.internal_release_player(p_team, c.drop_player_id);
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by)
    values (t.league_id, 'drop', p_team, c.drop_player_id, auth.uid());
  end if;
  perform public.internal_assign_player(t.league_id, p_team, p_add, 'add');
  insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by)
  values (t.league_id, 'add', p_team, p_add, auth.uid());
  update public.waiver_claims set status = 'won', processed_at = now(), detail = 'Added right away (her game hadn''t started).' where id = v_id;
  perform public.write_audit(t.league_id, 'roster.add_drop', 'fantasy_team', p_team::text, null,
    jsonb_build_object('add', p_add, 'drop', p_drop, 'via', 'immediate claim'));
  return 'added';
end;
$$;

-- ---------------------------------------------------------------- Dissolving a team

alter table public.fantasy_teams add column if not exists dissolved_at timestamptz;

-- A dissolved team can't get a manager again.
create or replace function public.tg_dissolved_team_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dissolved_at is not null and new.owner_user_id is not null then
    raise exception 'This team was dissolved by the commissioner.';
  end if;
  return new;
end;
$$;
drop trigger if exists dissolved_team_guard on public.fantasy_teams;
create trigger dissolved_team_guard before insert or update on public.fantasy_teams
  for each row execute function public.tg_dissolved_team_guard();

create or replace function public.admin_dissolve_team(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  r record;
  n int := 0;
begin
  select * into t from public.fantasy_teams where id = p_team;
  if not found then raise exception 'Team not found.'; end if;
  perform public.require_league_admin(t.league_id);
  perform public.lock_league(t.league_id);
  if t.dissolved_at is not null then raise exception '% is already dissolved.', t.name; end if;
  -- Every player to waivers (the release trigger starts each one's waiver period).
  for r in select player_id from public.roster_assignments where fantasy_team_id = p_team and released_at is null loop
    perform public.internal_release_player(p_team, r.player_id);
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by, details)
    values (t.league_id, 'drop', p_team, r.player_id, auth.uid(), jsonb_build_object('via', 'team dissolved'));
    n := n + 1;
  end loop;
  update public.waiver_claims set status = 'cancelled', processed_at = now(), detail = 'The team was dissolved.'
   where fantasy_team_id = p_team and status = 'pending';
  update public.trades set status = 'cancelled', status_reason = 'A team in this trade was dissolved.'
   where (proposing_team_id = p_team or receiving_team_id = p_team) and status in ('proposed', 'pending_review', 'accepted');
  delete from public.team_invitations where fantasy_team_id = p_team;
  delete from public.lineup_plans where fantasy_team_id = p_team;
  update public.fantasy_teams set owner_user_id = null, dissolved_at = now() where id = p_team;
  perform public.write_audit(t.league_id, 'team.dissolved', 'fantasy_team', p_team::text,
    jsonb_build_object('name', t.name, 'owner', t.owner_user_id), jsonb_build_object('players_released', n));
  return n;
end;
$$;
revoke all on function public.admin_dissolve_team(uuid) from public, anon;
grant execute on function public.admin_dissolve_team(uuid) to authenticated;

-- The invite link doesn't offer dissolved teams.
create or replace function public.join_link_info(p_code text)
returns table (league_name text, open_teams int) language sql stable security definer set search_path = public as $$
  select l.name,
         (select count(*)::int from public.fantasy_teams t where t.league_id = l.id and t.active and t.dissolved_at is null and t.owner_user_id is null)
    from public.league_join_links j join public.leagues l on l.id = j.league_id
   where j.code = p_code;
$$;

create or replace function public.join_link_teams(p_code text)
returns table (id uuid, name text, manager_hint text) language plpgsql stable security definer set search_path = public as $$
declare lg uuid;
begin
  perform public.require_user();
  select league_id into lg from public.league_join_links where code = p_code;
  if lg is null then raise exception 'This invite link is no longer valid. Ask the league admin for the new one.'; end if;
  return query
    select t.id, t.name, t.manager_display_name from public.fantasy_teams t
     where t.league_id = lg and t.active and t.dissolved_at is null and t.owner_user_id is null
     order by t.name;
end;
$$;
