-- Waiver order = reverse standings. Each night the claims of the team lowest in the standings
-- are decided first (ties: fewer points scored first), then the next team up, and so on. Winning
-- a claim doesn't change a team's place (replaces the rolling order).

create or replace function public.process_waivers(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n int := 0;
  limit_n int := public.league_roster_limit(p_league);
begin
  perform public.lock_league(p_league);
  loop
    select wc.* into c
      from public.waiver_claims wc
      left join public.v_standings st on st.fantasy_team_id = wc.fantasy_team_id
     where wc.league_id = p_league and wc.status = 'pending' and wc.process_after <= now()
     order by st.rank desc nulls first, st.points_for asc nulls first, wc.created_at
     limit 1;
    exit when not found;

    if exists (select 1 from public.roster_assignments where league_id = p_league and player_id = c.player_id and released_at is null) then
      update public.waiver_claims set status = 'lost', processed_at = now(), detail = 'A team lower in the standings got her.' where id = c.id;
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
