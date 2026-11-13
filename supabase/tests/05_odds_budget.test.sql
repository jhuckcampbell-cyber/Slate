-- 0032/0033: 20K paid-plan quota, 19K app cap, demand-driven cadence.
-- Hard Odds API credit budget and paid-call switch. Every paid call must reserve credits here first; the DB says no when the
-- switch is off, the monthly cap is reached, or the provider's own counter is near empty.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Isolate from the local cron (all rolled back at the end).
delete from private.api_usage;
delete from private.odds_sync_state;
update private.job_leases set holder = null, locked_until = '-infinity' where name = 'odds-sync';

create function pg_temp.budget() returns jsonb language sql as $$ select public.odds_budget_status() -> 'budget' $$;

-- 0032 changes defaults but deliberately preserves the paid switch OFF.
select is((pg_temp.budget() ->> 'quota')::int, 20000, 'quota defaults to the 20K plan (0032)');
select is((pg_temp.budget() ->> 'cap')::int, 19000, 'our hard cap leaves a 1000-credit buffer (0032)');
select is((pg_temp.budget() ->> 'enabled')::boolean, false, 'paid calls start disabled (dry run first)');
select is((pg_temp.budget() ->> 'left')::int, 19000, 'nothing used yet: 19000 left');

select is(public.odds_budget_reserve('basketball_nba', '/sports/basketball_nba/odds', 3) ->> 'reason',
  'PAID_CALLS_DISABLED', 'reserve refuses while the switch is off');
select is((select count(*)::int from private.api_usage), 0, '...and records nothing');

-- ---------- reserve → settle ----------
select public.odds_set_paid_calls(true);
select is((pg_temp.budget() ->> 'enabled')::boolean, true, 'switch turns paid calls on');

create temp table r1 as select public.odds_budget_reserve('basketball_nba', '/sports/basketball_nba/odds', 3) as r;
select is((select (r ->> 'ok')::boolean from r1), true, 'reserve within budget succeeds');
select is((select credits_used from private.api_usage where id = (select (r ->> 'reservation_id')::bigint from r1)),
  3, 'the estimate is charged up front');
select is((pg_temp.budget() ->> 'left')::int, 18997, 'an unsettled reservation counts against the budget');

select public.odds_budget_settle((select (r ->> 'reservation_id')::bigint from r1), 2, 19998);
select is((select (credits_used, status) from private.api_usage where id = (select (r ->> 'reservation_id')::bigint from r1)),
  row(2, 'settled'::text), 'settle records the actual cost from the response headers');
select public.odds_budget_settle((select (r ->> 'reservation_id')::bigint from r1), 0, 20000);
select is((select credits_used from private.api_usage where id = (select (r ->> 'reservation_id')::bigint from r1)),
  2, 'a reservation settles only once');

create temp table r2 as select public.odds_budget_reserve('basketball_nba', '/sports/basketball_nba/odds', 3) as r;
select public.odds_budget_settle((select (r ->> 'reservation_id')::bigint from r2), null, null);
select is((select credits_used from private.api_usage where id = (select (r ->> 'reservation_id')::bigint from r2)),
  3, 'no usage header (network error): the estimate stands');

select is(public.odds_budget_reserve('basketball_nba', 'x', 0) ->> 'reason', 'INVALID_COST', 'zero-cost reserve is refused');
select is(public.odds_budget_reserve('basketball_nba', 'x', 11) ->> 'reason', 'INVALID_COST',
  'one call may not cost more than 10 credits');

-- ---------- monthly cap ----------
-- Isolate the hard-cap tests from the independently tested settlement pool.
update private.app_settings set value = '0' where key = 'odds_settlement_credits';
-- 0032 defaults to auto; isolate the hard cap from daily pacing too.
select public.odds_set_budget_policy('manual','standard');
insert into private.api_usage (endpoint, credits_used, status) values ('filler', 18992, 'settled');
select is((pg_temp.budget() ->> 'left')::int, 3, '2 + 3 + 18992 used: 3 left');
select is(public.odds_budget_reserve('basketball_nba', 'x', 4) ->> 'reason', 'BUDGET_EXHAUSTED',
  'a call that would cross the cap is refused');
select ok(not exists(select 1 from private.odds_sync_state o where o.sport_key = 'basketball_nba'
  and o.odds_blocked_until > now()), 'pregame refusal never backs off settlement for the sport');
select is((public.odds_budget_reserve('basketball_nba', 'x', 3) ->> 'ok')::boolean, true, 'exactly reaching the cap is allowed');
select is((pg_temp.budget() ->> 'left')::int, 0, 'cap reached: 0 left');

-- ---------- the month boundary, and the provider's own counter ----------
delete from private.api_usage;
insert into private.api_usage (endpoint, credits_used, credits_remaining, called_at, status)
values ('old', 450, 5, date_trunc('month', now()) - interval '1 day', 'settled');
select is((pg_temp.budget() ->> 'left')::int, 19000, 'last month''s spend and counter don''t count');

insert into private.api_usage (endpoint, credits_used, credits_remaining, status) values ('/sports/x/events', 0, 1050, 'settled');
select is((pg_temp.budget() ->> 'left')::int, 50,
  'provider says 1050 left: we stop at its last 1000 even if our own ledger looks fine');

-- ---------- due-list respects the back-off ----------
insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', 'budget@test.dev', false, '{"display_name":"Bo"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('bt-ev1', 'icehockey_nhl', 'Boston Bruins', 'Toronto Maple Leafs', now() + interval '2 days');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select * from public.create_tournament('Budget Test', array['bt-ev1'], 'BT', null, 10000, null, '{"markets":["h2h"]}'::jsonb);
insert into private.odds_sync_state (sport_key, odds_blocked_until) values ('icehockey_nhl', now() + interval '15 minutes')
on conflict (sport_key) do update set odds_blocked_until = excluded.odds_blocked_until;
select ok(not exists (select 1 from jsonb_array_elements(private.odds_sync_due_jobs()) j
                      where j ->> 'kind' = 'odds' and j ->> 'sport_key' = 'icehockey_nhl'),
  'a backed-off sport is not due');

-- 0032: only 50 provider credits remain, so critical demand tiers apply.
select is(private.odds_refresh_interval(now() + interval '2 days'), interval '48 hours', '>24h out: critical far tier every 48h');
select is(private.odds_refresh_interval(now() + interval '6 hours'), interval '24 hours', '1–24h out: critical day tier every 24h');
select is(private.odds_max_age(now() + interval '30 minutes'), interval '541 minutes',
  'critical unpicked close tier: 6h, freshness 9h + 1 min');

-- ---------- only the service role can touch the budget ----------
set local role authenticated;
select throws_ok($$ select public.odds_budget_reserve('basketball_nba', 'x', 1) $$, '42501', null,
  'players cannot reserve credits');
select throws_ok($$ select public.odds_set_paid_calls(true) $$, '42501', null,
  'players cannot flip the paid-call switch');
reset role;

select * from finish();
rollback;
