-- Official box scores found on school websites (second statistics source, see src/lib/ingest/boxscores.ts).
create table public.box_score_links (
  match_id      uuid not null references public.matches (id) on delete cascade,
  school_site   text not null,
  url           text not null,
  discovered_at timestamptz not null default now(),
  fetched_at    timestamptz,
  status        text not null default 'found' check (status in ('found', 'loaded', 'error')),
  detail        text,
  primary key (match_id, school_site)
);

alter table public.box_score_links enable row level security;
create policy box_score_links_read on public.box_score_links for select to authenticated using (public.is_any_admin());
revoke all on public.box_score_links from anon;
revoke insert, update, delete, truncate on public.box_score_links from authenticated;
grant select on public.box_score_links to authenticated;
