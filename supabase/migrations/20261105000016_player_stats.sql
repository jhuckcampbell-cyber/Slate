-- Live player stats (2026-11-05). During a game, odds-sync pulls the box score (ESPN's public game feed: free,
-- no key, NO Odds API credits; unofficial and not licensed for commercial use, so swap in a licensed feed
-- before Slate makes money) for each NBA game in play that someone bet a prop on. Every saved prop pick reads
-- its player's current number (wager_legs.live_stat computed field), and its live chance follows the box score and
-- the clock (leg_probability, below). Grading stays with the host (grade_prop).

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
  remaining double precision check (remaining between 0 and 1),  -- share of the game left, from the feed's clock
  last_sync_at timestamptz not null default now()
);

-- p_stats: [{name, team, market_key, stat}]. Upserts what changed; the squad is signalled only on a change.
create function public.stats_ingest(p_event_id text, p_provider_id text, p_final boolean, p_stats jsonb,
                                    p_remaining double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed int;
  v_tid uuid;
begin
  insert into private.stats_sync_state as s (event_id, provider_id, is_final, remaining, last_sync_at)
  values (p_event_id, p_provider_id, coalesce(p_final, false),
          case when p_final then 0 else greatest(0, least(1, p_remaining)) end, now())
  on conflict (event_id) do update
    set provider_id = coalesce(excluded.provider_id, s.provider_id),
        is_final = excluded.is_final,
        remaining = coalesce(excluded.remaining, s.remaining),
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
revoke all on function public.stats_ingest(text, text, boolean, jsonb, double precision) from public, anon, authenticated;
grant execute on function public.stats_ingest(text, text, boolean, jsonb, double precision) to service_role;

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

-- ---------------------------------------------------------------------------
-- Live prop chance (Creative Enhancement #1, "Live Prop Sweat"). A prop pick's chance used to stay at its pregame
-- price all game. With a box score it follows pace: the player's number so far + what he's expected to add in the
-- time left (pregame expectation × share left), normal spread ~ k·√line·√(share left). The expectation comes from
-- the player's MAIN Over/Under pair (de-vigged), so a ladder line far above him is a long shot, not a coin flip;
-- without a pair, from the pick's own pregame chance. Settled facts are exact:
-- an Over already past its line is 100%, an Under past its line 0%, and at the final it's 100% or 0%.
-- Smooth by construction: it moves only when he scores or the clock runs, never with jumpy live odds.
-- The old calculation (game lines, pregame props) is kept as leg_probability_base and wrapped.
-- ---------------------------------------------------------------------------
alter function private.leg_probability(public.wager_legs) rename to leg_probability_base;

-- Full-game spread of a player's stat around its line (points come in 2s and 3s, so they spread wider).
create function private.prop_sigma(p_market_key text, p_line numeric) returns double precision
language sql immutable set search_path = '' as $$
  select case when regexp_replace(p_market_key, '_alternate$', '') = 'player_points' then 1.3 else 1.05 end
         * sqrt(greatest(p_line, 1));
$$;
grant execute on function private.prop_sigma(text, numeric) to authenticated;

create function private.prop_live_probability(l public.wager_legs, p_pregame double precision) returns double precision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_stat numeric := private.player_stat(l.event_id, l.market_key, l.participant_name);
  v_s private.stats_sync_state%rowtype;
  v_e public.events%rowtype;
  v_r double precision;           -- share of the game left
  v_sigma double precision;       -- full-game spread of the stat
  v_pre double precision;         -- pregame P(Over)
  v_mu double precision;          -- pregame expected stat
  v_over double precision;
  v_main record;                  -- the player's main Over/Under pair for this stat
begin
  if v_stat is null or l.line is null or l.selection not in ('Over', 'Under') then return p_pregame; end if;

  -- Facts first: past the line can't be undone.
  if v_stat > l.line then return case when l.selection = 'Over' then 1 else 0 end; end if;

  select * into v_s from private.stats_sync_state where event_id = l.event_id;
  if coalesce(v_s.is_final, false) then
    return case when l.selection = 'Under' or v_stat = l.line then 1 else 0 end;  -- equal = push (stake back)
  end if;
  v_r := v_s.remaining;
  if v_r is null then  -- no clock from the feed: estimate from kickoff
    select * into v_e from public.events where id = l.event_id;
    v_r := 1 - extract(epoch from now() - v_e.commence_time) / 60 / (select m.duration_minutes from private.sport_model(v_e.sport_key) m);
  end if;
  v_r := greatest(0.005, least(1, v_r));

  select o.point, o.price_american as over_price, u.price_american as under_price into v_main
  from public.odds_cache o
  join public.odds_cache u on u.event_id = o.event_id and u.market_key = o.market_key
   and u.participant_name = o.participant_name and u.point = o.point and u.outcome_name = 'Under' and not u.is_live
  where o.event_id = l.event_id and o.market_key = regexp_replace(l.market_key, '_alternate$', '')
    and o.participant_name = l.participant_name and o.outcome_name = 'Over' and not o.is_live
  limit 1;

  if v_main.point is not null then
    v_pre := 1 / (1 + case when v_main.over_price > 0 then v_main.over_price / 100.0 else 100.0 / -v_main.over_price end);
    v_pre := v_pre / (v_pre + 1 / (1 + case when v_main.under_price > 0 then v_main.under_price / 100.0
                                            else 100.0 / -v_main.under_price end));
    v_sigma := private.prop_sigma(l.market_key, v_main.point);
    v_mu := v_main.point;
  else
    v_pre := case when l.selection = 'Over' then p_pregame else 1 - p_pregame end;
    v_sigma := private.prop_sigma(l.market_key, l.line);
    v_mu := l.line;
  end if;
  v_pre := greatest(0.02, least(0.98, v_pre));
  v_mu := greatest(0, v_mu + v_sigma * ln(v_pre / (1 - v_pre)) / 1.702);   -- logistic ≈ probit
  v_over := private.norm_cdf((v_stat + v_mu * v_r - l.line) / (v_sigma * sqrt(v_r)));
  return case when l.selection = 'Over' then v_over else 1 - v_over end;
end;
$$;

create function private.leg_probability(l public.wager_legs) returns double precision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_p double precision := private.leg_probability_base(l);
begin
  if l.status <> 'pending' or coalesce(l.participant_name, '') = '' then return v_p; end if;
  return greatest(0, least(1, private.prop_live_probability(l, v_p)));
end;
$$;
revoke all on function private.prop_live_probability(public.wager_legs, double precision) from public;
revoke all on function private.leg_probability(public.wager_legs) from public;
grant execute on function private.prop_live_probability(public.wager_legs, double precision),
  private.leg_probability(public.wager_legs) to authenticated;
