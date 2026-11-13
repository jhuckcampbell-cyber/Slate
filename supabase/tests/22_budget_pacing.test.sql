begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
delete from private.api_usage;
delete from private.odds_sync_state;

select is(private.odds_setting('odds_budget_mode') #>> '{}','auto','0032 defaults to auto pacing; paid calls still start off');
-- Keep the legacy 400-credit policy fixture explicit after the 0032 plan upgrade.
update private.app_settings set value='400' where key='odds_monthly_cap';
update private.app_settings set value='500' where key='odds_monthly_quota';
select public.odds_set_budget_policy('manual','standard');
select public.odds_set_paid_calls(true);
update private.app_settings set value='400' where key='odds_settlement_credits';
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/odds',3)->>'reason',
 'SETTLEMENT_RESERVED','monthly settlement pool is protected even with auto off');
update private.app_settings set value='240' where key='odds_settlement_credits';
select public.odds_set_paid_calls(false);
select is((private.odds_pacing_window('2028-02-01 03:00Z',400,0,0)->>'days_left')::int,29,'leap February');
select is((private.odds_pacing_window('2026-11-01 03:00Z',400,0,0)->>'today_left')::int,14,'daily ceiling from remaining month');
select is((private.odds_pacing_window('2026-11-30 23:59Z',7,0,0)->>'today_left')::int,7,'last UTC day releases remainder');
select is((private.odds_pacing_window('2026-12-01 00:00Z',400,0,0)->>'days_left')::int,31,'UTC rollover');
select is((private.odds_pacing_window('2026-11-02 12:00Z',390,10,10)->>'today_left')::int,4,'today spend reduces allowance');
select is((private.odds_pacing_window('2026-11-08 12:00Z',330,10,70)->>'week_left')::int,27,'Sunday uses original week allocation');
select is((private.odds_pacing_window('2026-11-30 12:00Z',7,0,0)->>'week_left')::int,7,'week stops at month boundary');
select is((private.odds_pacing_window('2026-11-02 12:00Z',0,400,400)->>'today_left')::int,0,'overspend cannot create allowance');

select public.odds_set_budget_policy('auto','standard');
select is((private.odds_budget()->>'enabled')::boolean,false,'auto never enables paid switch');
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'reason',
 'PAID_CALLS_DISABLED','kill switch wins for settlement too');
select public.odds_set_paid_calls(true);
update private.app_settings set value='400' where key='odds_settlement_credits';
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/odds',3)->>'reason',
 'SETTLEMENT_RESERVED','odds cannot use settlement pool');
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/events/e/odds',3)->>'reason',
 'SETTLEMENT_RESERVED','props cannot use settlement pool');
select is((select count(*)::int from private.api_usage),0,'denials consume nothing');
select is((public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'ok')::boolean,
 true,'scores can consume protected credits');
select is((private.odds_budget()->>'used_this_month')::int,2,'unsettled reservation counts');
select is((private.odds_budget()->>'settlement_reserved')::int,398,'score reservation reduces protected pool');
delete from private.api_usage;
update private.app_settings set value='240' where key='odds_settlement_credits';
-- Simulate lower-priority demand until the daily protected share refuses it.
do $$
begin
 for i in 1..400 loop
   exit when not (public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/odds',1)->>'ok')::boolean;
 end loop;
end;
$$;
select ok((private.odds_budget()->>'today_left')::int >= 2,'lower priorities leave daily score capacity');
select is((public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'ok')::boolean,
 true,'a final still reserves after pregame demand is refused');
delete from private.api_usage;
-- Exhaust just today's allowance, retaining month-end funds.
insert into private.api_usage(endpoint,credits_used,status)
select '/sports/basketball_nba/scores',(private.odds_budget()->>'today_left')::int,'reserved';
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'reason',
 'PACING_LIMIT','daily pacing counts unsettled reservations');
select ok((private.odds_budget()->>'left')::int > 0,'daily stop preserves later days');
select public.odds_set_paid_calls(false);
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/odds',3)->>'reason',
 'PAID_CALLS_DISABLED','kill switch wins over pacing');

