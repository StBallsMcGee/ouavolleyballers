-- FLEX starting slot: an outside hitter OR a middle (shown as "OH/M"). The league sets how many
-- under League settings (default 0). Slot names: FLEX, or FLEX1, FLEX2, ... when there are several.

-- Allow the new slot name in lineups.
alter table public.lineup_entries drop constraint if exists lineup_entries_slot_check;
alter table public.lineup_entries add constraint lineup_entries_slot_check
  check (slot ~ '^(BENCH|UTIL[0-9]*|FLEX[0-9]*|S[0-9]*|L[0-9]*|OH[0-9]*|M[0-9]*)$');

-- Starting slots in display order: S, OH, M, FLEX, L, UTIL.
create or replace function public.league_starting_slots(p_league uuid) returns text[]
language sql stable set search_path = public as $$
  with r as (select settings -> 'roster' as roster from public.leagues where id = p_league),
  pos as (
    select p.code, p.ord, coalesce((r.roster ->> p.code)::int, 0) as n
    from r, (values ('S', 1), ('OH', 2), ('M', 3), ('FLEX', 4), ('L', 5), ('UTIL', 6)) as p(code, ord))
  select coalesce(array_agg(case when n = 1 then code else code || i end order by ord, i), '{}')
  from pos, generate_series(1, greatest(n, 0)) as i
  where n > 0;
$$;

-- FLEX takes an outside hitter or a middle; UTIL takes anyone.
create or replace function public.player_eligible_for_slot(p_positions text[], p_slot text)
returns boolean language sql immutable as $$
  select case public.slot_base(p_slot)
    when 'BENCH' then true
    when 'UTIL' then true
    when 'FLEX' then coalesce(p_positions, '{}') && array['OH', 'M']
    else public.slot_base(p_slot) = any (coalesce(p_positions, '{}'))
  end;
$$;

-- League settings: FLEX counts as a starting slot.
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
            + coalesce((p_settings -> 'roster' ->> 'UTIL')::int, 0) + coalesce((p_settings -> 'roster' ->> 'FLEX')::int, 0);
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
