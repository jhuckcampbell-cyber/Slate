begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
delete from private.api_usage;
select is((private.odds_budget()->>'quota')::int,20000,'paid plan quota');
select is((private.odds_budget()->>'cap')::int,19000,'buffer leaves app cap 19000');
select public.odds_set_paid_calls(false);
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'reason','PAID_CALLS_DISABLED','kill switch includes finals');
select is((private.odds_budget()->>'settlement_reserved')::int,2280,'settlement pool scales with cap');
select is((private.odds_pacing_window('2026-11-01 00:00Z',19000,0,0)->>'today_left')::int,634,'credits paced across 30 days');
select is((private.odds_pacing_window('2028-02-01 00:00Z',19000,0,0)->>'days_left')::int,29,'leap-month pacing');
select is(private.odds_demand_interval(now()+interval '20 minutes',true),interval '15 seconds','picked close game hot');
select is(private.odds_demand_interval(now()-interval '20 minutes',true),interval '15 seconds','picked live game hot');
select is(private.odds_demand_interval(now()-interval '20 minutes',false),interval '2 minutes','unpicked live game moderate');
select is(private.odds_demand_interval(now()+interval '20 minutes',false),interval '2 hours','unpicked pregame not hot');
select is(private.odds_demand_interval(now()+interval '2 days',true),interval '12 hours','far picked game slow');
insert into private.api_usage(endpoint,credits_used,status)
select 'daily',ceil((private.odds_budget()->>'today_left')::numeric*0.8)::int,'reserved';
select is(private.odds_budget()->>'cadence_tier','tight','daily capacity drain also selects tight');
insert into private.api_usage(endpoint,credits_used,status)
select 'daily',ceil((private.odds_budget()->>'today_left')::numeric*0.8)::int,'reserved';
select is(private.odds_budget()->>'cadence_tier','critical','daily capacity drain also selects critical');
delete from private.api_usage;
-- 0032 also considers daily drain: provider headroom isolates cap-relative tiers
-- without exhausting today's allowance (including on the first/last day of a month).
insert into private.api_usage(endpoint,credits_used,credits_remaining,status) values('test',0,6000,'settled');
select is(private.odds_budget()->>'cadence_tier','tight','cap relative 30% drain threshold');
select is(private.odds_demand_interval(now(),true),interval '1 minute','tight degrades hot tier');
insert into private.api_usage(endpoint,credits_used,credits_remaining,status,observed_at)
values('test',0,2000,'settled',now()+interval '1 second');
select is(private.odds_budget()->>'cadence_tier','critical','cap relative 10% drain threshold');
select is(private.odds_demand_interval(now(),true),interval '5 minutes','critical degrades hot tier');
delete from private.api_usage;
insert into private.api_usage(endpoint,credits_used,credits_remaining,status) values('external',0,1002,'settled');
select is((private.odds_budget()->>'left')::int,2,'provider counter overrides ledger');
select public.odds_set_paid_calls(true);
select public.odds_set_budget_policy('manual','standard');
select is((public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'ok')::boolean,true,'last provider credits reserve');
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',1)->>'reason','BUDGET_EXHAUSTED','inflight reservation protects provider buffer');
delete from private.api_usage;
insert into private.api_usage(endpoint,credits_used,status) values('test',18998,'reserved');
select is((public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'ok')::boolean,true,'last app credits reserve');
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',1)->>'reason','BUDGET_EXHAUSTED','hard cap cannot be exceeded');
select is((private.odds_budget()->>'used_this_month')::int,19000,'reservations count toward hard cap');
delete from private.api_usage;
select public.odds_set_budget_policy('auto','standard');
insert into private.api_usage(endpoint,credits_used,status)
select 'test',(private.odds_budget()->>'today_left')::int,'reserved';
select is(public.odds_budget_reserve('basketball_nba','/sports/basketball_nba/scores',2)->>'reason','PACING_LIMIT','daily stop preserves later days');
delete from private.api_usage;

