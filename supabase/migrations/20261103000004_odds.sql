-- Phase 2a: odds cache + sync plumbing.
-- The Odds API is called only by the odds-sync Edge Function (CLAUDE.md rule 6). It asks
-- odds_sync_claim() what is due (single-flight lease), fetches, and writes via odds_sync_ingest().
-- pg_cron pokes the function every minute, but only when there is work.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Private config/state
-- ---------------------------------------------------------------------------
create table private.app_settings (
  key text primary key,
  value jsonb not null
);
insert into private.app_settings (key, value) values
  ('odds_monthly_quota', '20000'),
  ('odds_catalog_sports', '["americanfootball_nfl", "basketball_nba"]');

create table private.odds_sync_state (
  sport_key text primary key,
  last_odds_sync_at timestamptz,
  last_catalog_sync_at timestamptz
);

create table private.job_leases (
  name text primary key,
  holder uuid,
  locked_until timestamptz not null default '-infinity'
);
insert into private.job_leases (name) values ('odds-sync');

create table private.api_usage (
  id bigint generated always as identity primary key,
  sport_key text,
  endpoint text not null,
  credits_used int,
  credits_remaining int,
  called_at timestamptz not null default now()
);
create index api_usage_called_idx on private.api_usage (called_at desc);

-- ---------------------------------------------------------------------------
-- Public odds tables
-- ---------------------------------------------------------------------------
-- One row per priced outcome: the canonical price from the primary book.
-- updated_at only moves when the price/line changes, so Realtime traffic == line movement.
create table public.odds_cache (
  id bigint generated always as identity primary key,
  event_id text not null references public.events on delete cascade,
  market_key text not null,                         -- h2h | spreads | totals (props later)
  outcome_name text not null,                       -- team | Over | Under
  participant_name text not null default '',        -- player, for props
  point numeric(7,2),                               -- spread/total line; null for moneyline
  price_american int not null check (price_american <= -100 or price_american >= 100),
  -- Mirrors americanToDecimalE4 in src/lib/core/odds.ts (numeric(10,4) rounds half up).
  price_decimal numeric(10,4) generated always as (
    case when price_american > 0 then 1 + price_american / 100.0
         else 1 + 100.0 / abs(price_american) end
  ) stored,
  bookmaker text not null,
  is_live boolean not null default false,
  updated_at timestamptz not null default now(),
  locked_at timestamptz,                            -- closing-line freeze (Phase 4)
  unique (event_id, market_key, outcome_name, participant_name, is_live)
);
create index odds_cache_event_idx on public.odds_cache (event_id);

