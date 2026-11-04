-- Same-game parlays: a host switch (allowed_bet_types.same_game_parlays, on unless set false). Several picks
-- from one game may share a parlay, but never two on the same game line or the same player stat (an
-- alternate ladder is its main line's stat), so a parlay can't stack Over + Under or "50+" + "100+".
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
set local check_function_bodies = off;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'sg@test.dev', false, '{"display_name":"Ann"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('sg-g1', 'americanfootball_nfl', 'Baltimore Ravens', 'Jacksonville Jaguars', now() + interval '2 days');
insert into public.odds_cache (event_id, market_key, outcome_name, participant_name, point, price_american, bookmaker, updated_at) values
  ('sg-g1', 'h2h', 'Baltimore Ravens', '', null, -200, 'dk', now()),
  ('sg-g1', 'h2h', 'Jacksonville Jaguars', '', null, 170, 'dk', now()),
  ('sg-g1', 'totals', 'Over', '', 44.5, -110, 'dk', now()),
  ('sg-g1', 'totals', 'Under', '', 44.5, -110, 'dk', now()),
  ('sg-g1', 'player_rush_yds', 'Under', 'Derrick Henry', 84.5, -110, 'dk', now()),
  ('sg-g1', 'player_rush_yds_alternate', 'Over', 'Derrick Henry', 99.5, 250, 'dk', now()),
  ('sg-g1', 'player_anytime_td', 'Yes', 'Derrick Henry', null, 120, 'dk', now());
insert into public.odds_markets (event_id, market_key, is_live, bookmaker, last_seen_at)
select distinct event_id, market_key, false, 'dk', now() from public.odds_cache where event_id = 'sg-g1';

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.leg(p_market text, p_outcome text, p_player text default '') returns jsonb language sql stable as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
  from public.odds_cache c where c.event_id = 'sg-g1' and c.market_key = p_market
   and c.outcome_name = p_outcome and c.participant_name = p_player;
$$;
create function pg_temp.parlay(variadic p_legs jsonb[]) returns text language sql as $$
  select format('select public.place_wagers(%L, %L)', (select id from tg),
    jsonb_build_array(jsonb_build_object('amount_cents', 500, 'legs', to_jsonb(p_legs))));
$$;

select pg_temp.as_user('a4000000-0000-0000-0000-00000000000a');
create temp table tg as select * from public.create_tournament('SGP', array['sg-g1'], 'SG', null, 10000, null,
  '{"markets":["h2h","totals"],"parlays":true,"player_props":true}'::jsonb);
grant select on tg to authenticated;

select is((select allowed_bet_types ->> 'same_game_parlays' from public.tournaments where id = (select id from tg)), 'true',
  'same-game parlays are on unless the host turns them off');

select lives_ok(pg_temp.parlay(pg_temp.leg('h2h', 'Baltimore Ravens'), pg_temp.leg('totals', 'Over'),
  pg_temp.leg('player_anytime_td', 'Yes', 'Derrick Henry')), 'Ravens ML + Over + Henry TD on one game: allowed');
select is((select count(*)::int from public.wager_legs l join public.wagers w on w.id = l.wager_id
           where w.tournament_id = (select id from tg)), 3, 'one 3-leg parlay stored');

select throws_ok(pg_temp.parlay(pg_temp.leg('totals', 'Over'), pg_temp.leg('totals', 'Under')),
  'P0001', 'CONFLICTING_LEGS', 'Over and Under on the same total: refused');
select throws_ok(pg_temp.parlay(pg_temp.leg('h2h', 'Baltimore Ravens'), pg_temp.leg('h2h', 'Jacksonville Jaguars')),
  'P0001', 'CONFLICTING_LEGS', 'both moneylines: refused');
select throws_ok(pg_temp.parlay(pg_temp.leg('player_rush_yds', 'Under', 'Derrick Henry'),
                                pg_temp.leg('player_rush_yds_alternate', 'Over', 'Derrick Henry')),
  'P0001', 'CONFLICTING_LEGS', 'a ladder line and the main line on the same player stat: refused');

-- Host turns it off: back to one pick per game.
select lives_ok(format('select public.update_tournament(%L, %L)', (select id from tg),
  '{"allowed_bet_types":{"markets":["h2h","totals"],"parlays":true,"max_parlay_legs":6,"player_props":true,"same_game_parlays":false}}'),
  'host turns same-game parlays off');
select is((select allowed_bet_types ->> 'same_game_parlays' from public.tournaments where id = (select id from tg)), 'false',
  'the switch is stored');
select throws_ok(pg_temp.parlay(pg_temp.leg('h2h', 'Baltimore Ravens'), pg_temp.leg('totals', 'Over')),
  'P0001', 'SAME_EVENT_PARLAY', 'with the switch off, one pick per game');

create temp table tg2 as select * from public.create_tournament('No SGP', array['sg-g1'], 'NS', null, 10000, null,
  '{"markets":["h2h"],"parlays":true,"same_game_parlays":false}'::jsonb);
select is((select allowed_bet_types ->> 'same_game_parlays' from public.tournaments where id = (select id from tg2)), 'false',
  'a host can create a tournament with it off');

select * from finish();
rollback;
