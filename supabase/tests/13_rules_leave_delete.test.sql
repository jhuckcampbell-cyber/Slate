-- Host rules "bet the whole bankroll" (all_in) and "at least N bets" (min_bets): stored with the rules, and a player
-- who misses them is ranked below everyone who met them (standing 'disqualified'). Players can leave and hosts can
-- delete a tournament, both only before lock (after lock the picks are frozen).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'h@test.dev', false, '{"display_name":"Hank"}'),
  ('b4000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Pia"}'),
  ('c4000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', null, true, '{"display_name":"Oz"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('rl-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"rl-g1","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"rl-g1","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"rl-g1","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bet(p_tid uuid, p_amount bigint, p_team text) returns void language sql as $$
  select public.place_wagers(p_tid, jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs',
    jsonb_build_array((select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
                       from public.odds_cache c where c.event_id = 'rl-g1' and c.market_key = 'h2h' and c.outcome_name = p_team)))));
$$;

-- ---------- the rules are stored ----------
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('All In', array['rl-g1'], 'AI', null, 10000, null,
  '{"markets":["h2h"],"all_in":true,"min_bets":2}'::jsonb);
create temp table t2 as select * from public.create_tournament('Loose', array['rl-g1'], 'LO', null, 10000, null,
  '{"markets":["h2h"],"min_bets":50}'::jsonb);
create temp table t3 as select * from public.create_tournament('Oops', array['rl-g1'], 'OP', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
grant select on t1, t2, t3 to authenticated;

select is((select allowed_bet_types -> 'all_in' from public.tournaments where id = (select id from t1)), 'true'::jsonb,
  'host can require betting the whole bankroll');
select is((select allowed_bet_types -> 'min_bets' from public.tournaments where id = (select id from t1)), '2'::jsonb,
  'host can require a minimum number of bets');
select is((select allowed_bet_types -> 'min_bets' from public.tournaments where id = (select id from t2)), '20'::jsonb,
  'minimum bets is capped at 20');
select is((select allowed_bet_types -> 'all_in' from public.tournaments where id = (select id from t3)), 'false'::jsonb,
  'off by default');
select public.update_tournament((select id from t2), '{"allowed_bet_types":{"min_bets":3,"all_in":true}}');
select is((select allowed_bet_types -> 'min_bets' from public.tournaments where id = (select id from t2)), '3'::jsonb,
  'the host can change the minimum before lock');
select is((select allowed_bet_types -> 'all_in' from public.tournaments where id = (select id from t2)), 'true'::jsonb,
  '...and turn all-in on');

-- ---------- leave ----------
select pg_temp.as_user('b4000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t3));
select pg_temp.bet((select id from t3), 1000, 'Boston Celtics');
select lives_ok(format('select public.leave_tournament(%L)', (select id from t3)), 'a player who joined by accident can leave');
select is((select count(*)::int from public.tournament_participants p
           where p.tournament_id = (select id from t3) and p.user_id = 'b4000000-0000-0000-0000-00000000000b'), 0,
  '...and is out of the squad');
select pg_temp.as_user('c4000000-0000-0000-0000-00000000000c');
select throws_ok(format('select public.leave_tournament(%L)', (select id from t3)), 'P0001', 'NOT_A_PARTICIPANT',
  'can''t leave a tournament you''re not in');
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
select throws_ok(format('select public.leave_tournament(%L)', (select id from t3)), 'P0001', 'HOST_CANNOT_LEAVE',
  'the host deletes instead of leaving');

-- ---------- delete ----------
select pg_temp.as_user('b4000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t3));
select throws_ok(format('select public.delete_tournament(%L)', (select id from t3)), 'P0001', 'NOT_HOST',
  'only the host can delete');
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
select lives_ok(format('select public.delete_tournament(%L)', (select id from t3)), 'the host deletes before lock');
select is((select count(*)::int from public.tournaments where id = (select id from t3)), 0, '...and it''s gone for everyone');

-- ---------- a removed player is told why, however they come back ----------
select pg_temp.as_user('c4000000-0000-0000-0000-00000000000c');
select public.join_tournament((select code from t2));
select is(public.removed_from((select code from t2)), false, 'still in: not removed');
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
select public.remove_participant((select id from t2), 'c4000000-0000-0000-0000-00000000000c');
select pg_temp.as_user('c4000000-0000-0000-0000-00000000000c');
select is(public.removed_from((select code from t2)), true, 'the host removed Oz: his invite link says so');
select pg_temp.as_user('b4000000-0000-0000-0000-00000000000b');
select is(public.removed_from((select code from t2)), false, '...and only for Oz');
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');

-- ---------- qualification on the leaderboard ----------
-- t1: all in + 2 bets. Hank bets all $100 in two bets; Pia bets $50 once (holding $50 would otherwise put her ahead).
select pg_temp.bet((select id from t1), 5000, 'Boston Celtics');
select pg_temp.bet((select id from t1), 5000, 'New York Knicks');
select pg_temp.as_user('b4000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t1));
select pg_temp.bet((select id from t1), 5000, 'Boston Celtics');

reset role;
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t1);
select private.advance_statuses();

select pg_temp.as_user('b4000000-0000-0000-0000-00000000000b');
select throws_ok(format('select public.leave_tournament(%L)', (select id from t1)), 'P0001', 'TOURNAMENT_LOCKED',
  'after lock nobody can leave (the picks are frozen)');
select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
select throws_ok(format('select public.delete_tournament(%L)', (select id from t1)), 'P0001', 'TOURNAMENT_LOCKED',
  '...and the host can''t delete it mid-game');

set local role authenticated;
select is((select qualified from public.leaderboard where tournament_id = (select id from t1) and display_name = 'Hank'), true,
  'Hank met the rules');
select is((select standing from public.leaderboard where tournament_id = (select id from t1) and display_name = 'Pia'),
  'disqualified', 'Pia bet half and only once: disqualified');
select ok((select ev_cents from public.leaderboard where tournament_id = (select id from t1) and display_name = 'Pia')
        > (select ev_cents from public.leaderboard where tournament_id = (select id from t1) and display_name = 'Hank'),
  'Pia''s projection is higher (she held $50 back)...');
select is((select rank from public.leaderboard where tournament_id = (select id from t1) and display_name = 'Hank'), 1,
  '...but whoever met the rules ranks first');
reset role;

select * from finish();
rollback;
