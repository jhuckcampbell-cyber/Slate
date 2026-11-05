-- Live player stats (2026-11-05). During a game, odds-sync pulls the box score (ESPN's public game feed: free,
-- no key, NO Odds API credits; unofficial and not licensed for commercial use, so swap in a licensed feed
-- before Slate makes money) for each NBA game in play that someone bet a prop on. Every saved prop pick reads
-- its player's current number (wager_legs.live_stat computed field). Grading stays with the host (grade_prop).

create table public.player_stats (
  event_id text not null references public.events on delete cascade,
  name_key text not null,
  player_name text not null,
  team text,
  market_key text not null,          -- the base prop market (player_points, player_rebounds, ...)
  stat numeric(8,2) not null check (stat >= 0),
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (event_id, name_key, market_key)
);
alter table public.player_stats add column initial_key text generated always as (private.initial_key(player_name)) stored;
create index player_stats_initial_key on public.player_stats (event_id, market_key, initial_key);
alter table public.player_stats enable row level security;
revoke all on public.player_stats from anon, authenticated;
grant select on public.player_stats to authenticated;
-- Public sports data (no picks, no bankrolls): anyone signed in may read it.
create policy "player stats: everyone" on public.player_stats for select to authenticated using (true);

create table private.stats_sync_state (
  event_id text primary key references public.events on delete cascade,
  provider_id text,                  -- the feed's game id, once matched (skips the scoreboard lookup)
  is_final boolean not null default false,
  last_sync_at timestamptz not null default now()
);

-- p_stats: [{name, team, market_key, stat}]. Upserts what changed; the squad is signalled only on a change.
create function public.stats_ingest(p_event_id text, p_provider_id text, p_final boolean, p_stats jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed int;
  v_tid uuid;
begin
  insert into private.stats_sync_state as s (event_id, provider_id, is_final, last_sync_at)
  values (p_event_id, p_provider_id, coalesce(p_final, false), now())
  on conflict (event_id) do update
    set provider_id = coalesce(excluded.provider_id, s.provider_id),
        is_final = excluded.is_final,
        last_sync_at = excluded.last_sync_at;

  with incoming as (
    select distinct on (private.name_key(x.name), x.market_key)
           private.name_key(x.name) as name_key, x.name, x.team, x.market_key, x.stat
    from jsonb_to_recordset(coalesce(p_stats, '[]'::jsonb)) as x(name text, team text, market_key text, stat numeric)
    where coalesce(x.name, '') <> '' and coalesce(x.market_key, '') <> '' and x.stat >= 0
  ),
  up as (
    insert into public.player_stats as ps (event_id, name_key, player_name, team, market_key, stat, is_final, updated_at)
    select p_event_id, i.name_key, i.name, i.team, i.market_key, i.stat, coalesce(p_final, false), now()
    from incoming i
    on conflict (event_id, name_key, market_key) do update
      set stat = excluded.stat, is_final = excluded.is_final, team = excluded.team,
          player_name = excluded.player_name, updated_at = excluded.updated_at
      where ps.stat is distinct from excluded.stat or ps.is_final is distinct from excluded.is_final
    returning 1
  )
  select count(*) into v_changed from up;

  if v_changed > 0 then
    for v_tid in
      select distinct t.id from public.tournaments t
      join public.tournament_events te on te.tournament_id = t.id
      where te.event_id = p_event_id and t.status in ('locked', 'live', 'settled')
    loop
      perform private.signal(v_tid, 'scores', '{}'::jsonb);
    end loop;
  end if;
  return jsonb_build_object('changed', v_changed);
end;
$$;
revoke all on function public.stats_ingest(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.stats_ingest(text, text, boolean, jsonb) to service_role;

-- One player's number for one market in one game: exact name, else first initial + last name when exactly one
-- player in the game fits (same rule as player teams).
create function private.player_stat(p_event_id text, p_market_key text, p_participant text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(
    (select s.stat from public.player_stats s
      where s.event_id = p_event_id and s.market_key = regexp_replace(p_market_key, '_alternate$', '')
        and s.name_key = private.name_key(p_participant)),
    (select min(s.stat) from public.player_stats s
      where s.event_id = p_event_id and s.market_key = regexp_replace(p_market_key, '_alternate$', '')
        and s.initial_key = private.initial_key(p_participant)
     having count(*) = 1));
$$;
grant execute on function private.player_stat(text, text, text) to authenticated;

-- PostgREST computed field: select wager_legs(..., live_stat). Leg visibility is still RLS on wager_legs.
create function public.live_stat(l public.wager_legs) returns numeric
language sql stable set search_path = '' as $$
  select case when coalesce(l.participant_name, '') = '' then null
              else private.player_stat(l.event_id, l.market_key, l.participant_name) end;
$$;
grant execute on function public.live_stat(public.wager_legs) to authenticated;

-- Due-list: the existing jobs + one free 'stats' job per NBA game in play (kickoff ≤ 8h ago) that has a prop pick,
-- at most once a minute, until the feed says final. The old list is kept under a new name and extended.
alter function private.odds_sync_due_jobs() rename to odds_sync_odds_jobs;

create function private.stats_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'stats', 'sport_key', g.sport_key, 'event_id', g.id, 'home_team', g.home_team,
           'away_team', g.away_team, 'commence_time', g.commence_time, 'provider_id', g.provider_id)), '[]'::jsonb)
  from (
    select distinct e.id, e.sport_key, e.home_team, e.away_team, e.commence_time, s.provider_id
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    left join private.stats_sync_state s on s.event_id = e.id
    where e.sport_key = 'basketball_nba'
      and t.status in ('locked', 'live', 'settled')
      and e.commence_time <= now() and e.commence_time > now() - interval '8 hours'
      and e.status not in ('canceled', 'postponed')
      and not coalesce(s.is_final, false)
      and (s.last_sync_at is null or s.last_sync_at <= now() - interval '50 seconds')
      and exists (select 1 from public.wager_legs l
                  where l.tournament_id = t.id and l.event_id = e.id and l.participant_name <> '')
  ) g;
$$;

create function private.odds_sync_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.odds_sync_odds_jobs() || private.stats_due_jobs();
$$;
revoke all on function private.odds_sync_odds_jobs() from public;
revoke all on function private.stats_due_jobs() from public;
revoke all on function private.odds_sync_due_jobs() from public;
