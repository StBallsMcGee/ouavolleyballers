-- Trades can take a team over the roster limit. Until it drops back down, that team can't change
-- its lineup (today's or a later day's) or add players; dropping is always allowed.

create or replace function public.internal_validate_trade(p_trade uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  tr public.trades;
  bad record;
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

  -- Trades may take a team over the roster limit; that team can't change its lineup (or add
  -- players) until it drops back to the limit.
  return null;
end;
$$;

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
  if public.team_roster_count(p_team) > public.league_roster_limit(t.league_id) then
    raise exception 'Your roster is over the limit (% players, limit %). Drop % before changing your lineup.',
      public.team_roster_count(p_team), public.league_roster_limit(t.league_id),
      case when public.team_roster_count(p_team) - public.league_roster_limit(t.league_id) = 1 then 'a player'
           else (public.team_roster_count(p_team) - public.league_roster_limit(t.league_id))::text || ' players' end;
  end if;
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

create or replace function public.save_lineup_plan(p_team uuid, p_date date, p_lineup jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
  if public.team_roster_count(p_team) > public.league_roster_limit(t.league_id) then
    raise exception 'Your roster is over the limit (% players, limit %). Drop % before changing your lineup.',
      public.team_roster_count(p_team), public.league_roster_limit(t.league_id),
      case when public.team_roster_count(p_team) - public.league_roster_limit(t.league_id) = 1 then 'a player'
           else (public.team_roster_count(p_team) - public.league_roster_limit(t.league_id))::text || ' players' end;
  end if;
  if p_date <= public.league_local_date(t.league_id) then
    raise exception 'That day has started: change today''s lineup instead.';
  end if;
  perform public.internal_check_lineup(p_team, p_lineup);
  insert into public.lineup_plans (fantasy_team_id, plan_date, lineup, created_by, updated_at, applied_at)
  values (p_team, p_date, p_lineup, auth.uid(), now(), null)
  on conflict (fantasy_team_id, plan_date) do update set lineup = excluded.lineup, created_by = excluded.created_by, updated_at = now(), applied_at = null;
  perform public.write_audit(t.league_id, 'lineup.plan', 'fantasy_team', p_team::text, null, jsonb_build_object('date', p_date, 'lineup', p_lineup));
end;
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
  if public.team_roster_count(p_team) > public.league_roster_limit(t.league_id) then
    raise exception 'Your roster is over the limit after a trade. Drop players before adding anyone.';
  end if;
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
