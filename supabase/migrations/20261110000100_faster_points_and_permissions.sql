-- Speed: the same results, computed far less often.
--
-- 1. Permission checks ("is this person in this league?") were run once per ROW for teams,
--    rosters, lineups and scoring rules. They now look up the person's leagues once per query
--    and compare against that list.
-- 2. Matchup scores added up every team's week points separately for each side of each matchup.
--    They now add them up once and look them up.
-- Nothing about who can see what, or how points are scored, changes.

create or replace function public.my_league_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.leagues where public.is_site_admin()
  union
  select league_id from public.league_members where user_id = auth.uid();
$$;

create or replace function public.my_admin_league_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.leagues where public.is_site_admin()
  union
  select league_id from public.league_members where user_id = auth.uid() and role = 'admin';
$$;

create or replace function public.my_league_team_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.fantasy_teams where league_id in (select public.my_league_ids());
$$;

create or replace function public.my_league_rule_set_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.scoring_rule_sets where league_id in (select public.my_league_ids());
$$;

create or replace function public.my_league_trade_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.trades where league_id in (select public.my_league_ids());
$$;

revoke all on function public.my_league_ids(), public.my_admin_league_ids(), public.my_league_team_ids(),
  public.my_league_rule_set_ids(), public.my_league_trade_ids() from public, anon;
grant execute on function public.my_league_ids(), public.my_admin_league_ids(), public.my_league_team_ids(),
  public.my_league_rule_set_ids(), public.my_league_trade_ids() to authenticated;

alter policy leagues_read on public.leagues using (id in (select public.my_league_ids()));
alter policy league_members_read on public.league_members using (league_id in (select public.my_league_ids()));
alter policy weeks_read on public.matchup_weeks using (league_id in (select public.my_league_ids()));
alter policy teams_read on public.fantasy_teams using (league_id in (select public.my_league_ids()));
alter policy roster_read on public.roster_assignments using (league_id in (select public.my_league_ids()));
alter policy lineup_read on public.lineup_entries using (fantasy_team_id in (select public.my_league_team_ids()));
alter policy rule_sets_read on public.scoring_rule_sets using (league_id in (select public.my_league_ids()));
alter policy rules_read on public.scoring_rules using (rule_set_id in (select public.my_league_rule_set_ids()));
alter policy matchups_read on public.matchups using (league_id in (select public.my_league_ids()));
alter policy trades_read on public.trades using (league_id in (select public.my_league_ids()));
alter policy trade_items_read on public.trade_items using (trade_id in (select public.my_league_trade_ids()));
alter policy transactions_read on public.transactions using (league_id in (select public.my_league_ids()));
alter policy audit_read on public.audit_log using (league_id in (select public.my_admin_league_ids()));

-- Matchup scores: team week totals are added up once, then looked up for both sides.
create or replace view public.v_matchup_scores with (security_invoker = true) as
with tw as (
  select fantasy_team_id, week, points from public.v_team_week_points
), s as (
  select mu.*,
         (case when mu.score_source = 'imported' then coalesce(mu.imported_home_score, 0)
               else coalesce(h.points, 0) end)::numeric(10, 2) as home_pts,
         (case when mu.score_source = 'imported' then coalesce(mu.imported_away_score, 0)
               else coalesce(a.points, 0) end)::numeric(10, 2) as away_pts
  from public.matchups mu
  left join tw h on h.fantasy_team_id = mu.home_team_id and h.week = mu.week
  left join tw a on a.fantasy_team_id = mu.away_team_id and a.week = mu.week
)
select s.id, s.league_id, s.week, s.home_team_id, s.away_team_id, s.status,
       s.score_source, s.playoff_round, s.finalized_at,
       s.home_pts as home_score, s.away_pts as away_score,
       case when s.status = 'final' and s.home_pts > s.away_pts then s.home_team_id
            when s.status = 'final' and s.away_pts > s.home_pts then s.away_team_id end as winner_team_id,
       (s.status = 'final' and s.home_pts = s.away_pts) as is_tie
from s;

-- Lookups the pages make on every visit.
create index if not exists lineup_entries_player_idx on public.lineup_entries (player_id);
create index if not exists roster_assignments_player_idx on public.roster_assignments (league_id, player_id);
create index if not exists matchups_league_week_idx on public.matchups (league_id, week);
create index if not exists matches_date_idx on public.matches (match_date);

-- Team points: score only the stat lines of players who were on a fantasy roster for that match,
-- instead of scoring every player in the conference and then filtering.
create or replace view public.v_team_player_match_points with (security_invoker = true) as
select mw.league_id, ra.fantasy_team_id, s.player_id, s.match_id, mw.week,
       le.slot, (le.slot <> 'BENCH') as counted, pts.points, pts.scoring_version
from public.roster_assignments ra
join public.player_match_statistics s on s.player_id = ra.player_id
join public.v_match_league_weeks mw on mw.match_id = s.match_id and mw.league_id = ra.league_id
join public.matches m on m.id = s.match_id
 and ra.acquired_at <= m.lock_at and (ra.released_at is null or ra.released_at > m.lock_at)
join public.lineup_entries le
  on le.roster_assignment_id = ra.id
 and le.valid_from <= m.lock_at and (le.valid_to is null or le.valid_to > m.lock_at)
cross join lateral (
  select rs.version as scoring_version,
         coalesce((select sum(r.points * public.stat_value(s, r.stat_key))
                   from public.scoring_rules r where r.rule_set_id = rs.id and r.active), 0)::numeric(10, 2) as points
  from public.scoring_rule_sets rs
  where rs.league_id = mw.league_id and rs.effective_from_week <= mw.week
  order by rs.effective_from_week desc, rs.version desc limit 1) pts;

-- Everything a page needs about the signed-in person and their league, in one round trip
-- (previously three in a row). Only returns the person's own league.
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  with prof as (
    select id, email, display_name, is_site_admin from public.profiles where id = auth.uid()
  ), mem as (
    select league_id, role::text as role from public.league_members where user_id = auth.uid()
  ), lg as (
    select l.id, l.name, l.season_label, l.status::text as status, l.timezone, l.settings
      from public.leagues l
     where l.id = coalesce(
       (select league_id from mem limit 1),
       (select x.id from public.leagues x where (select is_site_admin from prof) order by x.created_at limit 1))
  )
  select jsonb_build_object(
    'profile', (select to_jsonb(prof) from prof),
    'memberships', coalesce((select jsonb_agg(to_jsonb(mem)) from mem), '[]'::jsonb),
    'league', (select to_jsonb(lg) from lg),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'owner_user_id', t.owner_user_id,
               'manager_display_name', t.manager_display_name, 'active', t.active,
               'owner_name', p.display_name) order by t.name)
        from public.fantasy_teams t left join public.profiles p on p.id = t.owner_user_id
       where t.league_id = (select id from lg) and t.active), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'starts_on', w.starts_on, 'ends_on', w.ends_on,
               'is_playoff', w.is_playoff) order by w.week)
        from public.matchup_weeks w where w.league_id = (select id from lg)), '[]'::jsonb));
$$;
revoke all on function public.my_context() from public, anon;
grant execute on function public.my_context() to authenticated;

-- Season totals per player, added up in the database (one small result instead of every stat line).
create or replace view public.v_player_season_points with (security_invoker = true) as
select league_id, player_id, sum(points)::numeric(10, 2) as points, count(*)::int as games
from public.v_player_match_points
group by league_id, player_id;
grant select on public.v_player_season_points to authenticated;
