-- Phase 3: blind lock & live reveal.
--  * Lock guards: once picks lock, no code path (RPC bug, service script) can add, edit or delete a
--    pick, move the lock, change the rules, or add a player. Grading columns stay writable.
--  * Status machine: pg_cron advances open → locked → live → settled every 10 seconds.
--  * Signals: a private Realtime channel per tournament ("tournament:<id>") tells lobbies to refresh
--    when the lock/rules/status change or the roster changes. Payloads never carry picks; only
--    participants may join the channel (RLS on realtime.messages).
--  * Host controls: update_tournament, lock_tournament_now, remove_participant.

-- ---------------------------------------------------------------------------
-- Shared predicate: are this tournament's picks frozen? clock_timestamp(), not now(): a slip whose
-- transaction began before the lock but reaches the write after it is refused.
-- ---------------------------------------------------------------------------
create function private.picks_frozen(p_tournament_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and (t.lock_time <= clock_timestamp() or t.status not in ('draft', 'open'))
  );
$$;
revoke all on function private.picks_frozen(uuid) from public;

-- ---------------------------------------------------------------------------
-- Lock guards
-- ---------------------------------------------------------------------------
create function private.guard_tournament_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- draft → open → locked → live → settled, never backwards.
  if new.status < old.status then
    raise exception 'INVALID_STATUS_CHANGE';
  end if;
  -- After lock the lock moment and the money rules are history.
  if (old.lock_time <= clock_timestamp() or old.status not in ('draft', 'open'))
     and (new.lock_time, new.starting_bankroll_cents, new.max_bet_cents,
          new.min_total_wager_cents, new.allowed_bet_types)
         is distinct from
         (old.lock_time, old.starting_bankroll_cents, old.max_bet_cents,
          old.min_total_wager_cents, old.allowed_bet_types) then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  return new;
end;
$$;

create trigger tournaments_guard before update on public.tournaments
  for each row execute function private.guard_tournament_update();

-- Wagers: post-lock only the outcome columns may change (grading). Deletes are allowed only as a
-- cascade (participant/account/tournament already gone), never as a "cancel".
create function private.guard_wager_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tournament_id uuid := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;
  v_outcome constant text[] := array['status', 'is_locked', 'win_probability', 'settled_at'];
begin
  if not private.picks_frozen(v_tournament_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'TOURNAMENT_LOCKED';
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_outcome) is distinct from (to_jsonb(old) - v_outcome) then
      raise exception 'TOURNAMENT_LOCKED';
    end if;
    return new;
  end if;
  if exists (select 1 from public.tournament_participants p where p.id = old.participant_id) then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  return old;
end;
$$;

create function private.guard_leg_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tournament_id uuid := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;
  -- odds_id: the FK is ON DELETE SET NULL, so pruning old odds rows must not trip the guard.
  v_outcome constant text[] := array['status', 'win_probability', 'settled_at', 'odds_id'];
begin
  if not private.picks_frozen(v_tournament_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'TOURNAMENT_LOCKED';
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_outcome) is distinct from (to_jsonb(old) - v_outcome) then
      raise exception 'TOURNAMENT_LOCKED';
    end if;
    return new;
  end if;
  if exists (select 1 from public.wagers w where w.id = old.wager_id) then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  return old;
end;
$$;

create function private.guard_participant_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.picks_frozen(new.tournament_id) then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  return new;
end;
$$;

create trigger wagers_guard before insert or update or delete on public.wagers
  for each row execute function private.guard_wager_write();
create trigger wager_legs_guard before insert or update or delete on public.wager_legs
  for each row execute function private.guard_leg_write();
create trigger participants_guard before insert on public.tournament_participants
  for each row execute function private.guard_participant_insert();

