-- One source for "which team is this player on in this game" (2026-11-05): the board view AND saved picks
-- (wager_legs.participant_team computed field, for the slip / My picks / reveal labels). Same rules as 0012/0014:
-- team defenses by name, exact name, then first initial + last name only if exactly one player in the game fits.

create function private.player_team(p_event_id text, p_participant text) returns text
language sql stable set search_path = '' as $$
  select case
    when coalesce(p_participant, '') = '' then null
    when p_participant = e.home_team or p_participant like e.home_team || ' %' then e.home_team
    when p_participant = e.away_team or p_participant like e.away_team || ' %' then e.away_team
    else coalesce(
      (select min(pt.team) from public.player_teams pt
        where pt.sport_key = e.sport_key and pt.name_key = private.name_key(p_participant)
          and pt.team in (e.home_team, e.away_team)),
      (select min(pt.team) from public.player_teams pt
        where pt.sport_key = e.sport_key and pt.initial_key = private.initial_key(p_participant)
          and pt.team in (e.home_team, e.away_team)
       having count(*) = 1))
  end
  from public.events e where e.id = p_event_id;
$$;
grant execute on function private.player_team(text, text) to anon, authenticated;

-- PostgREST computed field: select wager_legs(..., participant_team). Leg visibility is still RLS on wager_legs.
create function public.participant_team(l public.wager_legs) returns text
language sql stable set search_path = '' as $$
  select private.player_team(l.event_id, l.participant_name);
$$;
grant execute on function public.participant_team(public.wager_legs) to authenticated;

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
    private.player_team(o.event_id, o.participant_name) AS participant_team
   FROM public.odds_cache o
     JOIN public.events e ON e.id = o.event_id
     LEFT JOIN public.odds_markets m ON m.event_id = o.event_id AND m.market_key = o.market_key AND m.is_live = o.is_live
  WHERE NOT o.is_live;
