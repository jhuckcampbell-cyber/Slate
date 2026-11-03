-- Local dev seed: upcoming games relative to now() so the create wizard always has a slate,
-- without spending Odds API credits. Real events arrive via the odds-sync function (Phase 2).
insert into public.events (id, sport_key, sport_title, home_team, away_team, commence_time) values
  ('seed-nfl-tnf',  'americanfootball_nfl', 'NFL', 'Kansas City Chiefs',   'Buffalo Bills',        date_trunc('hour', now()) + interval '2 days 1 hour'),
  ('seed-nfl-sun1', 'americanfootball_nfl', 'NFL', 'Philadelphia Eagles',  'Dallas Cowboys',       date_trunc('hour', now()) + interval '4 days'),
  ('seed-nfl-sun2', 'americanfootball_nfl', 'NFL', 'Detroit Lions',        'Green Bay Packers',    date_trunc('hour', now()) + interval '4 days'),
  ('seed-nfl-sun3', 'americanfootball_nfl', 'NFL', 'San Francisco 49ers',  'Seattle Seahawks',     date_trunc('hour', now()) + interval '4 days 3 hours'),
  ('seed-nfl-snf',  'americanfootball_nfl', 'NFL', 'Baltimore Ravens',     'Cincinnati Bengals',   date_trunc('hour', now()) + interval '4 days 7 hours'),
  ('seed-nba-1',    'basketball_nba',       'NBA', 'Boston Celtics',       'New York Knicks',      date_trunc('hour', now()) + interval '1 day'),
  ('seed-nba-2',    'basketball_nba',       'NBA', 'Denver Nuggets',       'Los Angeles Lakers',   date_trunc('hour', now()) + interval '1 day 2 hours')
on conflict (id) do nothing;

-- Local odds-sync wiring for pg_cron → Edge Function (see private.trigger_odds_sync).
-- host.docker.internal reaches the API gateway from inside the DB container (Docker Desktop).
select vault.create_secret('http://host.docker.internal:54321/functions/v1/odds-sync', 'odds_sync_url');
select vault.create_secret('local-dev-sync-secret', 'odds_sync_secret');
