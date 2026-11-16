-- Faster live feeds without an always-on worker.
-- 1) ESPN live/stats (free) refresh every 15s while a game is in its 8h window (was 50s).
--    Paid scores stay paced by recovery_score_interval = greatest(odds_scores_interval(), this).
-- 2) pg_cron ticks every 10s instead of every minute so the 15s "picked" odds tier and the
--    15s ESPN feeds are actually reachable. trigger_odds_sync only posts to the Edge Function
--    when odds_sync_due_jobs() is non-empty, and skips entirely while the worker heartbeat is
--    fresh, so idle ticks cost nothing. The single-writer lease prevents overlapping runs.
create or replace function private.recovery_interval(p_start timestamptz) returns interval
language sql stable set search_path = '' as $$
 select case when p_start < now()-interval '7 days' then interval '6 hours'
 when p_start < now()-interval '24 hours' then interval '1 hour'
 when p_start < now()-interval '8 hours' then interval '15 minutes' else interval '15 seconds' end;
$$;
revoke all on function private.recovery_interval(timestamptz) from public;

select cron.schedule('odds-sync', '10 seconds', 'select private.trigger_odds_sync()');
