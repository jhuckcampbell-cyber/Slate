-- Player props (opt-in per tournament via allowed_bet_types.player_props).
--
-- * Catalog: three over/under markets per sport (private.prop_markets). Only these are bettable,
--   and only when the tournament turned props on.
-- * Odds: props live on The Odds API's per-event endpoint, so they get their own per-game job
--   ('props'), clock (private.props_sync_state) and credit reservation (≈3 credits per refresh).
-- * Grading: the API has no player stats, so after the final the HOST enters the stat once per
--   (game, market, player). It grades every leg on that line in the tournament, uniformly, and the
--   result is public to the squad with who entered it. Props nobody graded refund 48h after kickoff.

create function private.prop_markets(p_sport_key text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_sport_key like 'basketball%' then array['player_points', 'player_rebounds', 'player_assists']
    when p_sport_key like 'americanfootball%' then array['player_pass_yds', 'player_rush_yds', 'player_reception_yds']
    else '{}'::text[]
  end;
$$;
grant execute on function private.prop_markets(text) to authenticated;

create table private.props_sync_state (
  event_id text primary key references public.events on delete cascade,
  last_sync_at timestamptz
);

-- Host-entered stats: one per tournament × game × market × player, readable by the squad.
create table public.prop_results (
  tournament_id uuid not null references public.tournaments on delete cascade,
  event_id text not null references public.events,
  market_key text not null,
  participant_name text not null,
  stat numeric(8,2) not null check (stat >= 0),
  graded_by uuid not null references public.profiles,
  graded_at timestamptz not null default now(),
  primary key (tournament_id, event_id, market_key, participant_name)
);
alter table public.prop_results enable row level security;
revoke all on public.prop_results from anon, authenticated;
grant select on public.prop_results to authenticated;
create policy "prop results: the squad" on public.prop_results for select to authenticated
  using (private.is_participant(tournament_id));

CREATE OR REPLACE FUNCTION public.odds_sync_ingest(p_kind text, p_sport_key text, p_fetched_at timestamp with time zone, p_events jsonb DEFAULT '[]'::jsonb, p_outcomes jsonb DEFAULT '[]'::jsonb, p_markets jsonb DEFAULT '[]'::jsonb, p_usage jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_events int := 0;
  v_changed int := 0;
  v_markets int := 0;
begin
  if p_kind not in ('odds', 'catalog', 'props') then
    raise exception 'INVALID_KIND';
  end if;

  -- Events: upsert schedule fields only (status/scores belong to scores-sync).
  insert into public.events as e (id, sport_key, sport_title, home_team, away_team, commence_time)
  select x.id, x.sport_key, x.sport_title, x.home_team, x.away_team, x.commence_time
  from jsonb_to_recordset(p_events) as x(
    id text, sport_key text, sport_title text, home_team text, away_team text, commence_time timestamptz)
  on conflict (id) do update
     set commence_time = excluded.commence_time,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         sport_title = coalesce(excluded.sport_title, e.sport_title)
   where (e.commence_time, e.home_team, e.away_team)
         is distinct from (excluded.commence_time, excluded.home_team, excluded.away_team);
  get diagnostics v_events = row_count;

  if p_kind in ('odds', 'props') then
    -- Pregame only: in-play prices for started games are skipped (live odds are Phase 4),
    -- and frozen closing-line rows are never overwritten.
    insert into public.odds_cache as o (
      event_id, market_key, outcome_name, participant_name, point, price_american, bookmaker, updated_at)
    select x.event_id, x.market_key, x.outcome_name, coalesce(x.participant_name, ''), x.point,
           x.price_american, x.bookmaker, p_fetched_at
    from jsonb_to_recordset(p_outcomes) as x(
      event_id text, market_key text, outcome_name text, participant_name text,
      point numeric, price_american int, bookmaker text)
    join public.events ev on ev.id = x.event_id and ev.commence_time > p_fetched_at
    on conflict (event_id, market_key, outcome_name, participant_name, is_live) do update
       set price_american = excluded.price_american,
           point = excluded.point,
           bookmaker = excluded.bookmaker,
           updated_at = excluded.updated_at
     where o.locked_at is null
       and (o.price_american, o.point) is distinct from (excluded.price_american, excluded.point);
    get diagnostics v_changed = row_count;

    insert into public.odds_markets as m (event_id, market_key, is_live, bookmaker, last_seen_at)
    select x.event_id, x.market_key, false, x.bookmaker, p_fetched_at
    from jsonb_to_recordset(p_markets) as x(event_id text, market_key text, bookmaker text)
    join public.events ev on ev.id = x.event_id and ev.commence_time > p_fetched_at
    on conflict (event_id, market_key, is_live) do update
       set bookmaker = excluded.bookmaker,
           last_seen_at = greatest(m.last_seen_at, excluded.last_seen_at);
    get diagnostics v_markets = row_count;

    if p_kind = 'odds' then
      insert into private.odds_sync_state as s (sport_key, last_odds_sync_at)
      values (p_sport_key, p_fetched_at)
      on conflict (sport_key) do update
         set last_odds_sync_at = greatest(s.last_odds_sync_at, excluded.last_odds_sync_at);
    else
      -- Props are per game: their own clock, never the sport's game-line clock.
      insert into private.props_sync_state as ps (event_id, last_sync_at)
      select distinct x.event_id, p_fetched_at
      from jsonb_to_recordset(p_markets) as x(event_id text)
      join public.events ev on ev.id = x.event_id
      on conflict (event_id) do update set last_sync_at = greatest(ps.last_sync_at, excluded.last_sync_at);
    end if;
  else
    insert into private.odds_sync_state as s (sport_key, last_catalog_sync_at)
    values (p_sport_key, p_fetched_at)
    on conflict (sport_key) do update
       set last_catalog_sync_at = greatest(s.last_catalog_sync_at, excluded.last_catalog_sync_at);
  end if;

  if p_usage is not null then
    insert into private.api_usage (sport_key, endpoint, credits_used, credits_remaining)
    values (p_sport_key, coalesce(p_usage ->> 'endpoint', p_kind),
            (p_usage ->> 'credits_used')::int, (p_usage ->> 'credits_remaining')::int);
  end if;

  return jsonb_build_object('events', v_events, 'outcomes_changed', v_changed, 'markets_seen', v_markets);
end;
$function$;

CREATE OR REPLACE FUNCTION public.place_wagers(p_tournament_id uuid, p_slip jsonb)
 RETURNS SETOF wagers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  v_markets := coalesce(v_t.allowed_bet_types -> 'markets', '[]'::jsonb)
    || case when coalesce((v_t.allowed_bet_types ->> 'player_props')::boolean, false)
            then to_jsonb(private.prop_markets(v_t.sport_key)) else '[]'::jsonb end;
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
$function$;

CREATE OR REPLACE FUNCTION private.void_stale_legs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wager uuid;
begin
  for v_wager in
    with voided as (
      update public.wager_legs l set status = 'void', settled_at = now()
        from public.events e
       where e.id = l.event_id and l.status = 'pending'
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
$function$;

CREATE OR REPLACE FUNCTION private.leg_probability(l wager_legs)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_e public.events%rowtype;
  v_m record;
  v_live boolean;
  v_r double precision := 1;          -- share of the game left
  v_d double precision := 0;          -- home margin so far
  v_c double precision := 0;          -- points so far
  v_mu double precision;              -- expected final home margin (pregame)
  v_tau double precision;             -- expected final total (pregame)
  v_home_price int;
  v_away_price int;
  v_p_home double precision;          -- de-vigged pregame P(home wins)
  v_is_home boolean;
  v_p double precision;
  v_over_price int;
  v_under_price int;
  v_p_over double precision;
begin
  if l.status in ('hit', 'push', 'void') then return 1; end if;
  if l.status = 'miss' then return 0; end if;

  select * into v_e from public.events where id = l.event_id;
  select * into v_m from private.sport_model(v_e.sport_key);
  v_is_home := l.selection = v_e.home_team;

  v_live := v_e.home_score is not null and v_e.away_score is not null and v_e.status in ('live', 'final');
  if v_live then
    v_r := greatest(0.02, least(1, 1 - extract(epoch from now() - v_e.commence_time) / 60 / v_m.duration_minutes));
    v_d := v_e.home_score - v_e.away_score;
    v_c := v_e.home_score + v_e.away_score;
  end if;

  -- Closing (last pregame) prices for this game.
  select -o.point into v_mu from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'spreads' and o.outcome_name = v_e.home_team and not o.is_live;
  select o.point into v_tau from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'totals' and o.outcome_name = 'Over' and not o.is_live;
  select o.price_american into v_home_price from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'h2h' and o.outcome_name = v_e.home_team and not o.is_live;
  select o.price_american into v_away_price from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'h2h' and o.outcome_name = v_e.away_team and not o.is_live;
  if v_home_price is not null and v_away_price is not null then
    v_p_home := (100.0 / (1 + case when v_home_price > 0 then v_home_price / 100.0 else 100.0 / -v_home_price end));
    v_p_home := v_p_home / (v_p_home + (100.0 / (1 + case when v_away_price > 0 then v_away_price / 100.0
                                                          else 100.0 / -v_away_price end)));
  end if;
  -- No spread market: back the margin out of the moneyline (logistic ≈ probit, 1.702).
  if v_mu is null and v_p_home is not null then
    v_mu := v_m.margin_sd * ln(v_p_home / (1 - v_p_home)) / 1.702;
  end if;

  if l.market_key = 'h2h' then
    if not v_live and v_p_home is not null then
      v_p := case when v_is_home then v_p_home else 1 - v_p_home end;
    else
      v_p := private.norm_cdf((v_d + coalesce(v_mu, 0) * v_r) / (v_m.margin_sd * sqrt(v_r)));
      if not v_is_home then v_p := 1 - v_p; end if;
    end if;
  elsif l.market_key = 'spreads' then
    v_mu := coalesce(v_mu, case when v_is_home then -l.line else l.line end);
    v_p := private.norm_cdf(
      ((case when v_is_home then 1 else -1 end) * (v_d + v_mu * v_r) + l.line) / (v_m.margin_sd * sqrt(v_r)));
  elsif l.market_key = 'totals' then
    v_p := private.norm_cdf((v_c + coalesce(v_tau, l.line) * v_r - l.line) / (v_m.total_sd * sqrt(v_r)));
    if l.selection = 'Under' then v_p := 1 - v_p; end if;
  else
    -- Props: de-vig the current Over/Under pair at the bet's line; else the bet's own price.
    select o.price_american into v_over_price from public.odds_cache o
     where o.event_id = l.event_id and o.market_key = l.market_key and o.participant_name = l.participant_name
       and o.outcome_name = 'Over' and o.point = l.line and not o.is_live;
    select o.price_american into v_under_price from public.odds_cache o
     where o.event_id = l.event_id and o.market_key = l.market_key and o.participant_name = l.participant_name
       and o.outcome_name = 'Under' and o.point = l.line and not o.is_live;
    if v_over_price is not null and v_under_price is not null then
      v_p_over := 1 / (1 + case when v_over_price > 0 then v_over_price / 100.0 else 100.0 / -v_over_price end);
      v_p_over := v_p_over / (v_p_over + 1 / (1 + case when v_under_price > 0 then v_under_price / 100.0
                                                       else 100.0 / -v_under_price end));
      v_p := case when l.selection = 'Over' then v_p_over else 1 - v_p_over end;
    else
      v_p := 1 / l.odds_decimal;
    end if;
  end if;
  return greatest(0, least(1, v_p));
end;
$function$;


create function public.grade_prop(
  p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.tournaments%rowtype;
  v_status text;
  v_wager uuid;
  v_n int := 0;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.host_id is distinct from auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if p_stat is null or p_stat < 0 or p_stat > 9999 then
    raise exception 'INVALID_STAT';
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
               and r.market_key = p_market_key and r.participant_name = p_participant_name) then
    raise exception 'ALREADY_GRADED';
  end if;
  if not exists (select 1 from public.wager_legs l
                 where l.tournament_id = p_tournament_id and l.event_id = p_event_id
                   and l.market_key = p_market_key and l.participant_name = p_participant_name
                   and l.status = 'pending') then
    raise exception 'NOTHING_TO_GRADE';
  end if;

  insert into public.prop_results (tournament_id, event_id, market_key, participant_name, stat, graded_by)
  values (p_tournament_id, p_event_id, p_market_key, p_participant_name, p_stat, auth.uid());

  for v_wager in
    with graded as (
      update public.wager_legs l
         set status = case sign((p_stat - l.line) * case when l.selection = 'Over' then 1 else -1 end)
                        when 1 then 'hit' when 0 then 'push' else 'miss' end::public.leg_status,
             settled_at = now()
       where l.tournament_id = p_tournament_id and l.event_id = p_event_id
         and l.market_key = p_market_key and l.participant_name = p_participant_name
         and l.status = 'pending' and l.selection in ('Over', 'Under') and l.line is not null
      returning l.wager_id
    )
    select distinct g.wager_id from graded g
  loop
    perform private.settle_wager(v_wager);
    v_n := v_n + 1;
  end loop;

  perform private.signal(p_tournament_id, 'scores', '{}'::jsonb);
  return jsonb_build_object('wagers', v_n);
end;
$$;
revoke all on function public.grade_prop(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.grade_prop(uuid, text, text, text, numeric) to authenticated;

-- Due-list: + one 'props' job per game whose open tournaments turned props on.
create or replace function private.odds_sync_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (
    select e.id, e.sport_key, e.commence_time, t.created_at as tournament_created_at,
           t.allowed_bet_types -> 'markets' as markets
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('draft', 'open') and t.lock_time > now()
      and e.status = 'scheduled' and e.commence_time > now()
  ),
  per_sport as (
    select a.sport_key,
           min(private.odds_refresh_interval(a.commence_time)) as every,
           max(a.tournament_created_at) as newest_tournament_at,
           jsonb_agg(distinct a.id) as event_ids,
           (select jsonb_agg(distinct m.market order by m.market)
              from active a2, jsonb_array_elements_text(a2.markets) as m(market)
             where a2.sport_key = a.sport_key) as markets
    from active a
    group by a.sport_key
  ),
  odds_jobs as (
    select jsonb_build_object('kind', 'odds', 'sport_key', ps.sport_key,
                              'markets', ps.markets, 'event_ids', ps.event_ids) as job
    from per_sport ps
    left join private.odds_sync_state s on s.sport_key = ps.sport_key
    where (s.odds_blocked_until is null or s.odds_blocked_until <= now())
      and (s.last_odds_sync_at is null
           or s.last_odds_sync_at + ps.every <= now()
           or ps.newest_tournament_at > s.last_odds_sync_at)
  ),
  props_active as (
    select e.id, e.sport_key, e.commence_time, max(t.created_at) as newest_tournament_at
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('draft', 'open') and t.lock_time > now()
      and e.status = 'scheduled' and e.commence_time > now()
      and coalesce((t.allowed_bet_types ->> 'player_props')::boolean, false)
      and cardinality(private.prop_markets(e.sport_key)) > 0
    group by e.id, e.sport_key, e.commence_time
  ),
  props_jobs as (
    select jsonb_build_object('kind', 'props', 'sport_key', pa.sport_key, 'event_id', pa.id,
                              'markets', to_jsonb(private.prop_markets(pa.sport_key))) as job
    from props_active pa
    left join private.props_sync_state ps on ps.event_id = pa.id
    left join private.odds_sync_state s on s.sport_key = pa.sport_key
    where (s.odds_blocked_until is null or s.odds_blocked_until <= now())
      and (ps.last_sync_at is null
           or ps.last_sync_at + private.odds_refresh_interval(pa.commence_time) <= now()
           or pa.newest_tournament_at > ps.last_sync_at)
  ),
  in_play as (
    select e.sport_key, jsonb_agg(distinct e.id) as event_ids
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('locked', 'live')
      and e.commence_time <= now() and e.commence_time > now() - interval '12 hours'
      and e.status not in ('final', 'canceled', 'postponed')
    group by e.sport_key
  ),
  scores_jobs as (
    select jsonb_build_object('kind', 'scores', 'sport_key', ip.sport_key, 'event_ids', ip.event_ids) as job
    from in_play ip
    left join private.odds_sync_state s on s.sport_key = ip.sport_key
    where (s.odds_blocked_until is null or s.odds_blocked_until <= now())
      and (s.last_scores_sync_at is null
           or s.last_scores_sync_at + coalesce((private.odds_setting('scores_refresh') #>> '{}')::interval,
                                               interval '15 minutes') <= now())
  ),
  catalog_jobs as (
    select jsonb_build_object('kind', 'catalog', 'sport_key', c.sport_key) as job
    from jsonb_array_elements_text(coalesce(
           (select st.value from private.app_settings st where st.key = 'odds_catalog_sports'),
           '[]'::jsonb)) as c(sport_key)
    left join private.odds_sync_state s on s.sport_key = c.sport_key
    where s.last_catalog_sync_at is null or s.last_catalog_sync_at + interval '6 hours' <= now()
  )
  select coalesce(jsonb_agg(j.job), '[]'::jsonb)
  from (select job from odds_jobs union all select job from props_jobs
        union all select job from scores_jobs union all select job from catalog_jobs) j;
$$;
