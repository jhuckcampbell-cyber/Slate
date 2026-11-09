-- Token mode (migration 0024): the host deals tokens (e.g. $25, $25, $50); every bet must be one unused token, and
-- every token must be used (token mode turns on all_in). Normal tournaments are untouched.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'h6@test.dev', false, '{"display_name":"Hank"}'),
  ('a6000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'g6@test.dev', false, '{"display_name":"Gina"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('tk-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"tk-g1","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"tk-g1","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"tk-g1","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bet(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs',
    jsonb_build_array((select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
                       from public.odds_cache c where c.event_id = 'tk-g1' and c.market_key = 'h2h' and c.outcome_name = p_team)));
$$;

select pg_temp.as_user('a6000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Tokens', array['tk-g1'], 'TK', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
create temp table t2 as select * from public.create_tournament('Normal', array['tk-g1'], 'NO', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
grant select on t1, t2 to authenticated;

-- Setting the tokens
select throws_ok($$ select public.set_tournament_tokens((select id from t1), '[2500, 2500]') $$,
  'INVALID_TOKENS', 'tokens must add up to the bankroll');
select throws_ok($$ select public.set_tournament_tokens((select id from t1), '[2550, 2450, 5000]') $$,
  'INVALID_TOKENS', 'tokens are whole dollars');
select lives_ok($$ select public.set_tournament_tokens((select id from t1), '[5000, 2500, 2500]') $$, 'host sets 25/25/50');
select is((select allowed_bet_types -> 'tokens' from public.tournaments where id = (select id from t1)),
  '[2500, 2500, 5000]'::jsonb, 'stored sorted');
select is((select (allowed_bet_types ->> 'all_in')::boolean from public.tournaments where id = (select id from t1)),
  true, 'token mode turns on all_in');
select lives_ok($$ select public.update_tournament((select id from t1), '{"allowed_bet_types":{"min_bets":0}}') $$,
  'editing other rules works');
select is((select allowed_bet_types -> 'tokens' from public.tournaments where id = (select id from t1)),
  '[2500, 2500, 5000]'::jsonb, 'and keeps the tokens');

-- A player joins and bets
select pg_temp.as_user('a6000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t1));
select throws_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(3000, 'Boston Celtics'), pg_temp.bet(2000, 'New York Knicks'), pg_temp.bet(5000, 'Boston Celtics'))) $$,
  'TOKEN_NOT_AVAILABLE', 'amounts that are not tokens are refused');
select throws_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(5000, 'Boston Celtics'), pg_temp.bet(5000, 'New York Knicks'))) $$,
  'TOKEN_NOT_AVAILABLE', 'the $50 token can only be used once');
select throws_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(2500, 'Boston Celtics'), pg_temp.bet(5000, 'New York Knicks'))) $$,
  'HOUSE_RULE_ALL_IN', 'every token has to be used');
select lives_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(2500, 'Boston Celtics'), pg_temp.bet(2500, 'New York Knicks'), pg_temp.bet(5000, 'Boston Celtics'))) $$,
  'all three tokens, one per bet');
select lives_ok($$ select public.cancel_wager((select w.id from public.wagers w join public.tournament_participants p
    on p.id = w.participant_id where w.tournament_id = (select id from t1)
    and p.user_id = 'a6000000-0000-0000-0000-00000000000b' and w.amount_cents = 5000)) $$,
  'cancelling a bet gives its token back');
select lives_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(pg_temp.bet(5000, 'New York Knicks'))) $$,
  'and it can be placed again');

-- Normal tournaments: unchanged (the host bets in their own).
select pg_temp.as_user('a6000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.place_wagers((select id from t2), jsonb_build_array(pg_temp.bet(1234, 'Boston Celtics'))) $$,
  'any amount still works without tokens');

select * from finish();
rollback;
