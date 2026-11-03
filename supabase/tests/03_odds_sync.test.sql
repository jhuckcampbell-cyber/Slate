-- Phase 2: odds sync scheduling (lease, due-list, cadence tiers, credit breaker).
-- Uses NHL fixtures so it doesn't collide with seeded/e2e NFL & NBA data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Isolate from whatever the local cron has been doing (all rolled back at the end).
update private.job_leases set holder = null, locked_until = '-infinity' where name = 'odds-sync';
delete from private.odds_sync_state;
delete from private.api_usage;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'sync@test.dev', false, '{"display_name":"Dee"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('ts-ev1', 'icehockey_nhl', 'Boston Bruins', 'Toronto Maple Leafs', now() + interval '2 days'),
  ('ts-ev2', 'icehockey_nhl', 'New York Rangers', 'New Jersey Devils', now() + interval '30 minutes'),
  ('ts-ev3', 'icehockey_nhl', 'Dallas Stars', 'Colorado Avalanche', now() - interval '1 hour');

select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select * from public.create_tournament('Sync Test', array['ts-ev1'], 'ST', null, 10000, null,
  '{"markets":["h2h"]}'::jsonb);

create function pg_temp.nhl_odds_job() returns jsonb language sql stable as $$
  select j from jsonb_array_elements(private.odds_sync_due_jobs()) j
  where j ->> 'kind' = 'odds' and j ->> 'sport_key' = 'icehockey_nhl';
$$;

-- ---------- single-flight lease ----------
create temp table lease1 as select public.odds_sync_claim(120) as r;
select is((select (r ->> 'claimed')::boolean from lease1), true, 'first claim gets the lease');
select is((public.odds_sync_claim(120) ->> 'claimed')::boolean, false, 'concurrent claim is refused');
select public.odds_sync_release((select (r ->> 'holder')::uuid from lease1));
select is((public.odds_sync_claim(120) ->> 'claimed')::boolean, true, 'released lease can be claimed again');

-- ---------- due-list ----------
select is(pg_temp.nhl_odds_job() -> 'markets', '["h2h"]'::jsonb,
  'never-synced sport is due, fetching only markets the tournament allows');
select is(pg_temp.nhl_odds_job() -> 'event_ids', '["ts-ev1"]'::jsonb,
  'only events still open for betting are requested');
select is((select count(*)::int from jsonb_array_elements(private.odds_sync_due_jobs()) j
           where j ->> 'kind' = 'catalog'), 2, 'catalog refresh due for both catalog sports');

select public.odds_sync_ingest('odds', 'icehockey_nhl', now());
select ok(pg_temp.nhl_odds_job() is null, 'just-synced sport is not due (12h tier for games 2 days out)');

select public.odds_sync_ingest('catalog', 'americanfootball_nfl', now());
select is((select count(*)::int from jsonb_array_elements(private.odds_sync_due_jobs()) j
           where j ->> 'kind' = 'catalog'), 1, 'catalog sync clears that sport for 6 hours');

-- A second tournament on a game 30 minutes out: union of markets, 3-minute tier.
select * from public.create_tournament('Sync Test 2', array['ts-ev2'], 'ST', null, 10000, null,
  '{"markets":["h2h","spreads"]}'::jsonb);
update private.odds_sync_state set last_odds_sync_at = now() - interval '1 minute'
 where sport_key = 'icehockey_nhl';
select is(pg_temp.nhl_odds_job() -> 'markets', '["h2h", "spreads"]'::jsonb,
  'a tournament created after the last sync makes its sport due now, with the union of markets');
update public.tournaments set created_at = now() - interval '1 hour' where title like 'Sync Test%';
select ok(pg_temp.nhl_odds_job() is null, '...but not again once synced (30-minute tier not yet elapsed)');
update private.odds_sync_state set last_odds_sync_at = now() - interval '31 minutes'
 where sport_key = 'icehockey_nhl';
select ok(pg_temp.nhl_odds_job() is not null, 'imminent game puts the sport on the 30-minute tier');

-- ---------- ingest guards ----------
select is((public.odds_sync_ingest('odds', 'icehockey_nhl', now(), '[]',
  '[{"event_id":"ts-ev3","market_key":"h2h","outcome_name":"Dallas Stars","price_american":-120,"bookmaker":"dk"}]',
  '[]') ->> 'outcomes_changed')::int, 0, 'in-play prices for started games are not stored as pregame');

-- ---------- cadence + credit breaker ----------
select is(private.odds_refresh_interval(now() + interval '2 days'), interval '12 hours', '>24h out: every 12h (free tier)');
select is(private.odds_max_age(now() + interval '30 minutes'), interval '46 minutes',
  'bets accept prices up to 1.5 intervals + 1 min old');

insert into private.api_usage (endpoint, credits_used, credits_remaining) values ('odds', 3, 90);
select is(private.odds_refresh_interval(now() + interval '2 days'), interval '24 hours',
  'under 20% of quota: cadence halves');
insert into private.api_usage (endpoint, credits_used, credits_remaining, called_at)
  values ('odds', 3, 20, now() + interval '1 second');
select is(private.odds_breaker_factor(), 4, 'under 5% of quota: cadence quarters');

select * from finish();
rollback;
