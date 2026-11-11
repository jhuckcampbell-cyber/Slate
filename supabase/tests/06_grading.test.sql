-- Phase 5: scores → grading → payouts → leaderboard → settlement, replayed end to end with
-- hand-computed expectations. Users: Ann (host), Ben, Cy. NFL, $100 bankrolls.
--   Ann: $20 KC ML -150 (returns 3333) + $10 Over 47.5 -110 (returns 1909)
--   Ben: $10 parlay BUF +3.5 / DET -3 / DAL ML +170 (9.8406 → 9840)
--   Cy:  $50 PHI -5.5 -110 (9545) + $50 GB ML -110 (9545)
-- Finals: KC 27-24 BUF, DET 20-17 GB (DET -3 pushes), DAL 28-21 PHI.
--   Ann 7000 + 3333 + 1909 = 12242 · Ben 9000 + floor(1000 × 5.1546) = 14154 · Cy 0 (busted)
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);
set local check_function_bodies = off;  -- helpers below reference temp tables created later

delete from private.odds_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ga@test.dev', false, '{"display_name":"Ann"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Ben"}'),
  ('c0000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', null, true, '{"display_name":"Cy"}');

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('gr-g1', 'americanfootball_nfl', 'Kansas City Chiefs', 'Buffalo Bills', now() + interval '2 days'),
  ('gr-g2', 'americanfootball_nfl', 'Philadelphia Eagles', 'Dallas Cowboys', now() + interval '2 days'),
  ('gr-g3', 'americanfootball_nfl', 'Detroit Lions', 'Green Bay Packers', now() + interval '2 days'),
  ('gr-g4', 'americanfootball_nfl', 'Seattle Seahawks', 'Los Angeles Rams', now() + interval '2 days');

select public.odds_sync_ingest('odds', 'americanfootball_nfl', now(), '[]',
  '[{"event_id":"gr-g1","market_key":"h2h","outcome_name":"Kansas City Chiefs","price_american":-150,"bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"h2h","outcome_name":"Buffalo Bills","price_american":130,"bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"spreads","outcome_name":"Kansas City Chiefs","point":-3.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"spreads","outcome_name":"Buffalo Bills","point":3.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"totals","outcome_name":"Over","point":47.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"totals","outcome_name":"Under","point":47.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g2","market_key":"h2h","outcome_name":"Philadelphia Eagles","price_american":-200,"bookmaker":"dk"},
    {"event_id":"gr-g2","market_key":"h2h","outcome_name":"Dallas Cowboys","price_american":170,"bookmaker":"dk"},
    {"event_id":"gr-g2","market_key":"spreads","outcome_name":"Philadelphia Eagles","point":-5.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g2","market_key":"spreads","outcome_name":"Dallas Cowboys","point":5.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g3","market_key":"h2h","outcome_name":"Detroit Lions","price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g3","market_key":"h2h","outcome_name":"Green Bay Packers","price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g3","market_key":"spreads","outcome_name":"Detroit Lions","point":-3,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g3","market_key":"spreads","outcome_name":"Green Bay Packers","point":3,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g4","market_key":"h2h","outcome_name":"Seattle Seahawks","price_american":-110,"bookmaker":"dk"},
    {"event_id":"gr-g4","market_key":"h2h","outcome_name":"Los Angeles Rams","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"gr-g1","market_key":"h2h","bookmaker":"dk"},{"event_id":"gr-g1","market_key":"spreads","bookmaker":"dk"},
    {"event_id":"gr-g1","market_key":"totals","bookmaker":"dk"},{"event_id":"gr-g2","market_key":"h2h","bookmaker":"dk"},
    {"event_id":"gr-g2","market_key":"spreads","bookmaker":"dk"},{"event_id":"gr-g3","market_key":"h2h","bookmaker":"dk"},
    {"event_id":"gr-g3","market_key":"spreads","bookmaker":"dk"},{"event_id":"gr-g4","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.leg(p_event text, p_market text, p_outcome text) returns jsonb language sql stable as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
  from public.odds_cache c where c.event_id = p_event and c.market_key = p_market and c.outcome_name = p_outcome;
$$;
create function pg_temp.wager(p_amount bigint, variadic p_legs jsonb[]) returns jsonb language sql immutable as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs', to_jsonb(p_legs));
$$;
create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.cash(p_name text, p_tid uuid default null) returns bigint language sql as $$
  select p.remaining_bankroll_cents from public.tournament_participants p
  join public.profiles pr on pr.id = p.user_id
  where pr.display_name = p_name and p.tournament_id = coalesce(p_tid, (select id from t1));
$$;
-- Wagers placed in one transaction share created_at, so same-stake bets are told apart by pick.
create function pg_temp.wager_of(p_name text, p_amount bigint, p_selection text default null)
returns public.wagers language sql as $$
  select w.* from public.wagers w
  join public.tournament_participants p on p.id = w.participant_id
  join public.profiles pr on pr.id = p.user_id
  where pr.display_name = p_name and w.amount_cents = p_amount and w.tournament_id = (select id from t1)
    and (p_selection is null
         or exists (select 1 from public.wager_legs l where l.wager_id = w.id and l.selection = p_selection))
  order by w.created_at limit 1;
$$;

-- ---------- tournament + bets (before lock) ----------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Grading Test', array['gr-g1','gr-g2','gr-g3'], 'GT');
create temp table t2 as select * from public.create_tournament('Void Test', array['gr-g4'], 'VT');
grant select on t1, t2 to authenticated;
select public.place_wagers((select id from t1), jsonb_build_array(
  pg_temp.wager(2000, pg_temp.leg('gr-g1', 'h2h', 'Kansas City Chiefs')),
  pg_temp.wager(1000, pg_temp.leg('gr-g1', 'totals', 'Over'))));
select public.place_wagers((select id from t2), jsonb_build_array(pg_temp.wager(1000, pg_temp.leg('gr-g4', 'h2h', 'Seattle Seahawks'))));

select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t1));
select public.place_wagers((select id from t1), jsonb_build_array(pg_temp.wager(1000,
  pg_temp.leg('gr-g1', 'spreads', 'Buffalo Bills'), pg_temp.leg('gr-g3', 'spreads', 'Detroit Lions'),
  pg_temp.leg('gr-g2', 'h2h', 'Dallas Cowboys'))));

select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select public.join_tournament((select code from t1));
select public.place_wagers((select id from t1), jsonb_build_array(
  pg_temp.wager(5000, pg_temp.leg('gr-g2', 'spreads', 'Philadelphia Eagles')),
  pg_temp.wager(5000, pg_temp.leg('gr-g3', 'h2h', 'Green Bay Packers'))));

-- ---------- the leaderboard is blind before lock (rule 1) ----------
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.leaderboard where tournament_id = (select id from t1)), 1,
  'before lock a player sees only their own leaderboard row');
