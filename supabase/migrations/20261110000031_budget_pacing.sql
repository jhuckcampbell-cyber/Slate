-- Opt-in pacing; the independent paid-call switch remains the emergency stop.
insert into private.app_settings(key,value) values
 ('odds_budget_mode','"manual"'),
 ('odds_budget_profile','"standard"'),
 ('odds_settlement_credits','240'),
 ('odds_beta_event_ids','[]'),
 ('odds_pacing_tiers','{"normal":{"far":"12 hours","day":"6 hours","close":"1 hour","scores":"1 hour"},"tight":{"far":"24 hours","day":"12 hours","close":"2 hours","scores":"2 hours"},"critical":{"far":"48 hours","day":"24 hours","close":"6 hours","scores":"3 hours"}}');

-- Pure UTC arithmetic, separately testable at month/leap-year boundaries.
create function private.odds_pacing_window(p_at timestamptz, p_left int, p_today int, p_week int)
returns jsonb language sql immutable set search_path = '' as $$
 with d as (select (p_at at time zone 'UTC')::date as day), n as (
 select day, ((date_trunc('month',day)+interval '1 month')::date-day) as days,
 greatest(date_trunc('month',day)::date,date_trunc('week',day)::date) as week_start,
 (date_trunc('month',day)+interval '1 month')::date as month_end from d)
 select jsonb_build_object('days_left',days,
 'today_left',greatest(0,ceil((greatest(0,p_left)+p_today)::numeric/days)::int-p_today),
 'week_left',greatest(0,ceil((greatest(0,p_left)+p_week)::numeric*
 (least(month_end,(date_trunc('week',day)+interval '7 days')::date)-week_start)/
 (month_end-week_start))::int-p_week)) from n;
$$;
revoke all on function private.odds_pacing_window(timestamptz,int,int,int) from public;

