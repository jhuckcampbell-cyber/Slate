-- Token mode fixes (migration 0025): tokens and the rules around them must agree; mixed slips (one parlay + singles)
-- spend every token in one submit; picks stay blind before lock; cancel/void can't refund twice.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'h7@test.dev', false, '{"display_name":"Hank"}'),
  ('a7000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'g7@test.dev', false, '{"display_name":"Gina"}'),
  ('a7000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'c7@test.dev', false, '{"display_name":"Cal"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('tf-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days'),
  ('tf-g2', 'basketball_nba', 'Los Angeles Lakers', 'Denver Nuggets', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"tf-g1","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"tf-g1","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"},
    {"event_id":"tf-g2","market_key":"h2h","outcome_name":"Los Angeles Lakers","price_american":120,"bookmaker":"dk"},
    {"event_id":"tf-g2","market_key":"h2h","outcome_name":"Denver Nuggets","price_american":-140,"bookmaker":"dk"}]',
  '[{"event_id":"tf-g1","market_key":"h2h","bookmaker":"dk"},{"event_id":"tf-g2","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.leg(p_team text) returns jsonb language sql as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
    from public.odds_cache c where c.market_key = 'h2h' and c.outcome_name = p_team and c.event_id like 'tf-%';
$$;
create function pg_temp.bet(p_amount bigint, variadic p_teams text[]) returns jsonb language sql as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs', (select jsonb_agg(pg_temp.leg(x)) from unnest(p_teams) x));
$$;
-- The `detail` of an error raised by a statement (null if it doesn't raise).
create function pg_temp.error_detail(p_sql text) returns text language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

select pg_temp.as_user('a7000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Tokens', array['tf-g1', 'tf-g2'], 'TF', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
create temp table t2 as select * from public.create_tournament('Rules', array['tf-g1'], 'TR', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
grant select on t1, t2 to authenticated, anon;

-- ---- The rules and the tokens must agree ----
select lives_ok($$ select public.set_tournament_tokens((select id from t2), '[2500, 2500, 5000]') $$, 'tokens set');
select throws_ok($$ select public.update_tournament((select id from t2), '{"starting_bankroll_cents":20000}') $$,
  'INVALID_TOKENS', 'bankroll change that breaks the tokens is refused');
select throws_ok($$ select public.update_tournament((select id from t2), '{"allowed_bet_types":{"min_bets":5}}') $$,
  'INVALID_TOKENS', 'min bets above the token count is refused');
select throws_ok($$ select public.update_tournament((select id from t2), '{"max_bet_cents":3000}') $$,
  'INVALID_TOKENS', 'a max bet below the biggest token is refused');
select lives_ok($$ select public.update_tournament((select id from t2), '{"max_bet_cents":5000,"allowed_bet_types":{"min_bets":3,"all_in":false}}') $$,
  'rules that fit the tokens are fine');
select is((select (allowed_bet_types ->> 'all_in')::boolean from public.tournaments where id = (select id from t2)),
  true, 'all_in stays on with tokens');

-- Clearing tokens
select lives_ok($$ select public.set_tournament_tokens((select id from t2), null) $$, 'host clears the tokens');
select ok(not ((select allowed_bet_types from public.tournaments where id = (select id from t2)) ? 'tokens'), 'tokens gone');
select is((select (allowed_bet_types ->> 'all_in')::boolean from public.tournaments where id = (select id from t2)),
  false, 'and bet-everything is off again');
select lives_ok($$ select public.update_tournament((select id from t2), '{"starting_bankroll_cents":20000}') $$,
  'bankroll can change again');
select throws_ok($$ select public.set_tournament_tokens((select id from t2), '[5000, 5000, 10000]') $$,
  'INVALID_TOKENS', 'a $100 token over the $50 max bet is refused');
select lives_ok($$ select public.update_tournament((select id from t2), '{"max_bet_cents":null,"allowed_bet_types":{"min_bets":4}}') $$,
  'min bets 4');
select throws_ok($$ select public.set_tournament_tokens((select id from t2), '[5000, 5000, 10000]') $$,
  'INVALID_TOKENS', 'three tokens but min bets 4 is refused');

-- ---- Mixed slip: one parlay + singles, every token in one submit ----
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000a');
select public.set_tournament_tokens((select id from t1), '[2500, 2500, 5000]');
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t1));
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000c');
select public.join_tournament((select code from t1));

select pg_temp.as_user('a7000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(5000, 'Boston Celtics', 'Los Angeles Lakers'))) $$,
  'HOUSE_RULE_ALL_IN', 'a parlay alone leaves tokens unused');
select lives_ok($$ select public.place_wagers((select id from t1), jsonb_build_array(
    pg_temp.bet(5000, 'Boston Celtics', 'Los Angeles Lakers'),
    pg_temp.bet(2500, 'New York Knicks'),
    pg_temp.bet(2500, 'Denver Nuggets'))) $$,
  'parlay on the $50 token + two $25 singles in one submit');
select is((select count(*)::int from public.wagers w where w.tournament_id = (select id from t1)), 3, 'three wagers placed');

select pg_temp.as_user('a7000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.set_tournament_tokens((select id from t1), '[5000, 5000]') $$,
  'TOKENS_LOCKED', 'tokens are fixed once anyone has bet');
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.set_tournament_tokens((select id from t1), '[5000, 5000]') $$,
  'NOT_HOST', 'only the host sets tokens');

-- ---- Blind before lock (rule 1), in a token tournament ----
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000c');
set local role authenticated;
select is((select count(*)::int from public.wagers where tournament_id = (select id from t1)), 0,
  'co-participant sees no wagers before lock');
select is((select count(*)::int from public.wager_legs l join public.wagers w on w.id = l.wager_id
            where w.tournament_id = (select id from t1)), 0, 'nor legs');
select is(pg_temp.error_detail($q$ select public.place_wagers((select id from t1), jsonb_build_array(pg_temp.bet(9900, 'Boston Celtics'))) $q$),
  '{"available": [2500, 2500, 5000]}', 'TOKEN_NOT_AVAILABLE lists only the caller''s own tokens');
reset role;

set local role anon;
select ok(not has_function_privilege('anon', 'public.set_tournament_tokens(uuid, jsonb)', 'execute'), 'anon cannot set tokens');
reset role;

-- ---- replace_wager is held to the tokens ----
select pg_temp.as_user('a7000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.replace_wager((select w.id from public.wagers w where w.tournament_id = (select id from t1)
    and w.wager_type = 'parlay'), jsonb_build_array(pg_temp.bet(4000, 'Boston Celtics'))) $$,
  'TOKEN_NOT_AVAILABLE', 'a swap must use the freed token');
select lives_ok($$ select public.replace_wager((select w.id from public.wagers w where w.tournament_id = (select id from t1)
    and w.wager_type = 'parlay'), jsonb_build_array(pg_temp.bet(5000, 'Boston Celtics'))) $$,
  'a swap on the same token works');

-- ---- No double refunds ----
-- A postponed game before lock: nothing is voided (the player can still cancel); once locked, it is.
update public.events set status = 'postponed' where id = 'tf-g2';
select private.void_stale_legs();
select is((select count(*)::int from public.wager_legs l join public.wagers w on w.id = l.wager_id
            where w.tournament_id = (select id from t1) and l.status = 'void'), 0, 'no voiding before lock');
-- A wager that is somehow already settled can't be cancelled for a second refund.
update public.wagers set status = 'void' where tournament_id = (select id from t1) and amount_cents = 2500
  and id = (select w.id from public.wagers w join public.wager_legs l on l.wager_id = w.id
             where w.tournament_id = (select id from t1) and l.event_id = 'tf-g2' limit 1);
select throws_ok($$ select public.cancel_wager((select w.id from public.wagers w where w.tournament_id = (select id from t1)
    and w.status = 'void' limit 1)) $$,
  'WAGER_SETTLED', 'a settled wager cannot be cancelled');

select * from finish();
rollback;
