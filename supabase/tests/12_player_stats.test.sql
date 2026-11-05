-- Live player stats (NBA): odds-sync pulls box scores (free feed, no Odds API credits) for games in play
-- that someone bet props on. Stats are public sports data; each saved prop pick reads its player's number.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

delete from private.stats_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ps@test.dev', false, '{"display_name":"Ann"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('ps-g1', 'basketball_nba', 'Detroit Pistons', 'Philadelphia 76ers', now() + interval '2 days'),
  ('ps-g2', 'basketball_nba', 'Boston Celtics', 'Milwaukee Bucks', now() + interval '2 days');
select public.odds_sync_ingest('props', 'basketball_nba', now(), '[]',
  '[{"event_id":"ps-g1","market_key":"player_points","outcome_name":"Over","participant_name":"Joel Embiid","point":27.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"ps-g1","market_key":"player_points","outcome_name":"Under","participant_name":"Joel Embiid","point":27.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"ps-g1","market_key":"player_rebounds","outcome_name":"Over","participant_name":"Jalen Duren Jr.","point":9.5,"price_american":120,"bookmaker":"dk"},
    {"event_id":"ps-g2","market_key":"player_points","outcome_name":"Over","participant_name":"Jayson Tatum","point":27.5,"price_american":-110,"bookmaker":"dk"},
    {"event_id":"ps-g2","market_key":"player_points","outcome_name":"Under","participant_name":"Jayson Tatum","point":27.5,"price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"ps-g1","market_key":"player_points","bookmaker":"dk"},{"event_id":"ps-g1","market_key":"player_rebounds","bookmaker":"dk"},
    {"event_id":"ps-g2","market_key":"player_points","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.leg(p_event text, p_market text, p_outcome text, p_player text) returns jsonb
language sql stable as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
  from public.odds_cache c where c.event_id = p_event and c.market_key = p_market
   and c.outcome_name = p_outcome and c.participant_name = p_player;
$$;
create function pg_temp.slip(p_amount bigint, p_leg jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(p_leg)));
$$;
create function pg_temp.job(p_event text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(private.odds_sync_due_jobs()) j
  where j ->> 'kind' = 'stats' and j ->> 'event_id' = p_event;
$$;
create function pg_temp.leg_stat(p_player text) returns numeric language sql stable as $$
  select public.live_stat(l) from public.wager_legs l where l.participant_name = p_player limit 1;
$$;

-- Ann: props on both games; picks on Embiid points and Duren rebounds (ps-g1). ps-g2 gets no prop pick.
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Stats', array['ps-g1', 'ps-g2'], 'ST', null, 10000, null,
  '{"markets":["h2h"],"player_props":true}'::jsonb);
select public.place_wagers((select id from t1), pg_temp.slip(1000, pg_temp.leg('ps-g1', 'player_points', 'Over', 'Joel Embiid')));
select public.place_wagers((select id from t1),
  pg_temp.slip(1000, pg_temp.leg('ps-g1', 'player_rebounds', 'Over', 'Jalen Duren Jr.')));
reset role;

-- ---------- due: only games in play, with a prop pick ----------
select ok(pg_temp.job('ps-g1') is null, 'before tip-off: no stats sync');

update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t1);
update public.events set commence_time = now() - interval '30 minutes' where id in ('ps-g1', 'ps-g2');
select private.advance_statuses();

select is(pg_temp.job('ps-g1') - 'commence_time',
  '{"kind":"stats","sport_key":"basketball_nba","event_id":"ps-g1","home_team":"Detroit Pistons",
    "away_team":"Philadelphia 76ers","provider_id":null}'::jsonb,
  'game in play with a prop pick: a stats job with the teams to find it by');
select ok(pg_temp.job('ps-g2') is null, 'a game nobody bet a prop on is not synced');

-- ---------- ingest: service role only ----------
set local role authenticated;
select throws_ok($$select public.stats_ingest('ps-g1', '401', false, '[]')$$, '42501', null, 'players can''t write stats');
reset role;

select is(public.stats_ingest('ps-g1', '401909922', false, '[
  {"name":"Joel Embiid","team":"Philadelphia 76ers","market_key":"player_points","stat":8},
  {"name":"Joel Embiid","team":"Philadelphia 76ers","market_key":"player_rebounds","stat":5},
  {"name":"Jalen Duren","team":"Detroit Pistons","market_key":"player_rebounds","stat":4}]') ->> 'changed', '3',
  'box score stored');
select ok(pg_temp.job('ps-g1') is null, 'just synced: not due again within the minute');
update private.stats_sync_state set last_sync_at = now() - interval '2 minutes' where event_id = 'ps-g1';
select is(pg_temp.job('ps-g1') ->> 'provider_id', '401909922', 'next sync goes straight to the matched game');

-- ---------- each saved pick reads its player's number ----------
select is(pg_temp.leg_stat('Joel Embiid'), 8::numeric, 'Embiid''s points pick shows his 8 points');
select is(pg_temp.leg_stat('Jalen Duren Jr.'), 4::numeric, 'a Jr. suffix doesn''t matter');
select is(private.player_stat('ps-g1', 'player_points_alternate', 'Joel Embiid'), 8::numeric, 'a ladder pick reads its base stat');

select is(public.stats_ingest('ps-g1', '401909922', false, '[
  {"name":"Joel Embiid","team":"Philadelphia 76ers","market_key":"player_points","stat":12},
  {"name":"Joel Embiid","team":"Philadelphia 76ers","market_key":"player_rebounds","stat":5},
  {"name":"Jalen Duren","team":"Detroit Pistons","market_key":"player_rebounds","stat":4}]') ->> 'changed', '1',
  'only real changes count (and only they signal the squad)');
select is(pg_temp.leg_stat('Joel Embiid'), 12::numeric, 'the number updates as he scores');

-- ---------- anyone signed in can read stats (public sports data, no picks in it) ----------
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is((select count(*)::int from public.player_stats where event_id = 'ps-g1'), 3, 'players read the box score');
select throws_ok($$delete from public.player_stats$$, '42501', null, 'players can''t change stats');
reset role;

-- ---------- final: stop syncing ----------
update private.stats_sync_state set last_sync_at = now() - interval '2 minutes' where event_id = 'ps-g1';
select public.stats_ingest('ps-g1', '401909922', true, '[
  {"name":"Joel Embiid","team":"Philadelphia 76ers","market_key":"player_points","stat":31}]');
update private.stats_sync_state set last_sync_at = now() - interval '2 minutes' where event_id = 'ps-g1';
select ok(pg_temp.job('ps-g1') is null, 'final box score: done syncing');
select is(pg_temp.leg_stat('Joel Embiid'), 31::numeric, 'the final number stays');
select is((select is_final from public.player_stats where event_id = 'ps-g1' and market_key = 'player_points'), true,
  'the final number is marked final');

select * from finish();
rollback;
