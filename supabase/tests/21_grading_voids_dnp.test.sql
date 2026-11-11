begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local check_function_bodies=off;
insert into auth.users(id,aud,role,email,raw_user_meta_data) values
 ('a2700000-0000-0000-0000-000000000001','authenticated','authenticated','grade27@test.dev','{"display_name":"Host27"}'),
 ('a2700000-0000-0000-0000-000000000002','authenticated','authenticated','peer27@test.dev','{"display_name":"Peer27"}');
insert into public.events(id,sport_key,home_team,away_team,commence_time)
select id,'americanfootball_nfl','Home27','Away27',now()+interval '2 days'
from unnest(array['g27-final','g27-outage','g27-canceled','g27-postponed']) id;
select set_config('request.jwt.claims','{"sub":"a2700000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table tournament27 as select * from public.create_tournament('Grade27',
 array['g27-final','g27-outage','g27-canceled','g27-postponed'],'G27',null,10000,null,
 '{"markets":["h2h"],"player_props":true}');
create temp table dq27 as select * from public.create_tournament('No qualified players',
 array['g27-final'],'DQ27',null,10000,null,'{"markets":["h2h"],"min_bets":1}');
grant select on tournament27,dq27 to authenticated;
-- Normal odds ingestion, then normal wager submission (no bypassed lock or money guards).
select public.odds_sync_ingest('props','americanfootball_nfl',now(),'[]',
 (select jsonb_agg(jsonb_build_object('event_id','g27-final','market_key',market,'outcome_name',selection,
 'participant_name',player,'point',line,'price_american',100,'bookmaker','test'))
 from (values
 ('Negative','player_rush_yds','Under',-3.5),
 ('Host DNP','player_rush_yds','Over',10.5),
 ('Feed DNP','player_rush_yds','Over',10.5),
 ('Unknown','player_receptions','Under',0.5),
 ('Counts','player_receptions','Over',1.5)
 ) v(player,market,selection,line)),
 '[{"event_id":"g27-final","market_key":"player_rush_yds","bookmaker":"test"},
   {"event_id":"g27-final","market_key":"player_receptions","bookmaker":"test"}]');
select public.odds_sync_ingest('odds','americanfootball_nfl',now(),'[]',
 (select jsonb_agg(jsonb_build_object('event_id',id,'market_key','h2h','outcome_name','Home27',
 'price_american',100,'bookmaker','test')) from unnest(array['g27-final','g27-outage','g27-canceled','g27-postponed']) id),
 (select jsonb_agg(jsonb_build_object('event_id',id,'market_key','h2h','bookmaker','test'))
 from unnest(array['g27-final','g27-outage','g27-canceled','g27-postponed']) id));
create function pg_temp.pick27(p_event text,p_player text default '') returns jsonb language sql as $$
 select jsonb_build_object('odds_id',id,'price_american',price_american,'point',point)
 from public.odds_cache where event_id=p_event and participant_name=p_player;
$$;
create function pg_temp.bet27(variadic p_legs jsonb[]) returns jsonb language sql as $$
 select jsonb_build_object('amount_cents',1000,'legs',to_jsonb(p_legs));
$$;
select public.place_wagers((select id from tournament27),jsonb_build_array(
 pg_temp.bet27(pg_temp.pick27('g27-final','Negative')),
 pg_temp.bet27(pg_temp.pick27('g27-final','Host DNP')),
 pg_temp.bet27(pg_temp.pick27('g27-final','Feed DNP')),
 pg_temp.bet27(pg_temp.pick27('g27-final','Host DNP'),pg_temp.pick27('g27-final')),
 pg_temp.bet27(pg_temp.pick27('g27-final','Unknown')),
 pg_temp.bet27(pg_temp.pick27('g27-final','Counts')),
 pg_temp.bet27(pg_temp.pick27('g27-outage')),
 pg_temp.bet27(pg_temp.pick27('g27-canceled')),
 pg_temp.bet27(pg_temp.pick27('g27-postponed'))));
select set_config('request.jwt.claims','{"sub":"a2700000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select public.join_tournament((select code from tournament27));
select public.join_tournament((select code from dq27));
set local role authenticated;
select is((select count(*)::int from public.leaderboard where tournament_id=(select id from tournament27)
 and display_name='Host27'),0,'co-participant cannot read bankrolls through replaced leaderboard before lock');
select is((select count(*)::int from public.wager_legs where tournament_id=(select id from tournament27)),0,
 'co-participant cannot read hidden legs');
select throws_ok('select * from private.grading_review','42501',null,'operator queue cannot reveal hidden picks');
select throws_ok('select * from private.player_participation','42501',null,'participation evidence is private');
select throws_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_rush_yds','Host DNP',0,true) $$,
 'P0001','NOT_HOST','co-participant cannot void host props');
reset role;
select set_config('request.jwt.claims','{"sub":"a2700000-0000-0000-0000-000000000001","role":"authenticated"}',true);
update public.tournaments set lock_time=now()-interval '1 second' where id in
 ((select id from tournament27),(select id from dq27));