alter function private.odds_budget() rename to odds_budget_unpaced;
create function private.odds_budget() returns jsonb
language sql stable security definer set search_path = '' as $$
 with b as (select private.odds_budget_unpaced() as b), spend as (
 select coalesce(sum(credits_used) filter(where called_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)::int as today,
 coalesce(sum(credits_used) filter(where called_at >= date_trunc('week',now() at time zone 'UTC') at time zone 'UTC'),0)::int as week,
 coalesce(sum(credits_used) filter(where endpoint ~ '/scores$'),0)::int as scores
 from private.api_usage where called_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),
 x as (select b.b,spend.*,private.odds_pacing_window(now(),(b.b->>'left')::int,today,week) as w from b,spend)
 select b || w || jsonb_build_object(
 'mode',private.odds_setting('odds_budget_mode'),
 'profile',private.odds_setting('odds_budget_profile'),
 'beta_event_ids',private.odds_setting('odds_beta_event_ids'),
 'settlement_reserved',least((b->>'left')::int,greatest(0,coalesce((private.odds_setting('odds_settlement_credits')#>>'{}')::int,240)-scores)),
 'projected_month_end',round((b->>'used_this_month')::numeric *
 extract(day from (date_trunc('month',now() at time zone 'UTC')+interval '1 month - 1 day')) /
 greatest(1,extract(day from now() at time zone 'UTC'))),
 'cadence_tier',case when (b->>'left')::int < (b->>'cap')::int*0.1 then 'critical'
 when (b->>'left')::int < (b->>'cap')::int*0.3 then 'tight' else 'normal' end)
 from x;
$$;
revoke all on function private.odds_budget(),private.odds_budget_unpaced() from public;

create or replace function public.odds_budget_reserve(p_sport_key text,p_endpoint text,p_cost int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b jsonb; r text; rid bigint; critical boolean := p_endpoint = '/sports/'||p_sport_key||'/scores';
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-budget'));
 b := private.odds_budget();
 if p_cost is null or p_cost < 1 or p_cost > 10 then r := 'INVALID_COST';
 elsif not (b->>'enabled')::boolean then r := 'PAID_CALLS_DISABLED';
 elsif p_cost > (b->>'left')::int then r := 'BUDGET_EXHAUSTED';
 elsif b->>'profile' = 'beta' and not critical and
 (p_endpoint <> '/sports/'||p_sport_key||'/odds' or not exists (
 select 1 from public.events e where e.sport_key=p_sport_key and e.commence_time>now()
 and private.odds_setting('odds_beta_event_ids') ? e.id)) then r := 'PROFILE_BLOCKED';
 elsif not critical and p_cost > (b->>'left')::int-(b->>'settlement_reserved')::int then r := 'SETTLEMENT_RESERVED';
 elsif b->>'mode' = 'auto' then
   if not critical and p_cost > greatest(0,least((b->>'today_left')::int,(b->>'week_left')::int)
     - greatest(2,ceil((b->>'settlement_reserved')::numeric/(b->>'days_left')::int)::int)) then r := 'SETTLEMENT_RESERVED';
   elsif p_cost > least((b->>'today_left')::int,(b->>'week_left')::int) then r := 'PACING_LIMIT';
   elsif not critical and p_endpoint like '%/events/%/odds' and b->>'cadence_tier' <> 'normal' then r := 'PROPS_PAUSED';
   end if;
 end if;
 if r is not null then
   -- Only settlement exhaustion backs off the whole sport; pregame never delays recovery finals.
   if r='BUDGET_EXHAUSTED' and critical then
     insert into private.odds_sync_state as s(sport_key,odds_blocked_until)
     values(p_sport_key,now()+interval '15 minutes')
     on conflict(sport_key) do update set odds_blocked_until=excluded.odds_blocked_until;
   end if;
   return jsonb_build_object('ok',false,'reason',r,'budget',b);
 end if;
 insert into private.api_usage(sport_key,endpoint,credits_used,status)
 values(p_sport_key,p_endpoint,p_cost,'reserved') returning id into rid;
 return jsonb_build_object('ok',true,'reservation_id',rid,'budget',private.odds_budget());
end;
$$;

create function private.odds_job_priority(p_kind text) returns int
language sql immutable set search_path = '' as $$
 select case p_kind when 'scores' then 0 when 'live' then 0 when 'stats' then 1
 when 'odds' then 2 when 'props' then 3 else 4 end;
$$;
revoke all on function private.odds_job_priority(text) from public;


create function private.odds_effective_tiers() returns jsonb
language sql stable security definer set search_path = '' as $$
 select case when private.odds_setting('odds_budget_mode') #>> '{}' = 'auto'
 or private.odds_setting('odds_budget_profile') #>> '{}' = 'beta'
 then private.odds_setting('odds_pacing_tiers')->(private.odds_budget()->>'cadence_tier')
 else private.odds_setting('odds_refresh_tiers') end;
$$;
revoke all on function private.odds_effective_tiers() from public;

create function private.odds_scores_interval() returns interval
language sql stable security definer set search_path = '' as $$
 select coalesce((private.odds_effective_tiers()->>'scores')::interval,
 (private.odds_setting('scores_refresh') #>> '{}')::interval,interval '15 minutes');
$$;
revoke all on function private.odds_scores_interval() from public;

create or replace function private.odds_refresh_interval(p_commence timestamptz) returns interval
language sql stable security definer set search_path = '' as $$
 with t as (select private.odds_effective_tiers() as tiers)
 select case
 when p_commence - now() > interval '24 hours' then (t.tiers->>'far')::interval
 when p_commence - now() > interval '1 hour' then (t.tiers->>'day')::interval
 else (t.tiers->>'close')::interval end * private.odds_breaker_factor() from t;
$$;

create or replace function private.odds_sync_odds_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (
    select e.id, e.sport_key, e.commence_time, t.created_at as tournament_created_at,
           t.allowed_bet_types -> 'markets' as markets
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('draft', 'open') and t.lock_time > now()
      and e.status = 'scheduled' and e.commence_time > now()
      and (private.odds_setting('odds_budget_profile') #>> '{}' <> 'beta'
        or (private.odds_setting('odds_beta_event_ids') ? e.id and e.commence_time <= now()+interval '48 hours'))
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

-- Stable ordering also powers dry-run and the existing sync-health RPC.
create or replace function private.odds_sync_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(j order by private.odds_job_priority(j->>'kind'),
 j->>'sport_key',j->>'event_id'),'[]'::jsonb)
 from jsonb_array_elements(private.odds_sync_odds_jobs() || private.stats_due_jobs() || private.live_due_jobs()) j;
$$;

-- Service-only operator configuration. Setting auto never enables the paid switch.
create function public.odds_set_budget_policy(p_mode text, p_profile text, p_event_ids jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if p_mode is null or p_mode not in ('manual','auto') or p_profile is null or p_profile not in ('standard','beta')
 or p_event_ids is null or jsonb_typeof(p_event_ids) <> 'array' then raise exception 'INVALID_POLICY'; end if;
 if jsonb_array_length(p_event_ids)>6 or exists(select 1 from jsonb_array_elements(p_event_ids) x
 where jsonb_typeof(x)<>'string') then raise exception 'INVALID_BETA_SLATE'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-budget'));
 update private.app_settings set value=to_jsonb(p_mode) where key='odds_budget_mode';
 update private.app_settings set value=to_jsonb(p_profile) where key='odds_budget_profile';
 update private.app_settings set value=p_event_ids where key='odds_beta_event_ids';
 return private.odds_budget();
end;
$$;
revoke all on function public.odds_set_budget_policy(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.odds_set_budget_policy(text,text,jsonb) to service_role;

create or replace function public.odds_budget_status() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('budget',private.odds_budget(),
 'refresh_tiers',private.odds_effective_tiers(),
 'scores_refresh',private.odds_scores_interval()::text,
 'recent_calls',coalesce((select jsonb_agg(c order by c.called_at desc,c.id desc)
 from (select u.id,u.called_at,u.sport_key,u.endpoint,u.credits_used,u.credits_remaining,u.status
 from private.api_usage u order by u.called_at desc,u.id desc limit 10) c),'[]'::jsonb));
$$;
