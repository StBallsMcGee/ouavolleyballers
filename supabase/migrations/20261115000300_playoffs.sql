-- Playoffs, created automatically:
--   Week 11: quarterfinals, seeds 1–8 (1v8, 4v5, 2v7, 3v6). Seeds 9–16 start the consolation ladder
--            the same way (9v16, 12v13, 10v15, 11v14).
--   Week 12: semifinals for the winners; the losers play for the lower places (5th–8th, 13th–16th).
--   Week 13: championship and bronze medal games, and a game for every other place (5th, 7th, ...).
-- Every team plays every week. A round is created as soon as the previous week is final.
-- Ties go to the higher seed. Playoff and ladder games don't count in the regular standings.

alter table public.matchups add column if not exists place_base int;    -- best place this game decides (1 = title)
alter table public.matchups add column if not exists bracket_slot int;  -- order within the round (who meets whom next)
alter table public.matchups add column if not exists seed_home int;
alter table public.matchups add column if not exists seed_away int;
alter table public.matchups add column if not exists label text;        -- "Quarterfinal", "Championship", "9th place", ...

-- The matchup view also carries the playoff details (new columns at the end).
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
       (s.status = 'final' and s.home_pts = s.away_pts) as is_tie,
       s.place_base, s.bracket_slot, s.seed_home, s.seed_away, s.label
from s;

create or replace function public.ordinal_suffix(n int) returns text language sql immutable as $$
  select case when n % 100 between 11 and 13 then 'th'
              when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end;
$$;

create or replace function public.playoff_label(p_round int, p_base int, p_winners boolean) returns text
language sql immutable as $$
  select case
    when p_round = 1 and p_base = 1 then 'Quarterfinal'
    when p_round = 1 then 'Consolation ladder · round 1'
    when p_round = 2 and p_base = 1 then 'Semifinal'
    when p_round = 2 then p_base || public.ordinal_suffix(p_base) || '–' || (p_base + 3) || 'th place semifinal'
    when p_round = 3 and p_base = 1 then 'Championship'
    when p_round = 3 and p_base = 3 then 'Bronze medal'
    else p_base || public.ordinal_suffix(p_base) || ' place'
  end;
$$;