update public.events set commence_time=now()-interval '72 hours' where id like 'g27-%';
select private.advance_statuses();
select private.void_stale_legs();
select is((select count(*)::int from public.wager_legs where tournament_id=(select id from tournament27)
 and status='pending'),10,'72 hour outage refunds no legs, including props');
select is((select remaining_bankroll_cents from public.tournament_participants where tournament_id=(select id from tournament27)
 and user_id=auth.uid()),1000::bigint,'outage does not credit a refund');
select ok(exists(select 1 from private.grading_review where tournament_id=(select id from tournament27)
 and event_id='g27-outage' and reason='MISSING_FINAL'),'outage surfaces in the operator queue');
update public.events set status='canceled' where id='g27-canceled';
update public.events set status='postponed' where id='g27-postponed';
select private.void_stale_legs();
select is((select status::text from public.wager_legs where event_id='g27-postponed'),'void','explicit postponement voids');
select is((select status::text from public.wager_legs where event_id='g27-canceled'),'void','explicit canceled game voids');
-- Late final still goes through normal scores ingestion and settles pending game lines.
select public.scores_ingest('americanfootball_nfl',now(),'[{"event_id":"g27-outage","completed":true,"home_score":21,"away_score":7}]');
select is((select status::text from public.wager_legs where event_id='g27-outage'),'hit','late final grades an outage leg');
create temp table paid27 as select remaining_bankroll_cents as cash from public.tournament_participants
 where tournament_id=(select id from tournament27) and user_id=auth.uid();
select public.scores_ingest('americanfootball_nfl',now(),'[{"event_id":"g27-outage","completed":true,"home_score":21,"away_score":7}]');
select private.void_stale_legs();
select is((select remaining_bankroll_cents from public.tournament_participants where tournament_id=(select id from tournament27)
 and user_id=auth.uid()),(select cash from paid27),'repeated final and stale sweep never pay twice');
select public.scores_ingest('americanfootball_nfl',now(),'[{"event_id":"g27-final","completed":true,"home_score":21,"away_score":7}]');
select lives_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_rush_yds','Negative',-4) $$,
 'negative rushing yards accepted');
select is((select stat from public.prop_results where event_id='g27-final' and participant_name='Negative'),-4::numeric,
 'negative result persisted');
select is((select status::text from public.wager_legs where participant_name='Negative'),'hit','negative under wins');
select throws_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_rush_yds','Negative',5) $$,
 'P0001','ALREADY_GRADED','negative final cannot be replaced');
select throws_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_receptions','Counts',-1) $$,
 'P0001','INVALID_STAT','negative counting stat rejected');
select throws_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_receptions','Unknown',null) $$,
 'P0001','INVALID_STAT','missing stat never means zero or DNP');
select lives_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_rush_yds','Host DNP',0,true) $$,
 'host explicitly confirms DNP');
select is((select count(*)::int from public.wager_legs where participant_name='Host DNP' and status='void'),2,
 'DNP voids the single and parlay leg');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id
 where l.participant_name='Host DNP' and w.wager_type='single'),1000::bigint,'DNP single refunds stake');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id
 where l.participant_name='Host DNP' and w.wager_type='parlay'),2000::bigint,'DNP parlay drops void leg and pays remaining decimal');
select ok((select did_not_play and stat is null from public.prop_results where participant_name='Host DNP'),
 'DNP result is explicit evidence, not numeric zero');
select throws_ok($$ select public.grade_prop((select id from tournament27),'g27-final','player_rush_yds','Host DNP',100) $$,
 'P0001','ALREADY_GRADED','DNP is immutable');
select public.stats_ingest('g27-final','espn27',false,
 '[{"name":"Feed DNP","market_key":"__participation","stat":null,"did_not_play":true}]');
select is((select status::text from public.wager_legs where participant_name='Feed DNP'),'pending','live DNP is not confirmed');
select public.stats_ingest('g27-final','espn27',true,
 '[{"name":"Feed DNP","market_key":"__participation","stat":null,"did_not_play":true}]');
select is((select status::text from public.wager_legs where participant_name='Feed DNP'),'void','final feed DNP voids');
select is((select status::text from public.wager_legs where participant_name='Unknown'),'pending','absent player data stays pending');
create temp table dnp_paid27 as select remaining_bankroll_cents as cash from public.tournament_participants
 where tournament_id=(select id from tournament27) and user_id=auth.uid();
select public.stats_ingest('g27-final','espn27',true,
 '[{"name":"Feed DNP","market_key":"__participation","stat":null,"did_not_play":true}]');
select private.void_stale_legs();
select is((select remaining_bankroll_cents from public.tournament_participants where tournament_id=(select id from tournament27)
 and user_id=auth.uid()),(select cash from dnp_paid27),'DNP replay never refunds twice');
select ok(not exists(select 1 from public.leaderboard where tournament_id=(select id from dq27) and rank=1),
 'everyone disqualified: nobody gets first place');
select ok(not exists(select 1 from public.leaderboard where tournament_id=(select id from dq27) and qualified),
 'everyone missed the minimum bets');
select * from finish();
rollback;
