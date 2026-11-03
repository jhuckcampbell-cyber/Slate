-- Phase 1 RLS/RPC tests. Users: A (host), B (joins), C (outsider).
-- auth.uid() reads request.jwt.claims; RLS/grants depend on the active role. Switch both.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@test.dev', false, '{"display_name":"Alice"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'authenticated', 'authenticated', null,        true,  '{"display_name":"Bob"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'authenticated', 'authenticated', null,        true,  '{}');

insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('t-ev-1',   'americanfootball_nfl', 'Chiefs',  'Bills',   now() + interval '2 days'),
  ('t-ev-2',   'americanfootball_nfl', 'Eagles',  'Cowboys', now() + interval '3 days'),
  ('t-ev-nba', 'basketball_nba',       'Celtics', 'Knicks',  now() + interval '2 days');

-- ---------- profiles trigger ----------
select is((select display_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice', 'profile created from metadata display_name');
select is((select is_guest from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  true, 'anonymous user profile is a guest');
select matches((select display_name from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003'),
  '^Player [A-Z0-9]{4}$', 'fallback display name when none provided');

-- ---------- A creates a tournament ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temp table t_created as
  select * from public.create_tournament('Thursday Night Football', array['t-ev-1','t-ev-2'], 'TNF');
grant select on t_created to anon, authenticated;
set local role authenticated;

select matches((select code from t_created), '^TNF-[2-9A-HJ-KMNP-TV-Z]{4}$', 'code has prefix + valid suffix');
select is((select lock_time from public.tournaments where id = (select id from t_created)),
  now() + interval '2 days', 'lock_time defaults to first kickoff');
select is((select remaining_bankroll_cents from public.tournament_participants
           where tournament_id = (select id from t_created)), 10000, 'host auto-joined with $100');
select is((select count(*)::int from public.tournament_events where tournament_id = (select id from t_created)),
  2, 'events attached');

select throws_ok($$ select * from public.create_tournament('Bad', array['t-ev-1','t-ev-nba']) $$,
  'MIXED_SPORTS', 'cannot mix sports');
select throws_ok($$ select * from public.create_tournament('Bad', array['t-ev-1'], 'SB', null, 10000, null, null, now() + interval '5 days') $$,
  'INVALID_LOCK_TIME', 'lock cannot be after first kickoff');
select throws_ok($$ select * from public.create_tournament('Bad', array['nope']) $$,
  'INVALID_EVENTS', 'unknown event rejected');

-- ---------- direct writes are denied ----------
select throws_ok($$ insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
                    select id, 'aaaaaaaa-0000-0000-0000-000000000001', 999999 from t_created $$,
  '42501', null, 'no direct insert into participants');
select throws_ok($$ update public.tournaments set starting_bankroll_cents = 1 $$,
  '42501', null, 'no direct update of tournaments');
select throws_ok($$ update public.profiles set is_guest = false where id = auth.uid() $$,
  '42501', null, 'cannot self-promote from guest');

-- ---------- preview is public (anon) ----------
reset role;
set local role anon;
select is((select title from public.get_tournament_preview((select code from t_created))),
  'Thursday Night Football', 'anon can read share preview');
select is((select participant_count from public.get_tournament_preview((select code from t_created))),
  1, 'preview shows participant count');
select is((select is_locked from public.get_tournament_preview((select code from t_created))),
  false, 'preview reports unlocked pre-lock');
select throws_ok($$ select count(*) from public.tournaments $$, '42501', null, 'anon cannot read tables');
select ok((select count(*) from public.events) >= 3, 'anon can read public schedule');

-- ---------- C (outsider) ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.tournaments), 0, 'outsider sees no tournaments');
select throws_ok($$ select * from public.get_roster((select id from t_created)) $$,
  'NOT_A_PARTICIPANT', 'outsider cannot read roster');
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'outsider cannot see host profile');

-- ---------- B joins ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.join_tournament(lower((select code from t_created))), (select id from t_created),
  'join by code (case-insensitive)');
select is(public.join_tournament((select code from t_created)), (select id from t_created),
  'join is idempotent');
select is((select count(*)::int from public.tournaments), 1, 'participant sees tournament');
select is((select count(*)::int from public.get_roster((select id from t_created))), 2, 'roster shows both players');

-- BLIND: pre-lock, B sees only their own participant row (no peeking at bankrolls).
select is((select count(*)::int from public.tournament_participants
           where tournament_id = (select id from t_created)), 1, 'pre-lock: only own participant row visible');

-- ---------- lock passes ----------
reset role;
update public.tournaments set lock_time = now() - interval '1 second' where id = (select id from t_created);
select is((select is_locked from public.get_tournament_preview((select code from t_created))),
  true, 'preview reports locked once lock_time passes');

set local role authenticated;  -- claims still B
select is((select count(*)::int from public.tournament_participants
           where tournament_id = (select id from t_created)), 2, 'post-lock: all participant rows revealed');

reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select public.join_tournament(%L)', (select code from t_created)),
  'TOURNAMENT_LOCKED', 'cannot join after lock');
select is((select count(*)::int from public.tournament_participants), 0, 'outsider still sees nothing post-lock');

reset role;
select * from finish();
rollback;
