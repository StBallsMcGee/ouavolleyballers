-- Weekly player news stories. Written once per player per completed week (shortly after
-- midnight Sunday) by /api/cron/news and kept, so a story never changes after it's published.
-- Safe to run again (e.g. if an earlier version of this file was already run).

create table if not exists public.player_news (
  league_id   uuid not null references public.leagues (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  week        int not null,
  headline    text not null,
  paragraphs  jsonb not null,                 -- ["first paragraph", "second", ...]
  written_by  text not null default 'gemini',
  created_at  timestamptz not null default now(),
  primary key (league_id, player_id, week)
);
alter table public.player_news drop constraint if exists player_news_written_by_check;
alter table public.player_news add constraint player_news_written_by_check check (written_by in ('gemini', 'claude', 'template'));
create index if not exists player_news_week_idx on public.player_news (league_id, week);
alter table public.player_news enable row level security;
drop policy if exists player_news_read on public.player_news;
create policy player_news_read on public.player_news for select to authenticated
  using (league_id in (select public.my_league_ids()));
revoke all on public.player_news from anon;
revoke insert, update, delete, truncate on public.player_news from authenticated;
grant select on public.player_news to authenticated;

-- Schedule the writer, reusing the address and secret of the existing live-scoring job.
-- Every 2 minutes from 04:00 to 11:59 UTC on Mondays (midnight to ~7 a.m. in Toronto, either
-- side of daylight saving), plus a daily catch-up. It does nothing once every story is written.
do $$
declare cmd text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed: schedule /api/cron/news by hand (see docs/DEPLOYMENT.md)';
    return;
  end if;
  execute $q$select command from cron.job where jobname = 'sideout-live'$q$ into cmd;
  if cmd is null then
    raise notice 'sideout-live job not found: schedule /api/cron/news by hand (see docs/DEPLOYMENT.md)';
    return;
  end if;
  cmd := replace(cmd, '/api/cron/live', '/api/cron/news');
  execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('sideout-news', 'sideout-news-catchup')$q$;
  execute $q$select cron.schedule('sideout-news', '*/2 4-11 * * 1', $1)$q$ using cmd;
  execute $q$select cron.schedule('sideout-news-catchup', '23 16 * * *', $1)$q$ using cmd;
end $$;
