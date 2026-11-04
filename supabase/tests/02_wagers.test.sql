-- Phase 2: odds ingest + slip RPCs + BLIND wagers. Users: A (host), B (joins), C (outsider).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'wa@test.dev', false, '{"display_name":"Ann"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Ben"}'),
  ('cccccccc-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', null, true, '{"display_name":"Cy"}');

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('tw-ev1', 'americanfootball_nfl', 'Kansas City Chiefs', 'Buffalo Bills', now() + interval '2 days'),
  ('tw-ev2', 'americanfootball_nfl', 'Philadelphia Eagles', 'Dallas Cowboys', now() + interval '3 days'),
  ('tw-ev3', 'americanfootball_nfl', 'Detroit Lions', 'Green Bay Packers', now() + interval '2 days');

-- Builders for slip JSON (current price/line unless overridden).
create function pg_temp.leg(p_event text, p_market text, p_outcome text,
                            p_price int default null, p_point numeric default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('odds_id', c.id,
                            'price_american', coalesce(p_price, c.price_american),
                            'point', coalesce(p_point, c.point))
  from public.odds_cache c
  where c.event_id = p_event and c.market_key = p_market and c.outcome_name = p_outcome;
$$;
create function pg_temp.wager(p_amount bigint, variadic p_legs jsonb[])
returns jsonb language sql immutable as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs', to_jsonb(p_legs));
$$;

-- ---------- odds ingest (service path) ----------
create temp table ingest_payload as select
  '[{"event_id":"tw-ev1","market_key":"h2h","outcome_name":"Kansas City Chiefs","price_american":-150,"bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"h2h","outcome_name":"Buffalo Bills","price_american":130,"bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"spreads","outcome_name":"Kansas City Chiefs","point":-3.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"spreads","outcome_name":"Buffalo Bills","point":3.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"totals","outcome_name":"Over","point":47.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"totals","outcome_name":"Under","point":47.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev2","market_key":"h2h","outcome_name":"Philadelphia Eagles","price_american":-200,"bookmaker":"dk"},
    {"event_id":"tw-ev2","market_key":"h2h","outcome_name":"Dallas Cowboys","price_american":170,"bookmaker":"dk"},
    {"event_id":"tw-ev2","market_key":"spreads","outcome_name":"Philadelphia Eagles","point":-5.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev2","market_key":"spreads","outcome_name":"Dallas Cowboys","point":5.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev3","market_key":"h2h","outcome_name":"Detroit Lions","price_american":-110,"bookmaker":"dk"},
    {"event_id":"tw-ev3","market_key":"h2h","outcome_name":"Green Bay Packers","price_american":-110,"bookmaker":"dk"}]'::jsonb as outcomes,
  '[{"event_id":"tw-ev1","market_key":"h2h","bookmaker":"dk"},{"event_id":"tw-ev1","market_key":"spreads","bookmaker":"dk"},
    {"event_id":"tw-ev1","market_key":"totals","bookmaker":"dk"},{"event_id":"tw-ev2","market_key":"h2h","bookmaker":"dk"},
    {"event_id":"tw-ev2","market_key":"spreads","bookmaker":"dk"},{"event_id":"tw-ev3","market_key":"h2h","bookmaker":"dk"}]'::jsonb as markets;

select is((public.odds_sync_ingest('odds', 'americanfootball_nfl', now(), '[]',
           (select outcomes from ingest_payload), (select markets from ingest_payload)) ->> 'outcomes_changed')::int,
  12, 'first ingest inserts every outcome');
select is((public.odds_sync_ingest('odds', 'americanfootball_nfl', now() + interval '1 minute', '[]',
           (select outcomes from ingest_payload), (select markets from ingest_payload)) ->> 'outcomes_changed')::int,
  0, 're-ingesting identical prices changes nothing (no Realtime noise)');
select is((select updated_at from public.odds_cache where event_id = 'tw-ev1' and market_key = 'h2h'
           and outcome_name = 'Kansas City Chiefs'), now(), 'unchanged price keeps its updated_at');
select is((select last_seen_at from public.odds_markets where event_id = 'tw-ev1' and market_key = 'h2h'),
  now() + interval '1 minute', 'market freshness still advances');
select is((public.odds_sync_ingest('odds', 'americanfootball_nfl', now(), '[]',
           '[{"event_id":"tw-ev3","market_key":"h2h","outcome_name":"Detroit Lions","price_american":-115,"bookmaker":"dk"}]',
           '[]') ->> 'outcomes_changed')::int,
  1, 'a moved price is written');
select is((select price_decimal from public.odds_cache where event_id = 'tw-ev1' and market_key = 'spreads'
           and outcome_name = 'Kansas City Chiefs'), 1.9091::numeric, 'decimal derived in SQL (-110 → 1.9091)');

