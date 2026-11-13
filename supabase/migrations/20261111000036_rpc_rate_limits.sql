-- Keep only the intentional anonymous read helpers executable by anonymous callers.
-- CREATE OR REPLACE preserves legacy ACLs, including grants on trigger functions.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosecdef
 and p.oid not in ('public.get_tournament_preview(text)'::regprocedure,
 'private.odds_setting(text)'::regprocedure,'private.odds_breaker_factor()'::regprocedure,
 'private.odds_refresh_interval(timestamptz)'::regprocedure,'private.odds_max_age(timestamptz)'::regprocedure)
 loop execute format('revoke execute on function %s from public, anon',r.signature); end loop;
end $$;

-- Successful mutations count in per-account sliding windows. Failed transactions roll back
-- their debit; this is a mutation quota, not an edge/network abuse limiter.
create table private.rpc_rate_events (
 user_id uuid not null, action text not null, occurred_at timestamptz not null
);
create index rpc_rate_events_lookup on private.rpc_rate_events(user_id, action, occurred_at);
alter table private.rpc_rate_events enable row level security;
revoke all on private.rpc_rate_events from public, anon, authenticated;
insert into private.app_settings(key,value) values
 ('rpc_rate_limits', '{"place_wagers":30,"replace_wager":30,"cancel_wager":60,"join_tournament":20,"leave_tournament":20,"remove_participant":60,"grade_prop":120}'),
 ('rpc_rate_window_seconds', '60');
create or replace function private.enforce_rpc_rate(p_action text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_limit integer;
 v_seconds integer;
 v_now timestamptz := clock_timestamp();
begin
 if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
 select (value ->> p_action)::integer into v_limit from private.app_settings where key='rpc_rate_limits';
 select (value #>> '{}')::integer into v_seconds from private.app_settings where key='rpc_rate_window_seconds';
 if v_limit is null or v_limit < 1 or v_seconds is null or v_seconds < 1 then
   raise exception 'RATE_LIMITED';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':' || p_action, 0));
 delete from private.rpc_rate_events where user_id=v_uid and action=p_action
   and occurred_at <= v_now - pg_catalog.make_interval(secs => v_seconds);
 if (select count(*) from private.rpc_rate_events where user_id=v_uid and action=p_action) >= v_limit then
   raise exception 'RATE_LIMITED';
 end if;
 insert into private.rpc_rate_events values(v_uid,p_action,v_now);
end;
$$;
revoke all on function private.enforce_rpc_rate(text) from public, anon, authenticated;

create or replace function public.place_wagers(p_tournament_id uuid, p_slip jsonb, p_submission_id uuid default null)
returns setof public.wagers
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid;
  v_submission uuid := coalesce(p_submission_id, (p_slip -> 0 ->> 'submission_id')::uuid);
  v_result jsonb;
  v_w public.wagers;
  v_index integer := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select p.id into v_pid from public.tournament_participants p
   where p.tournament_id = p_tournament_id and p.user_id = auth.uid() for update;
  if v_submission is not null and v_pid is not null then
    select s.result into v_result from private.wager_submissions s
     where s.participant_id = v_pid and s.submission_id = v_submission;
    if found then
      return query select * from jsonb_populate_recordset(null::public.wagers, v_result);
      return;
    end if;
  end if;
  perform private.enforce_rpc_rate('place_wagers');
  v_result := '[]'::jsonb;
  for v_w in select * from private.place_wagers_validated(p_tournament_id, p_slip) loop
    if v_submission is not null then
      update public.wagers set submission_id = v_submission, submission_index = v_index
       where id = v_w.id returning * into v_w;
      v_index := v_index + 1;
    end if;
    v_result := v_result || jsonb_build_array(to_jsonb(v_w));
    return next v_w;
  end loop;
  if v_submission is not null then
    insert into private.wager_submissions values (v_pid, v_submission, v_result);
  end if;
end;
$$;
revoke all on function public.place_wagers(uuid,jsonb,uuid) from public, anon;
grant execute on function public.place_wagers(uuid,jsonb,uuid) to authenticated;

create or replace function public.replace_wager(p_wager_id uuid, p_slip jsonb)
returns setof public.wagers
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tournament_id uuid;
begin
  perform private.enforce_rpc_rate('replace_wager');
  select w.tournament_id into v_tournament_id from public.wagers w where w.id = p_wager_id;
  perform public.cancel_wager(p_wager_id);   -- enforces ownership + lock
  return query select * from public.place_wagers(v_tournament_id, p_slip);
end;
$$;
revoke all on function public.replace_wager(uuid,jsonb) from public, anon;
grant execute on function public.replace_wager(uuid,jsonb) to authenticated;

