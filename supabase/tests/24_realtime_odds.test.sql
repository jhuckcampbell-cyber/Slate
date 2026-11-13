begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- realtime.send writes to realtime.messages; read the rows it produced (rolled back at the end).
create temp view captured_odds as
  select payload, event, topic, private from realtime.messages where topic like 'odds:%' and inserted_at >= now();  -- now() = this transaction's start
insert into public.events(id,sport_key,home_team,away_team,commence_time)
values ('rt-odds-a','basketball_nba','A','B',now()+interval '1 day'),
       ('rt-odds-b','basketball_nba','C','D',now()+interval '1 day');
insert into public.odds_cache(event_id,market_key,outcome_name,price_american,bookmaker)
values ('rt-odds-a','h2h','A',-110,'test'),('rt-odds-b','h2h','C',110,'test');
update public.odds_cache set price_american=-120 where event_id='rt-odds-a';
set constraints all immediate;
select is((select count(*) from captured_odds where event='odds'),1::bigint,'one signal per sport per batch');
select is((select jsonb_array_length(payload->'event_ids') from captured_odds where event='odds'),2,'both events included');
select is((select payload->'market_keys' from captured_odds where event='odds'),'["h2h"]'::jsonb,'distinct markets');
select is((select array_agg(k order by k) from captured_odds c cross join lateral jsonb_object_keys(c.payload) k where event='odds'),array['event_ids','id','market_keys','version'],'payload (id = realtime message id) excludes prices, picks, bankrolls and wagers');
select ok((select private from captured_odds where event='odds'),'private transport');
select ok(not private.can_read_channel('tournament:10000000-0000-0000-0000-000000000000'),'non-member cannot receive tournament');
select ok(not has_function_privilege('anon','private.can_read_channel(text)','execute'),'unauthenticated cannot authorize tournaments');
select ok(exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='odds channels: authenticated receive broadcasts' and roles=array['authenticated']::name[] and cmd='SELECT'),'odds policy only permits authenticated receivers');
select * from finish();
rollback;
