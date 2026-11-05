-- Live game updates (2026-11-05). Once a minute while a game in a locked tournament is on, odds-sync reads ESPN's
-- public scoreboard (one free call per sport covers every game, NO Odds API credits; unofficial, non-commercial: swap
-- for a licensed feed before Slate makes money) and stores score, clock, down & distance and the last play.
-- In-progress scores also update events (so live chances move every minute instead of every scores sync), but a
-- FINAL only ever comes from scores_ingest (the graded feed): this feed never settles anything.

create table public.game_live (
  event_id text primary key references public.events on delete cascade,
  state text not null check (state in ('pre', 'in', 'post')),
  home_score int,
  away_score int,
  period int,
  detail text,          -- "8:21 - 3rd", "Halftime", "Final"
  situation text,       -- football: "2nd & 7 at JAX 34"
  last_play text,
  updated_at timestamptz not null default now()
);
alter table public.game_live enable row level security;
revoke all on public.game_live from anon, authenticated;
grant select on public.game_live to authenticated;
create policy "live games: everyone" on public.game_live for select to authenticated using (true);

create table private.live_sync_state (
  sport_key text primary key,
  last_sync_at timestamptz not null default now()
);

-- p_games: [{event_id, state, home_score, away_score, period, detail, situation, last_play}]
create function public.live_ingest(p_sport_key text, p_games jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids text[];
  v_tid uuid;
begin
  insert into private.live_sync_state as s (sport_key, last_sync_at) values (p_sport_key, now())
  on conflict (sport_key) do update set last_sync_at = excluded.last_sync_at;

  with x as (
    select * from jsonb_to_recordset(coalesce(p_games, '[]'::jsonb)) as x(event_id text, state text, home_score int,
      away_score int, period int, detail text, situation text, last_play text)
    where x.state in ('pre', 'in', 'post')
      and exists (select 1 from public.events e where e.id = x.event_id and e.sport_key = p_sport_key)
  ), up as (
    insert into public.game_live as g (event_id, state, home_score, away_score, period, detail, situation, last_play, updated_at)
    select x.event_id, x.state, x.home_score, x.away_score, x.period, x.detail, x.situation, x.last_play, now() from x
    on conflict (event_id) do update
      set state = excluded.state, home_score = excluded.home_score, away_score = excluded.away_score,
          period = excluded.period, detail = excluded.detail, situation = excluded.situation,
          last_play = excluded.last_play, updated_at = excluded.updated_at
      where (g.state, g.home_score, g.away_score, g.period, g.detail, g.situation, g.last_play)
            is distinct from (excluded.state, excluded.home_score, excluded.away_score, excluded.period,
                              excluded.detail, excluded.situation, excluded.last_play)
    returning g.event_id
  )
  select coalesce(array_agg(up.event_id), '{}') into v_ids from up;

  -- In-progress scores move the game (never to final: grading belongs to scores_ingest).
  update public.events e
     set home_score = g.home_score, away_score = g.away_score, status = 'live'
    from public.game_live g
   where g.event_id = e.id and g.event_id = any (v_ids) and g.state = 'in'
     and g.home_score is not null and g.away_score is not null
     and e.status in ('scheduled', 'live');

  for v_tid in
    select distinct te.tournament_id from public.tournament_events te
    join public.tournaments t on t.id = te.tournament_id
    where te.event_id = any (v_ids) and t.status in ('locked', 'live', 'settled')
  loop
    perform private.signal(v_tid, 'scores', '{}'::jsonb);
  end loop;
  return jsonb_build_object('changed', cardinality(v_ids));
end;
$$;
revoke all on function public.live_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.live_ingest(text, jsonb) to service_role;

-- One 'live' job per covered sport with games in play (from 15 min before kickoff, up to 8h), at most once a minute.
create function private.live_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'live', 'sport_key', g.sport_key, 'events', g.events)), '[]'::jsonb)
  from (
    select x.sport_key, jsonb_agg(jsonb_build_object('event_id', x.id, 'home_team', x.home_team,
                                                     'away_team', x.away_team, 'commence_time', x.commence_time)) as events
    from (
      select distinct e.id, e.sport_key, e.home_team, e.away_team, e.commence_time
      from public.events e
      join public.tournament_events te on te.event_id = e.id
      join public.tournaments t on t.id = te.tournament_id
      left join public.game_live gl on gl.event_id = e.id
      where e.sport_key in ('basketball_nba', 'americanfootball_nfl')
        and t.status in ('locked', 'live')
        and e.commence_time <= now() + interval '15 minutes' and e.commence_time > now() - interval '8 hours'
        and e.status not in ('final', 'canceled', 'postponed')
        and coalesce(gl.state, 'pre') <> 'post'
    ) x
    left join private.live_sync_state s on s.sport_key = x.sport_key
    where s.last_sync_at is null or s.last_sync_at <= now() - interval '50 seconds'
    group by x.sport_key
  ) g;
$$;
revoke all on function private.live_due_jobs() from public;

create or replace function private.odds_sync_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.odds_sync_odds_jobs() || private.stats_due_jobs() || private.live_due_jobs();
$$;
