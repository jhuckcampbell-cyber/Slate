-- College football player props (opt-in per tournament AND behind odds_college_enabled).
-- Main stats only: passing / rushing / receiving yards and anytime TD. No receptions, alternate ladders or passing TDs.

create or replace function public.college_props_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.odds_setting('odds_college_enabled'), 'false'::jsonb) = 'true'::jsonb;
$$;
revoke all on function public.college_props_enabled() from public, anon, authenticated;
grant execute on function public.college_props_enabled() to service_role;

-- Prop catalog: NCAAF only while the college switch is on (this also gates props jobs and placement).
create or replace function private.prop_markets(p_sport_key text) returns text[]
language sql stable security definer set search_path = '' as $$
  select case
    when p_sport_key = 'basketball_ncaab' then '{}'::text[]
    when p_sport_key = 'americanfootball_ncaaf' then
      case when coalesce(private.odds_setting('odds_college_enabled'), 'false'::jsonb) = 'true'::jsonb
           then array['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_anytime_td']
           else '{}'::text[] end
    when p_sport_key like 'basketball%' then array['player_points', 'player_rebounds', 'player_assists']
    when p_sport_key like 'americanfootball%' then array[
      'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
      'player_pass_yds_alternate', 'player_rush_yds_alternate', 'player_reception_yds_alternate',
      'player_receptions_alternate', 'player_pass_tds', 'player_anytime_td']
    else '{}'::text[]
  end;
$$;
revoke all on function private.prop_markets(text) from public, anon;
grant execute on function private.prop_markets(text) to authenticated;

-- Which stats a box score can settle.
create or replace function private.prop_stat_supported(p_sport text,p_market text) returns boolean
language sql immutable set search_path = '' as $$
 select case p_sport
 when 'basketball_nba' then regexp_replace(p_market,'_alternate$','') = any(array[
 'player_points','player_rebounds','player_assists','player_threes'])
 when 'americanfootball_nfl' then regexp_replace(p_market,'_alternate$','') = any(array[
 'player_pass_yds','player_rush_yds','player_reception_yds','player_receptions','player_pass_tds','player_anytime_td'])
 when 'americanfootball_ncaaf' then regexp_replace(p_market,'_alternate$','') = any(array[
 'player_pass_yds','player_rush_yds','player_reception_yds','player_anytime_td'])
 else false end;
$$;
revoke all on function private.prop_stat_supported(text,text) from public,anon,authenticated;

-- Regulation fraction remaining (college football: 4 x 15 min, like the NFL).
create or replace function private.game_remaining(p_event text) returns double precision
language sql stable security definer set search_path = '' as $$
 select case when g.period between 1 and 4 then
 ((4-g.period)*case when e.sport_key='basketball_nba' then 720 else 900 end + g.clock_seconds)
 / case when e.sport_key='basketball_nba' then 2880.0 else 3600.0 end
 when g.period>4 then least(g.clock_seconds,case when e.sport_key='basketball_nba' then 300 else 600 end)
 / case when e.sport_key='basketball_nba' then 2880.0 else 3600.0 end end
 from public.game_live g join public.events e on e.id=g.event_id
 where g.event_id=p_event and g.clock_seconds is not null
 and e.sport_key in ('basketball_nba','americanfootball_nfl','americanfootball_ncaaf');
$$;
revoke all on function private.game_remaining(text) from public;

-- Stats jobs: college football games in play with a pending prop pick, behind the college switch.
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
    where (e.sport_key in ('basketball_nba', 'americanfootball_nfl')
        or (e.sport_key = 'americanfootball_ncaaf'
            and coalesce(private.odds_setting('odds_college_enabled'), 'false'::jsonb) = 'true'::jsonb))
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

-- Let college football props jobs through the college wrapper (still behind the switch; single-event, demand-driven).
create or replace function private.odds_sync_odds_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    case when j.job ->> 'sport_key' in ('americanfootball_ncaaf', 'basketball_ncaab')
                   and j.job ->> 'kind' in ('odds', 'scores')
         then jsonb_set(j.job, '{event_ids}', (
           select coalesce(jsonb_agg(c.id order by c.commence_time, c.id), '[]'::jsonb)
           from (
             select e.id, e.commence_time
             from jsonb_array_elements_text(j.job -> 'event_ids') ids(id)
             join public.events e on e.id = ids.id
             where exists (select 1 from public.tournament_events te where te.event_id = e.id)
             order by e.commence_time, e.id
             limit greatest(0, coalesce((private.odds_setting('odds_college_max_events') #>> '{}')::int, 8))
           ) c
         ))
         else j.job end order by j.ordinality), '[]'::jsonb)
  from jsonb_array_elements(private.odds_sync_odds_jobs_base()) with ordinality j(job, ordinality)
  where j.job ->> 'sport_key' not in ('americanfootball_ncaaf', 'basketball_ncaab')
     or (coalesce(private.odds_setting('odds_college_enabled'), 'false'::jsonb) = 'true'::jsonb
         and (j.job ->> 'kind' in ('catalog', 'odds', 'scores')
              or (j.job ->> 'kind' = 'props' and j.job ->> 'sport_key' = 'americanfootball_ncaaf')));
$$;
revoke all on function private.odds_sync_odds_jobs() from public, anon, authenticated;

-- Additive roster upsert for per-game college rosters: replaces only the teams in the payload.
create or replace function public.rosters_merge(p_sport_key text, p_players jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  delete from public.player_teams
   where sport_key = p_sport_key
     and team in (select distinct x.team from jsonb_to_recordset(p_players) as x(name text, team text)
                  where coalesce(x.team, '') <> '');
  insert into public.player_teams (sport_key, name_key, player_name, team)
  select distinct on (private.name_key(x.name), x.team) p_sport_key, private.name_key(x.name), x.name, x.team
  from jsonb_to_recordset(p_players) as x(name text, team text)
  where coalesce(x.name, '') <> '' and coalesce(x.team, '') <> '';
  get diagnostics v_n = row_count;
  return jsonb_build_object('players', v_n);
end;
$$;
revoke all on function public.rosters_merge(text, jsonb) from public, anon, authenticated;
grant execute on function public.rosters_merge(text, jsonb) to service_role;
