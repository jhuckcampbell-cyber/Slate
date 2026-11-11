-- College football legs grade, push and void like NFL: a total that lands on the number pushes
-- (stake refunded), a cancelled game voids (stake refunded), a normal final wins.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('a2800000-0000-0000-0000-000000000001','authenticated','authenticated','cfb@test.dev','{"display_name":"CFB host"}');
select set_config('request.jwt.claims', '{"sub":"a2800000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
 ('cfb-win','americanfootball_ncaaf','Alabama Crimson Tide','Georgia Bulldogs', now() + interval '2 days'),
 ('cfb-push','americanfootball_ncaaf','Ohio State Buckeyes','Michigan Wolverines', now() + interval '2 days'),
 ('cfb-void','americanfootball_ncaaf','Texas Longhorns','Oklahoma Sooners', now() + interval '2 days');
select public.odds_sync_ingest('odds','americanfootball_ncaaf', now(), '[]',
 '[{"event_id":"cfb-win","market_key":"h2h","outcome_name":"Alabama Crimson Tide","price_american":100,"bookmaker":"dk"},
   {"event_id":"cfb-push","market_key":"totals","outcome_name":"Over","point":52,"price_american":-110,"bookmaker":"dk"},
   {"event_id":"cfb-void","market_key":"h2h","outcome_name":"Texas Longhorns","price_american":100,"bookmaker":"dk"}]',
 '[{"event_id":"cfb-win","market_key":"h2h","bookmaker":"dk"},{"event_id":"cfb-push","market_key":"totals","bookmaker":"dk"},
   {"event_id":"cfb-void","market_key":"h2h","bookmaker":"dk"}]');
create temp table t as select * from public.create_tournament('CFB', array['cfb-win','cfb-push','cfb-void'], 'CFBG');
select public.place_wagers((select id from t), jsonb_build_array(jsonb_build_object('amount_cents',1000,'legs',
 jsonb_build_array(jsonb_build_object('odds_id',o.id,'price_american',o.price_american,'point',o.point)))))
from public.odds_cache o where o.event_id like 'cfb-%';
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t);
update public.events set commence_time = now() - interval '5 hours' where id like 'cfb-%';
select private.advance_statuses();

select public.scores_ingest('americanfootball_ncaaf', now(), '[
 {"event_id":"cfb-win","completed":true,"home_score":31,"away_score":17},
 {"event_id":"cfb-push","completed":true,"home_score":30,"away_score":22},
 {"event_id":"cfb-void","status":"canceled","status_reason":"Weather"}]');

select is((select l.status::text from public.wager_legs l where l.event_id='cfb-win'), 'hit', 'college winner hits');
select is((select l.status::text from public.wager_legs l where l.event_id='cfb-push'), 'push', 'college total on the number pushes');
select is((select l.status::text from public.wager_legs l where l.event_id='cfb-void'), 'void', 'cancelled college game voids');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id where l.event_id='cfb-win'), 2000::bigint, 'win pays 2x');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id where l.event_id='cfb-push'), 1000::bigint, 'push refunds stake');
select is((select w.payout_cents from public.wagers w join public.wager_legs l on l.wager_id=w.id where l.event_id='cfb-void'), 1000::bigint, 'void refunds stake');
select * from finish();
rollback;
