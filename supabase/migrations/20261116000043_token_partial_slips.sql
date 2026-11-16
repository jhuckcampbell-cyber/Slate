-- Token slips may spend a subset; house rules still determine qualification at lock.
-- Validator is the 0025 definition renamed by 0026; public RPCs remain identical to 0036.
create or replace function private.place_wagers_validated(p_tournament_id uuid, p_slip jsonb)
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

  -- House rules (0022), now only outside token mode.
  -- Token mode skips the on-submit house rules: the leaderboard ranks unused tokens last at lock.
  if found and not (case when jsonb_typeof(v_tokens) = 'array' then jsonb_array_length(v_tokens) > 0 else false end)
     and (v_min > 0 or v_all_in) and jsonb_typeof(p_slip) = 'array'
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

revoke all on function private.place_wagers_validated(uuid, jsonb) from public, anon, authenticated;

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

