-- Player teams, nickname fallback (2026-11-05). Real TNF data: the Odds API says "Matthew Hibner", Sleeper says
-- "Matt Hibner". If the exact name doesn't match, match first initial + last name, but ONLY when exactly one
-- rostered player of the two teams in that game fits (otherwise no team, never a guess).

create function private.initial_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select left(w[1], 1) || array_to_string(w[2:], '')
  from (select regexp_split_to_array(
                 trim(regexp_replace(
                   regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9 ]', '', 'g'),
                   '\s+(jr|sr|ii|iii|iv|v)\s*$', '')),
                 '\s+') as w) x;
$$;
grant execute on function private.initial_key(text) to anon, authenticated;

alter table public.player_teams add column initial_key text generated always as (private.initial_key(player_name)) stored;
create index player_teams_initial_key on public.player_teams (sport_key, initial_key);

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
    m.last_seen_at IS NULL OR m.last_seen_at < (now() - private.odds_max_age(e.commence_time)) AS is_stale,
    CASE
      WHEN o.participant_name = '' THEN NULL
      WHEN o.participant_name = e.home_team OR o.participant_name LIKE e.home_team || ' %' THEN e.home_team
      WHEN o.participant_name = e.away_team OR o.participant_name LIKE e.away_team || ' %' THEN e.away_team
      ELSE coalesce(
        (SELECT min(pt.team) FROM public.player_teams pt
          WHERE pt.sport_key = e.sport_key AND pt.name_key = private.name_key(o.participant_name)
            AND pt.team IN (e.home_team, e.away_team)),
        -- Nicknames (Matt/Matthew): first initial + last name, only if exactly ONE player in this game fits.
        (SELECT min(pt.team) FROM public.player_teams pt
          WHERE pt.sport_key = e.sport_key AND pt.initial_key = private.initial_key(o.participant_name)
            AND pt.team IN (e.home_team, e.away_team)
         HAVING count(*) = 1))
    END AS participant_team
   FROM public.odds_cache o
     JOIN public.events e ON e.id = o.event_id
     LEFT JOIN public.odds_markets m ON m.event_id = o.event_id AND m.market_key = o.market_key AND m.is_live = o.is_live
  WHERE NOT o.is_live;