-- Actual pick demand and blind co-participant reads.
insert into auth.users(id,aud,role,email,raw_user_meta_data) values
('23000000-0000-0000-0000-000000000001','authenticated','authenticated','w1-host@test.dev','{"display_name":"Host"}'),
('23000000-0000-0000-0000-000000000002','authenticated','authenticated','w1-peer@test.dev','{"display_name":"Peer"}');
insert into public.events(id,sport_key,home_team,away_team,commence_time) values
('w1-close','basketball_nba','Home','Away',now()+interval '20 minutes'),
('w1-live','basketball_nba','Home','Away',now()-interval '20 minutes');
select set_config('request.jwt.claims','{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table w1_t as select * from public.create_tournament('Worker test',array['w1-close'],'W1');
grant select on w1_t to authenticated;
insert into public.wagers(id,tournament_id,participant_id,wager_type,amount_cents,odds_american,odds_decimal,potential_payout_cents)
select '23000000-0000-0000-0000-000000000003',t.id,p.id,'single',100,100,2,200
from w1_t t join public.tournament_participants p on p.tournament_id=t.id;
insert into public.wager_legs(wager_id,tournament_id,participant_id,event_id,market_key,selection,odds_american,odds_decimal)
select w.id,w.tournament_id,w.participant_id,'w1-close','h2h','Home',100,2 from public.wagers w
where w.id='23000000-0000-0000-0000-000000000003';
select is(private.odds_event_interval('w1-close'),interval '15 seconds','pending tournament pick activates hot cadence');
select is(private.odds_refresh_interval(now()+interval '20 minutes'),interval '15 seconds','legacy freshness signature shares demand');
select is(private.odds_max_age(now()+interval '20 minutes'),interval '27.5 seconds','hot freshness has proportional slack');
select set_config('request.jwt.claims','{"sub":"23000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select public.join_tournament((select code from w1_t));
set local role authenticated;
select is((select count(*)::int from public.wagers where id='23000000-0000-0000-0000-000000000003'),0,'peer cannot read hot-demand wager before lock');
select is((select count(*)::int from public.wager_legs where event_id='w1-close'),0,'peer cannot read hot-demand legs before lock');
select throws_ok($$select private.odds_event_interval('w1-close')$$,'42501',null,'peer cannot probe event demand RPC');
select throws_ok($$select public.odds_worker_beat('spoof')$$,'42501',null,'peer cannot suppress cron');
reset role;

insert into public.odds_cache(event_id,market_key,outcome_name,price_american,bookmaker,locked_at)
values('w1-live','h2h','Home',100,'dk',now());
-- Live snapshots are separate from pregame closing prices, and unchanged odds do not write.
select public.odds_sync_ingest('odds','basketball_nba',now(),'[]',
 '[{"event_id":"w1-live","market_key":"h2h","outcome_name":"Home","price_american":110,"bookmaker":"dk"}]',
 '[{"event_id":"w1-live","market_key":"h2h","bookmaker":"dk"}]');
select is((select count(*)::int from public.odds_cache where event_id='w1-live' and is_live),1,'live snapshot ingested');
select is((public.odds_sync_ingest('odds','basketball_nba',now(),'[]',
 '[{"event_id":"w1-live","market_key":"h2h","outcome_name":"Home","price_american":110,"bookmaker":"dk"}]',
 '[{"event_id":"w1-live","market_key":"h2h","bookmaker":"dk"}]')->>'outcomes_changed')::int,0,'unchanged live price writes nothing');
select is((select price_american from public.odds_cache where event_id='w1-live' and not is_live),100,'live refresh preserves frozen closing price');
select is((public.odds_sync_ingest('odds','basketball_nba',now()-interval '1 minute','[]',
 '[{"event_id":"w1-live","market_key":"h2h","outcome_name":"Home","price_american":120,"bookmaker":"dk"}]',
 '[{"event_id":"w1-live","market_key":"h2h","bookmaker":"dk"}]')->>'outcomes_changed')::int,0,'older live snapshot rejected');
select is((select price_american from public.odds_cache where event_id='w1-live' and is_live),110,'live price does not rewind');
select ok(not exists(select 1 from jsonb_array_elements(private.odds_sync_odds_jobs()) j where j->>'kind'='props'),'no props without enabled tournament');
select public.odds_worker_beat('test-worker');
select ok(exists(select 1 from public.odds_worker_heartbeat where seen_at>clock_timestamp()-interval '45 seconds'),'DB-clock heartbeat fresh');
select * from finish();
rollback;
