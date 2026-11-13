insert into private.app_settings(key,value) values ('odds_demand_tiers',
'{"normal":{"picked":"15 seconds","live":"2 minutes","close":"2 hours","day":"6 hours","far":"12 hours"},"tight":{"picked":"1 minute","live":"5 minutes","close":"4 hours","day":"12 hours","far":"24 hours"},"critical":{"picked":"5 minutes","live":"5 minutes","close":"6 hours","day":"24 hours","far":"48 hours"}}');

create function private.odds_demand_interval(p_commence timestamptz,p_picked boolean) returns interval
language sql stable security definer set search_path='' as $$
 select (private.odds_setting('odds_demand_tiers')->(private.odds_budget()->>'cadence_tier')->>
 case when p_picked and p_commence<=now()+interval '30 minutes' then 'picked'
 when p_commence<=now() then 'live'
 when p_commence<=now()+interval '1 hour' then 'close'
 when p_commence<=now()+interval '24 hours' then 'day' else 'far' end)::interval
 * private.odds_breaker_factor();
$$;
revoke all on function private.odds_demand_interval(timestamptz,boolean) from public,anon,authenticated;

create function private.odds_event_interval(p_event text) returns interval
language sql stable security definer set search_path='' as $$
 select private.odds_demand_interval(e.commence_time,exists(
 select 1 from public.wager_legs l join public.wagers w on w.id=l.wager_id
 join public.tournaments t on t.id=w.tournament_id
 where l.event_id=e.id and l.status='pending' and w.status='pending'
 and t.status in ('open','locked','live')))
 from public.events e where e.id=p_event;
$$;
revoke all on function private.odds_event_interval(text) from public,anon,authenticated;

-- Existing board and wager RPCs pass kickoff, so use the fastest matching demand.
create or replace function private.odds_refresh_interval(p_commence timestamptz) returns interval
language sql stable security definer set search_path='' as $$
 select coalesce((select min(private.odds_event_interval(e.id)) from public.events e
 where e.commence_time=p_commence),private.odds_demand_interval(p_commence,false));
$$;
create or replace function private.odds_max_age(p_commence timestamptz) returns interval
language sql stable security definer set search_path='' as $$
 select private.odds_refresh_interval(p_commence)*1.5 +
 least(interval '1 minute', private.odds_refresh_interval(p_commence)/3);
