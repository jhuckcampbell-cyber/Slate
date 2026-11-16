-- odds_board computed private.odds_max_age once PER PRICE ROW. It reads the odds budget (sums over api_usage), so a
-- game with ~560 prop prices took ~25s and PostgREST's 8s timeout returned an empty board. Compute it once per game:
-- the OFFSET 0 lateral keeps the planner from inlining the call back into every row. Same columns, same semantics.
create or replace view public.odds_board with (security_invoker = true) as
SELECT o.id,
    o.event_id,
    o.market_key,
    o.outcome_name,
    o.participant_name,
    o.point,
    o.price_american,
    o.price_decimal,
    o.updated_at,
    m.last_seen_at,
    m.last_seen_at IS NULL OR m.last_seen_at < (now() - a.max_age) AS is_stale,
    private.player_team(o.event_id, o.participant_name) AS participant_team
   FROM public.events e
     CROSS JOIN LATERAL (SELECT private.odds_max_age(e.commence_time) AS max_age OFFSET 0) a
     JOIN public.odds_cache o ON o.event_id = e.id
     LEFT JOIN public.odds_markets m ON m.event_id = o.event_id AND m.market_key = o.market_key AND m.is_live = o.is_live
  WHERE NOT o.is_live;
