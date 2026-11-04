-- Football alternates + touchdowns: alternate yardage ladders (Over-only, one row per line), passing
-- TDs (over/under), anytime TD (one "Yes" price, no line). One yards entry by the host grades the main
-- line AND its ladder; anytime TD wins when the player scores at least once.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
set local check_function_bodies = off;

delete from private.odds_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ap@test.dev', false, '{"display_name":"Ann"}'),
  ('b3000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Ben"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('ap-g1', 'americanfootball_nfl', 'Baltimore Ravens', 'Jacksonville Jaguars', now() + interval '2 days');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.leg(p_market text, p_outcome text, p_player text, p_point numeric default null) returns jsonb
language sql stable as $$
  select jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)
  from public.odds_cache c where c.event_id = 'ap-g1' and c.market_key = p_market
   and c.outcome_name = p_outcome and c.participant_name = p_player and c.point is not distinct from p_point;
$$;
create function pg_temp.slip(p_amount bigint, p_leg jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(p_leg)));
$$;
create function pg_temp.leg_status(p_market text, p_outcome text, p_player text) returns text language sql as $$
  select l.status::text from public.wager_legs l
  where l.event_id = 'ap-g1' and l.market_key = p_market and l.selection = p_outcome and l.participant_name = p_player;
$$;
create function pg_temp.ingest(p_outcomes text) returns jsonb language sql as $$
  select public.odds_sync_ingest('props', 'americanfootball_nfl', now(), '[]', p_outcomes::jsonb,
    '[{"event_id":"ap-g1","market_key":"player_rush_yds","bookmaker":"dk"},
      {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","bookmaker":"dk"},
      {"event_id":"ap-g1","market_key":"player_anytime_td","bookmaker":"dk"}]'::jsonb);
$$;
create function pg_temp.rows(p_market text) returns text language sql stable as $$
  select string_agg(c.participant_name || ' ' || c.outcome_name || ' ' || coalesce(trim_scale(c.point)::text, '-') || ' ' || c.price_american,
                    ', ' order by c.participant_name, c.point, c.outcome_name)
  from public.odds_cache c where c.event_id = 'ap-g1' and c.market_key = p_market;
$$;

-- ---------- catalog ----------
select is(private.prop_markets('americanfootball_nfl'),
  array['player_pass_yds', 'player_rush_yds', 'player_reception_yds',
        'player_pass_yds_alternate', 'player_rush_yds_alternate', 'player_reception_yds_alternate',
        'player_pass_tds', 'player_anytime_td'],
  'NFL props: yards, alternate yards, passing TDs, anytime TD');

select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
create temp table tp as select * from public.create_tournament('TNF', array['ap-g1'], 'TN', null, 10000, null,
  '{"markets":["h2h"],"player_props":true}'::jsonb);
grant select on tp to authenticated;

select ok((select j -> 'markets' ? 'player_anytime_td' and j -> 'markets' ? 'player_rush_yds_alternate'
           from jsonb_array_elements(private.odds_sync_due_jobs()) j
           where j ->> 'kind' = 'props' and j ->> 'event_id' = 'ap-g1'),
  'the props sync asks for the alternate and touchdown markets');

-- ---------- ingest: a ladder is one row per line; Yes props have no line ----------
select pg_temp.ingest('[
  {"event_id":"ap-g1","market_key":"player_rush_yds","outcome_name":"Over","participant_name":"Derrick Henry","point":79.5,"price_american":-115,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds","outcome_name":"Under","participant_name":"Derrick Henry","point":79.5,"price_american":-105,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":29.5,"price_american":-1840,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":49.5,"price_american":-321,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":99.5,"price_american":250,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_anytime_td","outcome_name":"Yes","participant_name":"Derrick Henry","price_american":120,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_anytime_td","outcome_name":"Yes","participant_name":"Travis Etienne","price_american":150,"bookmaker":"dk"}]');

select is(pg_temp.rows('player_rush_yds_alternate'),
  'Derrick Henry Over 29.5 -1840, Derrick Henry Over 49.5 -321, Derrick Henry Over 99.5 250',
  'an alternate ladder stores every line for the player');
select is(pg_temp.rows('player_anytime_td'), 'Derrick Henry Yes - 120, Travis Etienne Yes - 150',
  'anytime TD stores one Yes price per player, without a line');

create temp table first_ids as select id, point from public.odds_cache where event_id = 'ap-g1' and market_key = 'player_rush_yds_alternate';

-- Next refresh: the ladder shifts (99.5 gone, 59.5 new, 29.5 repriced) and the main line moves.
select pg_temp.ingest('[
  {"event_id":"ap-g1","market_key":"player_rush_yds","outcome_name":"Over","participant_name":"Derrick Henry","point":84.5,"price_american":-110,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds","outcome_name":"Under","participant_name":"Derrick Henry","point":84.5,"price_american":-110,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":29.5,"price_american":-2000,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":49.5,"price_american":-321,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_rush_yds_alternate","outcome_name":"Over","participant_name":"Derrick Henry","point":59.5,"price_american":-200,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_anytime_td","outcome_name":"Yes","participant_name":"Derrick Henry","price_american":120,"bookmaker":"dk"},
  {"event_id":"ap-g1","market_key":"player_anytime_td","outcome_name":"Yes","participant_name":"Travis Etienne","price_american":150,"bookmaker":"dk"}]');

select is(pg_temp.rows('player_rush_yds_alternate'),
  'Derrick Henry Over 29.5 -2000, Derrick Henry Over 49.5 -321, Derrick Henry Over 59.5 -200',
  'the ladder follows the book: lines it dropped are removed, new ones added, prices updated');
select is((select c.id from public.odds_cache c where c.event_id = 'ap-g1' and c.market_key = 'player_rush_yds_alternate' and c.point = 29.5),
  (select id from first_ids where point = 29.5), 'a repriced ladder line keeps its row (bets and Realtime follow it)');
select is(pg_temp.rows('player_rush_yds'), 'Derrick Henry Over 84.5 -110, Derrick Henry Under 84.5 -110',
  'a main line that moves is still ONE row per side (no stale old line left bettable)');

-- ---------- betting ----------
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('player_rush_yds_alternate', 'Over', 'Derrick Henry', 49.5))),
  'Ann bets Henry alternate over 49.5 rushing yards');
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('player_anytime_td', 'Yes', 'Derrick Henry'))), 'Ann bets Henry to score');

