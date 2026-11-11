-- Differential pre-lock probes: identical public state/caller, different hidden slip.
-- Intentionally fails for real error oracles; do not bless a leak with TODO/expected errors.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data) values
  ('a9000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ab-host@test.dev', false, '{"display_name":"Host"}'),
  ('a9000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'ab-player@test.dev', false, '{"display_name":"Player"}'),
  ('a9000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'ab-peer@test.dev', false, '{"display_name":"Peer"}');
insert into public.events (id, sport_key, home_team, away_team, commence_time) values
  ('ab-game', 'basketball_nba', 'Boston Celtics', 'New York Knicks', now() + interval '2 days');
select public.odds_sync_ingest('odds', 'basketball_nba', now(), '[]',
  '[{"event_id":"ab-game","market_key":"h2h","outcome_name":"Boston Celtics","price_american":-110,"bookmaker":"dk"},
    {"event_id":"ab-game","market_key":"h2h","outcome_name":"New York Knicks","price_american":-110,"bookmaker":"dk"}]',
  '[{"event_id":"ab-game","market_key":"h2h","bookmaker":"dk"}]');

create function pg_temp.as_user(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'a9000000-0000-0000-0000-00000000000' || p_suffix, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bet(p_amount bigint, p_team text) returns jsonb language sql as $$
  select jsonb_build_object('amount_cents', p_amount, 'legs', jsonb_build_array(
    jsonb_build_object('odds_id', c.id, 'price_american', c.price_american, 'point', c.point)))
  from public.odds_cache c where c.event_id = 'ab-game' and c.outcome_name = p_team;
$$;
-- Invoker, never definer. Capture every client-visible diagnostic except CONTEXT
-- (which includes source lines). Roll back successful mutations too, so probes are independent.
create function pg_temp.probe(p_sql text) returns jsonb language plpgsql as $$
declare s text; m text; d text; h text;
begin
  execute p_sql;
  raise exception using errcode = 'ZB001', message = 'probe rollback';
exception
  when sqlstate 'ZB001' then return jsonb_build_object('success', true);
  when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text,
      d = pg_exception_detail, h = pg_exception_hint;
    return jsonb_build_object('sqlstate', s, 'message', m, 'detail', d, 'hint', h);
end;
$$;

select pg_temp.as_user('a');
create temp table ab_t as select * from public.create_tournament(
  'Adversarial blind', array['ab-game'], 'AB', null, 10000, null, '{"markets":["h2h"]}');
select public.set_tournament_tokens((select id from ab_t), '[2500,7500]');
select pg_temp.as_user('b');
select public.join_tournament((select code from ab_t));
select pg_temp.as_user('c');
select public.join_tournament((select code from ab_t));

create temp table ab_cases (name text primary key, caller text, sql text, before jsonb);
insert into ab_cases (name, caller, sql) values
  ('host invalid tokens', 'a', $$select public.set_tournament_tokens((select id from ab_t), '{}')$$),
  ('host clear tokens', 'a', $$select public.set_tournament_tokens((select id from ab_t), null)$$),
  ('host valid tokens', 'a', $$select public.set_tournament_tokens((select id from ab_t), '[5000,5000]')$$),
  ('host bankroll edit', 'a', $$select public.update_tournament((select id from ab_t), '{"starting_bankroll_cents":20000}')$$),
  ('host title edit', 'a', $$select public.update_tournament((select id from ab_t), '{"title":"New title"}')$$),
  ('host rule edit', 'a', $$select public.update_tournament((select id from ab_t), '{"allowed_bet_types":{"min_bets":2}}')$$),
  ('host invalid cap', 'a', $$select public.update_tournament((select id from ab_t), '{"max_bet_cents":1000}')$$),
  ('host removes player', 'a', $$select public.remove_participant((select id from ab_t), 'a9000000-0000-0000-0000-00000000000b')$$),
  ('host leaves', 'a', $$select public.leave_tournament((select id from ab_t))$$),
  ('peer leaves', 'c', $$select public.leave_tournament((select id from ab_t))$$),
  ('peer sets tokens', 'c', $$select public.set_tournament_tokens((select id from ab_t), '{}')$$),
  ('peer edits rules', 'c', $$select public.update_tournament((select id from ab_t), '{}')$$),
  ('peer removes player', 'c', $$select public.remove_participant((select id from ab_t), 'a9000000-0000-0000-0000-00000000000b')$$);
grant select on ab_t, ab_cases to authenticated;
grant update on ab_cases to authenticated;

-- Baselines run under real RLS, with the victim joined but no picks.
set local role authenticated;
do $$ declare r record; begin
  for r in select * from ab_cases order by name loop
    perform pg_temp.as_user(r.caller);
    update ab_cases set before = pg_temp.probe(r.sql) where name = r.name;
  end loop;
end $$;
reset role;

select pg_temp.as_user('b');
set local role authenticated;
select public.place_wagers((select id from ab_t), jsonb_build_array(
  pg_temp.bet(2500, 'Boston Celtics'), pg_temp.bet(7500, 'New York Knicks')));
reset role;
-- Attacker is deliberately given IDs, so obscurity of UUIDs cannot make these pass.
create temp table ab_ids as select w.id from public.wagers w where w.tournament_id = (select id from ab_t);
grant select on ab_ids to authenticated;
select is((select count(*)::int from ab_ids), 2, 'fixture has two real hidden wagers');
select is((select remaining_bankroll_cents from public.tournament_participants
  where tournament_id = (select id from ab_t) and user_id = 'a9000000-0000-0000-0000-00000000000b'),
  0::bigint, 'fixture spent the victim bankroll and both tokens');

set local role authenticated;
create function pg_temp.compare_probes() returns setof text language plpgsql as $$
declare r record;
begin
  for r in select * from ab_cases order by name loop
    perform pg_temp.as_user(r.caller);
    return next is(pg_temp.probe(r.sql), r.before, r.name || ': hidden picks cannot change result or diagnostics');
  end loop;
end;
$$;
select * from pg_temp.compare_probes();

-- Host and peer see only their own participant/leaderboard row. Test raw legs as
-- well as joins; computed fields must have no hidden source rows to evaluate.
create function pg_temp.check_blind(p_caller text) returns setof text language plpgsql as $$
begin
  perform pg_temp.as_user(p_caller);
  return next is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)),
    0, p_caller || ': wagers blind');
  return next is((select count(*)::int from public.wager_legs where wager_id in (select id from ab_ids)),
    0, p_caller || ': raw legs blind even with known IDs');
  return next is((select count(*)::int from public.tournament_participants
    where tournament_id = (select id from ab_t) and user_id <> auth.uid()),
    0, p_caller || ': other bankrolls and payout totals blind');
  return next is((select count(*)::int from public.leaderboard
    where tournament_id = (select id from ab_t) and user_id <> auth.uid()),
    0, p_caller || ': leaderboard hides cash/max/EV/rank/standing/bet count/wagered/qualified');
  return next is((select count(*)::int from (
    select public.live_probability(w), public.current_payout(w) from public.wagers w
      where w.id in (select id from ab_ids)
    union all
    select public.live_probability(l), null::bigint from public.wager_legs l
      where l.wager_id in (select id from ab_ids)) computed),
    0, p_caller || ': computed probabilities and payouts have no hidden rows');
  -- Existing, pending, settled, and nonexistent IDs must be indistinguishable
  -- to a non-owner, before any replacement slip/token validation happens.
  return next is(pg_temp.probe('select public.cancel_wager((select id from ab_ids order by id limit 1))'),
    pg_temp.probe($q$select public.cancel_wager('00000000-0000-0000-0000-000000000000')$q$),
    p_caller || ': cancel cannot detect hidden wager existence');
  return next is(pg_temp.probe('select public.replace_wager((select id from ab_ids order by id limit 1), ''[]'')'),
    pg_temp.probe($q$select public.replace_wager('00000000-0000-0000-0000-000000000000', '[]')$q$),
    p_caller || ': replace cannot detect hidden wager existence or tokens');
end;
$$;
select * from pg_temp.check_blind('a');
select * from pg_temp.check_blind('c');
reset role;

-- Repeat with a settled hidden wager: no WAGER_SETTLED ownership oracle.
update public.wagers set status = 'void' where id = (select id from ab_ids order by id limit 1);
set local role authenticated;
select * from pg_temp.check_blind('a');
select * from pg_temp.check_blind('c');
-- Owner positive controls prevent a trivially empty database from passing reads.
select pg_temp.as_user('b');
select is((select count(*)::int from public.wagers where tournament_id = (select id from ab_t)),
  2, 'owner can read their picks pre-lock');
reset role;

select * from finish();
rollback;