$$;
create or replace function private.odds_sync_odds_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (
    select e.id, e.sport_key, e.commence_time, t.created_at as tournament_created_at,
           t.allowed_bet_types -> 'markets' as markets
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    left join private.odds_sync_state es on es.sport_key=e.sport_key
    left join lateral (select max(m.last_seen_at) as seen from public.odds_markets m
      where m.event_id=e.id and m.is_live=(e.commence_time<=now()) and m.market_key not like 'player\_%') ms on true
    where (coalesce(ms.seen,es.last_odds_sync_at) is null
      or coalesce(ms.seen,es.last_odds_sync_at)+private.odds_event_interval(e.id)<=now()
      or t.created_at>coalesce(ms.seen,es.last_odds_sync_at))
      and t.status in ('draft','open','locked','live')
      and e.status in ('scheduled','live') and e.commence_time > now()-interval '12 hours'
      and (private.odds_setting('odds_budget_profile') #>> '{}' <> 'beta'
        or (private.odds_setting('odds_beta_event_ids') ? e.id and e.commence_time <= now()+interval '48 hours'))
  ),
  per_sport as (
    select a.sport_key,
           min(private.odds_event_interval(a.id)) as every,
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
      -- Event due filtering above prevents hot events from pulling far events every 15s.
  ),
  props_active as (
    select e.id, e.sport_key, e.commence_time, max(t.created_at) as newest_tournament_at
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('draft', 'open') and t.lock_time > now()
      and e.status = 'scheduled' and e.commence_time > now()
      and private.odds_setting('odds_budget_profile') #>> '{}' <> 'beta'
      and (private.odds_setting('odds_budget_mode') #>> '{}' <> 'auto' or private.odds_budget()->>'cadence_tier' = 'normal')
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
           or ps.last_sync_at + private.odds_event_interval(pa.id) <= now()
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
    where (s.last_scores_sync_at is null
           or s.last_scores_sync_at + private.odds_scores_interval() <= now())
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
  v_dropped int := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-ingest:' || p_sport_key));
  -- Filter the whole snapshot, including deletes and freshness, before applying it.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_markets
  from jsonb_array_elements(p_markets) x
  where not exists (select 1 from public.odds_markets m
    where m.event_id = x->>'event_id' and m.market_key = x->>'market_key' and m.is_live = (exists(select 1 from public.events ev where ev.id=x->>'event_id' and ev.commence_time<=p_fetched_at))
      and (m.last_seen_at > p_fetched_at or m.provider_updated_at > coalesce((x->>'provider_updated_at')::timestamptz, p_fetched_at)))
    and not exists (select 1 from jsonb_array_elements(p_outcomes) o
      join private.odds_player_versions v on v.event_id=o->>'event_id'
        and v.market_key=o->>'market_key' and v.participant_name=coalesce(o->>'participant_name','')
      where o->>'event_id'=x->>'event_id' and o->>'market_key'=x->>'market_key'
        and v.provider_updated_at > coalesce((o->>'provider_updated_at')::timestamptz, p_fetched_at));
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_outcomes
  from jsonb_array_elements(p_outcomes) x where exists
    (select 1 from jsonb_array_elements(p_markets) m where m->>'event_id'=x->>'event_id' and m->>'market_key'=x->>'market_key');
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
   where coalesce((select s.last_catalog_sync_at from private.odds_sync_state s where s.sport_key=p_sport_key), '-infinity'::timestamptz) <= p_fetched_at
       and (e.commence_time, e.home_team, e.away_team)
         is distinct from (excluded.commence_time, excluded.home_team, excluded.away_team);
  get diagnostics v_events = row_count;

  perform private.event_status(x->>'id',x->>'status',x->>'status_reason',p_fetched_at)
  from jsonb_array_elements(p_events) x
  where exists(select 1 from public.events e where e.id=x->>'id' and e.sport_key=p_sport_key);
  perform private.void_stale_legs();
  if p_kind in ('odds', 'props') then
    -- Live rows use a separate unique key; frozen closing prices remain immutable.
    insert into public.odds_cache as o (
      event_id, market_key, outcome_name, participant_name, point, price_american, bookmaker, updated_at, is_live)
    select x.event_id, x.market_key, x.outcome_name, coalesce(x.participant_name, ''), x.point,
           x.price_american, x.bookmaker, p_fetched_at, ev.commence_time<=p_fetched_at
    from jsonb_to_recordset(p_outcomes) as x(
      event_id text, market_key text, outcome_name text, participant_name text,
      point numeric, price_american int, bookmaker text)
    join public.events ev on ev.id = x.event_id and ev.status in ('scheduled','live') and ev.commence_time > p_fetched_at-interval '12 hours'
    on conflict (event_id, market_key, outcome_name, participant_name, alt_point, is_live) do update
       set price_american = excluded.price_american,
           point = excluded.point,
           bookmaker = excluded.bookmaker,
           updated_at = excluded.updated_at
     where (o.is_live or o.locked_at is null)
       and (o.price_american, o.point) is distinct from (excluded.price_american, excluded.point);
    get diagnostics v_changed = row_count;

    -- Every prop shape: withdrawn players and alternate lines must stop being bettable.
    -- Only for (game, market) pairs this sync actually priced; bets keep their own copy (odds_id → null).
    delete from public.odds_cache o
     using (select distinct x.event_id, x.market_key
              from jsonb_to_recordset(p_markets) as x(event_id text, market_key text)
             where x.market_key like 'player\_%') pm
     where o.event_id = pm.event_id and o.market_key = pm.market_key
       and o.is_live = (exists(select 1 from public.events ev where ev.id=o.event_id and ev.commence_time<=p_fetched_at)) and (o.is_live or o.locked_at is null)
       and exists (select 1 from public.events e where e.id=o.event_id and e.status in ('scheduled','live') and e.commence_time > p_fetched_at-interval '12 hours')
       and not exists (
         select 1 from jsonb_to_recordset(p_outcomes) as y(
           event_id text, market_key text, outcome_name text, participant_name text, point numeric)
         where y.event_id = o.event_id and y.market_key = o.market_key and y.outcome_name = o.outcome_name
           and coalesce(y.participant_name, '') = o.participant_name and (o.market_key not like '%\_alternate' or y.point is not distinct from o.point));
    get diagnostics v_dropped = row_count;
    v_changed := v_changed + v_dropped;

    insert into public.odds_markets as m (event_id, market_key, is_live, bookmaker, last_seen_at, provider_updated_at)
    select x.event_id, x.market_key, ev.commence_time<=p_fetched_at, x.bookmaker, p_fetched_at, coalesce(x.provider_updated_at, p_fetched_at)
    from jsonb_to_recordset(p_markets) as x(event_id text, market_key text, bookmaker text, provider_updated_at timestamptz)
    join public.events ev on ev.id = x.event_id and ev.status in ('scheduled','live') and ev.commence_time > p_fetched_at-interval '12 hours'
    on conflict (event_id, market_key, is_live) do update
       set provider_updated_at = excluded.provider_updated_at,
           bookmaker = excluded.bookmaker,
           last_seen_at = greatest(m.last_seen_at, excluded.last_seen_at);
    get diagnostics v_markets = row_count;

    insert into private.odds_player_versions as v(event_id, market_key, participant_name, provider_updated_at)
    select x.event_id, x.market_key, coalesce(x.participant_name,''), max(coalesce(x.provider_updated_at,p_fetched_at))
    from jsonb_to_recordset(p_outcomes) x(event_id text, market_key text, participant_name text, provider_updated_at timestamptz)
    join public.events ev on ev.id=x.event_id and ev.status in ('scheduled','live') and ev.commence_time > p_fetched_at-interval '12 hours'
    group by x.event_id, x.market_key, coalesce(x.participant_name,'')
    on conflict(event_id, market_key, participant_name) do update
      set provider_updated_at=greatest(v.provider_updated_at,excluded.provider_updated_at);

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

create or replace function private.odds_effective_tiers() returns jsonb
language sql stable security definer set search_path='' as $$
 select private.odds_setting('odds_demand_tiers')->(private.odds_budget()->>'cadence_tier')
 || jsonb_build_object('scores',coalesce(private.odds_setting('odds_pacing_tiers')->
 (private.odds_budget()->>'cadence_tier')->>'scores','1 hour'));
$$;
