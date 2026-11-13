begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local check_function_bodies=off;
insert into auth.users(id,aud,role,email,raw_user_meta_data) values
 ('a2900000-0000-0000-0000-000000000001','authenticated','authenticated','grade29@test.dev','{"display_name":"Host29"}'),
 ('a2900000-0000-0000-0000-000000000002','authenticated','authenticated','peer29@test.dev','{"display_name":"Peer29"}');
insert into public.events(id,sport_key,home_team,away_team,commence_time)
select id,'americanfootball_nfl','Home29','Away29',now()+interval '2 days'
from unnest(array['g29-final','g29-outage','g29-canceled','g29-postponed']) id;
select set_config('request.jwt.claims','{"sub":"a2900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table tournament29 as select * from public.create_tournament('Grade29',
 array['g29-final','g29-outage','g29-canceled','g29-postponed'],'G29',null,20000,null,
 '{"markets":["h2h"],"player_props":true}');
create temp table dq29 as select * from public.create_tournament('No qualified players',
 array['g29-final'],'DQ29',null,10000,null,'{"markets":["h2h"],"min_bets":1}');
grant select on tournament29,dq29 to authenticated;
-- Normal odds ingestion, then normal wager submission (no bypassed lock or money guards).
select public.odds_sync_ingest('props','americanfootball_nfl',now(),'[]',
 (select jsonb_agg(jsonb_build_object('event_id','g29-final','market_key',market,'outcome_name',selection,
 'participant_name',player,'point',line,'price_american',100,'bookmaker','test'))
 from (values
 ('Negative','player_rush_yds','Under',-3.5),
 ('Host DNP','player_rush_yds','Over',10.5),
 ('Feed DNP','player_rush_yds','Over',10.5),
 ('Unknown','player_receptions','Under',0.5),
 ('Counts','player_receptions','Over',1.5),
 ('Push','player_receptions','Over',2),
 ('Late','player_receptions','Over',2.5),
 ('Ladder','player_rush_yds_alternate','Over',24.5),
 ('Touchdown','player_anytime_td','Yes',null)
 ) v(player,market,selection,line)),
 '[{"event_id":"g29-final","market_key":"player_rush_yds","bookmaker":"test"},
   {"event_id":"g29-final","market_key":"player_receptions","bookmaker":"test"},
   {"event_id":"g29-final","market_key":"player_rush_yds_alternate","bookmaker":"test"},
   {"event_id":"g29-final","market_key":"player_anytime_td","bookmaker":"test"}]');
select public.odds_sync_ingest('odds','americanfootball_nfl',now(),'[]',
 (select jsonb_agg(jsonb_build_object('event_id',id,'market_key','h2h','outcome_name','Home29',
 'price_american',100,'bookmaker','test')) from unnest(array['g29-final','g29-outage','g29-canceled','g29-postponed']) id),
 (select jsonb_agg(jsonb_build_object('event_id',id,'market_key','h2h','bookmaker','test'))
 from unnest(array['g29-final','g29-outage','g29-canceled','g29-postponed']) id));
create function pg_temp.pick29(p_event text,p_player text default '') returns jsonb language sql as $$
 select jsonb_build_object('odds_id',id,'price_american',price_american,'point',point)
 from public.odds_cache where event_id=p_event and participant_name=p_player;
$$;
create function pg_temp.bet29(variadic p_legs jsonb[]) returns jsonb language sql as $$
 select jsonb_build_object('amount_cents',1000,'legs',to_jsonb(p_legs));
$$;
select public.place_wagers((select id from tournament29),jsonb_build_array(
 pg_temp.bet29(pg_temp.pick29('g29-final','Negative')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Host DNP')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Feed DNP')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Host DNP'),pg_temp.pick29('g29-final')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Unknown')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Counts')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Push')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Late')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Ladder')),
 pg_temp.bet29(pg_temp.pick29('g29-final','Touchdown')),
 pg_temp.bet29(pg_temp.pick29('g29-outage')),
 pg_temp.bet29(pg_temp.pick29('g29-canceled')),
 pg_temp.bet29(pg_temp.pick29('g29-postponed'))));
