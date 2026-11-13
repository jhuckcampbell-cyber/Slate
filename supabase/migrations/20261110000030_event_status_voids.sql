-- Explicit provider evidence only. Postponements retain bets indefinitely; after seven days
-- they require operator review, NEVER an automatic refund. Rescheduled kickoff restarts polling.
alter table public.events drop constraint events_status_check;
alter table public.events add constraint events_status_check check
 (status in ('scheduled','live','final','canceled','postponed','suspended','delayed'));
alter table public.events add column status_reason text;
alter table public.events add column status_updated_at timestamptz;
alter table public.game_live add column clock_seconds numeric check (clock_seconds >= 0);

create function private.event_status(p_id text, p_status text, p_reason text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.events set status=p_status, status_reason=coalesce(nullif(p_reason,''),p_status), status_updated_at=p_at
 where id=p_id and status not in ('final','canceled')
 and p_status in ('canceled','postponed','suspended','delayed')
 and coalesce(status_updated_at,'-infinity') <= p_at
 and coalesce(scores_synced_at,'-infinity') <= p_at;
end; $$;
revoke all on function private.event_status(text,text,text,timestamptz) from public,anon,authenticated;

create or replace function public.scores_ingest(p_sport_key text, p_fetched_at timestamptz, p_scores jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids text[];
  v_graded int := 0;
  v_id text;
  v_tid uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-ingest:' || p_sport_key));
  for v_id in select x->>'event_id' from jsonb_array_elements(p_scores) x loop
    perform private.event_status(v_id, x->>'status', x->>'status_reason',
      least(p_fetched_at,coalesce((x->>'provider_updated_at')::timestamptz,p_fetched_at)))
    from jsonb_array_elements(p_scores) x where x->>'event_id'=v_id
      and exists(select 1 from public.events e where e.id=v_id and e.sport_key=p_sport_key);
  end loop;
  perform private.void_stale_legs();
  -- Finals are final: later corrections are ignored, so a re-sent final can never pay twice.
  with x as (
    select * from jsonb_to_recordset(p_scores) as x(event_id text, completed boolean, home_score int, away_score int, provider_updated_at timestamptz, status text)
    where x.home_score is not null and x.away_score is not null and x.status is null
  ), upd as (
    update public.events e
       set home_score = x.home_score,
           away_score = x.away_score,
           status = case when x.completed then 'final' else 'live' end,
           scores_synced_at = p_fetched_at,
           scores_provider_updated_at = coalesce(x.provider_updated_at, p_fetched_at)
      from x
     where e.id = x.event_id and e.sport_key=p_sport_key and e.status not in ('final', 'canceled')
       and coalesce(e.status_updated_at,'-infinity') <= coalesce(x.provider_updated_at,p_fetched_at)
       -- Never go backwards; equal stamps still apply (<=) so a same-moment update isn't dropped.
       and coalesce(e.scores_synced_at, '-infinity'::timestamptz) <= p_fetched_at
       and coalesce(e.scores_provider_updated_at, '-infinity'::timestamptz) <= coalesce(x.provider_updated_at, p_fetched_at)
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

create or replace function private.void_stale_legs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wager uuid;
begin
  for v_wager in
    with voided as (
      update public.wager_legs l set status = 'void', settled_at = now()
        from public.events e, public.wagers w, public.tournaments t
       where e.id = l.event_id and l.status = 'pending'
         and w.id = l.wager_id and t.id = w.tournament_id
         and (t.lock_time <= now() or t.status not in ('draft', 'open'))
         and e.status = 'canceled'
      returning l.wager_id
    )
    select distinct v.wager_id from voided v
  loop
    perform private.settle_wager(v_wager);
  end loop;
end;
$$;

revoke all on function private.void_stale_legs() from public;


create or replace view private.grading_review as
select l.tournament_id,l.event_id,count(*) as pending_legs,
 case when e.status='final' then 'UNRESOLVED_PROPS'
 when e.status in ('postponed','suspended','delayed') then 'RESCHEDULE_REVIEW' else 'MISSING_FINAL' end as reason
from public.wager_legs l join public.events e on e.id=l.event_id
join public.tournaments t on t.id=l.tournament_id
where l.status='pending' and e.status <> 'canceled'
 and e.commence_time < now()-case when e.status in ('postponed','suspended','delayed') then interval '7 days' else interval '12 hours' end
 and (t.lock_time<=now() or t.status not in ('draft','open'))
group by l.tournament_id,l.event_id,e.status;
comment on view private.grading_review is 'Missing finals after 12h; postponement max unattended wait 7 days. Operator review only, never timeout refunds.';

-- Catalog schedule changes resume postponed games, but cannot reopen cancellations or finals.
create function private.event_rescheduled() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.status in ('postponed','suspended','delayed') and new.commence_time > old.commence_time then
   new.status := 'scheduled'; new.status_reason := 'Rescheduled by catalog';
   new.status_updated_at := now();
 end if;
 return new;
end; $$;
revoke all on function private.event_rescheduled() from public;
create trigger event_rescheduled before update of commence_time on public.events
for each row execute function private.event_rescheduled();

CREATE OR REPLACE FUNCTION public.odds_sync_ingest(p_kind text, p_sport_key text, p_fetched_at timestamp with time zone, p_events jsonb DEFAULT '[]'::jsonb, p_outcomes jsonb DEFAULT '[]'::jsonb, p_markets jsonb DEFAULT '[]'::jsonb, p_usage jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_events int := 0;
  v_changed int := 0;
  v_markets int := 0;
  v_dropped int := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-ingest:' || p_sport_key));
  -- Filter the whole snapshot, including deletes and freshness, before applying it.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_markets
  from jsonb_array_elements(p_markets) x
  where not exists (select 1 from public.odds_markets m
    where m.event_id = x->>'event_id' and m.market_key = x->>'market_key' and not m.is_live
      and (m.last_seen_at > p_fetched_at or m.provider_updated_at > coalesce((x->>'provider_updated_at')::timestamptz, p_fetched_at)))
    and not exists (select 1 from jsonb_array_elements(p_outcomes) o
      join private.odds_player_versions v on v.event_id=o->>'event_id'
        and v.market_key=o->>'market_key' and v.participant_name=coalesce(o->>'participant_name','')
      where o->>'event_id'=x->>'event_id' and o->>'market_key'=x->>'market_key'
        and v.provider_updated_at > coalesce((o->>'provider_updated_at')::timestamptz, p_fetched_at));
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_outcomes
  from jsonb_array_elements(p_outcomes) x where exists
    (select 1 from jsonb_array_elements(p_markets) m where m->>'event_id'=x->>'event_id' and m->>'market_key'=x->>'market_key');
  if p_kind not in ('odds', 'catalog', 'props') then
    raise exception 'INVALID_KIND';
  end if;

  -- Events: upsert schedule fields only (status/scores belong to scores-sync).
  insert into public.events as e (id, sport_key, sport_title, home_team, away_team, commence_time)
  select x.id, x.sport_key, x.sport_title, x.home_team, x.away_team, x.commence_time
  from jsonb_to_recordset(p_events) as x(
    id text, sport_key text, sport_title text, home_team text, away_team text, commence_time timestamptz)
  on conflict (id) do update
     set commence_time = excluded.commence_time,
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         sport_title = coalesce(excluded.sport_title, e.sport_title)
   where coalesce((select s.last_catalog_sync_at from private.odds_sync_state s where s.sport_key=p_sport_key), '-infinity'::timestamptz) <= p_fetched_at
       and (e.commence_time, e.home_team, e.away_team)
         is distinct from (excluded.commence_time, excluded.home_team, excluded.away_team);
  get diagnostics v_events = row_count;

  perform private.event_status(x->>'id',x->>'status',x->>'status_reason',p_fetched_at)
  from jsonb_array_elements(p_events) x
  where exists(select 1 from public.events e where e.id=x->>'id' and e.sport_key=p_sport_key);
  perform private.void_stale_legs();
  if p_kind in ('odds', 'props') then
    -- Pregame only: in-play prices for started games are skipped (live odds are Phase 4),
    -- and frozen closing-line rows are never overwritten.
    insert into public.odds_cache as o (
      event_id, market_key, outcome_name, participant_name, point, price_american, bookmaker, updated_at)
    select x.event_id, x.market_key, x.outcome_name, coalesce(x.participant_name, ''), x.point,
           x.price_american, x.bookmaker, p_fetched_at
    from jsonb_to_recordset(p_outcomes) as x(
      event_id text, market_key text, outcome_name text, participant_name text,
      point numeric, price_american int, bookmaker text)
    join public.events ev on ev.id = x.event_id and ev.commence_time > greatest(now(), p_fetched_at)
    on conflict (event_id, market_key, outcome_name, participant_name, alt_point, is_live) do update
       set price_american = excluded.price_american,
           point = excluded.point,
           bookmaker = excluded.bookmaker,
           updated_at = excluded.updated_at
     where o.locked_at is null
       and (o.price_american, o.point) is distinct from (excluded.price_american, excluded.point);
    get diagnostics v_changed = row_count;

    -- Every prop shape: withdrawn players and alternate lines must stop being bettable.
    -- Only for (game, market) pairs this sync actually priced; bets keep their own copy (odds_id → null).
    delete from public.odds_cache o
     using (select distinct x.event_id, x.market_key
              from jsonb_to_recordset(p_markets) as x(event_id text, market_key text)
             where x.market_key like 'player\_%') pm
     where o.event_id = pm.event_id and o.market_key = pm.market_key
       and not o.is_live and o.locked_at is null
       and exists (select 1 from public.events e where e.id=o.event_id and e.commence_time > greatest(now(), p_fetched_at))
       and not exists (
         select 1 from jsonb_to_recordset(p_outcomes) as y(
           event_id text, market_key text, outcome_name text, participant_name text, point numeric)
         where y.event_id = o.event_id and y.market_key = o.market_key and y.outcome_name = o.outcome_name
           and coalesce(y.participant_name, '') = o.participant_name and (o.market_key not like '%\_alternate' or y.point is not distinct from o.point));
    get diagnostics v_dropped = row_count;
    v_changed := v_changed + v_dropped;

    insert into public.odds_markets as m (event_id, market_key, is_live, bookmaker, last_seen_at, provider_updated_at)
    select x.event_id, x.market_key, false, x.bookmaker, p_fetched_at, coalesce(x.provider_updated_at, p_fetched_at)
    from jsonb_to_recordset(p_markets) as x(event_id text, market_key text, bookmaker text, provider_updated_at timestamptz)
    join public.events ev on ev.id = x.event_id and ev.commence_time > greatest(now(), p_fetched_at)
    on conflict (event_id, market_key, is_live) do update
       set provider_updated_at = excluded.provider_updated_at,
           bookmaker = excluded.bookmaker,
           last_seen_at = greatest(m.last_seen_at, excluded.last_seen_at);
    get diagnostics v_markets = row_count;

    insert into private.odds_player_versions as v(event_id, market_key, participant_name, provider_updated_at)
    select x.event_id, x.market_key, coalesce(x.participant_name,''), max(coalesce(x.provider_updated_at,p_fetched_at))
    from jsonb_to_recordset(p_outcomes) x(event_id text, market_key text, participant_name text, provider_updated_at timestamptz)
    join public.events ev on ev.id=x.event_id and ev.commence_time > greatest(now(),p_fetched_at)
    group by x.event_id, x.market_key, coalesce(x.participant_name,'')
    on conflict(event_id, market_key, participant_name) do update
      set provider_updated_at=greatest(v.provider_updated_at,excluded.provider_updated_at);

    if p_kind = 'odds' then
      insert into private.odds_sync_state as s (sport_key, last_odds_sync_at)
      values (p_sport_key, p_fetched_at)
      on conflict (sport_key) do update
         set last_odds_sync_at = greatest(s.last_odds_sync_at, excluded.last_odds_sync_at);
    else
      -- Props are per game: their own clock, never the sport's game-line clock.
      insert into private.props_sync_state as ps (event_id, last_sync_at)
      select distinct x.event_id, p_fetched_at
      from jsonb_to_recordset(p_markets) as x(event_id text)
      join public.events ev on ev.id = x.event_id
      on conflict (event_id) do update set last_sync_at = greatest(ps.last_sync_at, excluded.last_sync_at);
    end if;
  else
    insert into private.odds_sync_state as s (sport_key, last_catalog_sync_at)
    values (p_sport_key, p_fetched_at)
    on conflict (sport_key) do update
       set last_catalog_sync_at = greatest(s.last_catalog_sync_at, excluded.last_catalog_sync_at);
  end if;

  if p_usage is not null then
    insert into private.api_usage (sport_key, endpoint, credits_used, credits_remaining)
    values (p_sport_key, coalesce(p_usage ->> 'endpoint', p_kind),
            (p_usage ->> 'credits_used')::int, (p_usage ->> 'credits_remaining')::int);
  end if;

  return jsonb_build_object('events', v_events, 'outcomes_changed', v_changed, 'markets_seen', v_markets);
end;
$function$;
create or replace function public.live_ingest(p_sport_key text, p_games jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids text[];
  v_tid uuid;
begin
  insert into private.live_sync_state as s (sport_key, last_sync_at) values (p_sport_key, now())
  on conflict (sport_key) do update set last_sync_at = excluded.last_sync_at;

  perform private.event_status(x->>'event_id',x->>'status',x->>'status_reason',now())
  from jsonb_array_elements(p_games) x
  where exists(select 1 from public.events e where e.id=x->>'event_id' and e.sport_key=p_sport_key);
  perform private.void_stale_legs();
  with x as (
    select * from jsonb_to_recordset(coalesce(p_games, '[]'::jsonb)) as x(event_id text, state text, home_score int,
      away_score int, period int, detail text, situation text, last_play text, clock_seconds numeric)
    where x.state in ('pre', 'in', 'post')
      and exists (select 1 from public.events e where e.id = x.event_id and e.sport_key = p_sport_key)
  ), up as (
    insert into public.game_live as g (event_id, state, home_score, away_score, period, detail, situation, last_play, updated_at, clock_seconds)
    select x.event_id, x.state, x.home_score, x.away_score, x.period, x.detail, x.situation, x.last_play, now(), x.clock_seconds from x
    on conflict (event_id) do update
      set clock_seconds=excluded.clock_seconds, state = excluded.state, home_score = excluded.home_score, away_score = excluded.away_score,
          period = excluded.period, detail = excluded.detail, situation = excluded.situation,
          last_play = excluded.last_play, updated_at = excluded.updated_at
      where g.clock_seconds is distinct from excluded.clock_seconds or (g.state, g.home_score, g.away_score, g.period, g.detail, g.situation, g.last_play)
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

-- Regulation fraction remaining; overtime uses its actual period length, never wall time.
create function private.game_remaining(p_event text) returns double precision
language sql stable security definer set search_path = '' as $$
 select case when g.period between 1 and 4 then
 ((4-g.period)*case when e.sport_key='basketball_nba' then 720 else 900 end + g.clock_seconds)
 / case when e.sport_key='basketball_nba' then 2880.0 else 3600.0 end
 when g.period>4 then least(g.clock_seconds,case when e.sport_key='basketball_nba' then 300 else 600 end)
 / case when e.sport_key='basketball_nba' then 2880.0 else 3600.0 end end
 from public.game_live g join public.events e on e.id=g.event_id
 where g.event_id=p_event and g.clock_seconds is not null
 and e.sport_key in ('basketball_nba','americanfootball_nfl');
$$;
revoke all on function private.game_remaining(text) from public;
CREATE OR REPLACE FUNCTION private.leg_probability_base(l public.wager_legs)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_over_price int;
  v_under_price int;
  v_p_over double precision;
begin
  if l.status in ('hit', 'push', 'void') then return 1; end if;
  if l.status = 'miss' then return 0; end if;

  select * into v_e from public.events where id = l.event_id;
  select * into v_m from private.sport_model(v_e.sport_key);
  v_is_home := l.selection = v_e.home_team;

  v_live := v_e.home_score is not null and v_e.away_score is not null and v_e.status in ('live', 'final');
  if v_live then
    v_r := greatest(0.02, least(1, coalesce(private.game_remaining(v_e.id),
      1 - extract(epoch from now() - v_e.commence_time) / 60 / v_m.duration_minutes)));
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
    -- Props: de-vig the current Over/Under pair at the bet's line; else the bet's own price.
    select o.price_american into v_over_price from public.odds_cache o
     where o.event_id = l.event_id and o.market_key = l.market_key and o.participant_name = l.participant_name
       and o.outcome_name = 'Over' and o.point = l.line and not o.is_live;
    select o.price_american into v_under_price from public.odds_cache o
     where o.event_id = l.event_id and o.market_key = l.market_key and o.participant_name = l.participant_name
       and o.outcome_name = 'Under' and o.point = l.line and not o.is_live;
    if v_over_price is not null and v_under_price is not null then
      v_p_over := 1 / (1 + case when v_over_price > 0 then v_over_price / 100.0 else 100.0 / -v_over_price end);
      v_p_over := v_p_over / (v_p_over + 1 / (1 + case when v_under_price > 0 then v_under_price / 100.0
                                                       else 100.0 / -v_under_price end));
      v_p := case when l.selection = 'Over' then v_p_over else 1 - v_p_over end;
    else
      v_p := 1 / l.odds_decimal;
    end if;
  end if;
  return greatest(0, least(1, v_p));
end;
$function$;


create function public.leg_exact_push(l public.wager_legs) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.wager_legs actual
 join public.wagers w on w.id=actual.wager_id
 join public.tournament_participants tp on tp.id=w.participant_id
 join public.tournaments t on t.id=w.tournament_id
 join private.stats_sync_state s on s.event_id=actual.event_id and s.is_final
 where actual.id=l.id and actual.event_id=l.event_id and actual.market_key=l.market_key
 and actual.participant_name=l.participant_name and actual.line=l.line
 and (tp.user_id=auth.uid() or t.lock_time<=now() or auth.role()='service_role')
 and coalesce(private.player_stat(actual.event_id,actual.market_key,actual.participant_name)=actual.line,false));
$$;
revoke all on function public.leg_exact_push(public.wager_legs) from public,anon;
grant execute on function public.leg_exact_push(public.wager_legs) to authenticated,service_role;
create or replace function public.current_payout(w public.wagers) returns bigint
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
               where l.wager_id = w.id and l.status not in ('push', 'void')
 and not (l.status='pending' and l.participant_name<>'' and l.selection in ('Over','Under')
 and l.line is not null and public.leg_exact_push(l)) loop
    v_dec := v_dec * v_leg.odds_decimal;
    v_live := v_live + 1;
  end loop;
  if v_live = 0 then
    return w.amount_cents;
  end if;
  return floor(w.amount_cents * least(round(v_dec, 4), 1001))::bigint;
end;
$$;


create function private.recovery_interval(p_start timestamptz) returns interval
language sql stable set search_path = '' as $$
 select case when p_start < now()-interval '7 days' then interval '6 hours'
 when p_start < now()-interval '24 hours' then interval '1 hour'
 when p_start < now()-interval '8 hours' then interval '15 minutes' else interval '50 seconds' end;
$$;
revoke all on function private.recovery_interval(timestamptz) from public;
-- Optional pacing policy is installed by the following budget migration. Resolve at runtime.
create function private.recovery_score_interval(p_start timestamptz) returns interval
language plpgsql stable security definer set search_path = '' as $$
declare v_interval interval := interval '15 minutes';
begin
 if pg_catalog.to_regprocedure('private.odds_scores_interval()') is not null then
   execute 'select private.odds_scores_interval()' into v_interval;
 end if;
 return greatest(v_interval,private.recovery_interval(p_start));
end; $$;
revoke all on function private.recovery_score_interval(timestamptz) from public;
create function private.scores_recovery_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind','scores','sport_key',g.sport_key,'event_ids',g.ids)),'[]'::jsonb)
 from (select e.sport_key,jsonb_agg(e.id) as ids from public.events e
 left join private.odds_sync_state s on s.sport_key=e.sport_key
 where e.status not in ('final','canceled') and e.commence_time<now()-interval '12 hours'
 and exists(select 1 from public.tournament_events te join public.tournaments t on t.id=te.tournament_id
 where te.event_id=e.id and t.status in ('locked','live'))
 and (s.odds_blocked_until is null or s.odds_blocked_until<=now())
 and coalesce(greatest(s.last_scores_sync_at,(select max(r.started_at) from public.odds_sync_runs r
   where r.kind='scores' and r.sport_key=e.sport_key)),'-infinity')<=now()-private.recovery_score_interval(e.commence_time)
 group by e.sport_key) g;
$$;
revoke all on function private.scores_recovery_jobs() from public;
create or replace function private.stats_due_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Recovery score jobs travel with this extension, preserving later budget scheduler ordering.
  select private.scores_recovery_jobs() || coalesce(jsonb_agg(jsonb_build_object(
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
      and e.commence_time <= now()
      and e.status not in ('canceled')
      and (greatest(s.last_sync_at,(select max(r.started_at) from public.odds_sync_runs r
        where r.kind='stats' and r.event_id=e.id)) is null
        or greatest(s.last_sync_at,(select max(r.started_at) from public.odds_sync_runs r
        where r.kind='stats' and r.event_id=e.id)) <= now() - private.recovery_interval(e.commence_time))
      and exists (select 1 from public.wager_legs l
                  where l.tournament_id = t.id and l.event_id = e.id and l.participant_name <> '' and l.status='pending')
  ) g;
$$;
revoke all on function private.stats_due_jobs() from public;

create or replace function private.live_due_jobs() returns jsonb
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
        and e.commence_time <= now() + interval '15 minutes'
        and e.status not in ('final', 'canceled')
        and coalesce(gl.state, 'pre') <> 'post'
    ) x
    left join private.live_sync_state s on s.sport_key = x.sport_key
    where coalesce(greatest(s.last_sync_at,(select max(r.started_at) from public.odds_sync_runs r
      where r.kind='live' and r.sport_key=x.sport_key)),'-infinity')
      <= now() - private.recovery_interval(x.commence_time)
    group by x.sport_key
  ) g;
$$;
revoke all on function private.live_due_jobs() from public;

