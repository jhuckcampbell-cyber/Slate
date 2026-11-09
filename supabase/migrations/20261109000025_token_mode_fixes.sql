-- Token mode fixes (2026-11-09). Token mode (0024) could end up in a state nobody can bet in:
--   * the host changed the bankroll after dealing tokens (tokens no longer add up -> every slip refused),
--   * min_bets above the number of tokens, or a max bet below the biggest token.
-- Now the tokens and the rules around them must agree, on every write (trigger), with INVALID_TOKENS otherwise.
-- Also:
--   * set_tournament_tokens can clear the tokens (null or []) while nobody has bet,
--   * place_wagers checks tokens under the player's row lock (same as the core function),
--   * cancel_wager only cancels a pending wager, and stale/void grading only runs once a tournament is locked
--     (a pre-lock postponement used to settle a pick that could then be cancelled for a second refund),
--   * get_tournament_preview returns the DB clock so the join page countdown doesn't trust the phone.

-- ---------------------------------------------------------------------------
-- Rule consistency: carry tokens across update_tournament (as 0024 did) and refuse rule sets they break.
-- set_tournament_tokens clears tokens by setting squadbets.clear_tokens for its own transaction.
-- ---------------------------------------------------------------------------
create or replace function private.keep_tokens() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_tokens jsonb;
  v_sum bigint;
  v_n int;
  v_max bigint;
