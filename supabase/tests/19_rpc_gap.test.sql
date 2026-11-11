-- Direct coverage for the tournament is_locked computed RPC (DB clock + status).
-- Synthetic tournament records keep this independent of seed data and cron.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ---------- time boundary: draft/open freeze at lock_time ----------
set local role authenticated;
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'draft', 'lock_time', now() + interval '1 hour'))),
  false, 'draft before lock: picks are not frozen');
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'open', 'lock_time', now() + interval '1 hour'))),
  false, 'open before lock: picks are not frozen');
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'open', 'lock_time', now()))),
  true, 'exactly at lock_time: picks are frozen');
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'draft', 'lock_time', now() - interval '1 second'))),
  true, 'past lock_time: even a draft is frozen');

-- ---------- advanced statuses freeze picks even with a future lock_time ----------
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'locked', 'lock_time', now() + interval '1 hour'))),
  true, 'locked status freezes picks before the scheduled lock');
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'live', 'lock_time', now() + interval '1 hour'))),
  true, 'live status freezes picks before the scheduled lock');
select is(public.is_locked(jsonb_populate_record(null::public.tournaments,
  jsonb_build_object('status', 'settled', 'lock_time', now() + interval '1 hour'))),
  true, 'settled status freezes picks before the scheduled lock');
reset role;

select * from finish();
rollback;
