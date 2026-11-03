-- Phase 2b: wagers + legs with BLIND RLS, slip RPCs, roster "has submitted" flag.
-- Rule 1: picks are invisible to other players until lock. Rule 2: writes only via RPCs.

-- Parlay payouts (capped at 1001x) can exceed int4, so money columns become bigint.
alter table public.tournament_participants
  alter column remaining_bankroll_cents type bigint,
  alter column total_potential_payout_cents type bigint,
  alter column expected_value_cents type bigint;

create type public.wager_type as enum ('single', 'parlay');
create type public.wager_status as enum ('pending', 'won', 'lost', 'pushed', 'void');
create type public.leg_status as enum ('pending', 'hit', 'miss', 'push', 'void');

create table public.wagers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  participant_id uuid not null references public.tournament_participants on delete cascade,
  wager_type public.wager_type not null,
  amount_cents bigint not null check (amount_cents > 0),
  odds_american int not null,
  odds_decimal numeric(14,4) not null check (odds_decimal > 1),
  potential_payout_cents bigint not null check (potential_payout_cents >= amount_cents),
  status public.wager_status not null default 'pending',
  is_locked boolean not null default false,          -- denormalized flag; RLS does NOT rely on it
  win_probability numeric(5,4),                      -- live P(cash), Phase 4
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index wagers_participant_idx on public.wagers (participant_id);
create index wagers_tournament_idx on public.wagers (tournament_id);

create table public.wager_legs (
  id uuid primary key default gen_random_uuid(),
  wager_id uuid not null references public.wagers on delete cascade,
  tournament_id uuid not null references public.tournaments on delete cascade,      -- denormalized for RLS
  participant_id uuid not null references public.tournament_participants on delete cascade,
  event_id text not null references public.events,
  odds_id bigint references public.odds_cache on delete set null,
  market_key text not null,
  selection text not null,                           -- outcome_name at time of bet
  participant_name text not null default '',
  line numeric(7,2),                                 -- spread/total at time of bet
  odds_american int not null,
  odds_decimal numeric(10,4) not null,
  status public.leg_status not null default 'pending',
  win_probability numeric(5,4),
  settled_at timestamptz
);
create index wager_legs_wager_idx on public.wager_legs (wager_id);
create index wager_legs_participant_idx on public.wager_legs (participant_id);
create index wager_legs_event_idx on public.wager_legs (event_id, status);

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
create function private.owns_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournament_participants p
    where p.id = p_participant_id and p.user_id = (select auth.uid())
  );
$$;
revoke all on function private.owns_participant(uuid) from public;
grant execute on function private.owns_participant(uuid) to authenticated;

revoke all on public.wagers, public.wager_legs from anon, authenticated;
grant select on public.wagers, public.wager_legs to authenticated;
alter table public.wagers enable row level security;
alter table public.wager_legs enable row level security;

create policy "wagers: own, or everyone's after reveal" on public.wagers
  for select to authenticated
  using (
    private.owns_participant(participant_id)
    or (private.is_participant(tournament_id) and private.is_revealed(tournament_id))
  );

create policy "wager legs: own, or everyone's after reveal" on public.wager_legs
  for select to authenticated
  using (
    private.owns_participant(participant_id)
    or (private.is_participant(tournament_id) and private.is_revealed(tournament_id))
  );

-- PostgREST computed field: `select=...,is_locked` on tournaments, decided by the DB clock.
create function public.is_locked(t public.tournaments) returns boolean
language sql stable set search_path = '' as $$
  select t.lock_time <= now() or t.status not in ('draft', 'open');
$$;

