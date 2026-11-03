-- Phase 4: real odds, safely. A hard, DB-enforced Odds API credit budget.
--
-- Every PAID call by the odds-sync Edge Function must first reserve its estimated cost with
-- odds_budget_reserve(). The DB refuses when:
--   * paid calls are switched off (the default: dry-run first, then `odds_set_paid_calls(true)`),
--   * this calendar month's spend (our ledger) would pass the cap, or
--   * the provider's own x-requests-remaining counter would drop into the buffer (quota - cap).
-- After the call, odds_budget_settle() replaces the estimate with the real cost from the headers.
-- Unsettled reservations keep counting, so a crash or timeout can only over-count, never under.
-- Free endpoints (/events) don't reserve but still record their headers, which keeps the
-- provider-counter reading fresh.

-- ---------------------------------------------------------------------------
-- Settings: free tier. Upgrading the plan = updating these rows, no deploy.
-- ---------------------------------------------------------------------------
update private.app_settings set value = '500' where key = 'odds_monthly_quota';
insert into private.app_settings (key, value) values
  ('odds_monthly_cap', '400'),
  ('odds_paid_calls_enabled', 'false'),
  -- Refresh cadence by time to kickoff. Free tier: ~6 credits/day per sport far out.
  ('odds_refresh_tiers', '{"far": "12 hours", "day": "2 hours", "close": "30 minutes"}');

alter table private.api_usage
  add column status text not null default 'settled' check (status in ('reserved', 'settled'));

alter table private.odds_sync_state add column odds_blocked_until timestamptz;

create function private.odds_setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select s.value from private.app_settings s where s.key = p_key;
$$;
revoke all on function private.odds_setting(text) from public;
grant execute on function private.odds_setting(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Budget arithmetic (calendar month, UTC).
-- ---------------------------------------------------------------------------
create function private.odds_budget() returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((private.odds_setting('odds_monthly_quota') #>> '{}')::int, 500) as quota,
           coalesce((private.odds_setting('odds_monthly_cap') #>> '{}')::int, 400) as cap,
           coalesce((private.odds_setting('odds_paid_calls_enabled') #>> '{}')::boolean, false) as enabled,
           (date_trunc('month', now() at time zone 'utc') at time zone 'utc') as month_start
  ), month as (
    select coalesce(sum(u.credits_used), 0)::int as used
    from private.api_usage u, cfg
    where u.called_at >= cfg.month_start
  ), provider as (
    select u.credits_remaining as remaining
    from private.api_usage u, cfg
    where u.called_at >= cfg.month_start and u.credits_remaining is not null
    order by u.called_at desc, u.id desc limit 1
  )
  select jsonb_build_object(
    'enabled', cfg.enabled,
    'quota', cfg.quota,
    'cap', cfg.cap,
    'used_this_month', month.used,
    'provider_remaining', (select remaining from provider),
    'left', greatest(0, least(
      cfg.cap - month.used,
      coalesce((select remaining from provider) - (cfg.quota - cfg.cap), cfg.cap - month.used)))
  )
  from cfg, month;
$$;
revoke all on function private.odds_budget() from public;

create function public.odds_budget_reserve(p_sport_key text, p_endpoint text, p_cost int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_budget jsonb;
  v_id bigint;
begin
  -- Serialize reservations so parallel runs can't both see the same "left".
  perform pg_advisory_xact_lock(hashtext('odds-budget'));
  v_budget := private.odds_budget();

  if p_cost is null or p_cost < 1 or p_cost > 10 then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_COST', 'budget', v_budget);
  end if;
  if not (v_budget ->> 'enabled')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'PAID_CALLS_DISABLED', 'budget', v_budget);
  end if;
  if p_cost > (v_budget ->> 'left')::int then
    -- Back this sport off so cron doesn't wake the function every minute just to be refused.
    insert into private.odds_sync_state as s (sport_key, odds_blocked_until)
    values (p_sport_key, now() + interval '15 minutes')
    on conflict (sport_key) do update set odds_blocked_until = excluded.odds_blocked_until;
    return jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'budget', v_budget);
  end if;

  insert into private.api_usage (sport_key, endpoint, credits_used, status)
  values (p_sport_key, p_endpoint, p_cost, 'reserved')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'budget', private.odds_budget());
end;
$$;

create function public.odds_budget_settle(
  p_reservation_id bigint, p_credits_used int default null, p_credits_remaining int default null)
returns void
language sql volatile security definer set search_path = '' as $$
  update private.api_usage
     set credits_used = coalesce(p_credits_used, credits_used),
         credits_remaining = p_credits_remaining,
         status = 'settled'
   where id = p_reservation_id and status = 'reserved';
$$;

create function public.odds_set_paid_calls(p_enabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.app_settings set value = to_jsonb(p_enabled) where key = 'odds_paid_calls_enabled';
  if p_enabled then
    update private.odds_sync_state set odds_blocked_until = null  -- retry backed-off sports now
     where odds_blocked_until is not null;
  end if;
  return private.odds_budget();
end;
$$;

-- Operator view: budget + the last calls (no secrets in here; the key never reaches the DB).
create function public.odds_budget_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'budget', private.odds_budget(),
    'recent_calls', coalesce((
      select jsonb_agg(c order by c.called_at desc)
      from (select u.called_at, u.sport_key, u.endpoint, u.credits_used, u.credits_remaining, u.status
            from private.api_usage u order by u.called_at desc, u.id desc limit 10) c), '[]'::jsonb),
    'refresh_tiers', private.odds_setting('odds_refresh_tiers')
  );
$$;

revoke all on function public.odds_budget_reserve(text, text, int), public.odds_budget_settle(bigint, int, int),
  public.odds_set_paid_calls(boolean), public.odds_budget_status()
  from public, anon, authenticated;
grant execute on function public.odds_budget_reserve(text, text, int), public.odds_budget_settle(bigint, int, int),
  public.odds_set_paid_calls(boolean), public.odds_budget_status()
  to service_role;

-- ---------------------------------------------------------------------------
-- Cadence from settings (still the single source for sync schedule AND bet freshness).
-- SECURITY DEFINER now: the odds_board view evaluates it as the (anon) caller.
-- ---------------------------------------------------------------------------
create or replace function private.odds_refresh_interval(p_commence timestamptz) returns interval
language sql stable security definer set search_path = '' as $$
  with t as (select coalesce(private.odds_setting('odds_refresh_tiers'),
                             '{"far": "12 hours", "day": "2 hours", "close": "30 minutes"}') as tiers)
  select case
    when p_commence - now() > interval '24 hours' then (t.tiers ->> 'far')::interval
    when p_commence - now() > interval '1 hour'   then (t.tiers ->> 'day')::interval
    else (t.tiers ->> 'close')::interval
  end * private.odds_breaker_factor()
  from t;
$$;

-- Due-list: same as Phase 2, minus sports the budget has backed off.
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
           -- a tournament created since the last sync may have added never-priced games
           or ps.newest_tournament_at > s.last_odds_sync_at)
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
  from (select job from odds_jobs union all select job from catalog_jobs) j;
$$;
