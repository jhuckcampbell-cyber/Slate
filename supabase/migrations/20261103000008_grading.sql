-- Phase 5: scores → grading → payouts → live win probability → leaderboard → settlement.
--
-- Scores arrive through public.scores_ingest (odds-sync Edge Function, kind 'scores', budgeted
-- like any paid call). A final score grades every pending leg on that game in the same
-- transaction, settles the wagers it decides, and credits bankrolls. Win probability is computed
-- on read (no credits, no cron): de-vigged closing prices before kickoff, then a normal model on
-- the live score and the share of the game left. The leaderboard view inherits RLS, so it is as
-- blind before lock as the tables under it (rule 1).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.wagers add column payout_cents bigint check (payout_cents >= 0);  -- credited return
alter table private.odds_sync_state add column last_scores_sync_at timestamptz;
insert into private.app_settings (key, value) values ('scores_refresh', '"15 minutes"');

-- Grading may write payout_cents too (CLAUDE.md: widen the guard on purpose).
create or replace function private.guard_wager_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tournament_id uuid := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;
  v_outcome constant text[] := array['status', 'is_locked', 'win_probability', 'settled_at', 'payout_cents'];
begin
  if not private.picks_frozen(v_tournament_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'TOURNAMENT_LOCKED';
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_outcome) is distinct from (to_jsonb(old) - v_outcome) then
      raise exception 'TOURNAMENT_LOCKED';
    end if;
    return new;
  end if;
  if exists (select 1 from public.tournament_participants p where p.id = old.participant_id) then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grading
-- ---------------------------------------------------------------------------
create function private.leg_result(
  p_market text, p_selection text, p_line numeric,
  p_home text, p_away text, p_home_score int, p_away_score int
) returns public.leg_status
language sql immutable set search_path = '' as $$
  select case
    when p_market = 'h2h' and p_selection in (p_home, p_away) then
      case when p_home_score = p_away_score then 'push'
           when (p_home_score > p_away_score) = (p_selection = p_home) then 'hit'
           else 'miss' end
    when p_market = 'spreads' and p_selection in (p_home, p_away) then
      case sign(case when p_selection = p_home then p_home_score - p_away_score
                     else p_away_score - p_home_score end + p_line)
        when 1 then 'hit' when 0 then 'push' else 'miss' end
    when p_market = 'totals' and p_selection in ('Over', 'Under') then
      case sign((p_home_score + p_away_score - p_line) * case when p_selection = 'Over' then 1 else -1 end)
        when 1 then 'hit' when 0 then 'push' else 'miss' end
    else 'pending'  -- props etc.: graded by hand (later)
  end::public.leg_status;
$$;

-- What a wager returns as things stand: the stake if every leg pushed/voided, otherwise the stake
-- times the product of the live legs, with place_wagers' rounding (4dp, capped at 1001).
create function public.current_payout(w public.wagers) returns bigint
language plpgsql stable set search_path = '' as $$
declare
  v_dec numeric := 1;
  v_live int := 0;
  v_leg record;
begin
  if w.status <> 'pending' then
    return coalesce(w.payout_cents, 0);
  end if;
  for v_leg in select l.odds_decimal from public.wager_legs l
               where l.wager_id = w.id and l.status not in ('push', 'void') loop
    v_dec := v_dec * v_leg.odds_decimal;
    v_live := v_live + 1;
  end loop;
  if v_live = 0 then
    return w.amount_cents;
  end if;
  return floor(w.amount_cents * least(round(v_dec, 4), 1001))::bigint;
end;
$$;

