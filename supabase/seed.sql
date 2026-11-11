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

-- College stays opt-in: these fixtures do not modify app_settings.
insert into public.events (id, sport_key, sport_title, home_team, away_team, commence_time) values
  ('seed-ncaaf-1', 'americanfootball_ncaaf', 'NCAAF', 'Alabama Crimson Tide', 'Georgia Bulldogs', date_trunc('hour', now()) + interval '2 days'),
  ('seed-ncaaf-2', 'americanfootball_ncaaf', 'NCAAF', 'Ohio State Buckeyes', 'Michigan Wolverines', date_trunc('hour', now()) + interval '2 days 3 hours'),
  ('seed-ncaaf-3', 'americanfootball_ncaaf', 'NCAAF', 'Texas Longhorns', 'Oklahoma Sooners', date_trunc('hour', now()) + interval '3 days'),
  ('seed-ncaab-1', 'basketball_ncaab', 'NCAAB', 'Duke Blue Devils', 'North Carolina Tar Heels', date_trunc('hour', now()) + interval '1 day'),
  ('seed-ncaab-2', 'basketball_ncaab', 'NCAAB', 'Kansas Jayhawks', 'Kentucky Wildcats', date_trunc('hour', now()) + interval '1 day 2 hours'),
  ('seed-ncaab-3', 'basketball_ncaab', 'NCAAB', 'Gonzaga Bulldogs', 'UConn Huskies', date_trunc('hour', now()) + interval '2 days')
on conflict (id) do nothing;

insert into public.odds_cache (event_id, market_key, outcome_name, point, price_american, bookmaker)
select e.id, line.market_key, line.outcome_name, line.point, line.price, 'fakebook'
from public.events e
cross join lateral (values
  ('h2h', e.home_team, null::numeric, -150),
  ('h2h', e.away_team, null::numeric, 130),
  ('spreads', e.home_team, -3.5, -110),
  ('spreads', e.away_team, 3.5, -110),
  ('totals', 'Over', case when e.sport_key = 'basketball_ncaab' then 144.5 else 52.5 end, -110),
  ('totals', 'Under', case when e.sport_key = 'basketball_ncaab' then 144.5 else 52.5 end, -110)
) as line(market_key, outcome_name, point, price)
where e.id in ('seed-ncaaf-1', 'seed-ncaaf-2', 'seed-ncaaf-3', 'seed-ncaab-1', 'seed-ncaab-2', 'seed-ncaab-3')
on conflict do nothing;

insert into public.odds_markets (event_id, market_key, bookmaker, last_seen_at)
select e.id, m.key, 'fakebook', now()
from public.events e cross join (values ('h2h'), ('spreads'), ('totals')) m(key)
where e.id in ('seed-ncaaf-1', 'seed-ncaaf-2', 'seed-ncaaf-3', 'seed-ncaab-1', 'seed-ncaab-2', 'seed-ncaab-3')
on conflict do nothing;
