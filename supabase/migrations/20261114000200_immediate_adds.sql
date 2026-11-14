-- Claiming a free agent whose game hasn't started today (so she isn't locked) adds her straight
-- away. A player who is locked (her game today has started or finished) is still claimed for
-- midnight, as is anyone other teams already have a pending claim on (so nobody jumps the queue).

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
  if public.player_is_locked(t.league_id, p_add)
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
revoke all on function public.claim_player(uuid, uuid, uuid) from public, anon;
grant execute on function public.claim_player(uuid, uuid, uuid) to authenticated;
