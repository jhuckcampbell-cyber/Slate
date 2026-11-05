-- Minimum-bets budget (2026-11-05). When the host requires N bets, one bet can't be allowed to eat the bankroll:
-- every bet still owed (placed + in this slip < N) keeps $1 back, the smallest legal bet. Otherwise a player could
-- stake everything on one pick and never be able to meet the rule. Mirrors reserveCents() in src/lib/core/slip.ts.
-- The original function keeps all its checks as private.place_wagers_core; public.place_wagers adds this one first.

alter function public.place_wagers(uuid, jsonb) set schema private;
alter function private.place_wagers(uuid, jsonb) rename to place_wagers_core;
revoke all on function private.place_wagers_core(uuid, jsonb) from public, anon, authenticated;

create function public.place_wagers(p_tournament_id uuid, p_slip jsonb)
returns setof public.wagers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int;
  v_have int;
  v_remaining bigint;
  v_new int;
  v_stake bigint;
begin
  select coalesce((t.allowed_bet_types ->> 'min_bets')::int, 0), p.remaining_bankroll_cents, 
         (select count(*)::int from public.wagers w where w.participant_id = p.id)
    into v_min, v_remaining, v_have
    from public.tournaments t
    join public.tournament_participants p on p.tournament_id = t.id and p.user_id = (select auth.uid())
   where t.id = p_tournament_id;

  -- Not a participant, no minimum, or a malformed slip: the core function raises the right error.
  if v_min > 0 and jsonb_typeof(p_slip) = 'array' and jsonb_array_length(p_slip) between 1 and 20 then
    v_new := jsonb_array_length(p_slip);
    select coalesce(sum(case when jsonb_typeof(x -> 'amount_cents') = 'number' and (x ->> 'amount_cents') ~ '^[0-9]+$'
                             then (x ->> 'amount_cents')::bigint else 0 end), 0)
      into v_stake from jsonb_array_elements(p_slip) x;
    -- Only when the stake itself fits the bankroll; an oversized slip keeps its own INSUFFICIENT_BANKROLL error.
    if v_stake <= v_remaining and v_remaining - v_stake < greatest(v_min - v_have - v_new, 0) * 100 then
      raise exception 'LEAVES_TOO_LITTLE';
    end if;
  end if;

  return query select * from private.place_wagers_core(p_tournament_id, p_slip);
end;
$$;

revoke all on function public.place_wagers(uuid, jsonb) from public, anon;
grant execute on function public.place_wagers(uuid, jsonb) to authenticated;
