-- Phase 3: host controls, lock enforcement, status machine, reveal/roster signals.
-- Users: H (host), P (player), Q (player the host removes), O (outsider).
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'host@test.dev', false, '{"display_name":"Hal"}'),
  ('22222222-0000-0000-0000-000000000002', 'authenticated', 'authenticated', null, true, '{"display_name":"Pia"}'),
  ('33333333-0000-0000-0000-000000000003', 'authenticated', 'authenticated', null, true, '{"display_name":"Quin"}'),
  ('44444444-0000-0000-0000-000000000004', 'authenticated', 'authenticated', null, true, '{"display_name":"Oz"}');

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('tl-ev1', 'americanfootball_nfl', 'Miami Dolphins', 'New York Jets', now() + interval '2 days'),
  ('tl-ev2', 'americanfootball_nfl', 'Chicago Bears', 'Minnesota Vikings', now() + interval '3 days'),
  ('tl-ev3', 'americanfootball_nfl', 'Houston Texans', 'Tennessee Titans', now() + interval '1 day'),
  ('tl-ev4', 'americanfootball_nfl', 'Denver Broncos', 'Las Vegas Raiders', now() + interval '5 hours');

select public.odds_sync_ingest('odds', 'americanfootball_nfl', now(), '[]',
  '[{"event_id":"tl-ev1","market_key":"h2h","outcome_name":"Miami Dolphins","price_american":-130,"bookmaker":"dk"},
    {"event_id":"tl-ev1","market_key":"h2h","outcome_name":"New York Jets","price_american":110,"bookmaker":"dk"},
    {"event_id":"tl-ev2","market_key":"h2h","outcome_name":"Chicago Bears","price_american":-120,"bookmaker":"dk"},
    {"event_id":"tl-ev2","market_key":"h2h","outcome_name":"Minnesota Vikings","price_american":100,"bookmaker":"dk"},
    {"event_id":"tl-ev3","market_key":"h2h","outcome_name":"Houston Texans","price_american":-150,"bookmaker":"dk"},
    {"event_id":"tl-ev3","market_key":"h2h","outcome_name":"Tennessee Titans","price_american":130,"bookmaker":"dk"}]',
  '[{"event_id":"tl-ev1","market_key":"h2h","bookmaker":"dk"},{"event_id":"tl-ev2","market_key":"h2h","bookmaker":"dk"},
    {"event_id":"tl-ev3","market_key":"h2h","bookmaker":"dk"}]');

-- A one-pick slip at the current moneyline price.
create function pg_temp.single(p_amount bigint, p_event text, p_outcome text)
returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(
    jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point))))
  from public.odds_cache c
  where c.event_id = p_event and c.market_key = 'h2h' and c.outcome_name = p_outcome;
$$;
-- Broadcasts queued for a tournament's private Realtime channel (read as postgres, bypassing RLS).
create function pg_temp.signals(p_tid uuid, p_event text)
returns int language sql stable as $$
  select count(*)::int from realtime.messages m
  where m.topic = 'tournament:' || p_tid and m.event = p_event;
$$;
create temp table marks (k text primary key, n int);

-- ---------- H creates two tournaments; P and Q join the first ----------
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temp table t1 as select * from public.create_tournament('Lock Tests', array['tl-ev1', 'tl-ev2'], 'LK');
create temp table t_solo as select * from public.create_tournament('Solo Host', array['tl-ev1'], 'SOLO');
grant select on t1, t_solo, marks to authenticated;

select is(pg_temp.signals((select id from t1), 'roster'), 1, 'host auto-join signals the roster channel');

select set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.join_tournament((select code from t1));
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select public.join_tournament((select code from t1));
reset role;
select is(pg_temp.signals((select id from t1), 'roster'), 3, 'each join signals the roster channel');