select is((select display_name from public.leaderboard where tournament_id = (select id from t1)), 'Ben',
  '...and it is theirs');
select throws_ok($$ select public.scores_ingest('americanfootball_nfl', now(), '[]') $$, '42501', null,
  'players cannot ingest scores');
reset role;

-- ---------- lock, kick off ----------
update public.tournaments set lock_time = now() - interval '1 second' where id in ((select id from t1), (select id from t2));
update public.events set commence_time = now() - interval '4 hours' where id in ('gr-g1', 'gr-g3');
update public.events set commence_time = now() - interval '95 minutes' where id = 'gr-g2';  -- NFL halftime (190-min model)
select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t1)), 'live', 'kickoff moves the tournament to live');

-- ---------- win probability (hand-computed) ----------
select is(round(private.norm_cdf(0)::numeric, 4), 0.5000, 'Φ(0) = 0.5');
select is(round(private.norm_cdf(1)::numeric, 4), 0.8413, 'Φ(1) = 0.8413');
select is(round(private.norm_cdf(-1.96)::numeric, 4), 0.0250, 'Φ(-1.96) = 0.0250');
select is(round(public.live_probability(pg_temp.wager_of('Ann', 2000))::numeric, 4), 0.5798,
  'no score yet: KC ML = de-vigged closing price (0.6 / 1.0348)');

-- ---------- scores: two finals and a game at halftime ----------
select is((public.scores_ingest('americanfootball_nfl', now(),
  '[{"event_id":"gr-g1","completed":true,"home_score":27,"away_score":24},
    {"event_id":"gr-g3","completed":true,"home_score":20,"away_score":17},
    {"event_id":"gr-g2","completed":false,"home_score":7,"away_score":14}]') ->> 'events_updated')::int,
  3, 'scores ingest updates three events');
select is((select (status, home_score, away_score) from public.events where id = 'gr-g2'),
  row('live'::text, 7, 14), 'an unfinished game with a score is live');
select is((select status from public.events where id = 'gr-g1'), 'final', 'a completed game is final');

select is((select status::text from public.wager_legs where wager_id = (pg_temp.wager_of('Ann', 2000)).id), 'hit', 'KC ML hits');
select is((pg_temp.wager_of('Ann', 2000)).status::text, 'won', 'Ann''s KC single is won');
select is((pg_temp.wager_of('Ann', 2000)).payout_cents, 3333::bigint, '...paying floor(2000 × 1.6667)');
select is((pg_temp.wager_of('Ann', 1000)).payout_cents, 1909::bigint, 'Over 47.5 hits on 51 points');
select is(pg_temp.cash('Ann'), 12242::bigint, 'Ann is credited both returns: 7000 + 3333 + 1909');
select is((select total_potential_payout_cents from public.tournament_participants p join public.profiles pr on pr.id = p.user_id
           where pr.display_name = 'Ann' and p.tournament_id = (select id from t1)), 0::bigint,
  'settled wagers leave potential payout');

select is((select array_agg(l.status::text order by l.market_key, l.selection) from public.wager_legs l
           where l.wager_id = (pg_temp.wager_of('Ben', 1000)).id),
  array['pending', 'hit', 'push'], 'Ben''s parlay: DAL pending, BUF +3.5 hits (lost by 3), DET -3 pushes (won by 3)');
select is((pg_temp.wager_of('Ben', 1000)).status::text, 'pending', 'a parlay with a pending leg stays pending');
select is(public.current_payout(pg_temp.wager_of('Ben', 1000)), 5154::bigint,
  'the pushed leg drops out of the price: floor(1000 × round(1.9091 × 2.7, 4))');

select is((pg_temp.wager_of('Cy', 5000, 'Philadelphia Eagles')).status::text, 'pending', 'Cy''s PHI -5.5 is still live');
select is((select w.status::text from public.wagers w join public.wager_legs l on l.wager_id = w.id
           where l.selection = 'Green Bay Packers' and w.tournament_id = (select id from t1)), 'lost', 'GB ML loses');

select is(round(public.live_probability(pg_temp.wager_of('Ben', 1000))::numeric, 4), 0.6719,
  'halftime, DAL up 7, PHI -5.5 line: P(DAL wins) = Φ(4.25 / 9.546)');
select is(round(public.live_probability(pg_temp.wager_of('Cy', 5000, 'Philadelphia Eagles'))::numeric, 4), 0.1535,
  'P(PHI covers -5.5) = Φ(-9.75 / 9.546)');
select is((select round(public.live_probability(l)::numeric, 4) from public.wager_legs l where l.wager_id = (pg_temp.wager_of('Ben', 1000)).id
           and l.selection = 'Buffalo Bills'), 1.0000, 'a hit leg counts as certain');

-- ---------- live leaderboard (as Ben, after lock) ----------
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.leaderboard where tournament_id = (select id from t1)), 3,
  'after lock everyone is on the board');
