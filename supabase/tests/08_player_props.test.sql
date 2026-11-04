-- Player props: opt-in per tournament, per-game odds sync, host-entered stats grade every leg on
-- that line (results public), ungraded props refund 48h after kickoff.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
set local check_function_bodies = off;

delete from private.odds_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'pp@test.dev', false, '{"display_name":"Ann"}'),
  ('b2000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Ben"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('pp-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days'),
  ('pp-g2', 'basketball_nba', 'Denver Nuggets', 'Los Angeles Lakers', now() + interval '2 days');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.leg(p_event text, p_market text, p_outcome text, p_player text default '') returns jsonb
language sql stable as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
  from public.odds_cache c where c.event_id = p_event and c.market_key = p_market
   and c.outcome_name = p_outcome and c.participant_name = p_player;
$$;
create function pg_temp.slip(p_amount bigint, p_leg jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(p_leg)));
$$;
create function pg_temp.prop_wager(p_player text, p_outcome text, p_market text default 'player_points')
returns public.wagers language sql as $$
  select w.* from public.wagers w join public.wager_legs l on l.wager_id = w.id
  where l.participant_name = p_player and l.selection = p_outcome and l.market_key = p_market
    and w.tournament_id = (select id from tp);
$$;
create function pg_temp.cash(p_name text) returns bigint language sql as $$
  select p.remaining_bankroll_cents from public.tournament_participants p join public.profiles pr on pr.id = p.user_id
  where pr.display_name = p_name and p.tournament_id = (select id from tp);
$$;

-- ---------- catalog ----------
select is(private.prop_markets('basketball_nba'), array['player_points', 'player_rebounds', 'player_assists'],
  'NBA props: points, rebounds, assists');
select ok(private.prop_markets('americanfootball_nfl') @> array['player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
  'NFL props include passing, rushing, receiving yards (alternates + TDs: 09_alt_props)');
select is(private.prop_markets('icehockey_nhl'), '{}'::text[], 'no props for other sports');

-- ---------- tournaments: props on (pp-g1) and off (pp-g2) ----------
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
create temp table tp as select * from public.create_tournament('Props On', array['pp-g1'], 'PO', null, 10000, null,
  '{"markets":["h2h"],"player_props":true}'::jsonb);
create temp table tn as select * from public.create_tournament('Props Off', array['pp-g2'], 'PF', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);
grant select on tp, tn to authenticated;

-- ---------- due jobs ----------
create function pg_temp.job(p_kind text, p_event text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(private.odds_sync_due_jobs()) j
  where j ->> 'kind' = p_kind and (j ->> 'event_id' = p_event or j -> 'event_ids' ? p_event);
$$;
select is(pg_temp.job('props', 'pp-g1') -> 'markets', '["player_points", "player_rebounds", "player_assists"]'::jsonb,
  'a props tournament makes its game due for a props sync, with the sport''s prop markets');
select ok(pg_temp.job('props', 'pp-g2') is null, 'no props sync for a game whose tournaments have props off');
select is(pg_temp.job('odds', 'pp-g1') -> 'markets', '["h2h"]'::jsonb, 'the sport-wide odds call never asks for props');

-- ---------- props ingest ----------
select is((public.odds_sync_ingest('props', 'basketball_nba', now(), '[]',
  '[{"event_id":"pp-g1","market_key":"player_points","outcome_name":"Over","participant_name":"Jayson Tatum","point":27.5,"price_american":-115,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_points","outcome_name":"Under","participant_name":"Jayson Tatum","point":27.5,"price_american":-105,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_rebounds","outcome_name":"Over","participant_name":"Jayson Tatum","point":8,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_rebounds","outcome_name":"Under","participant_name":"Jayson Tatum","point":8,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_assists","outcome_name":"Over","participant_name":"Jalen Brunson","point":7.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_assists","outcome_name":"Under","participant_name":"Jalen Brunson","point":7.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-150,"bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"h2h","outcome_name":"New York Knicks","price_american":130,"bookmaker":"dk"}]',
  '[{"event_id":"pp-g1","market_key":"player_points","bookmaker":"dk"},{"event_id":"pp-g1","market_key":"player_rebounds","bookmaker":"dk"},
    {"event_id":"pp-g1","market_key":"player_assists","bookmaker":"dk"},{"event_id":"pp-g1","market_key":"h2h","bookmaker":"dk"}]')
  ->> 'outcomes_changed')::int, 8, 'props ingest stores every player outcome');
select ok(pg_temp.job('props', 'pp-g1') is null, 'a synced game is not due again until its refresh tier');
select ok(not exists (select 1 from private.odds_sync_state s where s.sport_key = 'basketball_nba' and s.last_odds_sync_at is not null),
  'a props sync does not count as the sport''s game-line sync');

-- ---------- betting ----------
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
select throws_ok(format('select public.place_wagers(%L, %L)', (select id from tn),
  pg_temp.slip(1000, pg_temp.leg('pp-g1', 'player_points', 'Over', 'Jayson Tatum'))), 'P0001', 'INVALID_SELECTION',
  'a prop on a game outside the tournament is refused');
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('pp-g1', 'player_points', 'Over', 'Jayson Tatum'))), 'Ann bets Tatum over 27.5 points');
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('pp-g1', 'player_rebounds', 'Over', 'Jayson Tatum'))), 'Ann bets Tatum over 8 rebounds');
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('pp-g1', 'player_assists', 'Over', 'Jalen Brunson'))), 'Ann bets Brunson over 7.5 assists');

