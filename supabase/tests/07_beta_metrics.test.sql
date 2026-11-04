-- Closed-beta feasibility metric: does a group start a second tournament?
-- A finished tournament "repeats" when a later tournament (created after its lock) has at least
-- two of the same players. Operator-only (service role).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'm1@test.dev', false, '{"display_name":"Ann"}'),
  ('b1000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', null, true, '{"display_name":"Ben"}'),
  ('c1000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', null, true, '{"display_name":"Cy"}'),
  ('d1000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', null, true, '{"display_name":"Di"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('bm-g1', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');

-- Baseline: whatever the local DB already holds.
create temp table before as select public.beta_metrics() as m;

-- T1: Ann hosts, Ben and Cy join. Finished.
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
create temp table t1 as select * from public.create_tournament('Metric One', array['bm-g1'], 'MO');
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t1));
select pg_temp.as_user('c1000000-0000-0000-0000-00000000000c');
select public.join_tournament((select code from t1));
update public.tournaments set lock_time = now() - interval '2 hours' where id = (select id from t1);
update public.tournaments set status = 'settled' where id = (select id from t1);

-- T2 (later): Di hosts, only Ann joins → just one shared player: not a repeat yet.
select pg_temp.as_user('d1000000-0000-0000-0000-00000000000d');
create temp table t2 as select * from public.create_tournament('Metric Two', array['bm-g1'], 'MT');
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
select public.join_tournament((select code from t2));

create function pg_temp.delta(p_key text) returns int language sql as $$
  select (public.beta_metrics() ->> p_key)::int - ((select m from before) ->> p_key)::int;
$$;

select is(pg_temp.delta('tournaments_created'), 2, 'counts tournaments created');
select is(pg_temp.delta('tournaments_finished'), 1, 'counts finished tournaments');
select is(pg_temp.delta('players'), 4, 'counts distinct players');
select is(pg_temp.delta('finished_with_repeat'), 0, 'one shared player is not the same group');

-- Ben joins T2 too → two of T1's players play again.
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
select public.join_tournament((select code from t2));
select is(pg_temp.delta('finished_with_repeat'), 1, 'two of the same players in a later tournament: the group came back');

set local role authenticated;
select throws_ok($$ select public.beta_metrics() $$, '42501', null, 'players cannot read operator metrics');
reset role;
select ok((public.beta_metrics() ->> 'repeat_rate') is not null, 'reports a repeat rate');

select * from finish();
rollback;