-- ---------------------------------------------------------------------------
-- place_wagers: the ONLY way money moves pre-lock. One call books a whole slip (N singles or
-- one parlay) all-or-nothing. Prices are re-read server-side; the client's prices are only
-- "expected" values used to detect line movement (CLAUDE.md rule 3).
--   p_slip: [{ "amount_cents": 1000,
--              "legs": [{ "odds_id": 1, "price_american": -110, "point": -3.5 }, ...] }, ...]
-- ---------------------------------------------------------------------------
create function public.place_wagers(p_tournament_id uuid, p_slip jsonb)
returns setof public.wagers
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
  v_p public.tournament_participants%rowtype;
  v_markets jsonb;
  v_parlays boolean;
  v_max_legs int;
  v_wager jsonb;
  v_leg jsonb;
  v_o record;
  v_amount bigint;
  v_n int;
  v_dec numeric;
  v_payout bigint;
  v_total_stake bigint := 0;
  v_total_payout bigint := 0;
  v_changed jsonb := '[]'::jsonb;
  v_events text[];
  v_legs jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_r jsonb;
  v_wager_id uuid;
  v_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock this player's row: concurrent submissions serialize, so the bankroll check below can't
  -- be raced into an overdraw (the CHECK >= 0 constraint is the last line of defense).
  select p.* into v_p from public.tournament_participants p
   where p.tournament_id = p_tournament_id and p.user_id = v_uid
   for update;
  if not found then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  select t.* into v_t from public.tournaments t where t.id = p_tournament_id;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;

  if jsonb_typeof(p_slip) is distinct from 'array'
     or jsonb_array_length(p_slip) = 0 or jsonb_array_length(p_slip) > 20 then
    raise exception 'INVALID_SLIP';
  end if;

  v_markets := coalesce(v_t.allowed_bet_types -> 'markets', '[]'::jsonb);
  v_parlays := coalesce((v_t.allowed_bet_types ->> 'parlays')::boolean, false);
  v_max_legs := coalesce((v_t.allowed_bet_types ->> 'max_parlay_legs')::int, 6);

  -- Pass 1: validate and price everything. Moved prices are collected rather than raised one at
  -- a time, so the player sees every changed line in a single "accept new odds?" prompt.
  for v_wager in select value from jsonb_array_elements(p_slip) loop
    if jsonb_typeof(v_wager -> 'amount_cents') is distinct from 'number'
       or (v_wager ->> 'amount_cents') !~ '^[0-9]+$' then
      raise exception 'INVALID_AMOUNT';
    end if;
    v_amount := (v_wager ->> 'amount_cents')::bigint;
    if v_amount < 100 then
      raise exception 'INVALID_AMOUNT';
    end if;
    if v_t.max_bet_cents is not null and v_amount > v_t.max_bet_cents then
      raise exception 'OVER_MAX_BET';
    end if;

    if jsonb_typeof(v_wager -> 'legs') is distinct from 'array'
       or jsonb_array_length(v_wager -> 'legs') = 0 then
      raise exception 'INVALID_SLIP';
    end if;
    v_n := jsonb_array_length(v_wager -> 'legs');
    if v_n > 1 and not v_parlays then
      raise exception 'PARLAYS_DISABLED';
    end if;
    if v_n > v_max_legs then
      raise exception 'TOO_MANY_LEGS';
    end if;

    v_dec := 1;
    v_events := '{}';
    v_legs := '[]'::jsonb;
    for v_leg in select value from jsonb_array_elements(v_wager -> 'legs') loop
      select o.id, o.event_id, o.market_key, o.outcome_name, o.participant_name, o.point,
             o.price_american, o.price_decimal, o.is_live,
             e.commence_time, e.status as event_status, m.last_seen_at,
             exists (select 1 from public.tournament_events te
                     where te.tournament_id = p_tournament_id and te.event_id = o.event_id) as in_tournament
        into v_o
        from public.odds_cache o
        join public.events e on e.id = o.event_id
        left join public.odds_markets m
          on m.event_id = o.event_id and m.market_key = o.market_key and m.is_live = o.is_live
       where o.id = (v_leg ->> 'odds_id')::bigint;

      if not found or v_o.is_live then
        raise exception 'ODDS_UNAVAILABLE';
      end if;
      if not v_o.in_tournament then
        raise exception 'INVALID_SELECTION';
      end if;
      if v_o.commence_time <= now() or v_o.event_status <> 'scheduled' then
        raise exception 'EVENT_STARTED';
      end if;
      if not (v_markets ? v_o.market_key) then
        raise exception 'MARKET_NOT_ALLOWED';
      end if;
      if v_o.last_seen_at is null
         or v_o.last_seen_at < now() - private.odds_max_age(v_o.commence_time) then
        raise exception 'ODDS_STALE';
      end if;
      if v_o.event_id = any (v_events) then
        raise exception 'SAME_EVENT_PARLAY';
      end if;
      v_events := v_events || v_o.event_id;

      if (v_leg ->> 'price_american')::int is distinct from v_o.price_american
         or nullif(v_leg ->> 'point', '')::numeric is distinct from v_o.point then
        v_changed := v_changed || jsonb_build_object(
          'odds_id', v_o.id, 'price_american', v_o.price_american, 'point', v_o.point);
      end if;

      v_dec := v_dec * v_o.price_decimal;
      v_legs := v_legs || jsonb_build_object(
        'odds_id', v_o.id, 'event_id', v_o.event_id, 'market_key', v_o.market_key,
        'selection', v_o.outcome_name, 'participant_name', v_o.participant_name,
        'line', v_o.point, 'odds_american', v_o.price_american, 'odds_decimal', v_o.price_decimal);
    end loop;

    -- Mirrors parlayDecimalE4 / payoutCents / decimalE4ToAmerican in src/lib/core/odds.ts.
    v_dec := least(round(v_dec, 4), 1001);
    v_payout := floor(v_amount * v_dec)::bigint;
    v_total_stake := v_total_stake + v_amount;
    v_total_payout := v_total_payout + v_payout;
    v_resolved := v_resolved || jsonb_build_object(
      'amount', v_amount,
      'decimal', v_dec,
      'payout', v_payout,
      'american', case
        when v_n = 1 then (v_legs -> 0 ->> 'odds_american')::int
        when v_dec >= 2 then round((v_dec - 1) * 100)::int
        else round(-100 / (v_dec - 1))::int
      end,
      'legs', v_legs);
  end loop;

  if jsonb_array_length(v_changed) > 0 then
    raise exception 'ODDS_CHANGED' using detail = v_changed::text;
  end if;
  if v_total_stake > v_p.remaining_bankroll_cents then
    raise exception 'INSUFFICIENT_BANKROLL';
  end if;

  -- Pass 2: book it.
  for v_r in select value from jsonb_array_elements(v_resolved) loop
    insert into public.wagers (tournament_id, participant_id, wager_type, amount_cents,
                               odds_american, odds_decimal, potential_payout_cents)
    values (
      p_tournament_id, v_p.id,
      (case when jsonb_array_length(v_r -> 'legs') = 1 then 'single' else 'parlay' end)::public.wager_type,
      (v_r ->> 'amount')::bigint, (v_r ->> 'american')::int, (v_r ->> 'decimal')::numeric,
      (v_r ->> 'payout')::bigint)
    returning id into v_wager_id;

    insert into public.wager_legs (wager_id, tournament_id, participant_id, event_id, odds_id,
                                   market_key, selection, participant_name, line,
                                   odds_american, odds_decimal)
    select v_wager_id, p_tournament_id, v_p.id, l.event_id, l.odds_id, l.market_key, l.selection,
           l.participant_name, l.line, l.odds_american, l.odds_decimal
    from jsonb_to_recordset(v_r -> 'legs') as l(
      odds_id bigint, event_id text, market_key text, selection text, participant_name text,
      line numeric, odds_american int, odds_decimal numeric);

    v_ids := v_ids || v_wager_id;
  end loop;

  update public.tournament_participants
     set remaining_bankroll_cents = remaining_bankroll_cents - v_total_stake,
         total_potential_payout_cents = total_potential_payout_cents + v_total_payout
   where id = v_p.id;

  return query select w.* from public.wagers w where w.id = any (v_ids) order by w.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_wager: pre-lock refund. DELETE ... RETURNING is the claim, so a concurrent duplicate
