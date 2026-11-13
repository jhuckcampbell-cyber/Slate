-- Differential pre-lock probes: identical public state/caller, different hidden slip.
-- Intentionally fails for real error oracles; do not bless a leak with TODO/expected errors.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a9000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ab-host@test.dev', false, '{"display_name":"Host"}'),
  ('a9000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'ab-player@test.dev', false, '{"display_name":"Player"}'),
  ('a9000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'ab-peer@test.dev', false, '{"display_name":"Peer"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('ab-game', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"ab-game","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"ab-game","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"ab-game","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'a9000000-0000-0000-0000-00000000000' || p_suffix, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bet(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(
    jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)))
  from public.odds_cache c where c.event_id = 'ab-game' and c.outcome_name = p_team;
$$;
-- Invoker, never definer. Capture every client-visible diagnostic except CONTEXT
-- (which includes source lines). Roll back successful mutations too, so probes are independent.
create function pg_temp.probe(p_sql text) returns jsonb language plpgsql as $$
declare s text; m text; d text; h text;
begin
  execute p_sql;
  raise exception using errcode = 'ZB001', message = 'probe rollback';
exception
  when sqlstate 'ZB001' then return jsonb_build_object('success', true);
  when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text,
      d = pg_exception_detail, h = pg_exception_hint;
    return jsonb_build_object('sqlstate', s, 'message', m, 'detail', d, 'hint', h);
end;
$$;

select pg_temp.as_user('a');
create temp table ab_t as select * from public.create_tournament(
  'Adversarial blind', array['ab-game'], 'AB', null, 10000, null, '{"markets":["h2h"]}');
select public.set_tournament_tokens((select id from ab_t), '[2500,7500]');
select pg_temp.as_user('b');
select public.join_tournament((select code from ab_t));
select pg_temp.as_user('c');
select public.join_tournament((select code from ab_t));

-- Snapshot the entire diagnostic, including detail and hint, before a hidden bet.
select pg_temp.as_user('a');
create temp table probes as select
  pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), '{}')$q$) invalid,
  pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), '[5000,5000]')$q$) valid,
  pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), null)$q$) clear;
grant select on ab_t, probes to authenticated;
select pg_temp.as_user('b');
create temp table payload as select jsonb_build_array(
  pg_temp.bet(2500, 'Boston Celtics') || '{"submission_id":"bb000000-0000-0000-0000-000000000001"}'::jsonb,
  pg_temp.bet(7500, 'New York Knicks')) slip;
grant select on payload to authenticated;
set local role authenticated;
select throws_ok($q$select public.place_wagers((select id from ab_t),
  jsonb_set((select slip from payload), '{0,legs,0,price_american}', '100'))$q$,
  'ODDS_CHANGED', 'a rejected price change does not consume the submission ID');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)),
  0, 'odds rejection inserts nothing');
create temp table original as select * from public.place_wagers((select id from ab_t), (select slip from payload));
select is((select count(*)::int from original), 2, 'multi-wager submission returns both wagers');
select is((select count(*)::int from public.wagers where submission_id = 'bb000000-0000-0000-0000-000000000001'),
  2, 'submission UUID stored on every wager');
select is((select remaining_bankroll_cents from public.tournament_participants where user_id = auth.uid() and tournament_id = (select id from ab_t)),
  0::bigint, 'first submission spends bankroll once');
create temp table retried as select * from public.place_wagers((select id from ab_t), (select slip from payload), 'bb000000-0000-0000-0000-000000000001');
select results_eq('select * from retried order by id', 'select * from original order by id', 'retry returns original rows exactly');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)), 2, 'retry does not insert');
select is((select remaining_bankroll_cents from public.tournament_participants where user_id = auth.uid() and tournament_id = (select id from ab_t)),
  0::bigint, 'retry does not debit');
select ok(not has_table_privilege('authenticated', 'private.wager_submissions', 'select'), 'receipts cannot be read directly');
select pg_temp.as_user('a');
select is(pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), '{}')$q$),
  (select invalid from probes), 'invalid token diagnostics equal before and after hidden bets');
select is(pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), '[5000,5000]')$q$),
  (select valid from probes), 'valid token diagnostics equal before and after hidden bets');
select is(pg_temp.probe($q$select public.set_tournament_tokens((select id from ab_t), null)$q$),
  (select clear from probes), 'clear token diagnostics equal before and after hidden bets');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)), 0, 'host cannot read submission IDs or wagers');
select pg_temp.as_user('c');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)), 0, 'peer cannot read submission IDs or wagers');
select is((select count(*)::int from public.place_wagers((select id from ab_t), (select slip from payload))), 2, 'another participant may use the same UUID independently');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)), 2, 'same UUID never returns someone else''s wagers');
select pg_temp.as_user('b');
select public.cancel_wager((select id from original order by id limit 1));
select results_eq(
  'select * from public.place_wagers((select id from ab_t), (select slip from payload)) order by id',
  'select * from original order by id', 'retry after cancellation still returns original receipt');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)), 1, 'retry after cancellation does not resurrect wagers');
select is((select remaining_bankroll_cents from public.tournament_participants where user_id = auth.uid() and tournament_id = (select id from ab_t)),
  (select amount_cents from original order by id limit 1), 'retry preserves cancellation refund');
reset role;


select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosecdef
 and not coalesce(p.proconfig @> array['search_path=""'],false)),0,'every definer pins empty search_path');