select pg_temp.as_user('b3000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from tp));
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('player_anytime_td', 'Yes', 'Travis Etienne'))), 'Ben bets Etienne to score');
select lives_ok(format('select public.place_wagers(%L, %L)', (select id from tp),
  pg_temp.slip(1000, pg_temp.leg('player_rush_yds', 'Under', 'Derrick Henry', 84.5))), 'Ben bets Henry under 84.5');

select is(round(public.live_probability((select w from public.wagers w join public.wager_legs l on l.wager_id = w.id
  where l.market_key = 'player_anytime_td' and l.participant_name = 'Derrick Henry'))::numeric, 4), 0.4545,
  'a one-sided prop''s chance is its own implied price (+120)');

-- ---------- grading ----------
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from tp);
update public.events set commence_time = now() - interval '4 hours' where id = 'ap-g1';
select private.advance_statuses();
select public.scores_ingest('americanfootball_nfl', now(), '[{"event_id":"ap-g1","completed":true,"home_score":27,"away_score":20}]');

select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
select lives_ok(format('select public.grade_prop(%L, %L, %L, %L, 91)', (select id from tp), 'ap-g1', 'player_rush_yds', 'Derrick Henry'),
  'host enters Henry: 91 rushing yards, once');
select is(pg_temp.leg_status('player_rush_yds_alternate', 'Over', 'Derrick Henry') || ' / ' ||
          pg_temp.leg_status('player_rush_yds', 'Under', 'Derrick Henry'), 'hit / miss',
  'one yards entry grades the alternate ladder (over 49.5 hit) and the main line (under 84.5 miss)');
select is((select count(*)::int from public.prop_results r where r.tournament_id = (select id from tp)
            and r.participant_name = 'Derrick Henry'), 1, 'stored once, under the main stat');
select throws_ok(format('select public.grade_prop(%L, %L, %L, %L, 91)', (select id from tp), 'ap-g1', 'player_rush_yds_alternate', 'Derrick Henry'),
  'P0001', 'ALREADY_GRADED', 'the ladder can''t be graded a second time under its own name');

select lives_ok(format('select public.grade_prop(%L, %L, %L, %L, 1)', (select id from tp), 'ap-g1', 'player_anytime_td', 'Derrick Henry'),
  'host enters Henry: 1 touchdown');
select public.grade_prop((select id from tp), 'ap-g1', 'player_anytime_td', 'Travis Etienne', 0);
select is(pg_temp.leg_status('player_anytime_td', 'Yes', 'Derrick Henry') || ' / ' ||
          pg_temp.leg_status('player_anytime_td', 'Yes', 'Travis Etienne'), 'hit / miss',
  'anytime TD: scored at least once = win, zero = loss');

select * from finish();
rollback;