-- ---------- A creates a tournament (spreads + moneyline only, $50 max bet, 2-leg parlays) ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
create temp table t_created as
  select * from public.create_tournament('Wager Tests', array['tw-ev1', 'tw-ev2'], 'WT', null, 10000, 5000,
    '{"markets":["h2h","spreads"],"parlays":true,"max_parlay_legs":2,"same_game_parlays":false}'::jsonb);
grant select on t_created to anon, authenticated;

set local role authenticated;
select throws_ok($$ select public.odds_sync_ingest('odds', 'x', now()) $$, '42501', null,
  'players cannot call the ingest RPC');
select ok((select not is_stale from public.odds_board where event_id = 'tw-ev1' and market_key = 'h2h' limit 1),
  'fresh market is not stale on the board');

-- Single: $10 on Chiefs ML -150 → returns floor(1000 × 1.6667) = 1666
select is((select potential_payout_cents from public.place_wagers((select id from t_created), jsonb_build_array(
           pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'h2h', 'Kansas City Chiefs'))))), 1666::bigint,
  'single priced from the server-side odds');
select is((select remaining_bankroll_cents from public.tournament_participants
           where tournament_id = (select id from t_created) and user_id = auth.uid()), 9000::bigint,
  'stake debited from bankroll');

-- Parlay: Chiefs -3.5 (1.9091) × Eagles ML (1.5) = 2.86365 → 2.8637 → $28.63 return, +186
-- (placed as postgres with A's claims so the temp table doesn't need TEMP privilege for players)
reset role;
create temp table parlay as
  select * from public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'spreads', 'Kansas City Chiefs'),
                        pg_temp.leg('tw-ev2', 'h2h', 'Philadelphia Eagles'))));
grant select on parlay to authenticated;
set local role authenticated;
select is((select wager_type::text from parlay), 'parlay', 'two legs book as a parlay');
select is((select odds_decimal from parlay), 2.8637::numeric, 'parlay decimal rounded half up to 4dp');
select is((select potential_payout_cents from parlay), 2863::bigint, 'parlay payout floors to the cent');
select is((select odds_american from parlay), 186, 'parlay American price derived from decimal');
select is((select count(*)::int from public.wager_legs where wager_id = (select id from parlay)), 2,
  'legs stored');
select is((select line from public.wager_legs where wager_id = (select id from parlay) and market_key = 'spreads'),
  -3.5::numeric, 'leg records the line at time of bet');

-- Rejections (bankroll must not move on any of them)
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(500, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills')),
    pg_temp.wager(500, pg_temp.leg('tw-ev1', 'totals', 'Over')))) $$,
  'MARKET_NOT_ALLOWED', 'host-disallowed market rejected');
select is((select remaining_bankroll_cents from public.tournament_participants
           where tournament_id = (select id from t_created) and user_id = auth.uid()), 8000::bigint,
  'slip is all-or-nothing: the valid single in a failed slip was not booked');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'h2h', 'Kansas City Chiefs', -140)))) $$,
  'ODDS_CHANGED', 'stale client price → ODDS_CHANGED');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'spreads', 'Kansas City Chiefs', null, -2.5)))) $$,
  'ODDS_CHANGED', 'moved line → ODDS_CHANGED');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(6000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills')))) $$,
  'OVER_MAX_BET', 'max bet enforced');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(50, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills')))) $$,
  'INVALID_AMOUNT', 'minimum $1 stake');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills'),
                        pg_temp.leg('tw-ev1', 'spreads', 'Buffalo Bills')))) $$,
  'SAME_EVENT_PARLAY', 'one leg per game in a parlay when the host turned same-game parlays off');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills'),
                        pg_temp.leg('tw-ev2', 'h2h', 'Dallas Cowboys'),
                        pg_temp.leg('tw-ev2', 'spreads', 'Dallas Cowboys')))) $$,
  'TOO_MANY_LEGS', 'host leg limit enforced');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev3', 'h2h', 'Detroit Lions')))) $$,
  'INVALID_SELECTION', 'games outside the tournament rejected');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(5000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills')),
    pg_temp.wager(5000, pg_temp.leg('tw-ev2', 'h2h', 'Dallas Cowboys')))) $$,
  'INSUFFICIENT_BANKROLL', 'total slip stake cannot exceed bankroll');
select throws_ok($$ select public.place_wagers((select id from t_created), '[]'::jsonb) $$,
  'INVALID_SLIP', 'empty slip rejected');

reset role;
update public.odds_markets set last_seen_at = now() - interval '20 hours'
 where event_id = 'tw-ev2' and market_key = 'h2h';
set local role authenticated;
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev2', 'h2h', 'Dallas Cowboys')))) $$,
  'ODDS_STALE', 'prices older than the refresh window are not bookable');
