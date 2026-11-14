-- 1. Waiver wire: free agents are claimed, and claims are decided at midnight (league time).
--    A player picked up mid-game no longer lands on a roster locked; she arrives the next day.
-- 2. Team pictures.

-- ---------------------------------------------------------------------------
-- Waiver claims
-- ---------------------------------------------------------------------------
create table public.waiver_claims (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues (id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  player_id       uuid not null references public.players (id),
  drop_player_id  uuid references public.players (id),
  status          text not null default 'pending' check (status in ('pending', 'won', 'lost', 'failed', 'cancelled')),
  detail          text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  process_after   timestamptz not null,
  processed_at    timestamptz
);
create unique index waiver_one_pending_claim on public.waiver_claims (fantasy_team_id, player_id) where status = 'pending';
create index waiver_due_idx on public.waiver_claims (league_id, process_after) where status = 'pending';

alter table public.waiver_claims enable row level security;
-- A team's claims are private to that team (and the league admins).
create policy waiver_claims_read on public.waiver_claims for select to authenticated
  using (fantasy_team_id in (select id from public.fantasy_teams where owner_user_id = auth.uid())
         or league_id in (select public.my_admin_league_ids()));
revoke all on public.waiver_claims from anon;
revoke insert, update, delete, truncate on public.waiver_claims from authenticated;
grant select on public.waiver_claims to authenticated;

/** The next midnight in the league's time zone. */
create or replace function public.league_next_midnight(p_league uuid, p_at timestamptz default now())
returns timestamptz language sql stable set search_path = public as $$
  select ((date_trunc('day', p_at at time zone l.timezone) + interval '1 day') at time zone l.timezone)
  from public.leagues l where l.id = p_league;
$$;

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
  select * into lg from public.leagues where id = t.league_id;
  if coalesce((lg.settings -> 'freeAgency' ->> 'enabled')::boolean, false) is not true and not public.is_league_admin(lg.id) then
    raise exception 'Free agency is currently closed in this league.';
  end if;
  select * into pl from public.players where id = p_add;
  if not found then raise exception 'Player not found.'; end if;
  if pl.gender <> lg.gender or pl.conference is distinct from lg.conference then
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
  values (lg.id, p_team, p_add, p_drop, auth.uid(), public.league_next_midnight(lg.id))
  returning waiver_claims.id into v_id;
  perform public.write_audit(lg.id, 'waiver.claim', 'fantasy_team', p_team::text, null, jsonb_build_object('add', p_add, 'drop', p_drop));
  return v_id;
end;
$$;

create or replace function public.cancel_waiver_claim(p_claim uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.waiver_claims;
begin
  select * into c from public.waiver_claims where id = p_claim;
  if not found then raise exception 'Claim not found.'; end if;
  perform public.require_team_manager(c.fantasy_team_id);
  if c.status <> 'pending' then raise exception 'That claim has already been decided.'; end if;
  update public.waiver_claims set status = 'cancelled', processed_at = now() where id = p_claim;
end;
$$;

-- Decides every claim that is due. For each player, the team lowest in the standings wins
-- (ties: the earliest claim). A winning claim drops the chosen player and adds the new one to
-- the bench; other claims on that player lose. Claims that can no longer work fail with a reason.
-- Called by the scheduled sync (not by users).
create or replace function public.process_waivers(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n int := 0;
  limit_n int := public.league_roster_limit(p_league);
begin
  perform public.lock_league(p_league);
  for c in
    select wc.*, coalesce(st.rank, 999) as rank
      from public.waiver_claims wc
      left join public.v_standings st on st.fantasy_team_id = wc.fantasy_team_id
     where wc.league_id = p_league and wc.status = 'pending' and wc.process_after <= now()
     order by wc.player_id, coalesce(st.rank, 999) desc, wc.created_at
  loop
    -- Re-read: an earlier claim in this loop may have taken the player.
    if exists (select 1 from public.roster_assignments where league_id = p_league and player_id = c.player_id and released_at is null) then
      update public.waiver_claims set status = 'lost', processed_at = now(), detail = 'Another team''s claim won.' where id = c.id;
      continue;
    end if;
    if c.drop_player_id is not null and not exists (
      select 1 from public.roster_assignments where fantasy_team_id = c.fantasy_team_id and player_id = c.drop_player_id and released_at is null) then
      update public.waiver_claims set status = 'failed', processed_at = now(), detail = 'The player to drop is no longer on the roster.' where id = c.id;
      continue;
    end if;
    if c.drop_player_id is null and public.team_roster_count(c.fantasy_team_id) >= limit_n then
      update public.waiver_claims set status = 'failed', processed_at = now(), detail = 'Roster was full.' where id = c.id;
      continue;
    end if;
    if c.drop_player_id is not null then
      perform public.internal_release_player(c.fantasy_team_id, c.drop_player_id);
      insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by, details)
      values (p_league, 'drop', c.fantasy_team_id, c.drop_player_id, c.created_by, jsonb_build_object('via', 'waivers'));
    end if;
    perform public.internal_assign_player(p_league, c.fantasy_team_id, c.player_id, 'add');
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by, details)
    values (p_league, 'add', c.fantasy_team_id, c.player_id, c.created_by, jsonb_build_object('via', 'waivers'));
    update public.waiver_claims set status = 'won', processed_at = now() where id = c.id;
    n := n + 1;
  end loop;
  if n > 0 then
    perform public.write_audit(p_league, 'waiver.processed', 'league', p_league::text, null, jsonb_build_object('won', n));
  end if;
  return n;
end;
$$;

-- Managers now add players through waiver claims; add_drop keeps dropping (and admins can still
-- add directly from the admin pages).
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
  if p_add is null and p_drop is null then raise exception 'Choose a player to add or drop.'; end if;
  if p_add is not null and not public.is_league_admin(lg.id) then
    raise exception 'Free agents are added by waiver claim: claims are decided at midnight.';
  end if;
  if coalesce((lg.settings -> 'freeAgency' ->> 'enabled')::boolean, false) is not true and not public.is_league_admin(lg.id) then
    raise exception 'Free agency is currently closed in this league.';
  end if;
  if p_drop is not null then
    perform public.internal_release_player(p_team, p_drop);
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by) values (lg.id, 'drop', p_team, p_drop, auth.uid());
    -- Pending claims that planned to drop this player can't any more.
    update public.waiver_claims set status = 'failed', processed_at = now(), detail = 'The player to drop was dropped earlier.'
     where fantasy_team_id = p_team and drop_player_id = p_drop and status = 'pending';
  end if;
  if p_add is not null then
    select * into pl from public.players where id = p_add;
    if not found then raise exception 'Player not found.'; end if;
    if pl.duplicate_of is not null or not pl.active then raise exception '% cannot be added.', pl.display_name; end if;
    if public.team_roster_count(p_team) >= public.league_roster_limit(lg.id) then
      raise exception 'Your roster is full (% players). Drop a player to make room.', public.league_roster_limit(lg.id);
    end if;
    perform public.internal_assign_player(lg.id, p_team, p_add, 'add');
    insert into public.transactions (league_id, type, fantasy_team_id, player_id, created_by) values (lg.id, 'add', p_team, p_add, auth.uid());
  end if;
  perform public.write_audit(lg.id, 'roster.add_drop', 'fantasy_team', p_team::text, null, jsonb_build_object('add', p_add, 'drop', p_drop));