begin
  if old.allowed_bet_types ? 'tokens' and not (new.allowed_bet_types ? 'tokens')
     and coalesce(current_setting('squadbets.clear_tokens', true), '') <> 'on' then
    new.allowed_bet_types := new.allowed_bet_types
      || jsonb_build_object('tokens', old.allowed_bet_types -> 'tokens', 'all_in', true);
  end if;

  v_tokens := new.allowed_bet_types -> 'tokens';
  if jsonb_typeof(v_tokens) = 'array' then
    new.allowed_bet_types := new.allowed_bet_types || jsonb_build_object('all_in', true);
    select count(*)::int, coalesce(sum((x #>> '{}')::bigint), 0), max((x #>> '{}')::bigint)
      into v_n, v_sum, v_max
      from jsonb_array_elements(v_tokens) x;
    if v_sum <> new.starting_bankroll_cents
       or coalesce((new.allowed_bet_types ->> 'min_bets')::int, 0) > v_n
       or (new.max_bet_cents is not null and new.max_bet_cents < v_max) then
      raise exception 'INVALID_TOKENS';
    end if;
  end if;
  return new;
end;
$$;

drop trigger tournaments_keep_tokens on public.tournaments;
create trigger tournaments_keep_tokens
  before update of allowed_bet_types, starting_bankroll_cents, max_bet_cents on public.tournaments
  for each row execute function private.keep_tokens();

-- ---------------------------------------------------------------------------
-- set_tournament_tokens: also checks min_bets / max bet (via the trigger), can clear, and serializes with
-- place_wagers by locking every participant row before looking for wagers.
-- ---------------------------------------------------------------------------
create or replace function public.set_tournament_tokens(p_tournament_id uuid, p_tokens jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
  v_sum bigint;
  v_n int;
  v_bad int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then raise exception 'TOURNAMENT_LOCKED'; end if;
  perform 1 from public.tournament_participants p where p.tournament_id = v_t.id for update;
  if exists (select 1 from public.wagers w where w.tournament_id = v_t.id) then raise exception 'TOKENS_LOCKED'; end if;

  -- Clear: back to typed amounts (and "bet everything" off, since tokens had turned it on).
  if p_tokens is null or jsonb_typeof(p_tokens) = 'null'
     or (jsonb_typeof(p_tokens) = 'array' and jsonb_array_length(p_tokens) = 0) then
    perform set_config('squadbets.clear_tokens', 'on', true);
    update public.tournaments t
       set allowed_bet_types = (t.allowed_bet_types - 'tokens') || jsonb_build_object('all_in', false)
     where t.id = v_t.id;
    perform set_config('squadbets.clear_tokens', '', true);
    return;
  end if;

  if jsonb_typeof(p_tokens) is distinct from 'array' then raise exception 'INVALID_TOKENS'; end if;
  select count(*)::int,
         coalesce(sum(case when jsonb_typeof(x) = 'number' and (x #>> '{}') ~ '^[0-9]+$' then (x #>> '{}')::bigint end), 0),
         count(*) filter (where jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-9]+$'
                          or (x #>> '{}')::bigint < 100 or (x #>> '{}')::bigint % 100 <> 0)::int
    into v_n, v_sum, v_bad
    from jsonb_array_elements(p_tokens) x;
  if v_n not between 2 and 10 or v_bad > 0 or v_sum <> v_t.starting_bankroll_cents then
    raise exception 'INVALID_TOKENS';
  end if;

  -- The trigger checks min_bets <= token count and max bet >= biggest token.
  update public.tournaments t
     set allowed_bet_types = t.allowed_bet_types
           || jsonb_build_object(
                'tokens', (select jsonb_agg((x #>> '{}')::bigint order by (x #>> '{}')::bigint)
                             from jsonb_array_elements(p_tokens) x),
                'all_in', true)
   where t.id = v_t.id;
end;
$$;

revoke all on function public.set_tournament_tokens(uuid, jsonb) from public, anon;
grant execute on function public.set_tournament_tokens(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- place_wagers: identical to 0024 except the first read locks the player's row, so the token and house-rule checks
-- see the same bets the core function will (it takes the same lock again; re-locking is a no-op).
-- ---------------------------------------------------------------------------
create or replace function public.place_wagers(p_tournament_id uuid, p_slip jsonb)
returns setof public.wagers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int;
  v_all_in boolean;
  v_have int;
  v_remaining bigint;
  v_new int;
  v_stake bigint;
  v_tokens jsonb;
  v_pid uuid;
  v_avail bigint[];
  v_amt bigint;
  v_idx int;
  v_x jsonb;
begin
  select coalesce((t.allowed_bet_types ->> 'min_bets')::int, 0),
         coalesce((t.allowed_bet_types ->> 'all_in')::boolean, false),
         p.remaining_bankroll_cents,
         t.allowed_bet_types -> 'tokens',
         p.id
    into v_min, v_all_in, v_remaining, v_tokens, v_pid
    from public.tournaments t
    join public.tournament_participants p on p.tournament_id = t.id and p.user_id = (select auth.uid())
   where t.id = p_tournament_id
   for update of p;

  if found then
    select count(*)::int into v_have from public.wagers w where w.participant_id = v_pid;
  end if;

  -- Tokens: each bet must spend one token the player still has (no other amounts, no token twice).
  if found and jsonb_typeof(v_tokens) = 'array' and jsonb_typeof(p_slip) = 'array'
     and jsonb_array_length(p_slip) between 1 and 20 then
    v_avail := array(select (x #>> '{}')::bigint from jsonb_array_elements(v_tokens) x);
    for v_amt in select w.amount_cents from public.wagers w where w.participant_id = v_pid loop
      v_idx := array_position(v_avail, v_amt);
      if v_idx is not null then
        v_avail := v_avail[1:v_idx - 1] || v_avail[v_idx + 1:];
      end if;
    end loop;
    for v_x in select x from jsonb_array_elements(p_slip) x loop
      v_amt := case when jsonb_typeof(v_x -> 'amount_cents') = 'number' and (v_x ->> 'amount_cents') ~ '^[0-9]+$'
                    then (v_x ->> 'amount_cents')::bigint else -1 end;
      v_idx := array_position(v_avail, v_amt);
      if v_idx is null then
        raise exception 'TOKEN_NOT_AVAILABLE'
          using detail = jsonb_build_object('available', to_jsonb(v_avail))::text;
      end if;
      v_avail := v_avail[1:v_idx - 1] || v_avail[v_idx + 1:];
    end loop;
  end if;

  -- House rules (unchanged from 0022).
  if found and (v_min > 0 or v_all_in) and jsonb_typeof(p_slip) = 'array'
     and jsonb_array_length(p_slip) between 1 and 20 then
    v_new := jsonb_array_length(p_slip);
    select coalesce(sum(case when jsonb_typeof(x -> 'amount_cents') = 'number' and (x ->> 'amount_cents') ~ '^[0-9]+$'
                             then (x ->> 'amount_cents')::bigint else 0 end), 0)
      into v_stake from jsonb_array_elements(p_slip) x;

    if v_stake <= v_remaining then
      if v_have + v_new < v_min then
        raise exception 'HOUSE_RULE_MIN_BETS'
          using detail = jsonb_build_object('min_bets', v_min, 'have', v_have, 'in_slip', v_new)::text;
      end if;
      if v_all_in and v_remaining - v_stake > 0 then
        raise exception 'HOUSE_RULE_ALL_IN'
          using detail = jsonb_build_object('left_cents', v_remaining - v_stake)::text;
      end if;
    end if;
  end if;

  return query select * from private.place_wagers_core(p_tournament_id, p_slip);
end;
$$;

revoke all on function public.place_wagers(uuid, jsonb) from public, anon;
grant execute on function public.place_wagers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_wager: only a pending wager (a settled one already paid or refunded).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_wager(p_wager_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_w public.wagers%rowtype;
begin
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

-- ---------------------------------------------------------------------------
-- void_stale_legs: same rules as 0010, but only for locked tournaments. Before lock a player can still cancel a
-- pick on a postponed game (the board shows it unavailable); at lock the next run voids it.
-- ---------------------------------------------------------------------------
create or replace function private.void_stale_legs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wager uuid;
begin
  for v_wager in
    with voided as (
      update public.wager_legs l set status = 'void', settled_at = now()
        from public.events e, public.wagers w, public.tournaments t
       where e.id = l.event_id and l.status = 'pending'
         and w.id = l.wager_id and t.id = w.tournament_id
         and (t.lock_time <= now() or t.status not in ('draft', 'open'))
         and (e.status in ('postponed', 'canceled')
              or (e.status <> 'final' and e.commence_time < now() - interval '12 hours')
              -- props the host never graded
              or (l.market_key like 'player\_%' and e.commence_time < now() - interval '48 hours'))
      returning l.wager_id
    )
    select distinct v.wager_id from voided v
  loop
    perform private.settle_wager(v_wager);
  end loop;
end;
$$;

revoke all on function private.void_stale_legs() from public;

-- ---------------------------------------------------------------------------
-- get_tournament_preview: + server_now (DB clock for the join page countdown).
-- ---------------------------------------------------------------------------
drop function public.get_tournament_preview(text);
create function public.get_tournament_preview(p_code text)
returns table (
  id uuid,
  code text,
  title text,
  description text,
  sport_key text,
  host_name text,
  lock_time timestamptz,
  status public.tournament_status,
  starting_bankroll_cents int,
  participant_count int,
  events jsonb,
  is_locked boolean,   -- DB clock decides (CLAUDE.md rule 5)
  server_now timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    t.id, t.code, t.title, t.description, t.sport_key,
    h.display_name,
    t.lock_time, t.status, t.starting_bankroll_cents,
    (select count(*)::int from public.tournament_participants p where p.tournament_id = t.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'home_team', e.home_team, 'away_team', e.away_team,
        'commence_time', e.commence_time) order by e.commence_time)
      from public.tournament_events te join public.events e on e.id = te.event_id
      where te.tournament_id = t.id), '[]'::jsonb),
    (t.lock_time <= now() or t.status not in ('draft', 'open')),
    now()
  from public.tournaments t
  join public.profiles h on h.id = t.host_id
  where t.code = upper(btrim(p_code));
$$;

revoke all on function public.get_tournament_preview(text) from public;
grant execute on function public.get_tournament_preview(text) to anon, authenticated;
