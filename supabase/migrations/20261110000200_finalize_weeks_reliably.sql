-- Weeks (Monday–Sunday) now become final as soon as all of the week's games are finished, from
-- Monday 00:00, and at the latest on Tuesday 00:00 even if a game's status never got updated by a
-- source. Points stay live: if a late box score arrives, a final week's score and the standings
-- update automatically.
create or replace function public.refresh_matchup_statuses(p_league uuid, p_grace interval default interval '1 day')
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := public.league_local_date(p_league);
  local_now timestamp := now() at time zone (select timezone from public.leagues where id = p_league);
  n int := 0;
  k int;
begin
  update public.matchups mu set status = 'in_progress'
   from public.matchup_weeks w
   where w.league_id = mu.league_id and w.week = mu.week and mu.league_id = p_league
     and mu.status = 'scheduled' and mu.score_source = 'calculated' and today >= w.starts_on;
  get diagnostics k = row_count; n := n + k;

  update public.matchups mu set status = 'final', finalized_at = now()
   from public.matchup_weeks w
   where w.league_id = mu.league_id and w.week = mu.week and mu.league_id = p_league
     and mu.status in ('scheduled', 'in_progress') and mu.score_source = 'calculated'
     and (
       -- the week is over and every game in it is finished (or postponed/cancelled) ...
       ((w.ends_on + 1)::timestamp <= local_now and not exists (
          select 1 from public.matches m
          where m.match_date between w.starts_on and w.ends_on and m.counts_for_fantasy
            and m.status in ('scheduled', 'live')))
       -- ... or the grace period after the week is over, whatever the sources say.
       or (w.ends_on + 1)::timestamp + p_grace <= local_now);
  get diagnostics k = row_count; n := n + k;
  return n;
end;
$$;
