-- An accepted (or approved) trade happens right away only if none of its players has played yet
-- today. If any of them is locked (her game today has started or finished), the trade is
-- "accepted" and happens at midnight, when rosters unlock — like waiver claims.

alter type public.trade_status add value if not exists 'accepted';
alter table public.trades add column if not exists execute_after timestamptz;

-- Runs the trade now, or schedules it for midnight if any player in it is locked today.
create or replace function public.internal_accept_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tr public.trades;
begin
  select * into tr from public.trades where id = p_trade for update;
  if exists (select 1 from public.trade_items ti where ti.trade_id = p_trade
             and public.player_is_locked(tr.league_id, ti.player_id)) then
    update public.trades set status = 'accepted', execute_after = public.league_next_midnight(tr.league_id)
     where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.scheduled', 'trade', p_trade::text, null,
      jsonb_build_object('at', public.league_next_midnight(tr.league_id)));
  else
    perform public.internal_execute_trade(p_trade);
  end if;
end;
$$;

create or replace function public.respond_trade(p_trade uuid, p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path = public as $$
declare
  tr public.trades;
  lg public.leagues;
begin
  select * into tr from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform public.require_team_manager(tr.receiving_team_id);
  perform public.lock_league(tr.league_id);
  select * into tr from public.trades where id = p_trade for update;
  if tr.status <> 'proposed' then
    raise exception 'This trade is no longer open.';
  end if;
  select * into lg from public.leagues where id = tr.league_id;

  if not p_accept then
    update public.trades set status = 'rejected', responded_at = now() where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.rejected', 'trade', p_trade::text, null, null);
    return 'rejected';
  end if;

  update public.trades set responded_at = now() where id = p_trade;
  if coalesce(lg.settings -> 'trades' ->> 'review', 'none') = 'commissioner' then
    update public.trades set status = 'pending_review' where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.accepted', 'trade', p_trade::text, null, null);
    return 'pending_review';
  end if;

  perform public.internal_accept_trade(p_trade);
  return (select status from public.trades where id = p_trade);
end;
$$;

create or replace function public.review_trade(p_trade uuid, p_approve boolean, p_reason text default null)
returns public.trade_status language plpgsql security definer set search_path = public as $$
declare tr public.trades;
begin
  select * into tr from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  perform public.require_league_admin(tr.league_id);
  perform public.lock_league(tr.league_id);
  if tr.status <> 'pending_review' then
    raise exception 'This trade is not waiting for review.';
  end if;
  if p_approve then
    perform public.internal_accept_trade(p_trade);
  else
    update public.trades set status = 'vetoed', status_reason = nullif(trim(p_reason), ''), processed_at = now()
     where id = p_trade;
    perform public.write_audit(tr.league_id, 'trade.vetoed', 'trade', p_trade::text, null,
      jsonb_build_object('reason', p_reason));
  end if;
  return (select status from public.trades where id = p_trade);
end;
$$;

-- Carries out accepted trades whose midnight has come (oldest first). If a player has left one of
-- the teams in the meantime, that trade fails with the reason, as any trade would.
create or replace function public.process_due_trades() returns int
language plpgsql security definer set search_path = public as $$
declare
  tr record;
  n int := 0;
begin
  for tr in
    select id, league_id from public.trades
     where status::text = 'accepted' and execute_after <= now()
     order by responded_at nulls last, created_at
  loop
    perform public.lock_league(tr.league_id);
    perform public.internal_execute_trade(tr.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.internal_accept_trade(uuid), public.process_due_trades() from public, anon, authenticated;
