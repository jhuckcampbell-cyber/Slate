-- College game lines are opt-in; keep the existing paid-job selection/cadence intact.
insert into private.app_settings (key, value) values
  ('odds_college_enabled', 'false'::jsonb),
  ('odds_college_max_events', '8'::jsonb)
on conflict (key) do nothing; -- prod set these by hand before this migration shipped

-- Catalog (free /events) for college; the wrapper below drops it while the switch is off.
update private.app_settings set value = value || '["americanfootball_ncaaf", "basketball_ncaab"]'::jsonb
 where key = 'odds_catalog_sports' and not (value ? 'americanfootball_ncaaf');

-- Preserve the original builder behind a private filtering wrapper.
alter function private.odds_sync_odds_jobs() rename to odds_sync_odds_jobs_base;
revoke all on function private.odds_sync_odds_jobs_base() from public, anon, authenticated;

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
         and j.job ->> 'kind' in ('catalog', 'odds', 'scores'));
$$;
revoke all on function private.odds_sync_odds_jobs() from public, anon, authenticated;

create or replace function private.prop_markets(p_sport_key text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_sport_key in ('americanfootball_ncaaf', 'basketball_ncaab') then '{}'::text[]
    when p_sport_key like 'basketball%' then array['player_points', 'player_rebounds', 'player_assists']
    when p_sport_key like 'americanfootball%' then array[
      'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions',
      'player_pass_yds_alternate', 'player_rush_yds_alternate', 'player_reception_yds_alternate',
      'player_receptions_alternate', 'player_pass_tds', 'player_anytime_td']
    else '{}'::text[]
  end;
$$;

-- Latest live_due_jobs (0030, recovery cadence) plus college football/basketball behind the switch.
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
      where (e.sport_key in ('basketball_nba', 'americanfootball_nfl')
        or (e.sport_key in ('americanfootball_ncaaf', 'basketball_ncaab')
            and coalesce(private.odds_setting('odds_college_enabled'), 'false'::jsonb) = 'true'::jsonb))
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
