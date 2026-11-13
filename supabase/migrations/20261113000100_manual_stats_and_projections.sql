-- 1. Admins can type in a game's box score by hand when no source has it.
-- 2. Projected fantasy points per game for every player, from her recent form.

-- ---------------------------------------------------------------------------
-- Manual stats
-- ---------------------------------------------------------------------------
-- p_rows: [{ "player_id": uuid, "remove": bool, "kills": int, "attack_errors": int,
--   "attack_attempts": int, "assists": int, "service_aces": int, "service_errors": int,
--   "digs": int, "solo_blocks": int, "block_assists": int, "sets_played": int|null }]
-- A player who must be on one of the two teams. "remove" deletes a line that was typed in by
-- hand (lines from an official source are never deleted here). If an official source later
-- publishes this game, its numbers replace the typed-in ones.
create or replace function public.admin_set_match_stats(p_match uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  r jsonb;
  pl public.players;
  lg uuid;
  n int := 0;
  keys text[] := array['kills','attack_errors','attack_attempts','assists','service_aces','service_errors','digs','solo_blocks','block_assists'];
  k text;
  v int;
begin
  perform public.require_user();
  if not public.is_any_admin() then
    raise exception 'Only the league administrator can do this.' using errcode = '42501';
  end if;
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'Too many rows.'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    select * into pl from public.players where id = (r ->> 'player_id')::uuid;
    if not found then raise exception 'Unknown player.'; end if;
    if pl.university_id is distinct from m.home_university_id and pl.university_id is distinct from m.away_university_id then
      raise exception '% does not play for either team in this match.', pl.display_name;
    end if;
    if coalesce((r ->> 'remove')::boolean, false) then
      delete from public.player_match_statistics where player_id = pl.id and match_id = m.id and source_system = 'manual';
      continue;
    end if;
    foreach k in array keys loop
      v := coalesce((r ->> k)::int, 0);
      if v < 0 or v > 300 then raise exception '%: % must be between 0 and 300.', pl.display_name, k; end if;
    end loop;
    if (r ->> 'sets_played') is not null and ((r ->> 'sets_played')::int < 0 or (r ->> 'sets_played')::int > 5) then
      raise exception '%: sets played must be between 0 and 5.', pl.display_name;
    end if;
    insert into public.player_match_statistics as t (player_id, match_id, university_id, kills, attack_errors, attack_attempts,
      assists, service_aces, service_errors, digs, solo_blocks, block_assists, sets_played, source_system, source_hash, source_updated_at)
    values (pl.id, m.id, pl.university_id, coalesce((r ->> 'kills')::int, 0), coalesce((r ->> 'attack_errors')::int, 0),
      coalesce((r ->> 'attack_attempts')::int, 0), coalesce((r ->> 'assists')::int, 0), coalesce((r ->> 'service_aces')::int, 0),
      coalesce((r ->> 'service_errors')::int, 0), coalesce((r ->> 'digs')::int, 0), coalesce((r ->> 'solo_blocks')::int, 0),
      coalesce((r ->> 'block_assists')::int, 0), (r ->> 'sets_played')::int, 'manual', 'manual:' || md5(r::text), now())
    on conflict (player_id, match_id) do update set
      university_id = excluded.university_id, kills = excluded.kills, attack_errors = excluded.attack_errors,
      attack_attempts = excluded.attack_attempts, assists = excluded.assists, service_aces = excluded.service_aces,
      service_errors = excluded.service_errors, digs = excluded.digs, solo_blocks = excluded.solo_blocks,
      block_assists = excluded.block_assists, sets_played = excluded.sets_played, source_system = 'manual',
      source_hash = excluded.source_hash, source_updated_at = now(), updated_at = now();
    n := n + 1;
  end loop;

  update public.matches set stats_available = exists (select 1 from public.player_match_statistics s where s.match_id = m.id) where id = m.id;
  select league_id into lg from public.league_members where user_id = auth.uid() and role = 'admin' limit 1;
  if lg is null then select id into lg from public.leagues order by created_at limit 1; end if;
  perform public.write_audit(lg, 'stats.manual', 'match', m.id::text, null, jsonb_build_object('rows', jsonb_array_length(p_rows), 'saved', n));
  return n;
end;
$$;
revoke all on function public.admin_set_match_stats(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_match_stats(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Projections
-- ---------------------------------------------------------------------------
-- Projected points per game = her recent form this season (latest games count most), blended
-- with a starting estimate that matters less as she plays more: last season's average under
-- this league's scoring if she played at least 3 games, otherwise the average for her position.
create or replace view public.v_player_projections with (security_invoker = true) as
with cur as (
  select pmp.league_id, pmp.player_id, pmp.points::numeric as pts,
         row_number() over (partition by pmp.league_id, pmp.player_id order by m.match_date desc, m.id) as rn
  from public.v_player_match_points pmp
  join public.matches m on m.id = pmp.match_id
), cur_agg as (
  select league_id, player_id, count(*)::int as games, avg(pts) as avg_pts,
         avg(pts) filter (where rn <= 3) as last3,
         sum(pts * power(0.8, rn - 1)) / sum(power(0.8, rn - 1)) as weighted,
         max(pts) as best, min(pts) as worst, coalesce(stddev_samp(pts), 0) as sd
  from cur group by league_id, player_id
), latest_rules as (
  select distinct on (rs.league_id) rs.league_id, rs.id
  from public.scoring_rule_sets rs order by rs.league_id, rs.effective_from_week desc, rs.version desc
), prev as (
  select l.id as league_id, s.player_id, count(*)::int as games,
         avg((select coalesce(sum(r.points * public.stat_value(s, r.stat_key)), 0)
              from public.scoring_rules r where r.rule_set_id = lr.id and r.active)) as avg_pts
  from public.leagues l
  join latest_rules lr on lr.league_id = l.id
  join public.matches m on m.season_label <> l.season_label and m.match_date > current_date - 550
  join public.player_match_statistics s on s.match_id = m.id
  group by l.id, s.player_id
), pos as (
  select c.league_id, p.position_label, avg(c.avg_pts) as pos_avg
  from cur_agg c join public.players p on p.id = c.player_id
  where c.games >= 2 group by c.league_id, p.position_label
), base as (
  select coalesce(c.league_id, pv.league_id) as league_id, coalesce(c.player_id, pv.player_id) as player_id,
         c.games, c.avg_pts, c.last3, c.weighted, c.best, c.worst, c.sd, pv.games as prev_games, pv.avg_pts as prev_avg
  from cur_agg c full join prev pv on pv.league_id = c.league_id and pv.player_id = c.player_id
)
select b.league_id, b.player_id,
       coalesce(b.games, 0) as games,
       round(b.avg_pts, 2) as avg_points,
       round(b.last3, 2) as last3_avg,
       round(b.best, 2) as best,
       round(b.worst, 2) as worst,
       round(b.sd, 2) as stddev,
       coalesce(b.prev_games, 0) as prev_games,
       round(b.prev_avg, 2) as prev_avg,
       round(((coalesce(b.games, 0) * coalesce(b.weighted, 0))
              + 3 * coalesce(case when b.prev_games >= 3 then b.prev_avg end, ps.pos_avg, b.avg_pts, 0))
             / (coalesce(b.games, 0) + 3), 2) as proj_per_game
from base b
left join public.players p on p.id = b.player_id
left join pos ps on ps.league_id = b.league_id and ps.position_label is not distinct from p.position_label;
grant select on public.v_player_projections to authenticated;

-- The calculation above takes about a second, so it is saved in a table by the regular sync
-- (and after stats are typed in); pages read the saved numbers instantly.
revoke select on public.v_player_projections from authenticated;
create table if not exists public.player_projections (
  league_id     uuid not null references public.leagues (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete cascade,
  games         int not null,
  avg_points    numeric(10, 2),
  last3_avg     numeric(10, 2),
  best          numeric(10, 2),
  worst         numeric(10, 2),
  stddev        numeric(10, 2),
  prev_games    int not null,
  prev_avg      numeric(10, 2),
  proj_per_game numeric(10, 2),
  updated_at    timestamptz not null default now(),
  primary key (league_id, player_id)
);
alter table public.player_projections enable row level security;
drop policy if exists projections_read on public.player_projections;
create policy projections_read on public.player_projections for select to authenticated
  using (league_id in (select public.my_league_ids()));
revoke all on public.player_projections from anon;
revoke insert, update, delete, truncate on public.player_projections from authenticated;
grant select on public.player_projections to authenticated;

create or replace function public.refresh_player_projections(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.player_projections where league_id = p_league;
  insert into public.player_projections (league_id, player_id, games, avg_points, last3_avg, best, worst, stddev, prev_games, prev_avg, proj_per_game)
  select league_id, player_id, games, avg_points, last3_avg, best, worst, stddev, prev_games, prev_avg, proj_per_game
  from public.v_player_projections where league_id = p_league;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.refresh_player_projections(uuid) from public, anon, authenticated;

-- Typed-in stats update the projections straight away.
create or replace function public.admin_set_match_stats_and_refresh(p_match uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int; l uuid;
begin
  n := public.admin_set_match_stats(p_match, p_rows);
  for l in select id from public.leagues where status in ('setup', 'active') loop
    perform public.refresh_player_projections(l);
  end loop;
  return n;
end;
$$;
revoke all on function public.admin_set_match_stats_and_refresh(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_match_stats_and_refresh(uuid, jsonb) to authenticated;

do $$ declare l uuid; begin
  for l in select id from public.leagues loop perform public.refresh_player_projections(l); end loop;
end $$;