create temp table second29 as select * from public.create_tournament('Second29',array['g29-final'],'SECOND29',null,10000,null,'{"markets":["h2h"],"player_props":true}');
select public.place_wagers((select id from second29),jsonb_build_array(pg_temp.bet29(pg_temp.pick29('g29-final','Counts'))));
select public.lock_tournament_now((select id from second29));
insert into public.prop_results(tournament_id,event_id,market_key,participant_name,stat,graded_by)
select id,'g29-final','player_receptions','Hidden fixture',1,auth.uid() from tournament29;
select set_config('request.jwt.claims','{"sub":"a2900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select public.join_tournament((select code from tournament29));
select public.join_tournament((select code from dq29));
set local role authenticated;
select is((select count(*)::int from public.leaderboard where tournament_id=(select id from tournament29)
 and display_name='Host29'),0,'co-participant cannot read bankrolls through replaced leaderboard before lock');
select is((select count(*)::int from public.wager_legs where tournament_id=(select id from tournament29)),0,
 'co-participant cannot read hidden legs');
select throws_ok('select * from private.grading_review','42501',null,'operator queue cannot reveal hidden picks');
select throws_ok('select * from private.prop_stat_evidence','42501',null,'automatic evidence is private');
select is((select count(*)::int from public.prop_results where tournament_id=(select id from tournament29)),0,'no results before lock');
select throws_ok('select * from private.player_participation','42501',null,'participation evidence is private');
select throws_ok($$ select public.grade_prop((select id from tournament29),'g29-final','player_rush_yds','Host DNP',0,true) $$,
 'P0001','NOT_HOST','co-participant cannot void host props');
reset role;
select set_config('request.jwt.claims','{"sub":"a2900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
update public.tournaments set lock_time=now()-interval '1 second' where id in
 ((select id from tournament29),(select id from dq29));
select private.advance_statuses();

select ok(not private.prop_stat_supported('americanfootball_nfl','player_team_dst_td'),'Team D/ST TD stays host graded');
-- Box arrives before the official final: nothing settles yet.
select public.stats_ingest('g29-final','espn29',true,'[
 {"name":"Unknown","provider_player_id":"unknown","market_key":"player_receptions","stat":0,"complete":false},
 {"name":"Negative","provider_player_id":"negative","market_key":"player_rush_yds","stat":-4,"complete":true},
 {"name":"Counts","provider_player_id":"counts","market_key":"player_receptions","stat":2,"complete":true},
 {"name":"Push","provider_player_id":"push","market_key":"player_receptions","stat":2,"complete":true},
 {"name":"Ladder","provider_player_id":"ladder","market_key":"player_rush_yds","stat":25,"complete":true},
 {"name":"Touchdown","provider_player_id":"td","market_key":"player_anytime_td","stat":1,"complete":true},
 {"name":"Feed DNP","market_key":"__participation","did_not_play":true}]');
select is((select status::text from public.wager_legs where participant_name='Negative'),'pending','box alone cannot grade');
select public.scores_ingest('americanfootball_nfl',now(),'[{"event_id":"g29-final","completed":true,"home_score":21,"away_score":7}]');
select is((select status::text from public.wager_legs where participant_name='Negative'),'hit','under grades on official final arrival');
select is((select count(*)::int from public.wager_legs where participant_name='Counts' and status='hit'),2,'over grades across all tournaments');
select is((select status::text from public.wager_legs where participant_name='Push'),'push','equal stat pushes');
select is((select status::text from public.wager_legs where participant_name='Ladder'),'hit','ladder uses base stat handler');
select is((select status::text from public.wager_legs where participant_name='Touchdown'),'hit','yes TD grades');
select is((select status::text from public.wager_legs where participant_name='Feed DNP'),'void','confirmed DNP uses void path');
select is((select status::text from public.wager_legs where participant_name='Unknown'),'pending','missing player is never zero');
select is((select source from public.prop_results where participant_name='Negative'),'box_score','automatic provenance');
select is((select provider_player_id from public.prop_results where participant_name='Negative'),'negative','provider identity retained');
select is((select status::text from public.wager_legs where participant_name='Late'),'pending','final without box stays pending');
select public.stats_ingest('g29-final','espn29',true,'[{"name":"Late","provider_player_id":"late","market_key":"player_receptions","stat":3,"complete":true}]');
select is((select status::text from public.wager_legs where participant_name='Late'),'hit','final first then numeric box grades');
-- Final before box: both single refund and parlay drop use the existing settlement path.
select public.stats_ingest('g29-final','espn29',true,'[{"name":"Host DNP","market_key":"__participation","did_not_play":true}]');
select is((select count(*)::int from public.wager_legs where participant_name='Host DNP' and status='void'),2,'all DNP legs void');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id where l.participant_name='Host DNP' and w.wager_type='parlay'),2000::bigint,'void drops from winning parlay');
create temp table paid29 as select remaining_bankroll_cents cash from public.tournament_participants where tournament_id=(select id from tournament29) and user_id=auth.uid();
select public.stats_ingest('g29-final','espn29',true,'[{"name":"Negative","provider_player_id":"negative","market_key":"player_rush_yds","stat":100,"complete":true},{"name":"Host DNP","market_key":"__participation","did_not_play":true}]');
select private.auto_grade_props('g29-final');
select is((select remaining_bankroll_cents from public.tournament_participants where tournament_id=(select id from tournament29) and user_id=auth.uid()),(select cash from paid29),'reruns never pay twice');
select is((select stat from public.prop_results where participant_name='Negative'),-4::numeric,'final result never changes');
select lives_ok($$select public.grade_prop((select id from tournament29),'g29-final','player_receptions','Unknown',0)$$,'host can resolve missing evidence');
select is((select source from public.prop_results where participant_name='Unknown'),'host','manual provenance preserved');
select throws_ok($$select public.grade_prop((select id from tournament29),'g29-final','player_rush_yds','Negative',100)$$,'P0001','ALREADY_GRADED','host cannot regrade an automatic final');
select * from finish();
rollback;