-- Market-level freshness: bumped on every sync that returns the market, without touching
-- odds_cache rows (so unchanged prices don't spam Realtime).
create table public.odds_markets (
  event_id text not null references public.events on delete cascade,
  market_key text not null,
  is_live boolean not null default false,
  bookmaker text not null,
  last_seen_at timestamptz not null,
  primary key (event_id, market_key, is_live)
);

revoke all on public.odds_cache, public.odds_markets from anon, authenticated;
grant select on public.odds_cache, public.odds_markets to anon, authenticated;
alter table public.odds_cache enable row level security;
alter table public.odds_markets enable row level security;
create policy "odds: public" on public.odds_cache for select to anon, authenticated using (true);
create policy "odds markets: public" on public.odds_markets for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.odds_cache;

-- ---------------------------------------------------------------------------
-- Cadence + freshness (single source of truth for sync schedule AND bet acceptance)
-- ---------------------------------------------------------------------------
-- Credit circuit breaker: slow everything down as the monthly Odds API quota runs low.
create function private.odds_breaker_factor() returns int
language sql stable security definer set search_path = '' as $$
  with latest as (
    select u.credits_remaining from private.api_usage u
    where u.credits_remaining is not null
    order by u.called_at desc limit 1
  ), quota as (
    select coalesce((select (s.value #>> '{}')::int from private.app_settings s
                     where s.key = 'odds_monthly_quota'), 20000) as q
  )
  select case
    when (select credits_remaining from latest) is null then 1
    when (select credits_remaining from latest) < 0.05 * (select q from quota) then 4
    when (select credits_remaining from latest) < 0.20 * (select q from quota) then 2
    else 1
  end;
$$;

create function private.odds_refresh_interval(p_commence timestamptz) returns interval
language sql stable set search_path = '' as $$
  select case
    when p_commence - now() > interval '24 hours' then interval '3 hours'
    when p_commence - now() > interval '1 hour'   then interval '20 minutes'
    else interval '3 minutes'
  end * private.odds_breaker_factor();
$$;

-- Bets are accepted on prices up to 1.5 refresh intervals old, plus a minute of cron slack.
create function private.odds_max_age(p_commence timestamptz) returns interval
language sql stable set search_path = '' as $$
  select private.odds_refresh_interval(p_commence) * 1.5 + interval '1 minute';
$$;

-- The board the client renders: outcome prices + market freshness, computed by the DB clock.
create view public.odds_board with (security_invoker = true) as
select
  o.id, o.event_id, o.market_key, o.outcome_name, o.participant_name, o.point,
  o.price_american, o.price_decimal, o.updated_at,
  m.last_seen_at,
  (m.last_seen_at is null or m.last_seen_at < now() - private.odds_max_age(e.commence_time)) as is_stale
from public.odds_cache o
join public.events e on e.id = o.event_id
left join public.odds_markets m
  on m.event_id = o.event_id and m.market_key = o.market_key and m.is_live = o.is_live
where not o.is_live;

revoke all on public.odds_board from anon, authenticated;
grant select on public.odds_board to anon, authenticated;

-- The view evaluates these as the caller; the breaker reads private tables via SECURITY DEFINER.
grant usage on schema private to anon;
revoke all on function private.odds_breaker_factor(), private.odds_refresh_interval(timestamptz),
  private.odds_max_age(timestamptz) from public;
grant execute on function private.odds_breaker_factor(), private.odds_refresh_interval(timestamptz),
  private.odds_max_age(timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Work list: only events that still accept bets in an open tournament, only the markets
-- those tournaments allow, at a cadence tied to time-to-kickoff. Plus a cheap catalog refresh.
-- ---------------------------------------------------------------------------
create function private.odds_sync_due_jobs() returns jsonb
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
    where s.last_odds_sync_at is null
       or s.last_odds_sync_at + ps.every <= now()
       -- a tournament created since the last sync may have added never-priced games
       or ps.newest_tournament_at > s.last_odds_sync_at
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

-- Single-flight: a short lease row instead of advisory locks (PostgREST calls don't share a
-- session). A crashed run frees itself when the lease expires.
create function public.odds_sync_claim(p_lease_seconds int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_holder uuid := gen_random_uuid();
begin
  update private.job_leases
     set holder = v_holder, locked_until = now() + make_interval(secs => p_lease_seconds)
   where name = 'odds-sync' and locked_until <= now();
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  return jsonb_build_object(
    'claimed', true,
    'holder', v_holder,
    'jobs', private.odds_sync_due_jobs(),
    'breaker_factor', private.odds_breaker_factor()
  );
end;
$$;

create function public.odds_sync_release(p_holder uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update private.job_leases set holder = null, locked_until = now()
  where name = 'odds-sync' and holder = p_holder;
$$;

-- Idempotent write path. Diff-upserts prices (only real changes touch odds_cache), bumps market
-- freshness, records sync state and credit usage.
create function public.odds_sync_ingest(
  p_kind text,
  p_sport_key text,
  p_fetched_at timestamptz,
  p_events jsonb default '[]',
  p_outcomes jsonb default '[]',
  p_markets jsonb default '[]',
  p_usage jsonb default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_events int := 0;
  v_changed int := 0;
  v_markets int := 0;
begin
  if p_kind not in ('odds', 'catalog') then
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

  if p_kind = 'odds' then
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

    insert into private.odds_sync_state as s (sport_key, last_odds_sync_at)
    values (p_sport_key, p_fetched_at)
    on conflict (sport_key) do update
       set last_odds_sync_at = greatest(s.last_odds_sync_at, excluded.last_odds_sync_at);
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
$$;

revoke all on function public.odds_sync_claim(int), public.odds_sync_release(uuid),
  public.odds_sync_ingest(text, text, timestamptz, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.odds_sync_claim(int), public.odds_sync_release(uuid),
  public.odds_sync_ingest(text, text, timestamptz, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function private.odds_sync_due_jobs() from public;

-- ---------------------------------------------------------------------------
-- Keep "lock ≤ first kickoff" true if a game is moved EARLIER after the tournament exists.
-- ---------------------------------------------------------------------------
create function private.pull_lock_forward() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.commence_time < old.commence_time then
    update public.tournaments t
       set lock_time = new.commence_time
     where t.lock_time > new.commence_time
       and t.status in ('draft', 'open')
       and exists (select 1 from public.tournament_events te
                   where te.tournament_id = t.id and te.event_id = new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.pull_lock_forward() from public;

create trigger events_pull_lock_forward after update of commence_time on public.events
  for each row execute function private.pull_lock_forward();

-- ---------------------------------------------------------------------------
-- Scheduler: every minute, call the Edge Function only if something is due. The URL and shared
-- secret live in Vault (seeded locally; set per environment), so CI/unconfigured envs no-op.
-- ---------------------------------------------------------------------------
create function private.trigger_odds_sync() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'odds_sync_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'odds_sync_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if jsonb_array_length(private.odds_sync_due_jobs()) = 0 then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.trigger_odds_sync() from public;

select cron.schedule('odds-sync', '* * * * *', 'select private.trigger_odds_sync()');
