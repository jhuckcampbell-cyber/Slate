-- Player teams for the props board (2026-11-05). The Odds API names players but not their teams, so
-- odds-sync stores rosters from Sleeper's public player list (once a day, only while a props tournament
-- is active) and odds_board resolves each prop's player to the home or away team of THAT game.
-- * Matching: private.name_key ignores case, punctuation and Jr./Sr./II-style suffixes.
-- * A name shared across the league resolves to whichever team is actually in the game; a player on
--   neither team gets NULL (shown under no team), never a guess. "Baltimore Ravens D/ST" matches by name.
-- * Rosters are public sports data: readable by anyone, written only by the service role.

create function private.name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9 ]', '', 'g'),
             '\s+(jr|sr|ii|iii|iv|v)\s*$', ''),
           ' ', '');
$$;
grant execute on function private.name_key(text) to anon, authenticated;

create table public.player_teams (
  sport_key text not null,
  name_key text not null,
  player_name text not null,
  team text not null,
  primary key (sport_key, name_key, team)
);
alter table public.player_teams enable row level security;
revoke all on public.player_teams from anon, authenticated;
grant select on public.player_teams to anon, authenticated;
create policy "rosters are public" on public.player_teams for select to anon, authenticated using (true);

create table private.roster_sync_state (
  sport_key text primary key,
  last_sync_at timestamptz not null
);

-- Due when never synced or older than ~a day (Sleeper asks for at most one all-players call per day).
create function public.rosters_due(p_sport_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.roster_sync_state s
                     where s.sport_key = p_sport_key and s.last_sync_at > now() - interval '20 hours');
$$;

-- Replace a sport's roster wholesale (trades and cuts drop out). p_players: [{name, team}].
create function public.rosters_ingest(p_sport_key text, p_players jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  delete from public.player_teams where sport_key = p_sport_key;
  insert into public.player_teams (sport_key, name_key, player_name, team)
  select distinct on (private.name_key(x.name), x.team) p_sport_key, private.name_key(x.name), x.name, x.team
  from jsonb_to_recordset(p_players) as x(name text, team text)
  where coalesce(x.name, '') <> '' and coalesce(x.team, '') <> '';
  get diagnostics v_n = row_count;
  insert into private.roster_sync_state as s (sport_key, last_sync_at) values (p_sport_key, now())
  on conflict (sport_key) do update set last_sync_at = excluded.last_sync_at;
  return jsonb_build_object('players', v_n);
end;
$$;
revoke all on function public.rosters_due(text) from public, anon, authenticated;
revoke all on function public.rosters_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.rosters_due(text) to service_role;
grant execute on function public.rosters_ingest(text, jsonb) to service_role;

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
      ELSE (SELECT min(pt.team) FROM public.player_teams pt
            WHERE pt.sport_key = e.sport_key AND pt.name_key = private.name_key(o.participant_name)
              AND pt.team IN (e.home_team, e.away_team))
    END AS participant_team
   FROM public.odds_cache o
     JOIN public.events e ON e.id = o.event_id
     LEFT JOIN public.odds_markets m ON m.event_id = o.event_id AND m.market_key = o.market_key AND m.is_live = o.is_live
  WHERE NOT o.is_live;