end;
$$;

revoke all on function public.submit_waiver_claim(uuid, uuid, uuid), public.cancel_waiver_claim(uuid),
  public.process_waivers(uuid), public.league_next_midnight(uuid, timestamptz) from public, anon;
grant execute on function public.submit_waiver_claim(uuid, uuid, uuid), public.cancel_waiver_claim(uuid),
  public.league_next_midnight(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Team pictures (small images, resized in the browser before upload)
-- ---------------------------------------------------------------------------
alter table public.fantasy_teams add column if not exists logo_updated_at timestamptz;

create table if not exists public.team_logos (
  fantasy_team_id uuid primary key references public.fantasy_teams (id) on delete cascade,
  image           text not null, -- data:image/...;base64,...
  updated_at      timestamptz not null default now()
);
alter table public.team_logos enable row level security;
create policy team_logos_read on public.team_logos for select to authenticated
  using (fantasy_team_id in (select public.my_league_team_ids()));
revoke all on public.team_logos from anon;
revoke insert, update, delete, truncate on public.team_logos from authenticated;
grant select on public.team_logos to authenticated;

create or replace function public.set_team_logo(p_team uuid, p_image text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  t := public.require_team_manager(p_team);
  if p_image is null then
    delete from public.team_logos where fantasy_team_id = p_team;
    update public.fantasy_teams set logo_updated_at = null where id = p_team;
  else
    if p_image !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'That image could not be used.'; end if;
    if length(p_image) > 400000 then raise exception 'That image is too large.'; end if;
    insert into public.team_logos (fantasy_team_id, image, updated_at) values (p_team, p_image, now())
      on conflict (fantasy_team_id) do update set image = excluded.image, updated_at = now();
    update public.fantasy_teams set logo_updated_at = now() where id = p_team;
  end if;
  perform public.write_audit(t.league_id, 'team.logo', 'fantasy_team', p_team::text, null, jsonb_build_object('removed', p_image is null));
end;
$$;
revoke all on function public.set_team_logo(uuid, text) from public, anon;
grant execute on function public.set_team_logo(uuid, text) to authenticated;

-- my_context now also says when each team's picture last changed (to load it only when needed).
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  with prof as (
    select id, email, display_name, is_site_admin from public.profiles where id = auth.uid()
  ), mem as (
    select league_id, role::text as role from public.league_members where user_id = auth.uid()
  ), lg as (
    select l.id, l.name, l.season_label, l.status::text as status, l.timezone, l.settings
      from public.leagues l
     where l.id = coalesce(
       (select league_id from mem limit 1),
       (select x.id from public.leagues x where (select is_site_admin from prof) order by x.created_at limit 1))
  )
  select jsonb_build_object(
    'profile', (select to_jsonb(prof) from prof),
    'memberships', coalesce((select jsonb_agg(to_jsonb(mem)) from mem), '[]'::jsonb),
    'league', (select to_jsonb(lg) from lg),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'owner_user_id', t.owner_user_id,
               'manager_display_name', t.manager_display_name, 'active', t.active,
               'owner_name', p.display_name,
               'logo_v', case when t.logo_updated_at is null then null else floor(extract(epoch from t.logo_updated_at))::bigint end) order by t.name)
        from public.fantasy_teams t left join public.profiles p on p.id = t.owner_user_id
       where t.league_id = (select id from lg) and t.active), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'starts_on', w.starts_on, 'ends_on', w.ends_on,
               'is_playoff', w.is_playoff) order by w.week)
        from public.matchup_weeks w where w.league_id = (select id from lg)), '[]'::jsonb));
$$;
