begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.events(id,sport_key,home_team,away_team,commence_time)
values ('status30','basketball_nba','Home','Away',now()-interval '3 days');
select public.scores_ingest('basketball_nba',now(),
 '[{"event_id":"status30","status":"postponed","status_reason":"Weather"}]');
select is((select status from public.events where id='status30'),'postponed','scoreless explicit postponement ingested');
select is((select status_reason from public.events where id='status30'),'Weather','reason retained');
select public.scores_ingest('basketball_nba',now(),'[]');
select is((select status from public.events where id='status30'),'postponed','empty feed cannot cancel game');
select public.odds_sync_ingest('catalog','basketball_nba',now(),jsonb_build_array(jsonb_build_object(
 'id','status30','sport_key','basketball_nba','home_team','Home','away_team','Away','commence_time',now()+interval '1 day')));
select is((select status from public.events where id='status30'),'scheduled','new catalog date resumes postponed event');
update public.events set commence_time=now()-interval '3 days',status='live',home_score=60,away_score=50 where id='status30';
select public.live_ingest('basketball_nba','[{"event_id":"status30","state":"in","period":3,"clock_seconds":720,"home_score":60,"away_score":50}]');
select is(private.game_remaining('status30'),0.5::double precision,'clock has half game remaining despite three day delay');
select ok(abs(private.leg_probability_base(jsonb_populate_record(null::public.wager_legs,
 '{"event_id":"status30","market_key":"h2h","selection":"Home","status":"pending","odds_decimal":2}'))
 - private.norm_cdf(10.0 / ((select margin_sd from private.sport_model('basketball_nba'))*sqrt(0.5))))<0.00001,
 'game-line probability uses actual clock');
select public.live_ingest('basketball_nba','[{"event_id":"status30","state":"in","period":5,"clock_seconds":300}]');
select is(private.game_remaining('status30'),(300.0/2880)::double precision,'overtime starts with actual overtime remaining');
delete from public.game_live where event_id='status30';
select is(private.game_remaining('status30'),null::double precision,'no clock selects legacy elapsed fallback');
select ok(abs(private.leg_probability_base(jsonb_populate_record(null::public.wager_legs,
 '{"event_id":"status30","market_key":"h2h","selection":"Home","status":"pending","odds_decimal":2}'))
 - private.norm_cdf(10.0 / ((select margin_sd from private.sport_model('basketball_nba'))*sqrt(0.02))))<0.00001,
 'without clock probability retains elapsed-time behavior');
select ok(private.recovery_interval(now()-interval '3 days')=interval '1 hour','overdue recovery backs off to hourly');
select ok(private.recovery_interval(now()-interval '8 days')=interval '6 hours','long outage continues recovery every six hours');
select public.scores_ingest('basketball_nba',now(),'[{"event_id":"status30","completed":true,"home_score":110,"away_score":100}]');
select is((select status from public.events where id='status30'),'final','late final accepted');
select public.live_ingest('basketball_nba','[{"event_id":"status30","state":"pre","status":"canceled","status_reason":"Late stale notice"}]');
select is((select status from public.events where id='status30'),'final','final cannot be canceled or paid again');
select * from finish();
rollback;