create or replace function public.cancel_wager(p_wager_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_w public.wagers%rowtype;
begin
  perform private.enforce_rpc_rate('cancel_wager');
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  delete from public.wagers w
   using public.tournament_participants p, public.tournaments t
   where w.id = p_wager_id
     and w.status = 'pending'
     and p.id = w.participant_id and p.user_id = v_uid
     and t.id = w.tournament_id and t.lock_time > now() and t.status in ('draft', 'open')
  returning w.* into v_w;

  if not found then
    if exists (select 1 from public.wagers w
               join public.tournament_participants p on p.id = w.participant_id
               join public.tournaments t on t.id = w.tournament_id
               where w.id = p_wager_id and p.user_id = v_uid and w.status <> 'pending'
                 and t.lock_time > now() and t.status in ('draft', 'open')) then
      raise exception 'WAGER_SETTLED';
    end if;
    if exists (select 1 from public.wagers w
               join public.tournament_participants p on p.id = w.participant_id
               where w.id = p_wager_id and p.user_id = v_uid) then
      raise exception 'TOURNAMENT_LOCKED';
    end if;
    raise exception 'WAGER_NOT_FOUND';
  end if;

  update public.tournament_participants
     set remaining_bankroll_cents = remaining_bankroll_cents + v_w.amount_cents,
         total_potential_payout_cents = total_potential_payout_cents - v_w.potential_payout_cents
   where id = v_w.participant_id;
end;
$$;
revoke all on function public.cancel_wager(uuid) from public, anon;
grant execute on function public.cancel_wager(uuid) to authenticated;

create or replace function public.join_tournament(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  perform private.enforce_rpc_rate('join_tournament');
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_t from public.tournaments t where t.code = upper(btrim(p_code)) for share;
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND';
  end if;

  if exists (select 1 from public.tournament_participants p
             where p.tournament_id = v_t.id and p.user_id = v_uid) then
    return v_t.id;
  end if;

  if exists (select 1 from private.tournament_removals r
             where r.tournament_id = v_t.id and r.user_id = v_uid) then
    raise exception 'REMOVED_BY_HOST';
  end if;

  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;

  if (select count(*) from public.tournament_participants p where p.tournament_id = v_t.id) >= 100 then
    raise exception 'TOURNAMENT_FULL';
  end if;

  insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
  values (v_t.id, v_uid, v_t.starting_bankroll_cents)
  on conflict (tournament_id, user_id) do nothing;

  return v_t.id;
end;
$$;
revoke all on function public.join_tournament(text) from public, anon;
grant execute on function public.join_tournament(text) to authenticated;

create or replace function public.leave_tournament(p_tournament_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  perform private.enforce_rpc_rate('leave_tournament');
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or not exists (select 1 from public.tournament_participants p
                              where p.tournament_id = p_tournament_id and p.user_id = v_uid) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  if v_t.host_id = v_uid then raise exception 'HOST_CANNOT_LEAVE'; end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then raise exception 'TOURNAMENT_LOCKED'; end if;
  delete from public.tournament_participants p where p.tournament_id = p_tournament_id and p.user_id = v_uid;
end;
$$;
revoke all on function public.leave_tournament(uuid) from public, anon;
grant execute on function public.leave_tournament(uuid) to authenticated;

create or replace function public.remove_participant(p_tournament_id uuid, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  perform private.enforce_rpc_rate('remove_participant');
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  if p_user_id = v_t.host_id then
    raise exception 'CANNOT_REMOVE_HOST';
  end if;

  delete from public.tournament_participants p
   where p.tournament_id = p_tournament_id and p.user_id = p_user_id;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  insert into private.tournament_removals (tournament_id, user_id)
  values (p_tournament_id, p_user_id)
  on conflict do nothing;
end;
$$;
revoke all on function public.remove_participant(uuid,uuid) from public, anon;
grant execute on function public.remove_participant(uuid,uuid) to authenticated;

create or replace function public.grade_prop(p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric, p_did_not_play boolean default false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype;
  v_status text;
  v_market text := regexp_replace(p_market_key, '_alternate$', '');
begin
  perform private.enforce_rpc_rate('grade_prop');
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.host_id is distinct from auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time > now() and v_t.status in ('draft','open') then
    raise exception 'GAME_NOT_FINAL';
  end if;
  select e.status into v_status from public.events e
  join public.tournament_events te on te.event_id = e.id and te.tournament_id = p_tournament_id
  where e.id = p_event_id;
  if v_status is null then
    raise exception 'NOTHING_TO_GRADE';
  end if;
  if v_status <> 'final' then
    raise exception 'GAME_NOT_FINAL';  -- final ⇒ after lock, so no hidden pick is involved
  end if;
  if exists (select 1 from public.prop_results r
             where r.tournament_id = p_tournament_id and r.event_id = p_event_id
               and r.market_key = v_market and r.participant_name = p_participant_name) then
    raise exception 'ALREADY_GRADED';
  end if;
  if not exists (select 1 from public.wager_legs l
                 where l.tournament_id = p_tournament_id and l.event_id = p_event_id
                   and l.market_key in (v_market, v_market || '_alternate') and l.participant_name = p_participant_name
                   and l.status = 'pending') then
    raise exception 'NOTHING_TO_GRADE';
  end if;

  return private.grade_prop_result(p_tournament_id,p_event_id,v_market,p_participant_name,
    p_stat,p_did_not_play,'host');
end;
$function$;
revoke all on function public.grade_prop(uuid,text,text,text,numeric,boolean) from public, anon;
grant execute on function public.grade_prop(uuid,text,text,text,numeric,boolean) to authenticated;