select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from tp));
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(2000, pg_temp.leg('pp-g1', 'player_points', 'Under', 'Jayson Tatum'))), 'Ben bets Tatum under');

-- Props off: a game-line market list without the flag refuses props.
update public.tournaments set allowed_bet_types = allowed_bet_types || '{"player_props":false}' where id = (select id from tp);
select throws_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('pp-g1', 'player_assists', 'Under', 'Jalen Brunson'))), 'P0001', 'MARKET_NOT_ALLOWED',
  'with props off, prop markets are not bettable');
update public.tournaments set allowed_bet_types = allowed_bet_types || '{"player_props":true}' where id = (select id from tp);

-- ---------- chance: de-vigged Over/Under pair ----------
select is(round(public.live_probability(pg_temp.prop_wager('Jayson Tatum', 'Over'))::numeric, 4), 0.5108,
  'pregame prop chance = de-vigged pair (-115 / -105)');

-- ---------- grading ----------
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from tp);
update public.events set commence_time = now() - interval '3 hours' where id = 'pp-g1';
select private.advance_statuses();

select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, 30)', (select id from tp), 'pp-g1', 'player_points', 'Jayson Tatum'),
  'P0001', 'GAME_NOT_FINAL', 'props wait for the final score');

select public.scores_ingest('basketball_nba', now(), '[{"event_id":"pp-g1","completed":true,"home_score":110,"away_score":101}]');

select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, 30)', (select id from tp), 'pp-g1', 'player_points', 'Jayson Tatum'),
  'P0001', 'NOT_HOST', 'only the host enters stats');

select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, -1)', (select id from tp), 'pp-g1', 'player_points', 'Jayson Tatum'),
  'P0001', 'INVALID_STAT', 'a stat cannot be negative');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, 30)', (select id from tp), 'pp-g1', 'player_steals', 'Jayson Tatum'),
  'P0001', 'NOTHING_TO_GRADE', 'only lines someone bet can be graded');

select lives_ok(format('select public.grade_prop(%L, %L, %L, %L, 30)', (select id from tp), 'pp-g1', 'player_points', 'Jayson Tatum'),
  'the host enters Tatum''s 30 points');
select is((pg_temp.prop_wager('Jayson Tatum', 'Over')).status::text, 'won', '30 > 27.5: the Over wins');
select is((pg_temp.prop_wager('Jayson Tatum', 'Over')).payout_cents, 1869::bigint, '...paying floor(1000 × 1.8696)');
select is((pg_temp.prop_wager('Jayson Tatum', 'Under')).status::text, 'lost', '...and the Under loses (same stat for everyone)');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, 20)', (select id from tp), 'pp-g1', 'player_points', 'Jayson Tatum'),
  'P0001', 'ALREADY_GRADED', 'a stat is entered once');

select public.grade_prop((select id from tp), 'pp-g1', 'player_rebounds', 'Jayson Tatum', 8);
select is((select w.status::text from public.wagers w join public.wager_legs l on l.wager_id = w.id
           where l.market_key = 'player_rebounds' and w.tournament_id = (select id from tp)), 'pushed',
  'stat exactly on a whole-number line pushes');

-- Results are public to the squad (the host can't quietly fudge them).
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select (stat, graded_by) from public.prop_results where participant_name = 'Jayson Tatum' and market_key = 'player_points'),
  row(30::numeric, 'a2000000-0000-0000-0000-00000000000a'::uuid), 'players see every entered stat and who entered it');
select throws_ok($$ insert into public.prop_results (tournament_id, event_id, market_key, participant_name, stat, graded_by)
  values ((select id from tp), 'pp-g1', 'player_assists', 'Jalen Brunson', 1, auth.uid()) $$, '42501', null,
  'nobody writes results directly');
reset role;

-- ---------- the tournament waits for ungraded props, then refunds them ----------
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from tp)), 'live',
  'an ungraded prop keeps the tournament open');
update public.events set commence_time = now() - interval '49 hours' where id = 'pp-g1';
select private.advance_statuses();
select is((select w.status::text from public.wagers w join public.wager_legs l on l.wager_id = w.id
           where l.market_key = 'player_assists' and w.tournament_id = (select id from tp)), 'pushed',
  'a prop still ungraded 48h after kickoff is refunded');
select is(pg_temp.cash('Ann'), (10000 - 3000 + 1869 + 1000 + 1000)::bigint, 'Ann: won points, refunded rebounds push and assists');
select is((select status::text from public.tournaments where id = (select id from tp)), 'settled', 'then it settles');

select * from finish();
rollback;
