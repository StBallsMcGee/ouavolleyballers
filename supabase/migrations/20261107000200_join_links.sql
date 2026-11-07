-- One shareable invite link per league. Anyone with the link can create an account and pick
-- an unclaimed team. The link's code is the only secret; the admin can replace it at any time,
-- which stops the old link working. Teams already claimed can't be taken through the link.

create table public.league_join_links (
  league_id  uuid primary key references public.leagues (id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.league_join_links enable row level security;
-- No direct access at all: only the functions below read it.
revoke all on public.league_join_links from anon, authenticated;

-- Admin: the league's link code, created on first use. p_reset = true makes a new one.
create or replace function public.admin_join_code(p_league uuid, p_reset boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform public.require_league_admin(p_league);
  select code into c from public.league_join_links where league_id = p_league;
  if c is null or p_reset then
    c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    insert into public.league_join_links (league_id, code, created_by) values (p_league, c, auth.uid())
      on conflict (league_id) do update set code = excluded.code, created_at = now(), created_by = excluded.created_by;
    perform public.write_audit(p_league, 'league.join_link', 'league', p_league::text, null,
      jsonb_build_object('reset', p_reset));
  end if;
  return c;
end;
$$;

-- Anyone holding a code: which league it is and how many teams are still open.
create or replace function public.join_link_info(p_code text)
returns table (league_name text, open_teams int) language sql stable security definer set search_path = public as $$
  select l.name,
         (select count(*)::int from public.fantasy_teams t where t.league_id = l.id and t.active and t.owner_user_id is null)
    from public.league_join_links j join public.leagues l on l.id = j.league_id
   where j.code = p_code;
$$;

-- Signed in with a valid code: the teams still waiting for a manager.
create or replace function public.join_link_teams(p_code text)
returns table (id uuid, name text, manager_hint text) language plpgsql stable security definer set search_path = public as $$
declare lg uuid;
begin
  perform public.require_user();
  select league_id into lg from public.league_join_links where code = p_code;
  if lg is null then raise exception 'This invite link is no longer valid. Ask the league admin for the new one.'; end if;
  return query
    select t.id, t.name, t.manager_display_name from public.fantasy_teams t
     where t.league_id = lg and t.active and t.owner_user_id is null
     order by t.name;
end;
$$;

-- Signed in with a valid code: take an unclaimed team (first come, first served).
create or replace function public.join_with_link(p_code text, p_team uuid, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  lg uuid;
  t public.fantasy_teams;
  mine text;
begin
  perform public.require_user();
  select league_id into lg from public.league_join_links where code = p_code;
  if lg is null then raise exception 'This invite link is no longer valid. Ask the league admin for the new one.'; end if;
  select * into t from public.fantasy_teams where id = p_team and league_id = lg for update;
  if not found or not t.active then raise exception 'That team is not part of this league.'; end if;
  select name into mine from public.fantasy_teams where league_id = lg and owner_user_id = auth.uid() limit 1;
  if mine is not null then raise exception 'You already manage %.', mine; end if;
  if t.owner_user_id is not null then raise exception 'Someone has already claimed %. Pick another team, or ask the league admin.', t.name; end if;

  update public.fantasy_teams set owner_user_id = auth.uid() where id = p_team;
  update public.team_invitations set claimed_at = now() where fantasy_team_id = p_team;
  insert into public.league_members (league_id, user_id, role) values (lg, auth.uid(), 'manager')
    on conflict (league_id, user_id) do nothing;
  if nullif(trim(p_display_name), '') is not null then
    update public.profiles set display_name = left(trim(p_display_name), 60) where id = auth.uid();
  end if;
  perform public.write_audit(lg, 'team.claimed', 'fantasy_team', p_team::text, null,
    jsonb_build_object('user_id', auth.uid(), 'via', 'invite link'));
  return lg;
end;
$$;

revoke all on function public.admin_join_code(uuid, boolean), public.join_link_info(text),
  public.join_link_teams(text), public.join_with_link(text, uuid, text) from public;
grant execute on function public.admin_join_code(uuid, boolean), public.join_link_teams(text),
  public.join_with_link(text, uuid, text) to authenticated;
grant execute on function public.join_link_info(text) to anon, authenticated;