delete from private.api_usage;
select public.odds_set_budget_policy('auto','beta');
select public.odds_set_paid_calls(true);
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/odds',3)->>'reason',
 'PROFILE_BLOCKED','empty beta slate fails closed');
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/events/e/odds',3)->>'reason',
 'PROFILE_BLOCKED','beta blocks paid props even outside scheduler');
select throws_ok($$select public.odds_set_budget_policy('auto','beta','[1]')$$,
 'P0001','INVALID_BETA_SLATE','beta validates event IDs');
select throws_ok($$select public.odds_set_budget_policy('bogus','standard')$$,
 'P0001','INVALID_POLICY','unknown mode rejected');
select is(private.odds_refresh_interval(now()+interval '6 hours'),interval '6 hours','beta cadence from settings');
select is(private.odds_scores_interval(),interval '1 hour','beta hourly finals');

insert into auth.users(id,aud,role,email,is_anonymous,raw_user_meta_data) values
 ('eeeeeeee-0031-0000-0000-000000000001','authenticated','authenticated','pacing@test.dev',false,'{"display_name":"Pacing"}');
insert into public.events(id,sport_key,home_team,away_team,commence_time) values
 ('pace-allowed','basketball_nba','A','B',now()+interval '6 hours'),
 ('pace-blocked','basketball_nba','C','D',now()+interval '6 hours'),
 ('pace-far','basketball_nba','E','F',now()+interval '3 days');
select set_config('request.jwt.claims','{"sub":"eeeeeeee-0031-0000-0000-000000000001","role":"authenticated"}',true);
select * from public.create_tournament('Pacing',array['pace-allowed','pace-blocked','pace-far'],'P',null,10000,null,
 '{"markets":["h2h"],"player_props":true}'::jsonb);
select public.odds_set_budget_policy('auto','beta','["pace-allowed","pace-far"]');
select is((select j->'event_ids' from jsonb_array_elements(private.odds_sync_due_jobs()) j
 where j->>'kind'='odds' and j->>'sport_key'='basketball_nba'),
 '["pace-allowed"]'::jsonb,'beta filters allowlist and 48-hour horizon');
select ok(not exists(select 1 from jsonb_array_elements(private.odds_sync_due_jobs()) j where j->>'kind'='props'),
 'beta never schedules paid props');
select public.odds_set_budget_policy('auto','standard');
-- 0032 also drains cadence on daily spend: use provider headroom to isolate monthly tiers.
insert into private.api_usage(endpoint,credits_used,credits_remaining,status) values('filler',0,200,'settled');
select is(private.odds_budget()->>'cadence_tier','tight','low remaining budget selects tight tier');
select is(private.odds_scores_interval(),interval '2 hours','tight tier slows scores');
select ok(not exists(select 1 from jsonb_array_elements(private.odds_sync_due_jobs()) j where j->>'kind'='props'),
 'tight tier drops props first');
insert into private.api_usage(endpoint,credits_used,credits_remaining,status,observed_at)
values('filler',0,130,'settled',now()+interval '1 second');
select is(private.odds_refresh_interval(now()+interval '6 hours'),interval '24 hours','critical tier slows pregame further');

-- Inject deliberately unordered due work to exercise the actual claim path, rolled back below.
create or replace function private.odds_sync_odds_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
 select '[{"kind":"catalog","sport_key":"z"},{"kind":"props","sport_key":"z"},
 {"kind":"odds","sport_key":"z"},{"kind":"live","sport_key":"z"},
 {"kind":"scores","sport_key":"a"}]'::jsonb;
$$;
create or replace function private.stats_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$select '[]'::jsonb$$;
create or replace function private.live_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$select '[]'::jsonb$$;
update private.job_leases set locked_until='-infinity' where name='odds-sync';
create temp table claim as select public.odds_sync_claim() as c;
select is((select c->'jobs'->0->>'kind' from claim),'scores','claim puts scores first');
select is((select c->'jobs'->1->>'kind' from claim),'live','live precedes pregame');
select is((select c->'jobs'->2->>'kind' from claim),'odds','odds precede props');
select is((select c->'jobs'->3->>'kind' from claim),'props','props precede catalog');
select is((select c->'jobs'->4->>'kind' from claim),'catalog','catalog last');
set local role authenticated;
select throws_ok($$select public.odds_set_budget_policy('auto','standard')$$,'42501',null,'players cannot configure budget');
reset role;
select * from finish();
rollback;