select ok((select is_stale from public.odds_board where event_id = 'tw-ev2' and market_key = 'h2h' limit 1),
  'board flags the stale market');

reset role;
update public.odds_markets set last_seen_at = now() where event_id = 'tw-ev2' and market_key = 'h2h';
update public.events set status = 'postponed' where id = 'tw-ev2';
set local role authenticated;
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev2', 'h2h', 'Dallas Cowboys')))) $$,
  'EVENT_STARTED', 'no bets on games that are not scheduled');
reset role;
update public.events set status = 'scheduled' where id = 'tw-ev2';
set local role authenticated;

-- Direct writes are impossible
select throws_ok($$ insert into public.wagers (tournament_id, participant_id, wager_type, amount_cents,
                    odds_american, odds_decimal, potential_payout_cents)
                    select id, id, 'single', 1, 100, 2, 2 from t_created $$,
  '42501', null, 'no direct insert into wagers');
select throws_ok($$ update public.wagers set potential_payout_cents = 999999 $$,
  '42501', null, 'no direct update of wagers');

-- ---------- BLIND before lock ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format('select public.join_tournament(%L)', (select code from t_created)), 'B joins');
select is((select count(*)::int from public.wagers where tournament_id = (select id from t_created)), 0,
  'pre-lock: B sees none of A''s wagers');
select is((select count(*)::int from public.wager_legs where tournament_id = (select id from t_created)), 0,
  'pre-lock: B sees none of A''s legs');
select is((select bool_and(has_submitted = (display_name = 'Ann'))
           from public.get_roster((select id from t_created))), true,
  'roster shows who has submitted (A) without revealing picks');
select is((select count(*)::int from public.place_wagers((select id from t_created), jsonb_build_array(
           pg_temp.wager(1000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills'))))), 1, 'B places a bet');
select is((select count(*)::int from public.wagers where tournament_id = (select id from t_created)), 1,
  'pre-lock: B sees only their own wager');
select throws_ok($$ select public.cancel_wager((select id from parlay)) $$,
  'WAGER_NOT_FOUND', 'B cannot cancel A''s wager');

reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.wagers), 0, 'outsider sees no wagers');

-- ---------- A: cancel + atomic replace ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.wagers where tournament_id = (select id from t_created)), 2,
  'A sees own wagers');
select lives_ok($$ select public.cancel_wager((select w.id from public.wagers w
                   where w.tournament_id = (select id from t_created) and w.wager_type = 'single')) $$,
  'A cancels the single');
select is((select remaining_bankroll_cents::int || '/' || total_potential_payout_cents::int
           from public.tournament_participants
           where tournament_id = (select id from t_created) and user_id = auth.uid()),
  '9000/2863', 'cancel refunds stake and removes potential payout');
select throws_ok($$ select public.replace_wager((select id from parlay), jsonb_build_array(
    pg_temp.wager(2000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills', 150)))) $$,
  'ODDS_CHANGED', 'replace with a moved price fails...');
select is((select count(*)::int from public.wagers where id = (select id from parlay)), 1,
  '...and the original bet survives (atomic)');
select is((select count(*)::int from public.replace_wager((select id from parlay), jsonb_build_array(
           pg_temp.wager(2000, pg_temp.leg('tw-ev1', 'h2h', 'Buffalo Bills'))))), 1,
  'replace succeeds at current price');
select is((select remaining_bankroll_cents from public.tournament_participants
           where tournament_id = (select id from t_created) and user_id = auth.uid()), 8000::bigint,
  'replace: +$10 refund, -$20 new stake');

-- ---------- game moved earlier pulls the lock forward ----------
reset role;
update public.events set commence_time = now() + interval '1 day' where id = 'tw-ev1';
select is((select lock_time from public.tournaments where id = (select id from t_created)),
  now() + interval '1 day', 'lock follows a game moved earlier');

-- ---------- lock passes: reveal ----------
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t_created);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.wagers where tournament_id = (select id from t_created)), 2,
  'post-lock: B sees everyone''s wagers');
select ok((select count(*) from public.wager_legs where tournament_id = (select id from t_created)) >= 2,
  'post-lock: legs revealed too');
select throws_ok($$ select public.place_wagers((select id from t_created), jsonb_build_array(
    pg_temp.wager(1000, pg_temp.leg('tw-ev2', 'h2h', 'Dallas Cowboys')))) $$,
  'TOURNAMENT_LOCKED', 'no bets after lock');
select throws_ok($$ select public.cancel_wager((select w.id from public.wagers w
                   join public.tournament_participants p on p.id = w.participant_id
                   where p.user_id = auth.uid() limit 1)) $$,
  'TOURNAMENT_LOCKED', 'no cancels after lock');

reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.wagers), 0, 'outsider still sees nothing post-lock');

reset role;
select * from finish();
rollback;
