-- Fix: removing a starting slot (e.g. UTIL) in League settings failed with
-- "DELETE requires a WHERE clause" (Supabase blocks deletes without one). Same function, with
-- the working list cleared by "delete ... where true".

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
