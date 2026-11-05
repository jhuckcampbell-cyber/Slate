-- Live game updates (ESPN scoreboard, free): score, clock, down & distance and last play for games in play in a locked
-- tournament, once a minute. In-progress scores also move the game's score (so live chances move), but a final only
-- ever comes from the graded scores feed (scores_ingest).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

delete from private.live_sync_state;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'lg@test.dev', false, '{"display_name":"Lu"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('lg-g1', 'americanfootball_nfl', 'Baltimore Ravens', 'Jacksonville Jaguars', now() + interval '2 days'),
  ('lg-g2', 'icehockey_nhl', 'Boston Bruins', 'New York Rangers', now() + interval '2 days');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.job(p_sport text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(private.odds_sync_due_jobs()) j where j ->> 'kind' = 'live' and j ->> 'sport_key' = p_sport;
$$;

select pg_temp.as_user('a5000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('TNF', array['lg-g1'], 'TN', null, 10000, null, '{"markets":["h2h"]}'::jsonb);
create temp table t2 as select * from public.create_tournament('Hockey', array['lg-g2'], 'HK', null, 10000, null, '{"markets":["h2h"]}'::jsonb);
reset role;

select ok(pg_temp.job('americanfootball_nfl') is null, 'days before kickoff: no live updates');
update public.tournaments set lock_time = now() - interval '1 second' where id in ((select id from t1), (select id from t2));
update public.events set commence_time = now() - interval '20 minutes' where id in ('lg-g1', 'lg-g2');
select private.advance_statuses();

select is((pg_temp.job('americanfootball_nfl') -> 'events' -> 0) - 'commence_time',
  '{"event_id":"lg-g1","home_team":"Baltimore Ravens","away_team":"Jacksonville Jaguars"}'::jsonb,
  'game in play: one live job per sport, with the teams to find it by');
select ok(pg_temp.job('icehockey_nhl') is null, 'sports the feed doesn''t cover are skipped');

set local role authenticated;
select throws_ok($$select public.live_ingest('americanfootball_nfl', '[]')$$, '42501', null, 'players can''t write live games');
reset role;

select is(public.live_ingest('americanfootball_nfl', '[{"event_id":"lg-g1","state":"in","home_score":7,"away_score":3,
  "period":1,"detail":"2:14 - 1st","situation":"3rd & 4 at BAL 40","last_play":"Lamar Jackson pass to Zay Flowers for 22 yards"}]')
  ->> 'changed', '1', 'live update stored');
select ok(pg_temp.job('americanfootball_nfl') is null, 'just synced: not due again within the minute');

select is((select (home_score, away_score, status) from public.events where id = 'lg-g1'), (7, 3, 'live'::text),
  'the game''s score moves with it (live chances follow)');

select pg_temp.as_user('a5000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is((select last_play from public.game_live where event_id = 'lg-g1'), 'Lamar Jackson pass to Zay Flowers for 22 yards',
  'anyone signed in reads the play-by-play (public sports data)');
select throws_ok($$delete from public.game_live$$, '42501', null, 'players can''t change it');
reset role;

select is(public.live_ingest('americanfootball_nfl', '[{"event_id":"lg-g1","state":"in","home_score":7,"away_score":3,
  "period":1,"detail":"2:14 - 1st","situation":"3rd & 4 at BAL 40","last_play":"Lamar Jackson pass to Zay Flowers for 22 yards"}]')
  ->> 'changed', '0', 'nothing new: no change, no signal');

select public.live_ingest('americanfootball_nfl', '[{"event_id":"lg-g1","state":"post","home_score":27,"away_score":20,
  "period":4,"detail":"Final"}]');
select is((select status from public.events where id = 'lg-g1'), 'live',
  'the feed''s final doesn''t settle anything: grading waits for the scores feed');
select is((select state from public.game_live where event_id = 'lg-g1'), 'post', '...but the screen shows it''s over');
update private.live_sync_state set last_sync_at = now() - interval '2 minutes';
select ok(pg_temp.job('americanfootball_nfl') is null, 'over: no more live updates');

select * from finish();
rollback;
