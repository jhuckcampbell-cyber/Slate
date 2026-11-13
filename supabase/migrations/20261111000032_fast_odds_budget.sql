-- Paid switch is deliberately untouched (OFF on a new installation).
update private.app_settings set value='20000' where key='odds_monthly_quota';
update private.app_settings set value='19000' where key='odds_monthly_cap';
-- NULL means 12% of the current cap, so future plan changes scale the reserve.
update private.app_settings set value='null' where key='odds_settlement_credits';
update private.app_settings set value='"auto"' where key='odds_budget_mode';
alter table private.api_usage add column observed_at timestamptz;
update private.api_usage set observed_at=called_at where credits_remaining is not null;
-- Cap fractions remain the 10% / 30% thresholds; never absolute credit thresholds.
create or replace function private.odds_budget_unpaced() returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((private.odds_setting('odds_monthly_quota') #>> '{}')::int, 20000) as quota,
           coalesce((private.odds_setting('odds_monthly_cap') #>> '{}')::int, 19000) as cap,
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
    order by coalesce(u.observed_at,u.called_at) desc, u.id desc limit 1
  )
  select jsonb_build_object(
    'enabled', cfg.enabled,
    'quota', cfg.quota,
    'cap', cfg.cap,
    'used_this_month', month.used,
    'provider_remaining', (select remaining from provider),
    'left', greatest(0, least(
      cfg.cap - month.used,
      coalesce((select remaining from provider) - (cfg.quota - cfg.cap) - (select coalesce(sum(credits_used),0)::int from private.api_usage where status='reserved' and called_at>=cfg.month_start), cfg.cap - month.used)))
  )
  from cfg, month;
$$;
revoke all on function private.odds_budget_unpaced() from public;

create or replace function private.odds_budget() returns jsonb
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
 'settlement_reserved',least((b->>'left')::int,greatest(0,coalesce((private.odds_setting('odds_settlement_credits')#>>'{}')::int,ceil((b->>'cap')::numeric*0.12)::int)-scores)),
 'projected_month_end',round((b->>'used_this_month')::numeric *
 extract(day from (date_trunc('month',now() at time zone 'UTC')+interval '1 month - 1 day')) /
 greatest(1,extract(day from now() at time zone 'UTC'))),
 'cadence_tier',case when (b->>'left')::int < (b->>'cap')::int*0.1 or (w->>'today_left')::int < ((w->>'today_left')::int+today)*0.1 then 'critical'
 when (b->>'left')::int < (b->>'cap')::int*0.3 or (w->>'today_left')::int < ((w->>'today_left')::int+today)*0.3 then 'tight' else 'normal' end)
 from x;
$$;
revoke all on function private.odds_budget(),private.odds_budget_unpaced() from public;


-- Record response time rather than reservation time when choosing the latest counter.
create or replace function public.odds_budget_settle(
 p_reservation_id bigint,p_credits_used int default null,p_credits_remaining int default null)
returns void language sql volatile security definer set search_path='' as $$
 update private.api_usage set credits_used=greatest(0,coalesce(p_credits_used,credits_used)),
 credits_remaining=case when p_credits_remaining is null then null else greatest(0,p_credits_remaining) end,
 observed_at=clock_timestamp(),status='settled'
 where id=p_reservation_id and status='reserved';
$$;
-- The demand controller already degrades from cap-relative thresholds.
create or replace function private.odds_breaker_factor() returns int
language sql stable security definer set search_path='' as $$ select 1; $$;
