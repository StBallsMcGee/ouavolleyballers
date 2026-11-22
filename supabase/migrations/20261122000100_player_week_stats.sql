-- Each player's stats and fantasy points per fantasy week, for the Players tab's Leaders view
-- (rank by points for any week or the whole season, by position).

create or replace view public.v_player_week_stats with (security_invoker = true) as
select pmp.league_id, pmp.player_id, pmp.week,
       count(*)::int                             as games,
       coalesce(sum(s.sets_played), 0)::int      as sets,
       sum(s.kills)::int                         as kills,
       sum(s.attack_errors)::int                 as attack_errors,
       sum(s.attack_attempts)::int               as attack_attempts,
       sum(s.assists)::int                       as assists,
       sum(s.service_aces)::int                  as service_aces,
       sum(s.service_errors)::int                as service_errors,
       sum(s.digs)::int                          as digs,
       sum(s.solo_blocks)::int                   as solo_blocks,
       sum(s.block_assists)::int                 as block_assists,
       sum(pmp.points)::numeric(10, 2)           as points
from public.v_player_match_points pmp
join public.player_match_statistics s on s.player_id = pmp.player_id and s.match_id = pmp.match_id
group by pmp.league_id, pmp.player_id, pmp.week;

grant select on public.v_player_week_stats to authenticated;