set local role authenticated;  -- still Q
select public.place_wagers((select id from t1), pg_temp.single(1500, 'tl-ev1', 'New York Jets'));
reset role;
select is(pg_temp.signals((select id from t1), 'roster'), 4, 'a first pick flips "picks in" and signals the roster');
set local role authenticated;
select public.place_wagers((select id from t1), pg_temp.single(500, 'tl-ev2', 'Chicago Bears'));
reset role;
select is(pg_temp.signals((select id from t1), 'roster'), 4, 'later picks send nothing (no activity leak)');

-- ---------- private channel authorization (realtime.messages RLS) ----------
select set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('realtime.topic', 'tournament:' || (select id from t1), true);
set local role authenticated;
select ok((select count(*) from realtime.messages where topic = 'tournament:' || (select id from t1)) > 0,
  'participant can receive their tournament''s broadcasts');
reset role;
select set_config('realtime.topic', 'tournament:' || (select id from t_solo), true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where topic = 'tournament:' || (select id from t_solo)), 0,
  'participant cannot join another tournament''s channel');
select ok(not private.can_read_channel('tournament:not-a-uuid'), 'malformed topics are denied without erroring');
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('realtime.topic', 'tournament:' || (select id from t1), true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where topic = 'tournament:' || (select id from t1)), 0,
  'outsider cannot receive tournament broadcasts');
reset role;

-- ---------- update_tournament ----------
select set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"title":"Mine now"}'),
  'NOT_HOST', 'only the host can edit');
reset role;

insert into marks values ('edit', pg_temp.signals((select id from t1), 'tournament'));
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format('select public.update_tournament(%L, %L)', (select id from t1),
  '{"title":"  Sunday Sweat  ","max_bet_cents":2500,"allowed_bet_types":{"markets":["h2h","totals","bogus"],"parlays":false}}'),
  'host edits title, max bet and bet types in one call');
select is((select title from public.tournaments where id = (select id from t1)), 'Sunday Sweat', 'title trimmed and saved');
select is((select max_bet_cents from public.tournaments where id = (select id from t1)), 2500, 'max bet saved');
select is((select allowed_bet_types from public.tournaments where id = (select id from t1)),
  '{"markets":["h2h","totals"],"parlays":false,"max_parlay_legs":6,"player_props":false}'::jsonb,
  'bet types merge over the current rules and unknown markets are dropped');
reset role;
select is(pg_temp.signals((select id from t1), 'tournament') - (select n from marks where k = 'edit'), 1,
  'an edit signals the tournament channel once');

select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"max_bet_cents":1000}'),
  'lowering max bet below a hidden existing bet succeeds (edits never reveal picks)');
reset role;
select is((select count(*)::int from public.wagers where tournament_id = (select id from t1)), 2,
  'existing bets stand under the new rules');

set local role authenticated;  -- H
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"title":"   "}'),
  'INVALID_TITLE', 'blank title rejected');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"max_bet_cents":20000}'),
  'INVALID_MAX_BET', 'max bet cannot exceed the bankroll');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1),
  '{"allowed_bet_types":{"markets":["player_points"]}}'),
  'INVALID_RULES', 'at least one supported market is required');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"status":"settled"}'),
  'INVALID_CHANGES', 'only editable fields are accepted');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"starting_bankroll_cents":50000}'),
  'BANKROLL_LOCKED', 'bankroll is fixed once others have joined');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1),
  json_build_object('lock_time', now() + interval '2 days 1 minute')),
  'INVALID_LOCK_TIME', 'lock cannot move past the first kickoff');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1),
  json_build_object('lock_time', now() - interval '1 minute')),
  'INVALID_LOCK_TIME', 'lock cannot move into the past');
select lives_ok(format('select public.update_tournament(%L, %L)', (select id from t1),
  json_build_object('lock_time', now() + interval '1 day')),
  'lock can move earlier');
select is((select lock_time from public.tournaments where id = (select id from t1)), now() + interval '1 day',
  'new lock time saved');
