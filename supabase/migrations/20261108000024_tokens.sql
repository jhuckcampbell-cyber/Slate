-- Token mode (2026-11-08). The host can deal everyone the same set of bet "tokens" (e.g. $25, $25, $50) instead of
-- letting players type any amount. Stored as allowed_bet_types.tokens: an array of cents that adds up to the starting
-- bankroll. Rules, enforced here (the slip mirrors them):
--   * every bet's amount must be one of the player's tokens still available (tokens minus amounts of their current
--     wagers, as a multiset; cancelling a bet deletes it, so its token comes back)          -> TOKEN_NOT_AVAILABLE
--   * every token must be used: token mode turns on all_in, so the existing house-rule check (migration 0022) requires
--     the slip to leave $0, and the leaderboard ranks anyone with tokens left at lock last.
-- Tournaments without tokens go through exactly the 0022 path below.
-- The tokens are set by a separate host RPC right after create_tournament (no change to create_tournament), and a
-- trigger keeps them when update_tournament rebuilds allowed_bet_types (it only knows the older keys).

create function public.set_tournament_tokens(p_tournament_id uuid, p_tokens jsonb)
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
  if exists (select 1 from public.wagers w where w.tournament_id = v_t.id) then raise exception 'TOKENS_LOCKED'; end if;

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

-- update_tournament rebuilds allowed_bet_types from the keys it knows: carry the tokens (and all_in) across.
create function private.keep_tokens() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.allowed_bet_types ? 'tokens' and not (new.allowed_bet_types ? 'tokens') then
    new.allowed_bet_types := new.allowed_bet_types
      || jsonb_build_object('tokens', old.allowed_bet_types -> 'tokens', 'all_in', true);
  end if;
  return new;
end;
$$;

create trigger tournaments_keep_tokens
  before update of allowed_bet_types on public.tournaments
  for each row execute function private.keep_tokens();

-- place_wagers: the 0022 house-rule wrapper, with the token check first (token tournaments only).
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
         (select count(*)::int from public.wagers w where w.participant_id = p.id),
         t.allowed_bet_types -> 'tokens',
         p.id
    into v_min, v_all_in, v_remaining, v_have, v_tokens, v_pid
    from public.tournaments t
    join public.tournament_participants p on p.tournament_id = t.id and p.user_id = (select auth.uid())
   where t.id = p_tournament_id;

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

  -- House rules (unchanged from 0022). Not a participant, no house rules, or a malformed slip: the core function
  -- raises the right error.
  if found and (v_min > 0 or v_all_in) and jsonb_typeof(p_slip) = 'array'
     and jsonb_array_length(p_slip) between 1 and 20 then
    v_new := jsonb_array_length(p_slip);
    select coalesce(sum(case when jsonb_typeof(x -> 'amount_cents') = 'number' and (x ->> 'amount_cents') ~ '^[0-9]+$'
                             then (x ->> 'amount_cents')::bigint else 0 end), 0)
      into v_stake from jsonb_array_elements(p_slip) x;

    -- An oversized slip keeps its own INSUFFICIENT_BANKROLL error from the core function.
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
