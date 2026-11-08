-- House rules are checked when you submit (2026-11-08). Friends could submit one bet when the host required three, or
-- keep cash back when the host said "bet everything", and then found themselves ranked last at lock. Now a slip only
-- goes through if, once placed, the player meets every house rule:
--   * min_bets: bets already placed + bets in this slip >= min_bets   -> HOUSE_RULE_MIN_BETS
--   * all_in:   bankroll left after this slip = $0                     -> HOUSE_RULE_ALL_IN
-- `details` carries what is missing so the slip can say it. This replaces the $1-per-owed-bet reserve
-- (LEAVES_TOO_LITTLE, migration 0020): once the slip itself has to reach the minimum, nothing is owed afterwards.
-- replace_wager cancels then calls public.place_wagers, so a swap is held to the same rules.
-- cancel_wager is unchanged: cancelling before lock is allowed, and leaves the player "not in" until they re-submit
-- (the leaderboard's existing `qualified` column, migration 0017, ranks them last if they never do).

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
begin
  select coalesce((t.allowed_bet_types ->> 'min_bets')::int, 0),
         coalesce((t.allowed_bet_types ->> 'all_in')::boolean, false),
         p.remaining_bankroll_cents,
         (select count(*)::int from public.wagers w where w.participant_id = p.id)
    into v_min, v_all_in, v_remaining, v_have
    from public.tournaments t
    join public.tournament_participants p on p.tournament_id = t.id and p.user_id = (select auth.uid())
   where t.id = p_tournament_id;

  -- Not a participant, no house rules, or a malformed slip: the core function raises the right error.
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
