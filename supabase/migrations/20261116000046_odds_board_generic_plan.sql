-- 0045 still let a GENERIC plan (PostgREST's prepared `event_id = any($1)`) compute odds_max_age for EVERY event
-- (~10s, 95 events) because the ANY filter on odds_cache doesn't propagate to events. Hang the per-game
-- lookup off each price row instead: Memoize caches it per event, so one budget read per game in any plan.
create or replace view public.odds_board with (security_invoker = true) as
SELECT o.id, o.event_id, o.market_key, o.outcome_name, o.participant_name, o.point, o.price_american, o.price_decimal,
    o.updated_at, m.last_seen_at,
    m.last_seen_at IS NULL OR m.last_seen_at < (now() - a.max_age) AS is_stale,
    private.player_team(o.event_id, o.participant_name) AS participant_team
   FROM public.odds_cache o
     CROSS JOIN LATERAL (SELECT private.odds_max_age(ev.commence_time) AS max_age
                         FROM public.events ev WHERE ev.id = o.event_id OFFSET 0) a
     LEFT JOIN public.odds_markets m ON m.event_id = o.event_id AND m.market_key = o.market_key AND m.is_live = o.is_live
  WHERE NOT o.is_live;
