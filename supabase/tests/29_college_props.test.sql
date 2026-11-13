-- College football props: gated by odds_college_enabled, main stats only, self-settling, additive rosters.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

update private.app_settings set value = 'false' where key = 'odds_college_enabled';
select is(private.prop_markets('americanfootball_ncaaf'), '{}'::text[], 'off: no college football props');
select is(public.college_props_enabled(), false, 'off: flag reads false');
update private.app_settings set value = 'true' where key = 'odds_college_enabled';
select is(private.prop_markets('americanfootball_ncaaf'),
  array['player_pass_yds','player_rush_yds','player_reception_yds','player_anytime_td'], 'on: main stats only');
select ok(not (private.prop_markets('americanfootball_ncaaf') && array['player_pass_tds','player_receptions','player_rush_yds_alternate']),
  'no NFL extras, passing TDs or alternate ladders');
select is(private.prop_markets('basketball_ncaab'), '{}'::text[], 'college basketball has no props');
select is(public.college_props_enabled(), true, 'on: flag reads true');
select is(array_length(private.prop_markets('americanfootball_nfl'), 1), 10, 'NFL catalog unchanged');

select ok(private.prop_stat_supported('americanfootball_ncaaf','player_rush_yds'), 'rush yds self-settle');
select ok(private.prop_stat_supported('americanfootball_ncaaf','player_anytime_td'), 'anytime TD self-settles');
select ok(not private.prop_stat_supported('americanfootball_ncaaf','player_pass_tds'), 'passing TDs not supported');
select ok(not private.prop_stat_supported('americanfootball_ncaaf','player_team_dst_td'), 'D/ST stays host graded');

-- rosters_merge is service-role only and replaces only the teams it carries.
set local role authenticated;
select throws_ok($$select public.rosters_merge('americanfootball_ncaaf', '[]')$$, '42501', null, 'players cannot write rosters');
select throws_ok($$select public.college_props_enabled()$$, '42501', null, 'players cannot call the flag');
reset role;
select public.rosters_merge('americanfootball_ncaaf', '[{"name":"A One","team":"Alabama Crimson Tide"},{"name":"B Two","team":"Auburn Tigers"}]');
select public.rosters_merge('americanfootball_ncaaf', '[{"name":"C Three","team":"Alabama Crimson Tide"}]');
select is((select array_agg(player_name order by player_name) from public.player_teams
  where sport_key = 'americanfootball_ncaaf' and team = 'Alabama Crimson Tide'), array['C Three'], 'merge replaces that team');
select is((select count(*)::int from public.player_teams
  where sport_key = 'americanfootball_ncaaf' and team = 'Auburn Tigers'), 1, 'other teams are kept');
select is((select count(*)::int from public.player_teams where sport_key = 'americanfootball_nfl' and team = 'Auburn Tigers'), 0, 'other sports untouched');

select * from finish();
rollback;
