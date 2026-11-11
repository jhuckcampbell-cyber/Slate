-- College stays dark until explicitly enabled, with bounded tournament-only polling.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(private.odds_setting('odds_college_enabled'), 'false'::jsonb, 'college defaults off');
select is(private.odds_setting('odds_college_max_events'), '8'::jsonb, 'college defaults to eight events');
select is(private.prop_markets('americanfootball_ncaaf'), '{}'::text[], 'no college football props');
select is(private.prop_markets('basketball_ncaab'), '{}'::text[], 'no college basketball props');
select is(private.prop_markets('basketball_nba'), array['player_points','player_rebounds','player_assists'], 'NBA props unchanged');
select is(private.prop_markets('americanfootball_nfl'), array[
  'player_pass_yds','player_rush_yds','player_reception_yds','player_receptions',
  'player_pass_yds_alternate','player_rush_yds_alternate','player_reception_yds_alternate',
  'player_receptions_alternate','player_pass_tds','player_anytime_td'], 'NFL props unchanged');

delete from private.odds_sync_state;
delete from private.live_sync_state;
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('a2600000-0000-0000-0000-000000000001','authenticated','authenticated','college@test.dev','{"display_name":"College host"}');
select set_config('request.jwt.claims', '{"sub":"a2600000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.events (id, sport_key, home_team, away_team, commence_time)
select 'college-' || sport || '-' || n, sport, 'Home', 'Away', now() + n * interval '1 hour'
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport, generate_series(1,7) n;
create temp table college_tournaments as
select sport, ct.* from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport
cross join lateral public.create_tournament('College upcoming', array[
 'college-' || sport || '-3', 'college-' || sport || '-1', 'college-' || sport || '-2'], 'CH') ct;
create temp table college_live_tournaments as
select sport, ct.* from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport
cross join lateral public.create_tournament('College live', array[
 'college-' || sport || '-6', 'college-' || sport || '-4', 'college-' || sport || '-5'], 'CL') ct;

select is((select count(*)::int from public.tournament_events te
 where te.tournament_id in (select id from college_tournaments union all select id from college_live_tournaments)),
 12, 'both college sports can be attached to tournaments');

-- Place actual game-line wagers before kickoff, using server-side cached prices.
insert into public.odds_cache (event_id, market_key, outcome_name, price_american, bookmaker)
select 'college-' || sport || '-4', 'h2h', 'Home', 100, 'test'
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;
insert into public.odds_markets (event_id, market_key, bookmaker, last_seen_at)
select event_id, 'h2h', 'test', now() from public.odds_cache where event_id like 'college-%';
select lives_ok(format('select public.place_wagers(%L::uuid, %L::jsonb)', ct.id,
 jsonb_build_array(jsonb_build_object('amount_cents',1000,'legs',jsonb_build_array(
 jsonb_build_object('odds_id',o.id,'price_american',100,'point',null))))), sport || ' game line can be placed')
from college_live_tournaments ct join public.odds_cache o on o.event_id = 'college-' || ct.sport || '-4';
update public.tournaments set lock_time = now() - interval '1 second'
where id in (select id from college_live_tournaments);
update public.events set commence_time = now() - (8 - right(id,1)::int) * interval '1 hour'
where id like 'college-%' and right(id,1)::int between 4 and 6;
select private.advance_statuses();

create function pg_temp.college_jobs() returns setof jsonb language sql as $$
 select j from jsonb_array_elements(private.odds_sync_due_jobs()) j
 where j ->> 'sport_key' in ('americanfootball_ncaaf','basketball_ncaab');
$$;
select is(
 (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
  from jsonb_array_elements(private.odds_sync_odds_jobs()) j
  where j ->> 'sport_key' not in ('americanfootball_ncaaf','basketball_ncaab')),
 (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
  from jsonb_array_elements(private.odds_sync_odds_jobs_base()) j
  where j ->> 'sport_key' not in ('americanfootball_ncaaf','basketball_ncaab')),
 'noncollege paid jobs are unchanged');
select is((select count(*)::int from pg_temp.college_jobs()), 0, 'off emits no college jobs even with tournaments');
-- The catalog list includes college (migration 0041) but the switch must suppress it.
select ok(private.odds_setting('odds_catalog_sports') ? 'americanfootball_ncaaf', 'college is in the catalog list');
select is((select count(*)::int from pg_temp.college_jobs()), 0, 'off suppresses configured college catalogs');
update private.app_settings set value = 'true' where key = 'odds_college_enabled';
update private.app_settings set value = '2' where key = 'odds_college_max_events';
select is((select count(*)::int from pg_temp.college_jobs() j where j ->> 'kind' = 'catalog'), 2,
 'enabled adds the free college catalog jobs');
select is((select count(*)::int from pg_temp.college_jobs() j where j ->> 'kind' in ('props','stats')), 0,
 'enabled never emits college props or stats');
select is((select j -> 'event_ids' from pg_temp.college_jobs() j where j ->> 'sport_key' = sport and j ->> 'kind' = 'odds'),
 jsonb_build_array('college-' || sport || '-1','college-' || sport || '-2'), sport || ' odds capped earliest first, excludes untournamented event')
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;
select is((select j -> 'event_ids' from pg_temp.college_jobs() j where j ->> 'sport_key' = sport and j ->> 'kind' = 'scores'),
 jsonb_build_array('college-' || sport || '-4','college-' || sport || '-5'), sport || ' scores capped earliest first')
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;
select is((select jsonb_array_length(j -> 'events') from pg_temp.college_jobs() j where j ->> 'sport_key' = sport and j ->> 'kind' = 'live'),
 3, sport || ' live scoreboard includes college tournament events')
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;

select public.scores_ingest(sport, now(), jsonb_build_array(jsonb_build_object(
 'event_id','college-' || sport || '-4','completed',true,'home_score',28,'away_score',21)))
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;
select is(w.status::text, 'won', ct.sport || ' final grades wager')
from college_live_tournaments ct join public.wagers w on w.tournament_id = ct.id;
select is(w.payout_cents, 2000::bigint, ct.sport || ' final pays winning wager')
from college_live_tournaments ct join public.wagers w on w.tournament_id = ct.id;
select is(p.remaining_bankroll_cents, 11000::bigint, ct.sport || ' winning return credited')
from college_live_tournaments ct join public.tournament_participants p on p.tournament_id = ct.id;
select public.scores_ingest(sport, now(), jsonb_build_array(jsonb_build_object(
 'event_id','college-' || sport || '-4','completed',true,'home_score',28,'away_score',21)))
from unnest(array['americanfootball_ncaaf','basketball_ncaab']) sport;
select is(p.remaining_bankroll_cents, 11000::bigint, ct.sport || ' replay does not pay twice')
from college_live_tournaments ct join public.tournament_participants p on p.tournament_id = ct.id;
update private.app_settings set value = 'false' where key = 'odds_college_enabled';
select is((select count(*)::int from pg_temp.college_jobs()), 0, 'disabling again suppresses all college jobs');
select * from finish();
rollback;
