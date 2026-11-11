-- Differential pre-lock probes: identical public state/caller, different hidden slip.
-- Intentionally fails for real error oracles; do not bless a leak with TODO/expected errors.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
select * from finish();
rollback;
