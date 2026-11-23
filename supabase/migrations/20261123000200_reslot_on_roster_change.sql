-- When the league's starting slots change (e.g. the UTIL slot is removed in League settings), every
-- team's current lineup and saved future-day lineups are re-seated automatically:
--   * players keep their position group, in order (OH1, OH2 stay; OH3 goes to the bench if there
--     are now only two OH slots); a renamed slot (OH -> OH1) just carries the player over
--   * anyone whose slot no longer exists (e.g. UTIL) moves to the bench
-- Points already scored don't change: scoring uses the lineup at each match's lock time.

-- Maps a lineup [{player_id, slot}] onto a set of starting slots.
create or replace function public.remap_lineup_slots(p_slots text[], p_lineup jsonb) returns jsonb
language sql immutable as $$
  with items as (
    select j ->> 'player_id' as player_id, j ->> 'slot' as slot, ord
      from jsonb_array_elements(coalesce(p_lineup, '[]'::jsonb)) with ordinality as x(j, ord)
  ), grouped as (
    select i.*, regexp_replace(i.slot, '\d+$', '') as grp,
           row_number() over (partition by regexp_replace(i.slot, '\d+$', '')
                              order by coalesce(nullif(substring(i.slot from '\d+$'), '')::int, 0), i.ord) as rn
      from items i where i.slot <> 'BENCH'
  ), targets as (
    select s, regexp_replace(s, '\d+$', '') as grp, row_number() over (partition by regexp_replace(s, '\d+$', '') order by o) as rn
      from unnest(p_slots) with ordinality as u(s, o)
  )
  select coalesce(jsonb_agg(jsonb_build_object('player_id', i.player_id, 'slot',
           case when i.slot = 'BENCH' then 'BENCH' else coalesce(t.s, 'BENCH') end) order by i.ord), '[]'::jsonb)
    from items i
    left join grouped g on g.ord = i.ord
    left join targets t on t.grp = g.grp and t.rn = g.rn;
$$;

-- Re-seats every team in the league to the league's current starting slots.
create or replace function public.reslot_league(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  slots text[] := public.league_starting_slots(p_league);
  t record;
  cur jsonb;
  nxt jsonb;
  moved int := 0;
  pl record;
begin
  for t in select id from public.fantasy_teams where league_id = p_league loop
    select coalesce(jsonb_agg(jsonb_build_object('player_id', le.player_id, 'slot', le.slot) order by le.slot), '[]'::jsonb)
      into cur
      from public.lineup_entries le where le.fantasy_team_id = t.id and le.valid_to is null;
    nxt := public.remap_lineup_slots(slots, cur);
    -- Close every entry whose slot changes, then open the new ones (avoids slot clashes).
    create temporary table if not exists _reslot (player_id uuid, slot text) on commit drop;
    delete from _reslot where true; -- (Supabase refuses a delete without a where clause)
    insert into _reslot
    select (n ->> 'player_id')::uuid, n ->> 'slot'
      from jsonb_array_elements(nxt) n
      join jsonb_array_elements(cur) c on c ->> 'player_id' = n ->> 'player_id'
     where c ->> 'slot' <> n ->> 'slot';
    update public.lineup_entries le set valid_to = now()
      from _reslot r where le.fantasy_team_id = t.id and le.player_id = r.player_id and le.valid_to is null;
    insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, changed_by)
    select ra.id, t.id, r.player_id, r.slot, null
      from _reslot r
      join public.roster_assignments ra on ra.fantasy_team_id = t.id and ra.player_id = r.player_id and ra.released_at is null;
    moved := moved + (select count(*) from _reslot);
    -- Saved lineups for days that haven't happened yet.
    for pl in select plan_date, lineup from public.lineup_plans where fantasy_team_id = t.id and applied_at is null loop
      update public.lineup_plans set lineup = public.remap_lineup_slots(slots, pl.lineup), updated_at = now()
       where fantasy_team_id = t.id and plan_date = pl.plan_date;
    end loop;
  end loop;
  return moved;
end;
$$;
revoke all on function public.reslot_league(uuid) from public, anon, authenticated;

create or replace function public.tg_reslot_on_roster_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.reslot_league(new.id);
  return null;
end;
$$;

drop trigger if exists reslot_on_roster_change on public.leagues;
create trigger reslot_on_roster_change after update of settings on public.leagues
  for each row when ((old.settings -> 'roster') is distinct from (new.settings -> 'roster'))
  execute function public.tg_reslot_on_roster_change();