select lives_ok(format('select public.update_tournament(%L, %L)', (select id from t_solo), '{"starting_bankroll_cents":50000}'),
  'a host alone in their tournament can change the bankroll');
select is((select remaining_bankroll_cents from public.tournament_participants where tournament_id = (select id from t_solo)),
  50000::bigint, 'host bankroll follows the new starting bankroll');
reset role;

-- ---------- remove_participant ----------
select set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select public.remove_participant(%L, %L)', (select id from t1), '33333333-0000-0000-0000-000000000003'),
  'NOT_HOST', 'only the host can remove players');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select public.remove_participant(%L, %L)', (select id from t1), '11111111-0000-0000-0000-000000000001'),
  'CANNOT_REMOVE_HOST', 'host cannot remove themselves');
select throws_ok(format('select public.remove_participant(%L, %L)', (select id from t1), '44444444-0000-0000-0000-000000000004'),
  'PLAYER_NOT_FOUND', 'removing a non-member fails');
select lives_ok(format('select public.remove_participant(%L, %L)', (select id from t1), '33333333-0000-0000-0000-000000000003'),
  'host removes Q');
reset role;
select is((select count(*)::int from public.tournament_participants
           where tournament_id = (select id from t1) and user_id = '33333333-0000-0000-0000-000000000003'), 0,
  'Q is off the roster');
select is((select count(*)::int from public.wagers where tournament_id = (select id from t1)), 0,
  'and Q''s picks are gone with them');
select ok(exists (select 1 from realtime.messages m
                  where m.topic = 'tournament:' || (select id from t1) and m.event = 'roster'
                    and m.payload ->> 'change' = 'left'
                    and m.payload ->> 'user_id' = '33333333-0000-0000-0000-000000000003'),
  'the channel is told who left');

select set_config('request.jwt.claims', '{"sub":"33333333-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select public.join_tournament(%L)', (select code from t1)),
  'REMOVED_BY_HOST', 'a removed player cannot rejoin');
reset role;

