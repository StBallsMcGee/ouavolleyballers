-- Speed: fantasy points per player per match are now worked out once and saved, instead of being
-- recalculated from every stat line of the season on every page load. The database keeps the saved
-- points correct by itself:
--   * a stat line added, corrected or removed -> that player's match is recalculated
--   * a match's date, "counts for fantasy" or cancelled status changes -> that match is recalculated
--   * scoring rules or fantasy weeks change -> everything is recalculated
-- v_player_match_points keeps its name and columns, so every screen and view built on it is unchanged.

-- The calculation itself (exactly the previous v_player_match_points), kept as the source of truth.
create or replace view public.v_player_match_points_live with (security_invoker = true) as
select s.player_id, s.match_id, mw.league_id, mw.week,
       rs.id as rule_set_id, rs.version as scoring_version,
       coalesce(sum(r.points * public.stat_value(s, r.stat_key)), 0)::numeric(10, 2) as points
from public.player_match_statistics s
join public.v_match_league_weeks mw on mw.match_id = s.match_id
join lateral (
  select x.id, x.version from public.scoring_rule_sets x
  where x.league_id = mw.league_id and x.effective_from_week <= mw.week
  order by x.effective_from_week desc, x.version desc limit 1) rs on true
left join public.scoring_rules r on r.rule_set_id = rs.id and r.active
group by s.player_id, s.match_id, mw.league_id, mw.week, rs.id, rs.version;
revoke all on public.v_player_match_points_live from anon;

create table if not exists public.player_match_points (
  league_id       uuid not null references public.leagues (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete cascade,
  match_id        uuid not null references public.matches (id) on delete cascade,
  week            int not null,
  rule_set_id     uuid not null,
  scoring_version int not null,
  points          numeric(10, 2) not null,
  primary key (league_id, player_id, match_id)
);
create index if not exists player_match_points_week_idx on public.player_match_points (league_id, week);
create index if not exists player_match_points_match_idx on public.player_match_points (match_id);
create index if not exists player_match_points_player_idx on public.player_match_points (player_id);
alter table public.player_match_points enable row level security;
drop policy if exists player_match_points_read on public.player_match_points;
create policy player_match_points_read on public.player_match_points for select to authenticated
  using (league_id in (select public.my_league_ids()));
revoke all on public.player_match_points from anon;
revoke insert, update, delete, truncate on public.player_match_points from authenticated;
grant select on public.player_match_points to authenticated;

-- Recalculates the saved points: one player's match, one match, or (both null) everything.
create or replace function public.refresh_player_match_points(p_player uuid default null, p_match uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.player_match_points
   where (p_player is null or player_id = p_player) and (p_match is null or match_id = p_match);
  insert into public.player_match_points (league_id, player_id, match_id, week, rule_set_id, scoring_version, points)
  select league_id, player_id, match_id, week, rule_set_id, scoring_version, points
    from public.v_player_match_points_live
   where (p_player is null or player_id = p_player) and (p_match is null or match_id = p_match);
end;
$$;
revoke all on function public.refresh_player_match_points(uuid, uuid) from public, anon, authenticated;

create or replace function public.tg_points_stat_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_player_match_points(old.player_id, old.match_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.player_id <> old.player_id or new.match_id <> old.match_id) then
    perform public.refresh_player_match_points(new.player_id, new.match_id);
  end if;
  return null;
end;
$$;

create or replace function public.tg_points_match_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_player_match_points(null, new.id);
  return null;
end;
$$;

create or replace function public.tg_points_everything() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_player_match_points(null, null);
  return null;
end;
$$;

drop trigger if exists points_on_stats on public.player_match_statistics;
create trigger points_on_stats after insert or update or delete on public.player_match_statistics
  for each row execute function public.tg_points_stat_row();

drop trigger if exists points_on_match on public.matches;
create trigger points_on_match after update of match_date, counts_for_fantasy, status on public.matches
  for each row when (old.match_date is distinct from new.match_date
                     or old.counts_for_fantasy is distinct from new.counts_for_fantasy
                     or (old.status = 'cancelled') is distinct from (new.status = 'cancelled'))
  execute function public.tg_points_match_row();

drop trigger if exists points_on_rules on public.scoring_rules;
create trigger points_on_rules after insert or update or delete on public.scoring_rules
  for each statement execute function public.tg_points_everything();
drop trigger if exists points_on_rule_sets on public.scoring_rule_sets;
create trigger points_on_rule_sets after insert or update or delete on public.scoring_rule_sets
  for each statement execute function public.tg_points_everything();
drop trigger if exists points_on_weeks on public.matchup_weeks;
create trigger points_on_weeks after insert or update or delete on public.matchup_weeks
  for each statement execute function public.tg_points_everything();

-- Fill it now.
select public.refresh_player_match_points(null, null);

-- Screens read the saved points through the same view as before.
create or replace view public.v_player_match_points with (security_invoker = true) as
select player_id, match_id, league_id, week, rule_set_id, scoring_version, points
from public.player_match_points;
