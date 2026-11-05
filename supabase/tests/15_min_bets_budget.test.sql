-- With a minimum-bets rule, a bet can't leave less than $1 for each bet still owed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
create function pg_temp.slip(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs',
    jsonb_build_array((select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
                       from public.odds_cache c where c.event_id = 'mb-g1' and c.market_key = 'h2h' and c.outcome_name = p_team))));
$$;

select pg_temp.as_user('a5000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Three bets', array['mb-g1'], 'TB', null, 10000, null,
  '{"markets":["h2h"],"min_bets":3}'::jsonb);
create temp table t2 as select * from public.create_tournament('No minimum', array['mb-g1'], 'NM', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
grant select on t1, t2 to authenticated;

select throws_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(10000, 'Boston Celtics')) $$,
  'LEAVES_TOO_LITTLE', 'the whole bankroll on one bet is refused when 3 bets are required');
select throws_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(9900, 'Boston Celtics')) $$,
  'LEAVES_TOO_LITTLE', 'leaving $1 is not enough for two more bets');
select lives_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(9800, 'Boston Celtics')) $$,
  'leaving $2 for the two bets still owed is fine');
select is((select remaining_bankroll_cents from public.tournament_participants
            where tournament_id = (select id from t1) and user_id = 'a5000000-0000-0000-0000-00000000000a'), 200::bigint,
  'the stake was taken');
select throws_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(200, 'New York Knicks')) $$,
  'LEAVES_TOO_LITTLE', 'with 1 placed, $2 on the next bet leaves nothing for the third');
select lives_ok($$ select public.place_wagers((select id from t1), pg_temp.slip(100, 'New York Knicks')) $$,
  'a $1 bet leaves $1 for the last one');
select lives_ok($$ select public.place_wagers((select id from t2), pg_temp.slip(10000, 'Boston Celtics')) $$,
  'without a minimum the whole bankroll can go on one bet');

select * from finish();
rollback;
