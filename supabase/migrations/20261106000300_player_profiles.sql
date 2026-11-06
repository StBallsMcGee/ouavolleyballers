-- Player profiles from official school roster pages (photos linked, not copied).
-- Only these fields are kept; program of study and other personal details are deliberately not stored.
create table public.player_profiles (
  player_id      uuid primary key references public.players (id) on delete cascade,
  photo_url      text,          -- the school's own image address (loaded by the viewer's browser)
  profile_url    text,          -- official bio page
  position_label text,
  height         text,
  academic_year  text,
  hometown       text,
  previous_team  text,
  source_label   text not null, -- e.g. 'Western Mustangs' (photo credit)
  source_site    text not null, -- e.g. 'westernmustangs.ca'
  fetched_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.player_profiles enable row level security;
create policy player_profiles_read on public.player_profiles for select to authenticated using (true);
revoke all on public.player_profiles from anon;
revoke insert, update, delete, truncate on public.player_profiles from authenticated;
grant select on public.player_profiles to authenticated;
