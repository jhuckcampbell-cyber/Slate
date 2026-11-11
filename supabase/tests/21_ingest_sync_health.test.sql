begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
insert into public.events(id,sport_key,home_team,away_team,commence_time) values
 ('health-props','health_test','Home','Away',now()+interval '2 days'),
 ('health-scores','health_test','Home','Away',now()-interval '1 hour');

create function pg_temp.snapshot(p_stamp timestamptz, p_fetch timestamptz, p_players text[], p_price int)
returns jsonb language sql set search_path = '' as $$
 select public.odds_sync_ingest('props','health_test',p_fetch,'[]',
   (select coalesce(jsonb_agg(jsonb_build_object('event_id','health-props','market_key',m,
     'outcome_name',o,'participant_name',p,'point',case when m='player_anytime_td' then null else 20.5 end,
     'price_american',p_price,'bookmaker','book','provider_updated_at',p_stamp)), '[]')
    from unnest(array['player_points','player_points_alternate','player_anytime_td']) m,
      unnest(p_players) p, unnest(case when m='player_anytime_td' then array['Yes']
        when m='player_points_alternate' then array['Over'] else array['Over','Under'] end) o),
   (select jsonb_agg(jsonb_build_object('event_id','health-props','market_key',m,'bookmaker','book',
      'provider_updated_at',p_stamp)) from unnest(array['player_points','player_points_alternate','player_anytime_td']) m));
$$;
select pg_temp.snapshot(now()-interval '3 minutes',now()-interval '3 minutes',array['Active','Scratched'],-110);
select pg_temp.snapshot(now()-interval '2 minutes',now()-interval '2 minutes',array['Active'],-120);
select is((select count(*)::int from public.odds_cache where event_id='health-props' and participant_name='Scratched'),0,
 'all prop shapes remove scratched players');
select is((select count(*)::int from public.odds_cache where event_id='health-props'),4,'active outcomes retained');
select pg_temp.snapshot(now()-interval '3 minutes',now()-interval '1 minute',array['Scratched'],-150);
select is((select count(*)::int from public.odds_cache where event_id='health-props' and participant_name='Scratched'),0,
 'old provider response cannot resurrect withdrawn players');
select is((select min(price_american) from public.odds_cache where event_id='health-props'),-120,'older provider cannot overwrite prices');
select pg_temp.snapshot(now(),now()-interval '4 minutes',array['Scratched'],-160);
select is((select count(*)::int from public.odds_cache where event_id='health-props' and participant_name='Active'),4,
 'older request cannot remove current players');
select is((select min(last_seen_at) from public.odds_markets where event_id='health-props'),
 now()-interval '2 minutes','rejected snapshot does not refresh freshness');
-- A merged market can have the same oldest timestamp while one player's source regresses.
update private.odds_player_versions set provider_updated_at=now() where event_id='health-props';
select pg_temp.snapshot(now()-interval '2 minutes',now(),array['Active'],-170);
select is((select min(price_american) from public.odds_cache where event_id='health-props'),-120,
 'per-player watermark blocks source regression within a merged market');
select pg_temp.snapshot(now()-interval '1 minute',now(),array[]::text[],-120);
select is((select count(*)::int from public.odds_cache where event_id='health-props'),0,'empty fresh snapshots withdraw whole markets');
select public.scores_ingest('health_test',now()-interval '2 minutes',jsonb_build_array(jsonb_build_object(
 'event_id','health-scores','completed',false,'home_score',10,'away_score',9,'provider_updated_at',now()-interval '2 minutes')));
select public.scores_ingest('health_test',now(),jsonb_build_array(jsonb_build_object(
 'event_id','health-scores','completed',true,'home_score',1,'away_score',0,'provider_updated_at',now()-interval '3 minutes')));
select is((select home_score from public.events where id='health-scores'),10,'older provider score ignored');
select is((select status::text from public.events where id='health-scores'),'live','old final cannot finalize newer live scores');
select public.scores_ingest('health_test',now(),jsonb_build_array(jsonb_build_object(
 'event_id','health-scores','completed',false,'home_score',10,'away_score',9,'provider_updated_at',now()-interval '1 minute')));
select public.scores_ingest('health_test',now(),jsonb_build_array(jsonb_build_object(
 'event_id','health-scores','completed',false,'home_score',5,'away_score',4,'provider_updated_at',now()-interval '90 seconds')));
select is((select home_score from public.events where id='health-scores'),10,'unchanged newer score advances watermark');
select public.scores_ingest('health_test',now()-interval '5 minutes',jsonb_build_array(jsonb_build_object(
 'event_id','health-scores','completed',false,'home_score',3,'away_score',2,'provider_updated_at',now())));
select is((select home_score from public.events where id='health-scores'),10,'older score request is ignored');
select ok(not has_function_privilege('authenticated','public.odds_sync_health(integer)','execute'),'health restricted to service role');
select ok(not has_table_privilege('authenticated','public.odds_sync_runs','select'),'runs restricted to service role');
select ok(not public.odds_sync_renew('00000000-0000-0000-0000-000000000000'),'wrong holder cannot renew');
update private.job_leases set holder='aaaaaaaa-0000-0000-0000-000000000001',
 locked_until=clock_timestamp()+interval '30 seconds' where name='odds-sync';
select ok(public.odds_sync_renew('aaaaaaaa-0000-0000-0000-000000000001'),'current lease can renew');
update private.job_leases set locked_until=clock_timestamp()-interval '1 second' where name='odds-sync';
select ok(not public.odds_sync_renew('aaaaaaaa-0000-0000-0000-000000000001'),'expired lease cannot renew');
insert into public.odds_sync_runs(kind,sport_key,ok,finished_at,error) values
 ('catalog','health_test',true,now(),null),('catalog','health_test',false,now(),'TEST_FAILURE'),
 ('catalog','health_test',false,now(),'TEST_FAILURE');
select is((select (f->>'failures')::int from jsonb_array_elements(public.odds_sync_health()->'consecutive_failures') f
 where f->>'sport_key'='health_test' and f->>'kind'='catalog'),2,'health counts failures since last success');
select * from finish();
rollback;