-- cancel finds nothing (no double refund).
-- ---------------------------------------------------------------------------
create function public.cancel_wager(p_wager_id uuid) returns void
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
     and p.id = w.participant_id and p.user_id = v_uid
     and t.id = w.tournament_id and t.lock_time > now() and t.status in ('draft', 'open')
  returning w.* into v_w;

  if not found then
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

-- replace_wager: cancel + re-place atomically. If the new slip fails (e.g. ODDS_CHANGED), the
-- whole transaction rolls back and the original bet survives at its original price.
create function public.replace_wager(p_wager_id uuid, p_slip jsonb)
returns setof public.wagers
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tournament_id uuid;
begin
  select w.tournament_id into v_tournament_id from public.wagers w where w.id = p_wager_id;
  perform public.cancel_wager(p_wager_id);   -- enforces ownership + lock
  return query select * from public.place_wagers(v_tournament_id, p_slip);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_roster: now includes has_submitted ("5/8 locked in") without revealing the picks.
-- ---------------------------------------------------------------------------
drop function public.get_roster(uuid);
create function public.get_roster(p_tournament_id uuid)
returns table (
  user_id uuid, display_name text, avatar_url text, is_host boolean, joined_at timestamptz,
  has_submitted boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_participant(p_tournament_id) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  return query
  select pr.id, pr.display_name, pr.avatar_url, pr.id = t.host_id, p.joined_at,
         exists (select 1 from public.wagers w where w.participant_id = p.id)
  from public.tournament_participants p
  join public.profiles pr on pr.id = p.user_id
  join public.tournaments t on t.id = p.tournament_id
  where p.tournament_id = p_tournament_id
  order by p.joined_at;
end;
$$;

revoke all on function public.place_wagers(uuid, jsonb), public.cancel_wager(uuid),
  public.replace_wager(uuid, jsonb), public.get_roster(uuid), public.is_locked(public.tournaments)
  from public, anon;
grant execute on function public.place_wagers(uuid, jsonb), public.cancel_wager(uuid),
  public.replace_wager(uuid, jsonb), public.get_roster(uuid), public.is_locked(public.tournaments)
  to authenticated;