-- Creates the next playoff round when it is due. Safe to run any time (does nothing otherwise).
create or replace function public.advance_playoffs(p_league uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  po jsonb;
  start_w int;
  w int;
  r int;
  n int := 0;
  seeds uuid[];
  grp record;
  m1 record;
  m2 record;
  w1 uuid; w2 uuid; l1 uuid; l2 uuid;
  sw1 int; sw2 int; sl1 int; sl2 int;
  seed_of jsonb := '{}'::jsonb;
  pair int[];
  pairs int[][] := array[array[1, 8], array[4, 5], array[2, 7], array[3, 6]];
  base int;
  k int;
begin
  select settings -> 'playoffs' into po from public.leagues where id = p_league;
  if po is null or coalesce((po ->> 'enabled')::boolean, false) is not true then return 0; end if;
  start_w := coalesce((po ->> 'startWeek')::int, 11);

  for r in 1..3 loop
    w := start_w + r - 1;
    continue when exists (select 1 from public.matchups where league_id = p_league and week = w);
    exit when not exists (select 1 from public.matchup_weeks where league_id = p_league and week = w);

    if r = 1 then
      -- The regular season must be over: every earlier matchup final (or void).
      exit when not exists (select 1 from public.matchups where league_id = p_league and week < start_w)
             or exists (select 1 from public.matchups where league_id = p_league and week < start_w and status not in ('final', 'void'));
      select array_agg(fantasy_team_id order by rank, points_for desc, fantasy_team_id) into seeds
        from public.v_standings where league_id = p_league;
      exit when coalesce(array_length(seeds, 1), 0) < 8;
      foreach base in array array[1, 9] loop
        continue when base = 9 and array_length(seeds, 1) < 16;
        k := 0;
        foreach pair slice 1 in array pairs loop
          k := k + 1;
          insert into public.matchups (league_id, week, home_team_id, away_team_id, playoff_round, place_base, bracket_slot, seed_home, seed_away, label)
          values (p_league, w, seeds[base - 1 + pair[1]], seeds[base - 1 + pair[2]], 1, base, k, base - 1 + pair[1], base - 1 + pair[2],
                  public.playoff_label(1, base, true));
          n := n + 1;
        end loop;
      end loop;
    else
      -- The previous round must be final.
      exit when exists (select 1 from public.matchups where league_id = p_league and week = w - 1 and status <> 'final');
      exit when not exists (select 1 from public.matchups where league_id = p_league and week = w - 1);
      for grp in
        select distinct place_base from public.matchups where league_id = p_league and week = w - 1 and place_base is not null order by 1
      loop
        -- Games 1+2 (and 3+4 in round 1) feed the next round.
        for k in 0 .. (case when r = 2 then 1 else 0 end) loop
          select * into m1 from public.v_matchup_scores where league_id = p_league and week = w - 1 and place_base = grp.place_base and bracket_slot = 2 * k + 1;
          select * into m2 from public.v_matchup_scores where league_id = p_league and week = w - 1 and place_base = grp.place_base and bracket_slot = 2 * k + 2;
          continue when m1.id is null or m2.id is null;
          -- Winner of each game (a tie goes to the higher seed, i.e. the lower number).
          if m1.winner_team_id is not null then w1 := m1.winner_team_id; else w1 := case when m1.seed_home <= m1.seed_away then m1.home_team_id else m1.away_team_id end; end if;
          l1 := case when w1 = m1.home_team_id then m1.away_team_id else m1.home_team_id end;
          sw1 := case when w1 = m1.home_team_id then m1.seed_home else m1.seed_away end;
          sl1 := case when w1 = m1.home_team_id then m1.seed_away else m1.seed_home end;
          if m2.winner_team_id is not null then w2 := m2.winner_team_id; else w2 := case when m2.seed_home <= m2.seed_away then m2.home_team_id else m2.away_team_id end; end if;
          l2 := case when w2 = m2.home_team_id then m2.away_team_id else m2.home_team_id end;
          sw2 := case when w2 = m2.home_team_id then m2.seed_home else m2.seed_away end;
          sl2 := case when w2 = m2.home_team_id then m2.seed_away else m2.seed_home end;

          if r = 2 then
            -- Winners stay in this group; losers drop to the group four places lower.
            insert into public.matchups (league_id, week, home_team_id, away_team_id, playoff_round, place_base, bracket_slot, seed_home, seed_away, label)
            values (p_league, w, case when sw1 <= sw2 then w1 else w2 end, case when sw1 <= sw2 then w2 else w1 end, 2, grp.place_base, k + 1,
                    least(sw1, sw2), greatest(sw1, sw2), public.playoff_label(2, grp.place_base, true)),
                   (p_league, w, case when sl1 <= sl2 then l1 else l2 end, case when sl1 <= sl2 then l2 else l1 end, 2, grp.place_base + 4, k + 1,
                    least(sl1, sl2), greatest(sl1, sl2), public.playoff_label(2, grp.place_base + 4, false));
          else
            -- Final round: winners play for this group's best place, losers for two places lower.
            insert into public.matchups (league_id, week, home_team_id, away_team_id, playoff_round, place_base, bracket_slot, seed_home, seed_away, label)
            values (p_league, w, case when sw1 <= sw2 then w1 else w2 end, case when sw1 <= sw2 then w2 else w1 end, 3, grp.place_base, 1,
                    least(sw1, sw2), greatest(sw1, sw2), public.playoff_label(3, grp.place_base, true)),
                   (p_league, w, case when sl1 <= sl2 then l1 else l2 end, case when sl1 <= sl2 then l2 else l1 end, 3, grp.place_base + 2, 1,
                    least(sl1, sl2), greatest(sl1, sl2), public.playoff_label(3, grp.place_base + 2, false));
          end if;
          n := n + 2;
        end loop;
      end loop;
    end if;
    if n > 0 then
      update public.matchup_weeks set is_playoff = true where league_id = p_league and week = w;
      perform public.write_audit(p_league, 'playoffs.round', 'matchup_week', w::text, null, jsonb_build_object('round', r, 'games', n));
      exit; -- one round per run
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.advance_playoffs(uuid) from public, anon, authenticated;

-- This league: top eight make the playoffs, starting in week 11.
update public.leagues
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{playoffs}', '{"enabled": true, "teams": 8, "startWeek": 11}'::jsonb)
 where status in ('setup', 'active');
