-- Snapshot ordering and operator health. No changes to wager RPCs.
alter table public.odds_markets add column provider_updated_at timestamptz;
alter table public.events add column scores_provider_updated_at timestamptz;
-- Keep per-player source watermarks separate so unchanged prices do not emit Realtime updates.
create table private.odds_player_versions (
  event_id text not null references public.events on delete cascade,
  market_key text not null,
  participant_name text not null,
  provider_updated_at timestamptz not null,
  primary key(event_id, market_key, participant_name)
);
revoke all on private.odds_player_versions from public, anon, authenticated;
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
    where m.event_id = x->>'event_id' and m.market_key = x->>'market_key' and not m.is_live
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
    join public.events ev on ev.id = x.event_id and ev.commence_time > greatest(now(), p_fetched_at)
    on conflict (event_id, market_key, outcome_name, participant_name, alt_point, is_live) do update
       set price_american = excluded.price_american,
           point = excluded.point,
           bookmaker = excluded.bookmaker,
           updated_at = excluded.updated_at
     where o.locked_at is null
       and (o.price_american, o.point) is distinct from (excluded.price_american, excluded.point);
    get diagnostics v_changed = row_count;

    -- Every prop shape: withdrawn players and alternate lines must stop being bettable.
    -- Only for (game, market) pairs this sync actually priced; bets keep their own copy (odds_id → null).
    delete from public.odds_cache o
     using (select distinct x.event_id, x.market_key
              from jsonb_to_recordset(p_markets) as x(event_id text, market_key text)
             where x.market_key like 'player\_%') pm
     where o.event_id = pm.event_id and o.market_key = pm.market_key
       and not o.is_live and o.locked_at is null
       and exists (select 1 from public.events e where e.id=o.event_id and e.commence_time > greatest(now(), p_fetched_at))
       and not exists (
         select 1 from jsonb_to_recordset(p_outcomes) as y(
           event_id text, market_key text, outcome_name text, participant_name text, point numeric)
         where y.event_id = o.event_id and y.market_key = o.market_key and y.outcome_name = o.outcome_name
           and coalesce(y.participant_name, '') = o.participant_name and (o.market_key not like '%\_alternate' or y.point is not distinct from o.point));
    get diagnostics v_dropped = row_count;
    v_changed := v_changed + v_dropped;

    insert into public.odds_markets as m (event_id, market_key, is_live, bookmaker, last_seen_at, provider_updated_at)
    select x.event_id, x.market_key, false, x.bookmaker, p_fetched_at, coalesce(x.provider_updated_at, p_fetched_at)
    from jsonb_to_recordset(p_markets) as x(event_id text, market_key text, bookmaker text, provider_updated_at timestamptz)
    join public.events ev on ev.id = x.event_id and ev.commence_time > greatest(now(), p_fetched_at)
    on conflict (event_id, market_key, is_live) do update
       set provider_updated_at = excluded.provider_updated_at,
           bookmaker = excluded.bookmaker,
           last_seen_at = greatest(m.last_seen_at, excluded.last_seen_at);
    get diagnostics v_markets = row_count;

    insert into private.odds_player_versions as v(event_id, market_key, participant_name, provider_updated_at)
    select x.event_id, x.market_key, coalesce(x.participant_name,''), max(coalesce(x.provider_updated_at,p_fetched_at))
    from jsonb_to_recordset(p_outcomes) x(event_id text, market_key text, participant_name text, provider_updated_at timestamptz)
    join public.events ev on ev.id=x.event_id and ev.commence_time > greatest(now(),p_fetched_at)
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
create or replace function public.scores_ingest(p_sport_key text, p_fetched_at timestamptz, p_scores jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids text[];
  v_graded int := 0;
  v_id text;
  v_tid uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-ingest:' || p_sport_key));
  -- Finals are final: later corrections are ignored, so a re-sent final can never pay twice.
  with x as (
    select * from jsonb_to_recordset(p_scores) as x(event_id text, completed boolean, home_score int, away_score int, provider_updated_at timestamptz)
    where x.home_score is not null and x.away_score is not null
  ), upd as (
    update public.events e
       set home_score = x.home_score,
           away_score = x.away_score,
           status = case when x.completed then 'final' else 'live' end,
           scores_synced_at = p_fetched_at,
           scores_provider_updated_at = coalesce(x.provider_updated_at, p_fetched_at)
      from x
     where e.id = x.event_id and e.status not in ('final', 'canceled')
       -- Never go backwards; equal stamps still apply (<=) so a same-moment update isn't dropped.
       and coalesce(e.scores_synced_at, '-infinity'::timestamptz) <= p_fetched_at
       and coalesce(e.scores_provider_updated_at, '-infinity'::timestamptz) <= coalesce(x.provider_updated_at, p_fetched_at)
    returning e.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;

  foreach v_id in array v_ids loop
    v_graded := v_graded + private.grade_event(v_id);
  end loop;

  -- Signal (no data) every tournament sweating these games; clients refetch through RLS.
  for v_tid in
    select distinct te.tournament_id from public.tournament_events te
    join public.tournaments t on t.id = te.tournament_id
    where te.event_id = any (v_ids) and t.status in ('locked', 'live')
  loop
    perform private.signal(v_tid, 'scores', '{}'::jsonb);
  end loop;

  insert into private.odds_sync_state as s (sport_key, last_scores_sync_at)
  values (p_sport_key, p_fetched_at)
  on conflict (sport_key) do update
     set last_scores_sync_at = greatest(s.last_scores_sync_at, excluded.last_scores_sync_at);

  return jsonb_build_object('events_updated', coalesce(array_length(v_ids, 1), 0), 'wagers_graded', v_graded);
end;
$$;

create function public.odds_sync_renew(p_holder uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.job_leases set locked_until = clock_timestamp() + interval '120 seconds'
  where name='odds-sync' and holder=p_holder and locked_until > clock_timestamp();
  return found;
end;
$$;

create table public.odds_sync_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('catalog','odds','props','scores','stats','live')),
  sport_key text not null,
  event_id text,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  ok boolean,
  error text,
  counts jsonb not null default '{}',
  latency_ms bigint
);
alter table public.odds_sync_runs enable row level security;
revoke all on public.odds_sync_runs from public, anon, authenticated;
grant select, insert, update on public.odds_sync_runs to service_role;
grant usage, select on sequence public.odds_sync_runs_id_seq to service_role;
create index odds_sync_runs_recent on public.odds_sync_runs (sport_key, kind, id desc);

-- Missing final threshold defaults to the existing 12h safety window; caller can inspect earlier.
create function public.odds_sync_health(p_final_hours int default 12) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stale_catalog', (select coalesce(jsonb_agg(c.sport_key), '[]')
      from jsonb_array_elements_text(private.odds_setting('odds_catalog_sports')) c(sport_key)
      left join private.odds_sync_state s on s.sport_key=c.sport_key
      where s.last_catalog_sync_at is null or s.last_catalog_sync_at < now()-interval '6 hours'),
    'stale_markets', (select count(*) from public.odds_markets m join public.events e on e.id=m.event_id
      where not m.is_live and e.commence_time > now()
      and m.last_seen_at < now()-private.odds_max_age(e.commence_time)),
    'due_jobs', private.odds_sync_due_jobs(),
    'stale_stats', (select count(*) from private.stats_sync_state s join public.events e on e.id=s.event_id
      where not s.is_final and e.status <> 'canceled' and e.commence_time < now()
      and e.commence_time > now()-interval '12 hours' and s.last_sync_at < now()-interval '3 minutes'),
    'missing_finals', (select coalesce(jsonb_agg(e.id), '[]') from public.events e
      where e.status not in ('final','canceled') and e.commence_time < now()-make_interval(hours=>greatest(1,p_final_hours))
      and exists (select 1 from public.tournament_events te where te.event_id=e.id)),
    'budget_exhausted', (private.odds_budget()->>'left')::int <= 0,
    'consecutive_failures', (select coalesce(jsonb_agg(f), '[]') from (
      select r.kind, r.sport_key, r.event_id, count(*) as failures
      from public.odds_sync_runs r where r.ok=false and not exists (
        select 1 from public.odds_sync_runs later where later.kind=r.kind and later.sport_key=r.sport_key
        and later.event_id is not distinct from r.event_id and later.id>r.id and later.ok=true)
      group by r.kind, r.sport_key, r.event_id) f),
    'unfinished_runs', (select count(*) from public.odds_sync_runs where finished_at is null
      and started_at < now()-interval '2 minutes'),
    'recent_runs', (select coalesce(jsonb_agg(r order by r.id desc), '[]') from
      (select * from public.odds_sync_runs order by id desc limit 20) r)
  );
$$;
revoke all on function public.odds_sync_renew(uuid), public.odds_sync_health(int) from public, anon, authenticated;
grant execute on function public.odds_sync_renew(uuid), public.odds_sync_health(int) to service_role;