-- Explicit allowlist: invite preview and read-only odds settings/cadence.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where n.nspname in ('public','private') and p.prosecdef and a.privilege_type='EXECUTE'
 and (a.grantee=0 or a.grantee=(select oid from pg_roles where rolname='anon'))
 and p.oid not in ('public.get_tournament_preview(text)'::regprocedure,
 'private.odds_setting(text)'::regprocedure,'private.odds_breaker_factor()'::regprocedure,
 -- Anonymous odds_board reads evaluate these freshness helpers as the caller.
 'private.odds_refresh_interval(timestamptz)'::regprocedure,'private.odds_max_age(timestamptz)'::regprocedure)),
 0,'only allowlisted definers permit anon/PUBLIC execute');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private') and c.relkind in ('r','p') and not c.relrowsecurity),0,'all application tables enable RLS');
select ok(not has_table_privilege('authenticated','private.rpc_rate_events','SELECT'),'peer cannot read quota records');
select ok(not has_table_privilege('authenticated','private.tournament_removals','SELECT'),'peer cannot read removal identity');
select ok(not has_function_privilege('authenticated','private.was_removed(uuid)','EXECUTE'),'identity helper inaccessible');
select ok(not has_function_privilege('authenticated','private.enforce_rpc_rate(text)','EXECUTE'),'quota helper inaccessible');
delete from private.rpc_rate_events;
select pg_temp.as_user('b');
select is((select (value ->> 'place_wagers')::int from private.app_settings where key='rpc_rate_limits'),30,'default allows 30 placement submissions per minute');
select private.enforce_rpc_rate('place_wagers') from generate_series(1,30);
select throws_ok($q$select private.enforce_rpc_rate('place_wagers')$q$,'RATE_LIMITED','31st placement exceeds default');
delete from private.rpc_rate_events;
update private.app_settings set value='{"place_wagers":1,"replace_wager":1,"cancel_wager":1,"join_tournament":1,"leave_tournament":1,"remove_participant":1,"grade_prop":1}' where key='rpc_rate_limits';
select pg_temp.as_user('b');
select private.enforce_rpc_rate(x) from unnest(array['place_wagers','replace_wager','cancel_wager','join_tournament','leave_tournament','remove_participant','grade_prop']) x;
select throws_ok(format('select private.enforce_rpc_rate(%L)',x),'RATE_LIMITED',x || ' quota enforced')
 from unnest(array['place_wagers','replace_wager','cancel_wager','join_tournament','leave_tournament','remove_participant','grade_prop']) x;
set local role authenticated;
select lives_ok($q$select public.place_wagers((select id from ab_t),(select slip from payload))$q$,'receipt replay bypasses quota');
select throws_ok($q$select public.join_tournament((select code from ab_t))$q$,'RATE_LIMITED','join RPC enforces quota');
select throws_ok($q$select public.place_wagers((select id from ab_t),'[]', 'bb000000-0000-0000-0000-000000000099')$q$,'RATE_LIMITED','new placement enforces quota');
select throws_ok($q$select public.replace_wager((select id from original limit 1),'[]')$q$,'RATE_LIMITED','replace RPC enforces quota');
select throws_ok($q$select public.cancel_wager((select id from original limit 1))$q$,'RATE_LIMITED','cancel RPC enforces quota');
select throws_ok($q$select public.leave_tournament((select id from ab_t))$q$,'RATE_LIMITED','leave RPC enforces quota');
select throws_ok($q$select public.remove_participant((select id from ab_t),auth.uid())$q$,'RATE_LIMITED','remove RPC enforces quota');
reset role;
-- 0040 checks host/lock before delegating initial grading to the quota guard.
-- Exercise that path with a valid locked host fixture, independent of peer probes.
select pg_temp.as_user('b');
create temp table grade_t as select * from public.create_tournament('Grade quota',array['ab-game'],'GQ');
grant select on grade_t to authenticated;
update public.tournaments set lock_time=now()-interval '1 second' where id=(select id from grade_t);
set local role authenticated;
select throws_ok($q$select public.grade_prop((select id from grade_t),'ab-game','player_points','Player',1)$q$,'RATE_LIMITED','grade RPC enforces quota');
reset role;
select pg_temp.as_user('c');
select lives_ok($q$select private.enforce_rpc_rate('place_wagers')$q$,'quotas are per user');
update private.rpc_rate_events set occurred_at=clock_timestamp()-interval '61 seconds';
select lives_ok($q$select private.enforce_rpc_rate('place_wagers')$q$,'sliding window expires');
update auth.users set email_confirmed_at=now() where id='a9000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('c');
set local role authenticated;
select throws_ok($q$select public.remove_participant((select id from ab_t),'a9000000-0000-0000-0000-00000000000b')$q$,'NOT_HOST','peer cannot remove');
reset role;
select pg_temp.as_user('a');
set local role authenticated;
select lives_ok($q$select public.remove_participant((select id from ab_t),'a9000000-0000-0000-0000-00000000000b')$q$,'host removes despite hidden picks');
reset role;
select pg_temp.as_user('b');
delete from private.rpc_rate_events;
set local role authenticated;
select throws_ok($q$select public.join_tournament((select code from ab_t))$q$,'REMOVED_BY_HOST','removed account cannot rejoin');
select is(public.removed_from((select code from ab_t)),true,'removal message available');
reset role;
update auth.users set email='old-account@test.dev' where id='a9000000-0000-0000-0000-00000000000b';
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_user_meta_data)
 values('a9000000-0000-0000-0000-00000000000d','authenticated','authenticated','ab-player@test.dev',now(),false,'{"display_name":"Replacement"}');
delete from public.profiles where id='a9000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('d');
set local role authenticated;
select throws_ok($q$select public.join_tournament((select code from ab_t))$q$,'REMOVED_BY_HOST','verified email blocks replacement identity');
reset role;
update auth.users set email_confirmed_at=null where id='a9000000-0000-0000-0000-00000000000d';
select is(private.was_removed((select id from ab_t)),false,'unverified email is not trusted');
select * from finish();
rollback;
