-- Rolling waiver priority. The league keeps a waiver order (it starts as the current standings
-- reversed: last place first). At midnight the team highest in the order with a pending claim
-- gets its claim decided first; a team that wins a claim moves to the back of the order. Adding
-- a free agent straight away (her game hasn't started) doesn't use or change the order.

create table if not exists public.waiver_priority (
  league_id       uuid not null references public.leagues (id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  position        int not null,
  primary key (league_id, fantasy_team_id)
);
alter table public.waiver_priority enable row level security;
drop policy if exists waiver_priority_read on public.waiver_priority;
create policy waiver_priority_read on public.waiver_priority for select to authenticated
  using (league_id in (select public.my_league_ids()));
revoke all on public.waiver_priority from anon;
revoke insert, update, delete, truncate on public.waiver_priority from authenticated;
grant select on public.waiver_priority to authenticated;

-- Adds any team missing from the order at the back, worst record first.
create or replace function public.ensure_waiver_priority(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare top int;
begin
  select coalesce(max(position), 0) into top from public.waiver_priority where league_id = p_league;
  insert into public.waiver_priority (league_id, fantasy_team_id, position)
  select p_league, t.id, top + row_number() over (order by st.rank desc nulls first, st.points_for asc nulls first, t.name)
    from public.fantasy_teams t
    left join public.v_standings st on st.fantasy_team_id = t.id
   where t.league_id = p_league and t.active
     and not exists (select 1 from public.waiver_priority w where w.league_id = p_league and w.fantasy_team_id = t.id);
end;
$$;

-- Decides due claims one at a time: always the claim of the team highest in the waiver order
-- (its earliest claim first). A win moves that team to the back before the next claim is decided.
create or replace function public.process_waivers(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n int := 0;
  limit_n int := public.league_roster_limit(p_league);
begin
  perform public.lock_league(p_league);
  perform public.ensure_waiver_priority(p_league);
  loop
    select wc.* into c
      from public.waiver_claims wc
      join public.waiver_priority wp on wp.league_id = wc.league_id and wp.fantasy_team_id = wc.fantasy_team_id
     where wc.league_id = p_league and wc.status = 'pending' and wc.process_after <= now()
     order by wp.position, wc.created_at
     limit 1;
    exit when not found;

    if exists (select 1 from public.roster_assignments where league_id = p_league and player_id = c.player_id and released_at is null) then
      update public.waiver_claims set status = 'lost', processed_at = now(), detail = 'A team higher in the waiver order got her.' where id = c.id;
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
    -- Winner to the back of the order.
    update public.waiver_priority set position = (select max(position) + 1 from public.waiver_priority where league_id = p_league)
     where league_id = p_league and fantasy_team_id = c.fantasy_team_id;
    n := n + 1;
  end loop;
  if n > 0 then
    perform public.write_audit(p_league, 'waiver.processed', 'league', p_league::text, null, jsonb_build_object('won', n));
  end if;
  return n;
end;
$$;

revoke all on function public.ensure_waiver_priority(uuid) from public, anon, authenticated;

-- Start the order now for every running league.
do $$ declare l uuid; begin
  for l in select id from public.leagues where status in ('setup', 'active') loop
    perform public.ensure_waiver_priority(l);
  end loop;
end $$;
