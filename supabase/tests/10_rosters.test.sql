-- Player teams on the props board: rosters (from Sleeper, via odds-sync) let the board say which side
-- each player is on. Only the service role writes them; everyone reads the team through odds_board.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

delete from private.roster_sync_state;  -- independent of any local sync

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('rt-g1', 'americanfootball_nfl', 'Baltimore Ravens', 'Jacksonville Jaguars', now() + interval '2 days');
insert into public.odds_cache (event_id, market_key, outcome_name, participant_name, point, price_american, bookmaker, updated_at) values
  ('rt-g1', 'player_anytime_td', 'Yes', 'Derrick Henry', null, 120, 'dk', now()),
  ('rt-g1', 'player_anytime_td', 'Yes', 'Chris Rodriguez Jr.', null, -105, 'dk', now()),
  ('rt-g1', 'player_anytime_td', 'Yes', 'Baltimore Ravens D/ST', null, 600, 'dk', now()),
  ('rt-g1', 'player_anytime_td', 'Yes', 'Josh Allen', null, 300, 'dk', now()),
  ('rt-g1', 'player_anytime_td', 'Yes', 'Nobody Known', null, 900, 'dk', now()),
  ('rt-g1', 'h2h', 'Baltimore Ravens', '', null, -150, 'dk', now());

create function pg_temp.team(p_player text) returns text language sql stable as $$
  select b.participant_team from public.odds_board b where b.event_id = 'rt-g1' and b.participant_name = p_player;
$$;

-- ---------- name matching ----------
select is(private.name_key('Chris Rodriguez Jr.'), private.name_key('chris rodriguez'), 'suffixes and punctuation don''t matter');
select is(private.name_key('Amon-Ra St. Brown'), 'amonrastbrown', 'hyphens, dots and spaces are ignored');

-- ---------- writes are service-role only ----------
set local role authenticated;
select throws_ok($$select public.rosters_ingest('americanfootball_nfl', '[]')$$, '42501', null, 'players can''t write rosters');
reset role;

select is(public.rosters_due('americanfootball_nfl'), true, 'never synced: due');
select is(public.rosters_ingest('americanfootball_nfl', '[
  {"name":"Derrick Henry","team":"Baltimore Ravens"},
  {"name":"Chris Rodriguez","team":"Washington Commanders"},
  {"name":"Chris Rodriguez","team":"Baltimore Ravens"},
  {"name":"Josh Allen","team":"Buffalo Bills"},
  {"name":"Josh Allen","team":"Jacksonville Jaguars"}]') ->> 'players', '5', 'roster stored');
select is(public.rosters_due('americanfootball_nfl'), false, 'synced: not due again for a day');

-- ---------- the board says which side each player is on ----------
select is(pg_temp.team('Derrick Henry'), 'Baltimore Ravens', 'a rostered player gets his team');
select is(pg_temp.team('Chris Rodriguez Jr.'), 'Baltimore Ravens',
  'a name shared across the league resolves to the team actually in this game');
select is(pg_temp.team('Josh Allen'), 'Jacksonville Jaguars', 'same for any duplicate name');
select is(pg_temp.team('Baltimore Ravens D/ST'), 'Baltimore Ravens', 'a team defense is matched by its name');
select is(pg_temp.team('Nobody Known'), null, 'unknown player: no team, never a guess');

-- A re-sync replaces the roster (trades, cuts).
select public.rosters_ingest('americanfootball_nfl', '[{"name":"Derrick Henry","team":"Jacksonville Jaguars"}]');
select is(pg_temp.team('Derrick Henry'), 'Jacksonville Jaguars', 'a new roster replaces the old one');

select * from finish();
rollback;
