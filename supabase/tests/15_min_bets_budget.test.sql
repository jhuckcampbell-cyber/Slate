-- House rules are checked on submit (migration 0022): a slip only goes through if, once placed, the player has at
-- least min_bets bets and (with all_in) $0 left. Cancelling stays allowed; a swap (replace_wager) obeys the rules too.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'h@test.dev', false, '{"display_name":"Hank"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('mb-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"mb-g1","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"mb-g1","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"mb-g1","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bet(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs',
    jsonb_build_array((select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
                       from public.odds_cache c where c.event_id = 'mb-g1' and c.market_key = 'h2h' and c.outcome_name = p_team)));
$$;
create function pg_temp.slip(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.bet(p_amount, p_team));
$$;
create function pg_temp.left_in(p_t uuid) returns bigint language sql as $$
  select remaining_bankroll_cents from public.tournament_participants
   where tournament_id = p_t and user_id = 'a5000000-0000-0000-0000-00000000000a';
$$;

select pg_temp.as_user('a5000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Three bets', array['mb-g1'], 'TB', null, 10000, null,
  '{"markets":["h2h"],"min_bets":3}'::jsonb);
create temp table t2 as select * from public.create_tournament('No minimum', array['mb-g1'], 'NM', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
create temp table t3 as select * from public.create_tournament('All in', array['mb-g1'], 'AI', null, 10000, null,
  '{"markets":["h2h"],"all_in":true}'::jsonb);
create temp table t4 as select * from public.create_tournament('Both', array['mb-g1'], 'BO', null, 10000, null,
  '{"markets":["h2h"],"all_in":true,"min_bets":2}'::jsonb);
grant select on t1, t2, t3, t4 to authenticated;

-- min_bets
select throws_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(1000, 'Boston Celtics')) $$,
  'HOUSE_RULE_MIN_BETS', 'one bet is refused when 3 are required');
select throws_ok($$ select public.place_wagers((select id from t1),
    jsonb_build_array(pg_temp.bet(1000, 'Boston Celtics'), pg_temp.bet(1000, 'New York Knicks'))) $$,
  'HOUSE_RULE_MIN_BETS', 'two bets are still short of three');
select is(pg_temp.left_in((select id from t1)), 10000::bigint, 'a refused slip takes no money');
select lives_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(1000, 'Boston Celtics'), pg_temp.bet(1000, 'New York Knicks'), pg_temp.bet(1000, 'Boston Celtics'))) $$,
  'three bets in one slip meet the rule');
select lives_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(500, 'Boston Celtics')) $$,
  'once the rule is met, one more bet is fine');
select lives_ok($$ select public.cancel_wager((select w.id from public.wagers w where w.tournament_id = (select id from t1)
    limit 1)) $$, 'cancelling stays allowed');
select lives_ok($$ select public.cancel_wager((select w.id from public.wagers w where w.tournament_id = (select id from t1)
    limit 1)) $$, 'even below the minimum (the player is then not in until they re-submit)');
select lives_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(500, 'Boston Celtics')) $$,
  'with 2 left after cancelling, one bet brings it back to 3');

-- all_in
select throws_ok($$ select public.place_wagers((select id from t3), pg_temp.slip(9900, 'Boston Celtics')) $$,
  'HOUSE_RULE_ALL_IN', 'leaving $1 unbet is refused when the host said bet everything');
select lives_ok($$ select public.place_wagers((select id from t3), pg_temp.slip(10000, 'Boston Celtics')) $$,
  'betting the whole bankroll is fine');
select is(pg_temp.left_in((select id from t3)), 0::bigint, 'nothing left');

-- both rules at once, and a swap
select throws_ok($$ select public.place_wagers((select id from t4), pg_temp.slip(10000, 'Boston Celtics')) $$,
  'HOUSE_RULE_MIN_BETS', 'everything on one bet misses the 2-bet minimum');
select lives_ok($$ select public.place_wagers((select id from t4), jsonb_build_array(
    pg_temp.bet(6000, 'Boston Celtics'), pg_temp.bet(4000, 'New York Knicks'))) $$, 'two bets using everything');
select throws_ok($$ select public.replace_wager(
    (select w.id from public.wagers w where w.tournament_id = (select id from t4) and w.amount_cents = 4000),
    pg_temp.slip(3000, 'New York Knicks')) $$,
  'HOUSE_RULE_ALL_IN', 'a swap that would leave $10 unbet is refused (and the old bet stays)');

-- No rules: unchanged.
select lives_ok($$ select public.place_wagers((select id from t2), pg_temp.slip(1000, 'Boston Celtics')) $$,
  'without house rules any slip is fine');

select * from finish();
rollback;