-- ---------- lock_tournament_now ----------
select set_config('request.jwt.claims', '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.place_wagers((select id from t1), pg_temp.single(1000, 'tl-ev1', 'Miami Dolphins'));
select throws_ok(format('select public.lock_tournament_now(%L)', (select id from t1)),
  'NOT_HOST', 'only the host can lock early');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.place_wagers((select id from t1), pg_temp.single(1000, 'tl-ev2', 'Chicago Bears'));
select lives_ok(format('select public.lock_tournament_now(%L)', (select id from t1)), 'host locks picks now');
select is((select status::text from public.tournaments where id = (select id from t1)), 'locked', 'status flips to locked');
select ok((select lock_time <= now() from public.tournaments where id = (select id from t1)), 'lock time moves to now');
select is((select count(*)::int from public.wagers where tournament_id = (select id from t1)), 2,
  'the host sees every pick the moment picks lock');
select throws_ok(format('select public.lock_tournament_now(%L)', (select id from t1)),
  'TOURNAMENT_LOCKED', 'cannot lock twice');
select throws_ok(format('select public.update_tournament(%L, %L)', (select id from t1), '{"title":"Too late"}'),
  'TOURNAMENT_LOCKED', 'no edits after lock');
select throws_ok(format('select public.remove_participant(%L, %L)', (select id from t1), '22222222-0000-0000-0000-000000000002'),
  'TOURNAMENT_LOCKED', 'no removals after lock');
reset role;
select ok((select bool_and(is_locked) from public.wagers where tournament_id = (select id from t1)),
  'locking flags every wager');
select ok(exists (select 1 from realtime.messages m
                  where m.topic = 'tournament:' || (select id from t1) and m.event = 'tournament'
                    and m.payload ->> 'status' = 'locked'),
  'the lock is broadcast to the channel');

-- ---------- lock guards: even code that bypasses the RPCs can't touch frozen picks ----------
select throws_ok($$ insert into public.wagers (tournament_id, participant_id, wager_type, amount_cents,
                    odds_american, odds_decimal, potential_payout_cents)
                    select p.tournament_id, p.id, 'single', 100, 100, 2, 200
                    from public.tournament_participants p where p.tournament_id = (select id from t1) limit 1 $$,
  'TOURNAMENT_LOCKED', 'post-lock: no new wagers');
select throws_ok($$ update public.wagers set amount_cents = amount_cents + 100 where tournament_id = (select id from t1) $$,
  'TOURNAMENT_LOCKED', 'post-lock: stakes are frozen');
select throws_ok($$ update public.wager_legs set selection = 'Minnesota Vikings' where tournament_id = (select id from t1) $$,
  'TOURNAMENT_LOCKED', 'post-lock: selections are frozen');
select throws_ok($$ delete from public.wagers where tournament_id = (select id from t1) $$,
  'TOURNAMENT_LOCKED', 'post-lock: picks cannot be deleted');
select lives_ok($$ update public.wager_legs set status = 'hit', settled_at = now() where tournament_id = (select id from t1) $$,
  'post-lock: grading columns can still change');
select throws_ok($$ update public.tournaments set lock_time = now() + interval '1 hour' where id = (select id from t1) $$,
  'TOURNAMENT_LOCKED', 'post-lock: lock time is frozen');
select throws_ok($$ update public.tournaments set max_bet_cents = 100 where id = (select id from t1) $$,
  'TOURNAMENT_LOCKED', 'post-lock: rules are frozen');
select throws_ok($$ update public.tournaments set status = 'open' where id = (select id from t1) $$,
  'INVALID_STATUS_CHANGE', 'status never moves backwards');
select throws_ok($$ insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
                    values ((select id from t1), '44444444-0000-0000-0000-000000000004', 10000) $$,
  'TOURNAMENT_LOCKED', 'post-lock: nobody new gets in, even bypassing join_tournament');
select lives_ok($$ delete from auth.users where id = '22222222-0000-0000-0000-000000000002' $$,
  'deleting an account still cascades through locked picks');

-- ---------- status machine (pg_cron → private.advance_statuses) ----------
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temp table t3 as select * from public.create_tournament('Status Tests', array['tl-ev3'], 'ST');
grant select on t3 to authenticated;
set local role authenticated;
select public.place_wagers((select id from t3), pg_temp.single(1000, 'tl-ev3', 'Houston Texans'));
reset role;

select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t3)), 'open',
  'before lock time: stays open');
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t3);
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t3)), 'locked',
  'locks once lock time passes');
update public.events set commence_time = now() - interval '1 minute' where id = 'tl-ev3';
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t3)), 'live',
  'goes live once the first game starts');
update public.events set status = 'final' where id = 'tl-ev3';
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t3)), 'live',
  'stays live while any wager is ungraded');
update public.wagers set status = 'won', settled_at = now() where tournament_id = (select id from t3);
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t3)), 'settled',
  'settles once every game is final and every wager graded');
select is((select count(*)::int from cron.job where jobname = 'advance-statuses'), 1, 'the status machine is scheduled');

-- A game moved earlier must not touch a lock that already passed (cron may not have flipped the
-- status yet); otherwise the lock guard would make the odds ingest fail.
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temp table t4 as select * from public.create_tournament('Passed Lock', array['tl-ev4'], 'PL');
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t4);
select lives_ok($$ update public.events set commence_time = now() - interval '1 hour' where id = 'tl-ev4' $$,
  'a game moving earlier does not error on a passed lock');
select is((select lock_time from public.tournaments where id = (select id from t4)), now() - interval '1 second',
  'and the passed lock is left alone');

-- ---------- DB clock for client countdowns ----------
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select public.server_now(t) from public.tournaments t where t.id = (select id from t_solo)), now(),
  'server_now exposes the DB clock (countdowns never trust the phone''s clock)');
reset role;

select * from finish();
rollback;
