-- Same-game parlays (2026-11-05). Host switch allowed_bet_types.same_game_parlays (on unless set false, so
-- existing tournaments get it). Several picks from one game may share a parlay, but each leg occupies a slot:
-- one per game line (moneyline, spread, total) and one per player stat (an alternate ladder shares its main
-- line's stat). A repeated slot raises CONFLICTING_LEGS: no Over+Under, both moneylines, or "50+" + "100+".
-- Pricing stays the product of leg prices (books shave SGPs for correlation; play money accepts the generosity),
-- and live win probability still multiplies legs as if independent: an approximation for same-game legs.

CREATE OR REPLACE FUNCTION public.create_tournament(p_title text, p_event_ids text[], p_code_prefix text DEFAULT 'SB'::text, p_description text DEFAULT NULL::text, p_starting_bankroll_cents integer DEFAULT 10000, p_max_bet_cents integer DEFAULT NULL::integer, p_allowed_bet_types jsonb DEFAULT NULL::jsonb, p_lock_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_prefix text := upper(coalesce(nullif(btrim(p_code_prefix), ''), 'SB'));
  v_event_count int;
  v_sport text;
  v_sport_count int;
  v_first_kickoff timestamptz;
  v_lock timestamptz;
  v_allowed jsonb;
  v_code text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_prefix !~ '^[A-Z0-9]{2,5}$' then
    v_prefix := 'SB';
  end if;

  -- Abuse guard (guests are cheap to create): max 10 tournaments per user per hour.
  if (select count(*) from public.tournaments t
      where t.host_id = v_uid and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;

  if coalesce(cardinality(p_event_ids), 0) = 0 or cardinality(p_event_ids) > 20 then
    raise exception 'INVALID_EVENTS';
  end if;

  select count(*), min(e.sport_key), count(distinct e.sport_key), min(e.commence_time)
    into v_event_count, v_sport, v_sport_count, v_first_kickoff
  from public.events e
  where e.id = any (p_event_ids) and e.status = 'scheduled' and e.commence_time > now();

  if v_event_count <> cardinality(array(select distinct unnest(p_event_ids))) then
    raise exception 'INVALID_EVENTS';
  end if;
  if v_sport_count <> 1 then
    raise exception 'MIXED_SPORTS';
  end if;

  -- Lock defaults to first kickoff and may never be after it.
  v_lock := coalesce(p_lock_time, v_first_kickoff);
  if v_lock <= now() or v_lock > v_first_kickoff then
    raise exception 'INVALID_LOCK_TIME';
  end if;

  -- Merge host-provided rules over defaults; only whitelisted markets survive.
  v_allowed := jsonb_build_object(
    'markets', coalesce(
      (select jsonb_agg(distinct m)
       from jsonb_array_elements_text(coalesce(p_allowed_bet_types -> 'markets', '[]')) as m
       where m in ('h2h', 'spreads', 'totals')),
      '["h2h","spreads","totals"]'::jsonb),
    'parlays', coalesce((p_allowed_bet_types ->> 'parlays')::boolean, true),
    'max_parlay_legs', least(greatest(coalesce((p_allowed_bet_types ->> 'max_parlay_legs')::int, 6), 2), 10),
    'player_props', coalesce((p_allowed_bet_types ->> 'player_props')::boolean, false),
    'same_game_parlays', coalesce((p_allowed_bet_types ->> 'same_game_parlays')::boolean, true)
  );

  -- Generate a unique code (retry on the rare collision).
  for attempt in 1..10 loop
    v_code := v_prefix || '-' || private.random_code_suffix();
    exit when not exists (select 1 from public.tournaments t where t.code = v_code);
    if attempt = 10 then
      raise exception 'CODE_GENERATION_FAILED';
    end if;
  end loop;

  insert into public.tournaments (
    host_id, title, description, code, sport_key, starting_bankroll_cents,
    max_bet_cents, allowed_bet_types, lock_time, status
  ) values (
    v_uid, btrim(p_title), nullif(btrim(p_description), ''), v_code, v_sport,
    p_starting_bankroll_cents, p_max_bet_cents, v_allowed, v_lock, 'open'
  ) returning tournaments.id into v_id;

  insert into public.tournament_events (tournament_id, event_id)
  select v_id, distinct_ids.eid from (select distinct unnest(p_event_ids) as eid) distinct_ids;

  -- Host auto-joins.
  insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
  values (v_id, v_uid, p_starting_bankroll_cents);

  return query select v_id, v_code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_tournament(p_tournament_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'player_props', coalesce((v_rules ->> 'player_props')::boolean, false),
      'same_game_parlays', coalesce((v_rules ->> 'same_game_parlays')::boolean, true));
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
  v_slots text[];
  v_slot text;
  v_sgp boolean;
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
  v_sgp := coalesce((v_t.allowed_bet_types ->> 'same_game_parlays')::boolean, true);

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
    v_slots := '{}';
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
      if not v_sgp and v_o.event_id = any (v_events) then
        raise exception 'SAME_EVENT_PARLAY';
      end if;
      v_events := v_events || v_o.event_id;
      -- One pick per game line and per player stat (a ladder is its main line's stat): no Over+Under, no 50+ & 100+.
      v_slot := case when v_o.market_key like 'player\_%'
                     then v_o.event_id || '|' || regexp_replace(v_o.market_key, '_alternate$', '') || '|' || v_o.participant_name
                     else v_o.event_id || '|' || v_o.market_key end;
      if v_slot = any (v_slots) then
        raise exception 'CONFLICTING_LEGS';
      end if;
      v_slots := v_slots || v_slot;

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
