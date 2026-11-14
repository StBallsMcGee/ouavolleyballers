-- Lineups for future days. A manager can set the lineup for any later day, whoever is locked
-- today. The plan is applied just after midnight on that day (before any game locks) and carries
-- forward until a later plan or a manual change. Today's lineup works as before.

create table if not exists public.lineup_plans (
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  plan_date       date not null,
  lineup          jsonb not null, -- [{ "player_id": uuid, "slot": text }]
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  applied_at      timestamptz,
  primary key (fantasy_team_id, plan_date)
);
alter table public.lineup_plans enable row level security;
drop policy if exists lineup_plans_read on public.lineup_plans;
create policy lineup_plans_read on public.lineup_plans for select to authenticated
  using (fantasy_team_id in (select public.my_league_team_ids()));
revoke all on public.lineup_plans from anon;
revoke insert, update, delete, truncate on public.lineup_plans from authenticated;
grant select on public.lineup_plans to authenticated;

-- Checks a lineup for a team's current roster (every player once, real slots, one player per
-- starting slot, eligible positions). Locks are not checked: that depends on the day.
create or replace function public.internal_check_lineup(p_team uuid, p_lineup jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  t public.fantasy_teams;
  slots text[];
  rec record;
  new_slot text;
  roster_count int;
begin
  select * into t from public.fantasy_teams where id = p_team;
  slots := public.league_starting_slots(t.league_id);
  if jsonb_typeof(p_lineup) <> 'array' then raise exception 'Lineup must be a list.'; end if;
  select count(*) into roster_count from public.roster_assignments where fantasy_team_id = p_team and released_at is null;
  if jsonb_array_length(p_lineup) <> roster_count
     or (select count(distinct e ->> 'player_id') from jsonb_array_elements(p_lineup) e) <> roster_count then
    raise exception 'The lineup must list every player on your roster exactly once.';
  end if;
  if exists (select e ->> 'slot' from jsonb_array_elements(p_lineup) e where e ->> 'slot' <> 'BENCH' group by e ->> 'slot' having count(*) > 1) then
    raise exception 'Each starting slot can only hold one player.';
  end if;
  for rec in
    select ra.player_id, pl.positions, pl.display_name
      from public.roster_assignments ra join public.players pl on pl.id = ra.player_id
     where ra.fantasy_team_id = p_team and ra.released_at is null
  loop
    select e ->> 'slot' into new_slot from jsonb_array_elements(p_lineup) e where (e ->> 'player_id')::uuid = rec.player_id;
    if new_slot is null then raise exception 'The lineup must list every player on your roster exactly once.'; end if;
    if new_slot <> 'BENCH' and not (new_slot = any (slots)) then raise exception 'Slot % does not exist in this league.', new_slot; end if;
    if not public.player_eligible_for_slot(rec.positions, new_slot) then
      raise exception '% is not eligible for the % slot.', rec.display_name, new_slot;
    end if;
  end loop;
end;
$$;

create or replace function public.save_lineup_plan(p_team uuid, p_date date, p_lineup jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.fantasy_teams;
begin
  t := public.require_team_manager(p_team);
  perform public.lock_league(t.league_id);
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

-- Applies each team's latest plan that is due (its day has started). Players who left the roster
-- are skipped, new players go to the bench, and anyone already locked (if this runs late) keeps
-- her slot. Called by the scheduled jobs every few minutes.
create or replace function public.apply_due_lineup_plans() returns int
language plpgsql security definer set search_path = public as $$
declare
  pl record;
  rec record;
  want text;
  n int := 0;
  taken text[];
  changed uuid[];
  final jsonb;
begin
  for pl in
    select distinct on (p.fantasy_team_id) p.*, t.league_id
      from public.lineup_plans p join public.fantasy_teams t on t.id = p.fantasy_team_id
     where p.applied_at is null and p.plan_date <= public.league_local_date(t.league_id)
     order by p.fantasy_team_id, p.plan_date desc
  loop
    perform public.lock_league(pl.league_id);
    taken := '{}';
    changed := '{}';
    final := '[]'::jsonb;
    -- Locked players keep their slot first.
    for rec in
      select ra.id as ra_id, ra.player_id, le.slot as cur_slot
        from public.roster_assignments ra
        left join public.lineup_entries le on le.roster_assignment_id = ra.id and le.valid_to is null
       where ra.fantasy_team_id = pl.fantasy_team_id and ra.released_at is null
         and public.player_is_locked(pl.league_id, ra.player_id)
    loop
      if rec.cur_slot is not null and rec.cur_slot <> 'BENCH' then taken := taken || rec.cur_slot; end if;
    end loop;
    for rec in
      select ra.id as ra_id, ra.player_id, pls.positions, coalesce(le.slot, 'BENCH') as cur_slot,
             public.player_is_locked(pl.league_id, ra.player_id) as locked
        from public.roster_assignments ra
        join public.players pls on pls.id = ra.player_id
        left join public.lineup_entries le on le.roster_assignment_id = ra.id and le.valid_to is null
       where ra.fantasy_team_id = pl.fantasy_team_id and ra.released_at is null
    loop
      if rec.locked then
        want := rec.cur_slot;
      else
        select e ->> 'slot' into want from jsonb_array_elements(pl.lineup) e where (e ->> 'player_id')::uuid = rec.player_id;
        want := coalesce(want, 'BENCH');
        if want <> 'BENCH' and (want = any (taken) or not public.player_eligible_for_slot(rec.positions, want)) then want := 'BENCH'; end if;
        if want <> 'BENCH' then taken := taken || want; end if;
      end if;
      if want is distinct from rec.cur_slot then
        changed := changed || rec.ra_id;
        final := final || jsonb_build_object('ra', rec.ra_id, 'slot', want);
      end if;
    end loop;
    if array_length(changed, 1) is not null then
      update public.lineup_entries set valid_to = now() where roster_assignment_id = any (changed) and valid_to is null;
      insert into public.lineup_entries (roster_assignment_id, fantasy_team_id, player_id, slot, changed_by)
      select ra.id, pl.fantasy_team_id, ra.player_id, (select f ->> 'slot' from jsonb_array_elements(final) f where (f ->> 'ra')::uuid = ra.id), pl.created_by
        from public.roster_assignments ra where ra.id = any (changed);
      perform public.write_audit(pl.league_id, 'lineup.plan_applied', 'fantasy_team', pl.fantasy_team_id::text, null, jsonb_build_object('date', pl.plan_date));
    end if;
    update public.lineup_plans p set applied_at = now()
      from public.fantasy_teams t
     where p.fantasy_team_id = pl.fantasy_team_id and t.id = p.fantasy_team_id
       and p.applied_at is null and p.plan_date <= public.league_local_date(t.league_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.internal_check_lineup(uuid, jsonb), public.save_lineup_plan(uuid, date, jsonb), public.apply_due_lineup_plans() from public, anon;
grant execute on function public.save_lineup_plan(uuid, date, jsonb) to authenticated;