select is((select (cash_cents, max_cents) from public.leaderboard where display_name = 'Ben' and tournament_id = (select id from t1)),
  row(9000::bigint, 14154::bigint), 'Ben: $90 cash, max = cash + parlay return');
select is((select ev_cents from public.leaderboard where display_name = 'Ben' and tournament_id = (select id from t1)),
  9000 + round(0.6719179 * 5154)::bigint, 'EV = cash + P(cash) × return');
select is((select standing from public.leaderboard where display_name = 'Cy' and tournament_id = (select id from t1)),
  'eliminated', 'Cy can win at most $95.45, less than Ann already has: eliminated');
select is((select standing from public.leaderboard where display_name = 'Ben' and tournament_id = (select id from t1)),
  'alive', 'Ben can still catch Ann: alive');
select is((select array_agg(display_name order by rank) from public.leaderboard where tournament_id = (select id from t1)),
  array['Ben', 'Ann', 'Cy'], 'ranked by projected value: Ben 9000 + 3463 > Ann 12242 > Cy');
reset role;

-- ---------- final ----------
select public.scores_ingest('americanfootball_nfl', now(),
  '[{"event_id":"gr-g2","completed":true,"home_score":21,"away_score":28}]');
select is((pg_temp.wager_of('Ben', 1000)).status::text, 'won', 'Ben''s parlay cashes');
select is((pg_temp.wager_of('Ben', 1000)).payout_cents, 5154::bigint, '...at the push-adjusted price');
select is(pg_temp.cash('Ben'), 14154::bigint, 'Ben: 9000 + 5154');
select is(pg_temp.cash('Cy'), 0::bigint, 'Cy loses both');

select public.scores_ingest('americanfootball_nfl', now(),
  '[{"event_id":"gr-g2","completed":true,"home_score":21,"away_score":28}]');
select is(pg_temp.cash('Ben'), 14154::bigint, 're-ingesting a final never pays twice');

select ok(exists (select 1 from realtime.messages m where m.topic = 'tournament:' || (select id from t1) and m.event = 'scores'),
  'score changes signal the tournament channel');

select private.advance_statuses();
select is((select status::text from public.tournaments where id = (select id from t1)), 'settled',
  'all games final and every wager graded: settled');

select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
set local role authenticated;
select is((select array_agg(display_name order by rank) from public.leaderboard where tournament_id = (select id from t1)),
  array['Ben', 'Ann', 'Cy'], 'final standings: Ben, Ann, Cy');
select is((select standing from public.leaderboard where display_name = 'Cy' and tournament_id = (select id from t1)),
  'busted', 'nothing left and nothing pending: busted');
select is((select (cash_cents, ev_cents, max_cents) from public.leaderboard where display_name = 'Ben' and tournament_id = (select id from t1)),
  row(14154::bigint, 14154::bigint, 14154::bigint), 'when settled, cash = EV = max');
reset role;

-- ---------- a feed outage stays pending for operator review ----------
update public.events set commence_time = now() - interval '13 hours' where id = 'gr-g4';
select private.advance_statuses();  -- open → locked → live
select private.advance_statuses();  -- no refund without explicit cancellation
select is((select w.status::text from public.wagers w where w.tournament_id = (select id from t2)), 'pending',
  'no final 12h after kickoff: the bet stays pending');
select is(pg_temp.cash('Ann', (select id from t2)), 9000::bigint, '...and the stake is not refunded');
select is((select status::text from public.tournaments where id = (select id from t2)), 'live', '...and the tournament waits for a final');

select * from finish();
rollback;
