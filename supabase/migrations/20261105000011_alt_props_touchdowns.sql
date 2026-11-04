-- Football alternates + touchdowns (2026-11-05).
-- * Catalog: NFL/NCAAF props add alternate yardage ladders (pass/rush/reception), passing TDs and
--   anytime TD. Shapes match the real Odds API (checked on TNF): ladders are Over-only with many lines
--   per player; anytime TD is one "Yes" price per player with no line.
-- * odds_cache: a ladder needs one row PER LINE, but a main market must stay one row per side (so a
--   moved line replaces its old price). alt_point = point for "_alternate" markets only, and the unique
--   key includes it. Ladder lines the book drops are deleted on the next sync of that market.
-- * Grading: the host enters a stat once per (player, stat); it grades the main line and the ladder
--   (prop_results keeps the main market key). "Yes" (anytime TD) hits when the stat (TDs) is >= 1.
-- * Chance: one-sided props have no pair to de-vig, so leg_probability's existing fallback applies
--   (the bet's own implied price).

create or replace function private.prop_markets(p_sport_key text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_sport_key like 'basketball%' then array['player_points', 'player_rebounds', 'player_assists']
    when p_sport_key like 'americanfootball%' then array[
      'player_pass_yds', 'player_rush_yds', 'player_reception_yds',
      'player_pass_yds_alternate', 'player_rush_yds_alternate', 'player_reception_yds_alternate',
      'player_pass_tds', 'player_anytime_td']
    else '{}'::text[]
  end;
$$;

alter table public.odds_cache
  add column alt_point numeric generated always as (case when market_key like '%\_alternate' then point end) stored;
alter table public.odds_cache drop constraint odds_cache_event_id_market_key_outcome_name_participant_nam_key;
alter table public.odds_cache add constraint odds_cache_outcome_key
  unique nulls not distinct (event_id, market_key, outcome_name, participant_name, alt_point, is_live);

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
   where (e.commence_time, e.home_team, e.away_team)
         is distinct from (excluded.commence_time, excluded.home_team, excluded.away_team);
  get diagnostics v_events = row_count;

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
    join public.events ev on ev.id = x.event_id and ev.commence_time > p_fetched_at
    on conflict (event_id, market_key, outcome_name, participant_name, alt_point, is_live) do update
       set price_american = excluded.price_american,
           point = excluded.point,
           bookmaker = excluded.bookmaker,
           updated_at = excluded.updated_at
     where o.locked_at is null
       and (o.price_american, o.point) is distinct from (excluded.price_american, excluded.point);
    get diagnostics v_changed = row_count;

    -- Alternate ladders: a line the book stopped offering must not stay bettable at an old price.
    -- Only for (game, market) pairs this sync actually priced; bets keep their own copy (odds_id → null).
    delete from public.odds_cache o
     using (select distinct x.event_id, x.market_key
              from jsonb_to_recordset(p_markets) as x(event_id text, market_key text)
             where x.market_key like '%\_alternate') pm
     where o.event_id = pm.event_id and o.market_key = pm.market_key
       and not o.is_live and o.locked_at is null
       and not exists (
         select 1 from jsonb_to_recordset(p_outcomes) as y(
           event_id text, market_key text, outcome_name text, participant_name text, point numeric)
         where y.event_id = o.event_id and y.market_key = o.market_key and y.outcome_name = o.outcome_name
           and coalesce(y.participant_name, '') = o.participant_name and y.point = o.point);
    get diagnostics v_dropped = row_count;
    v_changed := v_changed + v_dropped;

    insert into public.odds_markets as m (event_id, market_key, is_live, bookmaker, last_seen_at)
    select x.event_id, x.market_key, false, x.bookmaker, p_fetched_at
    from jsonb_to_recordset(p_markets) as x(event_id text, market_key text, bookmaker text)
    join public.events ev on ev.id = x.event_id and ev.commence_time > p_fetched_at
    on conflict (event_id, market_key, is_live) do update
       set bookmaker = excluded.bookmaker,
           last_seen_at = greatest(m.last_seen_at, excluded.last_seen_at);
    get diagnostics v_markets = row_count;

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

CREATE OR REPLACE FUNCTION public.grade_prop(p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype;
  v_status text;
  v_wager uuid;
  v_n int := 0;
  v_market text := regexp_replace(p_market_key, '_alternate$', '');
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.host_id is distinct from auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if p_stat is null or p_stat < 0 or p_stat > 9999 then
    raise exception 'INVALID_STAT';
  end if;
  select e.status into v_status from public.events e
  join public.tournament_events te on te.event_id = e.id and te.tournament_id = p_tournament_id
  where e.id = p_event_id;
  if v_status is null then
    raise exception 'NOTHING_TO_GRADE';
  end if;
  if v_status <> 'final' then
    raise exception 'GAME_NOT_FINAL';  -- final ⇒ after lock, so no hidden pick is involved
  end if;
  if exists (select 1 from public.prop_results r
             where r.tournament_id = p_tournament_id and r.event_id = p_event_id
               and r.market_key = v_market and r.participant_name = p_participant_name) then
    raise exception 'ALREADY_GRADED';
  end if;
  if not exists (select 1 from public.wager_legs l
                 where l.tournament_id = p_tournament_id and l.event_id = p_event_id
                   and l.market_key in (v_market, v_market || '_alternate') and l.participant_name = p_participant_name
                   and l.status = 'pending') then
    raise exception 'NOTHING_TO_GRADE';
  end if;

  insert into public.prop_results (tournament_id, event_id, market_key, participant_name, stat, graded_by)
  values (p_tournament_id, p_event_id, v_market, p_participant_name, p_stat, auth.uid());

  for v_wager in
    with graded as (
      update public.wager_legs l
         set status = case
                        when l.selection = 'Yes' then case when p_stat >= 1 then 'hit' else 'miss' end
                        else case sign((p_stat - l.line) * case when l.selection = 'Over' then 1 else -1 end)
                               when 1 then 'hit' when 0 then 'push' else 'miss' end
                      end::public.leg_status,
             settled_at = now()
       where l.tournament_id = p_tournament_id and l.event_id = p_event_id
         and l.market_key in (v_market, v_market || '_alternate') and l.participant_name = p_participant_name
         and l.status = 'pending'
         and (l.selection = 'Yes' or (l.selection in ('Over', 'Under') and l.line is not null))
      returning l.wager_id
    )
    select distinct g.wager_id from graded g
  loop
    perform private.settle_wager(v_wager);
    v_n := v_n + 1;
  end loop;

  perform private.signal(p_tournament_id, 'scores', '{}'::jsonb);
  return jsonb_build_object('wagers', v_n);
end;
$function$;
