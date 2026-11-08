-- Live football player stats (2026-11-08). Football props (yards, receptions, passing TDs, anytime TD) used to sit at
-- their pregame chance all game: the box-score job only ran for the NBA. Now odds-sync pulls ESPN's free NFL box score
-- too (same feed, no Odds API credits; unofficial, replace before monetizing), so "62 Rush Yds · needs 13 more" and the
-- projected leaderboard move during the game.
--   * stats_due_jobs: NFL games in play with a prop pick get a stats job (once a minute), like NBA games.
--   * Stats may be negative: a QB can finish with -4 rushing yards.
--   * prop_sigma: yards spread with the line (a 60-yard rusher misses by 25 as often as a 25-point scorer misses by 6).
--   * Anytime TD ("Yes", no line): scored = 100%; at the final with none = 0%; in between the chance of at least one
--     more as the clock runs, 1 - (1 - pregame)^(share left).

alter table public.player_stats drop constraint if exists player_stats_stat_check;

create or replace function public.stats_ingest(p_event_id text, p_provider_id text, p_final boolean, p_stats jsonb,
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
    where coalesce(x.name, '') <> '' and coalesce(x.market_key, '') <> '' and x.stat is not null
      and x.stat between -999 and 9999
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

create or replace function private.stats_due_jobs() returns jsonb
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
    where e.sport_key in ('basketball_nba', 'americanfootball_nfl')
      and t.status in ('locked', 'live', 'settled')
      and e.commence_time <= now() and e.commence_time > now() - interval '8 hours'
      and e.status not in ('canceled', 'postponed')
      and not coalesce(s.is_final, false)
      and (s.last_sync_at is null or s.last_sync_at <= now() - interval '50 seconds')
      and exists (select 1 from public.wager_legs l
                  where l.tournament_id = t.id and l.event_id = e.id and l.participant_name <> '')
  ) g;
$$;
revoke all on function private.stats_due_jobs() from public;

-- Full-game spread of a player's stat around its line. Counting stats (points, rebounds, catches, TDs) spread like
-- √line; yards spread with the line itself (one long run or catch moves them a lot).
create or replace function private.prop_sigma(p_market_key text, p_line numeric) returns double precision
language sql immutable set search_path = '' as $$
  select case regexp_replace(p_market_key, '_alternate$', '')
           when 'player_points' then 1.3 * sqrt(greatest(p_line, 1))
           when 'player_pass_yds' then greatest(40, 0.25 * p_line)
           when 'player_rush_yds' then greatest(15, 0.45 * p_line)
           when 'player_reception_yds' then greatest(15, 0.55 * p_line)
           when 'player_receptions' then 0.85 * sqrt(greatest(p_line, 1))
           when 'player_pass_tds' then 0.8 * sqrt(greatest(p_line, 1))
           else 1.05 * sqrt(greatest(p_line, 1))
         end;
$$;

create or replace function private.prop_live_probability(l public.wager_legs, p_pregame double precision)
returns double precision
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
  if v_stat is null then return p_pregame; end if;
  if l.selection = 'Yes' then
    if v_stat >= 1 then return 1; end if;    -- anytime TD: he scored
  elsif l.line is null or l.selection not in ('Over', 'Under') then
    return p_pregame;
  elsif v_stat > l.line then
    return case when l.selection = 'Over' then 1 else 0 end;  -- facts first: past the line can't be undone
  end if;

  select * into v_s from private.stats_sync_state where event_id = l.event_id;
  if coalesce(v_s.is_final, false) then
    if l.selection = 'Yes' then return 0; end if;
    return case when l.selection = 'Under' or v_stat = l.line then 1 else 0 end;  -- equal = push (stake back)
  end if;
  v_r := v_s.remaining;
  if v_r is null then  -- no clock from the feed: estimate from kickoff
    select * into v_e from public.events where id = l.event_id;
    v_r := 1 - extract(epoch from now() - v_e.commence_time) / 60 / (select m.duration_minutes from private.sport_model(v_e.sport_key) m);
  end if;
  v_r := greatest(0.005, least(1, v_r));

  if l.selection = 'Yes' then
    -- Touchdowns come at a steady rate: the chance of none in the time left is (chance of none all game)^(share left).
    return 1 - power(1 - greatest(0, least(0.999, p_pregame)), v_r);
  end if;

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
revoke all on function private.prop_live_probability(public.wager_legs, double precision) from public;
grant execute on function private.prop_live_probability(public.wager_legs, double precision) to authenticated;
