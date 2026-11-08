-- Live football stats (migration 0023): NFL games in play with a prop pick get box-score syncs, yards can go
-- negative, yards spread with the line, and anytime TD follows the clock until he scores.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

delete from private.stats_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'nfl@test.dev', false, '{"display_name":"Nia"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('nf-g1', 'americanfootball_nfl', 'Seattle Seahawks', 'Chicago Bears', now() + interval '2 days');
select public.odds_sync_ingest('props', 'americanfootball_nfl', now(), '[]',
  '[{"event_id":"nf-g1","market_key":"player_rush_yds","outcome_name":"Over","participant_name":"D''Andre Swift","point":74.5,"price_american":-115,"bookmaker":"dk"},
    {"event_id":"nf-g1","market_key":"player_rush_yds","outcome_name":"Under","participant_name":"D''Andre Swift","point":74.5,"price_american":-115,"bookmaker":"dk"},
    {"event_id":"nf-g1","market_key":"player_anytime_td","outcome_name":"Yes","participant_name":"D''Andre Swift","price_american":100,"bookmaker":"dk"}]',
  '[{"event_id":"nf-g1","market_key":"player_rush_yds","bookmaker":"dk"},{"event_id":"nf-g1","market_key":"player_anytime_td","bookmaker":"dk"}]');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.job() returns jsonb language sql stable as $$
  select j from jsonb_array_elements(private.odds_sync_due_jobs()) j
  where j ->> 'kind' = 'stats' and j ->> 'event_id' = 'nf-g1';
$$;
create function pg_temp.chance(p_market text, p_selection text, p_line numeric, p_decimal numeric default 1.8696)
returns double precision language sql stable as $$
  select private.leg_probability(jsonb_populate_record(null::public.wager_legs, jsonb_build_object(
    'event_id', 'nf-g1', 'market_key', p_market, 'participant_name', 'D''Andre Swift', 'selection', p_selection,
    'line', p_line, 'status', 'pending', 'odds_decimal', p_decimal)));
$$;
create function pg_temp.box(p_yds int, p_tds int, p_remaining double precision, p_final boolean default false)
returns jsonb language sql as $$
  select public.stats_ingest('nf-g1', '401873036', p_final, jsonb_build_array(
    jsonb_build_object('name', 'D''Andre Swift', 'team', 'Chicago Bears', 'market_key', 'player_rush_yds', 'stat', p_yds),
    jsonb_build_object('name', 'D''Andre Swift', 'team', 'Chicago Bears', 'market_key', 'player_anytime_td', 'stat', p_tds),
    jsonb_build_object('name', 'Caleb Williams', 'team', 'Chicago Bears', 'market_key', 'player_rush_yds', 'stat', -4)),
    p_remaining);
$$;

-- Nia bets Swift's rushing Over.
select pg_temp.as_user('a6000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Sunday', array['nf-g1'], 'SU', null, 10000, null,
  '{"markets":["h2h"],"player_props":true}'::jsonb);
select public.place_wagers((select id from t1), jsonb_build_array(jsonb_build_object('amount_cents', 1000, 'legs',
  jsonb_build_array((select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
    from public.odds_cache c where c.event_id = 'nf-g1' and c.market_key = 'player_rush_yds' and c.outcome_name = 'Over')))));
reset role;

select ok(pg_temp.job() is null, 'before kickoff: no stats sync');
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t1);
update public.events set commence_time = now() - interval '40 minutes' where id = 'nf-g1';
select private.advance_statuses();
select is(pg_temp.job() ->> 'sport_key', 'americanfootball_nfl', 'a football game in play with a prop pick is synced');

-- ---------- box score ----------
select is(pg_temp.box(30, 0, 0.75) ->> 'changed', '3', 'football box score stored');
select is(private.player_stat('nf-g1', 'player_rush_yds', 'Caleb Williams'), -4::numeric, 'negative rushing yards are kept');
select is((select public.live_stat(l) from public.wager_legs l where l.participant_name = 'D''Andre Swift'), 30::numeric,
  'Swift''s rushing pick shows his 30 yards');

-- ---------- rushing yards: 74.5 at -115/-115 = 50% pregame ----------
select ok(pg_temp.chance('player_rush_yds', 'Over', 74.5) between 0.55 and 0.8,
  '30 yards after one quarter is ahead of pace (a quarter of 74.5 is 19): better than even, not a lock');
select pg_temp.box(30, 0, 0.25);
select ok(pg_temp.chance('player_rush_yds', 'Over', 74.5) < 0.2, '30 yards with one quarter left: well behind');
select ok(pg_temp.chance('player_rush_yds', 'Over', 74.5) > 0.01, '...but one long run could still do it');
select pg_temp.box(80, 0, 0.25);
select is(pg_temp.chance('player_rush_yds_alternate', 'Over', 79.5), 1::double precision, 'a ladder line he cleared: 100%');

-- ---------- anytime TD: pregame +100 = 50% ----------
select pg_temp.box(30, 0, 1);
select ok(abs(pg_temp.chance('player_anytime_td', 'Yes', null, 2.0) - 0.5) < 0.01, 'at kickoff: the pregame chance');
select pg_temp.box(30, 0, 0.25);
select ok(abs(pg_temp.chance('player_anytime_td', 'Yes', null, 2.0) - (1 - power(0.5, 0.25))) < 1e-9,
  'no TD yet with a quarter left: the chance of one more drops with the clock (16%)');
select pg_temp.box(30, 1, 0.25);
select is(pg_temp.chance('player_anytime_td', 'Yes', null, 2.0), 1::double precision, 'he scored: 100%');
select pg_temp.box(30, 0, 0, true);
select is(pg_temp.chance('player_anytime_td', 'Yes', null, 2.0), 0::double precision, 'final with no TD: 0%');
update private.stats_sync_state set last_sync_at = now() - interval '2 minutes' where event_id = 'nf-g1';
select ok(pg_temp.job() is null, 'final: done syncing');

select * from finish();
rollback;
