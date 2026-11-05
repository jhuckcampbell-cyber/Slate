-- Receptions (2026-11-05): football props add "player_receptions" (catches, over/under) and its alternate ladder
-- ("player_receptions_alternate"), both real Odds API markets. Same shapes as the yardage markets, graded by the
-- host entering the catches once (an alternate ladder shares its main line's stat). Mirrors src/lib/core/props.ts.

create or replace function private.prop_markets(p_sport_key text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_sport_key like 'basketball%' then array['player_points', 'player_rebounds', 'player_assists']
    when p_sport_key like 'americanfootball%' then array[
      'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
      'player_pass_yds_alternate', 'player_rush_yds_alternate', 'player_reception_yds_alternate',
      'player_receptions_alternate', 'player_pass_tds', 'player_anytime_td']
    else '{}'::text[]
  end;
$$;