create function private.settle_wager(p_wager_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_w public.wagers%rowtype;
  v_payout bigint;
  v_status public.wager_status;
begin
  select * into v_w from public.wagers where id = p_wager_id for update;
  if not found or v_w.status <> 'pending' then
    return;
  end if;
  if exists (select 1 from public.wager_legs l where l.wager_id = p_wager_id and l.status = 'miss') then
    v_status := 'lost';
    v_payout := 0;
  elsif exists (select 1 from public.wager_legs l where l.wager_id = p_wager_id and l.status = 'pending') then
    return;
  else
    v_payout := public.current_payout(v_w);
    v_status := case when exists (select 1 from public.wager_legs l
                                  where l.wager_id = p_wager_id and l.status = 'hit')
                     then 'won' else 'pushed' end;
  end if;

  update public.wagers set status = v_status, payout_cents = v_payout, settled_at = now() where id = p_wager_id;
  update public.tournament_participants
     set remaining_bankroll_cents = remaining_bankroll_cents + v_payout,
         total_potential_payout_cents = greatest(0, total_potential_payout_cents - v_w.potential_payout_cents)
   where id = v_w.participant_id;
end;
$$;

create function private.grade_event(p_event_id text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_e public.events%rowtype;
  v_wager uuid;
  v_n int := 0;
begin
  select * into v_e from public.events where id = p_event_id;
  if not found or v_e.status <> 'final' or v_e.home_score is null or v_e.away_score is null then
    return 0;
  end if;
  for v_wager in
    with graded as (
      update public.wager_legs l
         set status = private.leg_result(l.market_key, l.selection, l.line,
                                         v_e.home_team, v_e.away_team, v_e.home_score, v_e.away_score),
             settled_at = now()
       where l.event_id = p_event_id and l.status = 'pending'
         and private.leg_result(l.market_key, l.selection, l.line,
                                v_e.home_team, v_e.away_team, v_e.home_score, v_e.away_score) <> 'pending'
      returning l.wager_id
    )
    select distinct g.wager_id from graded g
  loop
    perform private.settle_wager(v_wager);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Games that never report a final (postponed, canceled, or the feed lost them) are voided 12h
-- after kickoff, refunding the stake (parlays drop the leg), so tournaments can always finish.
create function private.void_stale_legs() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_wager uuid;
begin
  for v_wager in
    with voided as (
      update public.wager_legs l set status = 'void', settled_at = now()
        from public.events e
       where e.id = l.event_id and l.status = 'pending'
         and (e.status in ('postponed', 'canceled')
              or (e.status <> 'final' and e.commence_time < now() - interval '12 hours'))
      returning l.wager_id
    )
    select distinct v.wager_id from voided v
  loop
    perform private.settle_wager(v_wager);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scores ingest (service role only)
-- ---------------------------------------------------------------------------
create function public.scores_ingest(p_sport_key text, p_fetched_at timestamptz, p_scores jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids text[];
  v_graded int := 0;
  v_id text;
  v_tid uuid;
begin
  -- Finals are final: later corrections are ignored, so a re-sent final can never pay twice.
  with x as (
    select * from jsonb_to_recordset(p_scores) as x(event_id text, completed boolean, home_score int, away_score int)
    where x.home_score is not null and x.away_score is not null
  ), upd as (
    update public.events e
       set home_score = x.home_score,
           away_score = x.away_score,
           status = case when x.completed then 'final' else 'live' end,
           scores_synced_at = p_fetched_at
      from x
     where e.id = x.event_id and e.status not in ('final', 'canceled')
       and (e.home_score, e.away_score, e.status)
           is distinct from (x.home_score, x.away_score, case when x.completed then 'final' else 'live' end)
    returning e.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;

  foreach v_id in array v_ids loop
    v_graded := v_graded + private.grade_event(v_id);
  end loop;

  -- Signal (no data) every tournament sweating these games; clients refetch through RLS.
  for v_tid in
    select distinct te.tournament_id from public.tournament_events te
    join public.tournaments t on t.id = te.tournament_id
    where te.event_id = any (v_ids) and t.status in ('locked', 'live')
  loop
    perform private.signal(v_tid, 'scores', '{}'::jsonb);
  end loop;

  insert into private.odds_sync_state as s (sport_key, last_scores_sync_at)
  values (p_sport_key, p_fetched_at)
  on conflict (sport_key) do update
     set last_scores_sync_at = greatest(s.last_scores_sync_at, excluded.last_scores_sync_at);

  return jsonb_build_object('events_updated', coalesce(array_length(v_ids, 1), 0), 'wagers_graded', v_graded);
end;
$$;
revoke all on function public.scores_ingest(text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.scores_ingest(text, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Win probability
-- ---------------------------------------------------------------------------
-- Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
create function private.norm_cdf(x double precision) returns double precision
language sql immutable set search_path = '' as $$
  with z as (select abs(x) / sqrt(2.0) as z),
       t as (select 1.0 / (1.0 + 0.3275911 * z.z) as t, z.z from z)
  select 0.5 * (1 + sign(x) * (1 - (((((1.061405429 * t.t - 1.453152027) * t.t) + 1.421413741) * t.t
                                      - 0.284496736) * t.t + 0.254829592) * t.t * exp(-t.z * t.z)))
  from t;
$$;

-- Game length (minutes, wall clock) and final-margin / final-total standard deviations.
create function private.sport_model(p_sport_key text,
  out duration_minutes double precision, out margin_sd double precision, out total_sd double precision)
language sql immutable set search_path = '' as $$
  select case p_sport_key
           when 'americanfootball_nfl' then 190 when 'americanfootball_ncaaf' then 210
           when 'basketball_nba' then 150 when 'basketball_ncaab' then 130 else 180 end,
         case when p_sport_key like 'basketball%' then 12 else 13.5 end,
         case when p_sport_key like 'basketball%' then 17 else 13 end;
$$;

create function private.leg_probability(l public.wager_legs) returns double precision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.events%rowtype;
  v_m record;
  v_live boolean;
  v_r double precision := 1;          -- share of the game left
  v_d double precision := 0;          -- home margin so far
  v_c double precision := 0;          -- points so far
  v_mu double precision;              -- expected final home margin (pregame)
  v_tau double precision;             -- expected final total (pregame)
  v_home_price int;
  v_away_price int;
  v_p_home double precision;          -- de-vigged pregame P(home wins)
  v_is_home boolean;
  v_p double precision;
begin
  if l.status in ('hit', 'push', 'void') then return 1; end if;
  if l.status = 'miss' then return 0; end if;

  select * into v_e from public.events where id = l.event_id;
  select * into v_m from private.sport_model(v_e.sport_key);
  v_is_home := l.selection = v_e.home_team;

  v_live := v_e.home_score is not null and v_e.away_score is not null and v_e.status in ('live', 'final');
  if v_live then
    v_r := greatest(0.02, least(1, 1 - extract(epoch from now() - v_e.commence_time) / 60 / v_m.duration_minutes));
    v_d := v_e.home_score - v_e.away_score;
    v_c := v_e.home_score + v_e.away_score;
  end if;

  -- Closing (last pregame) prices for this game.
  select -o.point into v_mu from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'spreads' and o.outcome_name = v_e.home_team and not o.is_live;
  select o.point into v_tau from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'totals' and o.outcome_name = 'Over' and not o.is_live;
  select o.price_american into v_home_price from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'h2h' and o.outcome_name = v_e.home_team and not o.is_live;
  select o.price_american into v_away_price from public.odds_cache o
   where o.event_id = l.event_id and o.market_key = 'h2h' and o.outcome_name = v_e.away_team and not o.is_live;
  if v_home_price is not null and v_away_price is not null then
    v_p_home := (100.0 / (1 + case when v_home_price > 0 then v_home_price / 100.0 else 100.0 / -v_home_price end));
    v_p_home := v_p_home / (v_p_home + (100.0 / (1 + case when v_away_price > 0 then v_away_price / 100.0
                                                          else 100.0 / -v_away_price end)));
  end if;
  -- No spread market: back the margin out of the moneyline (logistic ≈ probit, 1.702).
  if v_mu is null and v_p_home is not null then
    v_mu := v_m.margin_sd * ln(v_p_home / (1 - v_p_home)) / 1.702;
  end if;

  if l.market_key = 'h2h' then
    if not v_live and v_p_home is not null then
      v_p := case when v_is_home then v_p_home else 1 - v_p_home end;
    else
      v_p := private.norm_cdf((v_d + coalesce(v_mu, 0) * v_r) / (v_m.margin_sd * sqrt(v_r)));
      if not v_is_home then v_p := 1 - v_p; end if;
    end if;
  elsif l.market_key = 'spreads' then
    v_mu := coalesce(v_mu, case when v_is_home then -l.line else l.line end);
    v_p := private.norm_cdf(
      ((case when v_is_home then 1 else -1 end) * (v_d + v_mu * v_r) + l.line) / (v_m.margin_sd * sqrt(v_r)));
  elsif l.market_key = 'totals' then
    v_p := private.norm_cdf((v_c + coalesce(v_tau, l.line) * v_r - l.line) / (v_m.total_sd * sqrt(v_r)));
    if l.selection = 'Under' then v_p := 1 - v_p; end if;
  else
    v_p := 1 / l.odds_decimal;  -- props: the price at bet time, vig included
  end if;
  return greatest(0, least(1, v_p));
end;
$$;

-- PostgREST computed fields: select=...,live_probability
create function public.live_probability(l public.wager_legs) returns double precision
language sql stable set search_path = '' as $$
  select private.leg_probability(l);
$$;

create function public.live_probability(w public.wagers) returns double precision
language sql stable set search_path = '' as $$
  select case w.status
    when 'pending' then coalesce((select exp(sum(ln(greatest(private.leg_probability(l), 1e-12))))
                                  from public.wager_legs l where l.wager_id = w.id), 0)
    when 'lost' then 0
    else 1 end;
$$;

grant execute on function private.norm_cdf(double precision), private.sport_model(text),
  private.leg_probability(public.wager_legs) to authenticated;
revoke all on function public.live_probability(public.wager_legs), public.live_probability(public.wagers),
  public.current_payout(public.wagers) from public, anon;
grant execute on function public.live_probability(public.wager_legs), public.live_probability(public.wagers),
  public.current_payout(public.wagers) to authenticated;
revoke all on function private.leg_result(text, text, numeric, text, text, int, int), private.settle_wager(uuid),
  private.grade_event(text), private.void_stale_legs() from public;

-- ---------------------------------------------------------------------------
-- Leaderboard (security invoker: inherits the blind-pick RLS of participants and wagers)
-- ---------------------------------------------------------------------------
create view public.leaderboard with (security_invoker = true) as
with pending as (
  select w.participant_id,
         sum(public.current_payout(w)) as payout,
         sum(public.live_probability(w) * public.current_payout(w)) as ev
  from public.wagers w
  where w.status = 'pending'
  group by w.participant_id
), base as (
  select p.tournament_id, p.id as participant_id, p.user_id, pr.display_name,
         p.remaining_bankroll_cents::bigint as cash_cents,
         (p.remaining_bankroll_cents + coalesce(pe.payout, 0))::bigint as max_cents,
         (p.remaining_bankroll_cents + coalesce(round(pe.ev), 0))::bigint as ev_cents
  from public.tournament_participants p
  join public.profiles pr on pr.id = p.user_id
  left join pending pe on pe.participant_id = p.id
)
select b.*,
       rank() over (partition by b.tournament_id order by b.ev_cents desc, b.cash_cents desc)::int as rank,
       case when b.max_cents = 0 then 'busted'
            when b.max_cents < max(b.cash_cents) over (partition by b.tournament_id) then 'eliminated'
            else 'alive' end as standing
from base b;

revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to authenticated;

-- ---------------------------------------------------------------------------
-- Status machine: void stale games, settle when nothing is left to grade.
-- ---------------------------------------------------------------------------
create or replace function private.advance_statuses() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tournaments t set status = 'locked'
   where t.status in ('draft', 'open') and t.lock_time <= now();

  update public.tournaments t set status = 'live'
   where t.status = 'locked'
     and exists (select 1 from public.tournament_events te
                 join public.events e on e.id = te.event_id
                 where te.tournament_id = t.id
                   and (e.commence_time <= now() or e.status in ('live', 'final')));

  perform private.void_stale_legs();

  update public.tournaments t set status = 'settled'
   where t.status = 'live'
     and not exists (select 1 from public.tournament_events te
                     join public.events e on e.id = te.event_id
                     where te.tournament_id = t.id
                       and e.status not in ('final', 'canceled', 'postponed')
                       and e.commence_time >= now() - interval '12 hours')
     and not exists (select 1 from public.wagers w
                     where w.tournament_id = t.id and w.status = 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- Scores schedule: while a game in a locked/live tournament is under way, every scores_refresh.
-- ---------------------------------------------------------------------------
create or replace function private.odds_sync_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (
    select e.id, e.sport_key, e.commence_time, t.created_at as tournament_created_at,
           t.allowed_bet_types -> 'markets' as markets
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('draft', 'open') and t.lock_time > now()
      and e.status = 'scheduled' and e.commence_time > now()
  ),
  per_sport as (
    select a.sport_key,
           min(private.odds_refresh_interval(a.commence_time)) as every,
           max(a.tournament_created_at) as newest_tournament_at,
           jsonb_agg(distinct a.id) as event_ids,
           (select jsonb_agg(distinct m.market order by m.market)
              from active a2, jsonb_array_elements_text(a2.markets) as m(market)
             where a2.sport_key = a.sport_key) as markets
    from active a
    group by a.sport_key
  ),
  odds_jobs as (
    select jsonb_build_object('kind', 'odds', 'sport_key', ps.sport_key,
                              'markets', ps.markets, 'event_ids', ps.event_ids) as job
    from per_sport ps
    left join private.odds_sync_state s on s.sport_key = ps.sport_key
    where (s.odds_blocked_until is null or s.odds_blocked_until <= now())
      and (s.last_odds_sync_at is null
           or s.last_odds_sync_at + ps.every <= now()
           or ps.newest_tournament_at > s.last_odds_sync_at)
  ),
  in_play as (
    select e.sport_key, jsonb_agg(distinct e.id) as event_ids
    from public.events e
    join public.tournament_events te on te.event_id = e.id
    join public.tournaments t on t.id = te.tournament_id
    where t.status in ('locked', 'live')
      and e.commence_time <= now() and e.commence_time > now() - interval '12 hours'
      and e.status not in ('final', 'canceled', 'postponed')
    group by e.sport_key
  ),
  scores_jobs as (
    select jsonb_build_object('kind', 'scores', 'sport_key', ip.sport_key, 'event_ids', ip.event_ids) as job
    from in_play ip
    left join private.odds_sync_state s on s.sport_key = ip.sport_key
    where (s.odds_blocked_until is null or s.odds_blocked_until <= now())
      and (s.last_scores_sync_at is null
           or s.last_scores_sync_at + coalesce((private.odds_setting('scores_refresh') #>> '{}')::interval,
                                               interval '15 minutes') <= now())
  ),
  catalog_jobs as (
    select jsonb_build_object('kind', 'catalog', 'sport_key', c.sport_key) as job
    from jsonb_array_elements_text(coalesce(
           (select st.value from private.app_settings st where st.key = 'odds_catalog_sports'),
           '[]'::jsonb)) as c(sport_key)
    left join private.odds_sync_state s on s.sport_key = c.sport_key
    where s.last_catalog_sync_at is null or s.last_catalog_sync_at + interval '6 hours' <= now()
  )
  select coalesce(jsonb_agg(j.job), '[]'::jsonb)
  from (select job from odds_jobs union all select job from scores_jobs union all select job from catalog_jobs) j;
$$;