-- A game moved earlier pulls the lock forward, but never edits a lock that already passed (the
-- status cron may not have run yet, and the guard above would fail the whole odds ingest).
create or replace function private.pull_lock_forward() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.commence_time < old.commence_time then
    update public.tournaments t
       set lock_time = new.commence_time
     where t.lock_time > new.commence_time
       and t.lock_time > now()
       and t.status in ('draft', 'open')
       and exists (select 1 from public.tournament_events te
                   where te.tournament_id = t.id and te.event_id = new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime signals: private channel "tournament:<id>", participants only.
-- Events: "tournament" {status, lock_time} on any change to the tournament row;
--         "roster" {change, user_id} when someone joins/leaves or their "picks in" flag flips.
-- ---------------------------------------------------------------------------
create function private.signal(p_tournament_id uuid, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- realtime.send swallows its own errors (WARNING), so a Realtime hiccup never fails a bet.
  perform realtime.send(p_payload, p_event, 'tournament:' || p_tournament_id::text, true);
end;
$$;
revoke all on function private.signal(uuid, text, jsonb) from public;

create function private.on_tournament_updated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'locked' and old.status in ('draft', 'open') then
    update public.wagers w set is_locked = true where w.tournament_id = new.id;
  end if;
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    perform private.signal(new.id, 'tournament',
      jsonb_build_object('status', new.status, 'lock_time', new.lock_time));
  end if;
  return null;
end;
$$;

create trigger tournaments_signal after update on public.tournaments
  for each row execute function private.on_tournament_updated();

create function private.on_participant_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.signal(new.tournament_id, 'roster',
      jsonb_build_object('change', 'joined', 'user_id', new.user_id));
  else
    perform private.signal(old.tournament_id, 'roster',
      jsonb_build_object('change', 'left', 'user_id', old.user_id));
  end if;
  return null;
end;
$$;

create trigger participants_signal after insert or delete on public.tournament_participants
  for each row execute function private.on_participant_change();

-- Only flips of "has submitted" are signalled: further bets, edits and cancels stay silent, so the
-- channel reveals nothing the roster doesn't already show.
create function private.on_wager_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_participant uuid := case when tg_op = 'INSERT' then new.participant_id else old.participant_id end;
  v_user uuid;
  v_others int;
begin
  select p.user_id into v_user from public.tournament_participants p where p.id = v_participant;
  if v_user is null then
    return null;   -- cascade from a removed participant: that removal already signalled
  end if;
  select count(*) into v_others from public.wagers w
   where w.participant_id = v_participant
     and w.id <> case when tg_op = 'INSERT' then new.id else old.id end;
  if v_others = 0 then
    perform private.signal(
      case when tg_op = 'INSERT' then new.tournament_id else old.tournament_id end,
      'roster',
      jsonb_build_object('change', case when tg_op = 'INSERT' then 'submitted' else 'unsubmitted' end,
                         'user_id', v_user));
  end if;
  return null;
end;
$$;

create trigger wagers_signal after insert or delete on public.wagers
  for each row execute function private.on_wager_change();

revoke all on function private.guard_tournament_update(), private.guard_wager_write(),
  private.guard_leg_write(), private.guard_participant_insert(), private.pull_lock_forward(),
  private.on_tournament_updated(), private.on_participant_change(), private.on_wager_change()
  from public;

-- Channel authorization. Realtime evaluates this when a client joins a private channel, with
-- realtime.topic() set to the channel name.
create function private.can_read_channel(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic is null
     or p_topic !~ '^tournament:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_participant(substr(p_topic, 12)::uuid);
end;
$$;
revoke all on function private.can_read_channel(text) from public;
grant execute on function private.can_read_channel(text) to authenticated;

create policy "tournament channels: participants receive broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.messages.topic = (select realtime.topic())
    and private.can_read_channel(realtime.messages.topic)
  );
-- No INSERT policy: clients can't send on these channels; only the database does.

-- ---------------------------------------------------------------------------
-- Status machine
-- ---------------------------------------------------------------------------
create function private.advance_statuses() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- RLS already revealed picks at lock_time; this makes it official and fires the signal.
  update public.tournaments t set status = 'locked'
   where t.status in ('draft', 'open') and t.lock_time <= now();

  update public.tournaments t set status = 'live'
   where t.status = 'locked'
     and exists (select 1 from public.tournament_events te
                 join public.events e on e.id = te.event_id
                 where te.tournament_id = t.id
                   and (e.commence_time <= now() or e.status in ('live', 'final')));

  -- Needs scores + grading (Phase 5) to ever be true.
  update public.tournaments t set status = 'settled'
   where t.status = 'live'
     and not exists (select 1 from public.tournament_events te
                     join public.events e on e.id = te.event_id
                     where te.tournament_id = t.id and e.status not in ('final', 'canceled'))
     and not exists (select 1 from public.wagers w
                     where w.tournament_id = t.id and w.status = 'pending');
end;
$$;
revoke all on function private.advance_statuses() from public;

select cron.schedule('advance-statuses', '10 seconds', 'select private.advance_statuses()');
-- Second-level jobs log ~9k runs/day; keep three days of history.
select cron.schedule('cron-history-cleanup', '17 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

-- ---------------------------------------------------------------------------
-- DB clock for client countdowns (PostgREST computed field: select=...,server_now).
-- ---------------------------------------------------------------------------
create function public.server_now(t public.tournaments) returns timestamptz
language sql stable set search_path = '' as $$
  select now();
$$;
revoke all on function public.server_now(public.tournaments) from public, anon;
grant execute on function public.server_now(public.tournaments) to authenticated;

-- ---------------------------------------------------------------------------
-- Host controls (pre-lock only). Errors never depend on hidden picks, so the host learns nothing.
-- ---------------------------------------------------------------------------
create table private.tournament_removals (
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

-- p_changes: any subset of {title, description, lock_time, max_bet_cents (null = no limit),
-- allowed_bet_types {markets, parlays, max_parlay_legs}, starting_bankroll_cents}.
-- Rule changes apply to new bets; bets already placed stand.
create function public.update_tournament(p_tournament_id uuid, p_changes jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
  v_key text;
  v_val jsonb;
  v_rules jsonb;
  v_markets jsonb;
  v_first_kickoff timestamptz;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- FOR UPDATE serializes with joins (FOR SHARE) and other host actions.
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'INVALID_CHANGES';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('title', 'description', 'lock_time', 'max_bet_cents', 'allowed_bet_types',
                     'starting_bankroll_cents') then
      raise exception 'INVALID_CHANGES';
    end if;
  end loop;

  if p_changes ? 'title' then
    if jsonb_typeof(p_changes -> 'title') <> 'string'
       or char_length(btrim(p_changes ->> 'title')) not between 1 and 60 then
      raise exception 'INVALID_TITLE';
    end if;
    v_t.title := btrim(p_changes ->> 'title');
  end if;

  if p_changes ? 'description' then
    if jsonb_typeof(p_changes -> 'description') not in ('string', 'null')
       or char_length(coalesce(p_changes ->> 'description', '')) > 280 then
      raise exception 'INVALID_CHANGES';
    end if;
    v_t.description := nullif(btrim(p_changes ->> 'description'), '');
  end if;

  if p_changes ? 'starting_bankroll_cents' then
    v_val := p_changes -> 'starting_bankroll_cents';
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^[0-9]+$'
       or (v_val #>> '{}')::bigint not between 100 and 100000000 then
      raise exception 'INVALID_BANKROLL';
    end if;
    -- Others' bankrolls were dealt at join time; with only the host in (and no bets), re-deal is safe.
    if exists (select 1 from public.tournament_participants p
               where p.tournament_id = v_t.id and p.user_id <> v_uid)
       or exists (select 1 from public.wagers w where w.tournament_id = v_t.id) then
      raise exception 'BANKROLL_LOCKED';
    end if;
    v_t.starting_bankroll_cents := (v_val #>> '{}')::int;
  end if;

  if p_changes ? 'max_bet_cents' then
    v_val := p_changes -> 'max_bet_cents';
    if jsonb_typeof(v_val) = 'null' then
      v_t.max_bet_cents := null;
    elsif jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^[0-9]+$'
          and (v_val #>> '{}')::bigint between 100 and v_t.starting_bankroll_cents then
      v_t.max_bet_cents := (v_val #>> '{}')::int;
    else
      raise exception 'INVALID_MAX_BET';
    end if;
  elsif v_t.max_bet_cents > v_t.starting_bankroll_cents then
    raise exception 'INVALID_MAX_BET';   -- bankroll lowered below the existing cap
  end if;

  if p_changes ? 'allowed_bet_types' then
    v_val := p_changes -> 'allowed_bet_types';
    if jsonb_typeof(v_val) <> 'object'
       or (v_val ? 'markets' and jsonb_typeof(v_val -> 'markets') <> 'array')
       or (v_val ? 'parlays' and jsonb_typeof(v_val -> 'parlays') <> 'boolean')
       or (v_val ? 'max_parlay_legs' and jsonb_typeof(v_val -> 'max_parlay_legs') <> 'number') then
      raise exception 'INVALID_RULES';
    end if;
    v_rules := v_t.allowed_bet_types || v_val;
    select coalesce(jsonb_agg(distinct m order by m), '[]'::jsonb) into v_markets
      from jsonb_array_elements_text(coalesce(v_rules -> 'markets', '[]'::jsonb)) as m
     where m in ('h2h', 'spreads', 'totals');
    if jsonb_array_length(v_markets) = 0 then
      raise exception 'INVALID_RULES';
    end if;
    v_t.allowed_bet_types := jsonb_build_object(
      'markets', v_markets,
      'parlays', coalesce((v_rules ->> 'parlays')::boolean, true),
      'max_parlay_legs', least(greatest(coalesce(round((v_rules ->> 'max_parlay_legs')::numeric)::int, 6), 2), 10),
      'player_props', coalesce((v_rules ->> 'player_props')::boolean, false));
  end if;

  if p_changes ? 'lock_time' then
    v_val := p_changes -> 'lock_time';
    if jsonb_typeof(v_val) <> 'string' then
      raise exception 'INVALID_LOCK_TIME';
    end if;
    begin
      v_t.lock_time := (v_val #>> '{}')::timestamptz;
    exception when others then
      raise exception 'INVALID_LOCK_TIME';
    end;
    select min(e.commence_time) into v_first_kickoff
      from public.tournament_events te join public.events e on e.id = te.event_id
     where te.tournament_id = v_t.id;
    if v_t.lock_time <= now() or v_t.lock_time > v_first_kickoff then
      raise exception 'INVALID_LOCK_TIME';
    end if;
  end if;

  update public.tournaments t
     set title = v_t.title,
         description = v_t.description,
         lock_time = v_t.lock_time,
         max_bet_cents = v_t.max_bet_cents,
         allowed_bet_types = v_t.allowed_bet_types,
         starting_bankroll_cents = v_t.starting_bankroll_cents
   where t.id = v_t.id;

  if p_changes ? 'starting_bankroll_cents' then
    update public.tournament_participants p
       set remaining_bankroll_cents = v_t.starting_bankroll_cents
     where p.tournament_id = v_t.id and p.user_id = v_uid;
  end if;
end;
$$;

-- "Everyone's in, let's go": lock (and reveal) right now, by the DB clock.
create function public.lock_tournament_now(p_tournament_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
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
  update public.tournaments t set lock_time = now(), status = 'locked' where t.id = p_tournament_id;
end;
$$;

-- Kick a player before lock: their picks go with them and they can't rejoin with this account.
create function public.remove_participant(p_tournament_id uuid, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
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

-- join_tournament: + REMOVED_BY_HOST, and FOR SHARE so a join can't interleave with a host edit
-- (bankroll re-deal) or an early lock.
create or replace function public.join_tournament(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
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

revoke all on function public.update_tournament(uuid, jsonb), public.lock_tournament_now(uuid),
  public.remove_participant(uuid, uuid) from public, anon;
grant execute on function public.update_tournament(uuid, jsonb), public.lock_tournament_now(uuid),
  public.remove_participant(uuid, uuid) to authenticated;
