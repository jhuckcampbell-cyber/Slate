-- Verified per-player/per-market evidence, separate from public display-only live stats.
create table private.prop_stat_evidence (
  event_id text not null references public.events on delete cascade,
  name_key text not null, market_key text not null, provider_player_id text not null,
  primary key(event_id,name_key,market_key)
);
revoke all on private.prop_stat_evidence from public,anon,authenticated;
-- Existing feed DNP provenance is retained; all new automatic results say box_score.
alter table public.player_stats add column provider_player_id text;
alter table public.prop_results add column provider_player_id text;
alter table private.player_participation add column provider_player_id text;
drop policy "prop results: the squad" on public.prop_results;
create policy "prop results: the squad" on public.prop_results for select to authenticated
using (private.is_participant(tournament_id) and exists (
  select 1 from public.tournaments t where t.id=tournament_id and t.lock_time<=now()));

create function private.prop_stat_supported(p_sport text,p_market text) returns boolean
language sql immutable set search_path = '' as $$
 select case p_sport
 when 'basketball_nba' then regexp_replace(p_market,'_alternate$','') = any(array[
 'player_points','player_rebounds','player_assists','player_threes'])
 when 'americanfootball_nfl' then regexp_replace(p_market,'_alternate$','') = any(array[
 'player_pass_yds','player_rush_yds','player_reception_yds','player_receptions','player_pass_tds','player_anytime_td'])
 else false end;
$$;
revoke all on function private.prop_stat_supported(text,text) from public,anon,authenticated;
-- One settlement path for host entries and verified box scores. Tournament row locks
-- serialize the two callers; settle_wager remains the sole payout authority.
create function private.grade_prop_result(p_tournament_id uuid, p_event_id text, p_market_key text,
  p_participant_name text, p_stat numeric, p_did_not_play boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_market text := regexp_replace(p_market_key, '_alternate$', '');
  v_host uuid;
  v_wager uuid;
  v_n int := 0;
begin
  select host_id into v_host from public.tournaments where id=p_tournament_id
    and (lock_time<=now() or status not in ('draft','open')) for update;
  if not found then return '{}'::jsonb; end if;
  if exists(select 1 from public.prop_results where tournament_id=p_tournament_id
    and event_id=p_event_id and market_key=v_market and participant_name=p_participant_name) then
    return '{}'::jsonb;
  end if;
  if not coalesce(p_did_not_play, false) and not coalesce(private.valid_prop_stat(v_market, p_stat), false) then
    raise exception 'INVALID_STAT';
  end if;
  if p_did_not_play then
    perform private.void_dnp_props(p_tournament_id, p_event_id, p_participant_name, p_source);
    return jsonb_build_object('did_not_play', true);
  end if;

  insert into public.prop_results (tournament_id, event_id, market_key, participant_name, stat, graded_by, source)
  values (p_tournament_id, p_event_id, v_market, p_participant_name, p_stat, v_host, p_source);

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
$$;
revoke all on function private.grade_prop_result(uuid,text,text,text,numeric,boolean,text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.grade_prop(p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric, p_did_not_play boolean default false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype;
  v_status text;
  v_market text := regexp_replace(p_market_key, '_alternate$', '');
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.host_id is distinct from auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time > now() and v_t.status in ('draft','open') then
    raise exception 'GAME_NOT_FINAL';
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

  return private.grade_prop_result(p_tournament_id,p_event_id,v_market,p_participant_name,
    p_stat,p_did_not_play,'host');
end;
$function$;

create function private.auto_grade_props(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform 1 from public.events where id=p_event and status='final' for update;
  if not found then return; end if;
  for r in
    select distinct l.tournament_id,l.participant_name,
      regexp_replace(l.market_key,'_alternate$','') as market,
      ps.stat, coalesce(ev.provider_player_id,pp.provider_player_id) as provider_player_id,
      coalesce(pp.did_not_play and pp.is_final,false) as dnp
    from public.wager_legs l join public.events e on e.id=l.event_id
    left join public.player_stats ps on ps.event_id=l.event_id
      and ps.name_key=private.name_key(l.participant_name)
      and ps.market_key=regexp_replace(l.market_key,'_alternate$','') and ps.is_final
    left join private.prop_stat_evidence ev on ev.event_id=ps.event_id
      and ev.name_key=ps.name_key and ev.market_key=ps.market_key
    left join private.player_participation pp on pp.event_id=l.event_id
      and pp.name_key=private.name_key(l.participant_name)
    where l.event_id=p_event and l.status='pending' and l.market_key like 'player\_%'
      and ((pp.did_not_play and pp.is_final) or
        (ev.provider_player_id is not null and private.prop_stat_supported(e.sport_key,l.market_key)))
    order by l.tournament_id,l.participant_name,market
  loop
    perform private.grade_prop_result(r.tournament_id,p_event,r.market,r.participant_name,r.stat,r.dnp,'box_score');
    update public.prop_results set provider_player_id=r.provider_player_id
      where tournament_id=r.tournament_id and event_id=p_event and market_key=r.market
      and participant_name=r.participant_name and source='box_score' and provider_player_id is null;
  end loop;
end;
$$;
revoke all on function private.auto_grade_props(text) from public,anon,authenticated;
-- Both arrival orders work, without replacing scores ingestion or its finality guards.
create function private.props_on_final() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='final' then perform private.auto_grade_props(new.id); end if;
  return new;
end;
$$;
revoke all on function private.props_on_final() from public,anon,authenticated;
create trigger self_settling_props after update of status on public.events
for each row when (new.status='final' and old.status is distinct from new.status)
execute function private.props_on_final();
create or replace function public.stats_ingest(p_event_id text, p_provider_id text, p_final boolean, p_stats jsonb,
                                               p_remaining double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed int;
  v_tid uuid;
begin
  -- Serialize ingest/final arrival and reject a changed provider game identity.
  perform 1 from public.events where id=p_event_id for update;
  if exists(select 1 from private.stats_sync_state where event_id=p_event_id
    and provider_id is not null and provider_id is distinct from p_provider_id) then
    raise exception 'PROVIDER_ID_MISMATCH';
  end if;
  insert into private.prop_stat_evidence(event_id,name_key,market_key,provider_player_id)
  select p_event_id,private.name_key(x.name),x.market_key,min(x.provider_player_id)
  from jsonb_to_recordset(coalesce(p_stats,'[]')) x(name text,market_key text,provider_player_id text,complete boolean,stat numeric)
  where p_final and x.complete and x.provider_player_id<>'' and private.valid_prop_stat(x.market_key,x.stat)
    and not exists (select 1 from jsonb_to_recordset(coalesce(p_stats,'[]'))
      other(name text,provider_player_id text) where private.name_key(other.name)=private.name_key(x.name)
      and other.provider_player_id is not null and other.provider_player_id<>x.provider_player_id)
  group by private.name_key(x.name),x.market_key
  having count(distinct x.provider_player_id)=1
  on conflict do nothing;
  insert into private.player_participation(event_id,name_key,player_name,did_not_play,is_final,provider_player_id)
  select p_event_id,private.name_key(x.name),x.name,bool_and(x.did_not_play),coalesce(p_final,false),min(x.provider_player_id)
  from jsonb_to_recordset(coalesce(p_stats,'[]')) x(name text,did_not_play boolean,provider_player_id text)
  where x.name <> '' and x.did_not_play is not null group by x.name
  on conflict(event_id,name_key) do update
    set did_not_play=private.player_participation.did_not_play and excluded.did_not_play,is_final=excluded.is_final,
      provider_player_id=coalesce(private.player_participation.provider_player_id,excluded.provider_player_id)
    where not private.player_participation.is_final;
  insert into private.stats_sync_state as s (event_id, provider_id, is_final, remaining, last_sync_at)
  values (p_event_id, p_provider_id, coalesce(p_final, false),
          case when p_final then 0 else greatest(0, least(1, p_remaining)) end, now())
  on conflict (event_id) do update
    set provider_id = coalesce(excluded.provider_id, s.provider_id),
        is_final = s.is_final or excluded.is_final,
        remaining = coalesce(excluded.remaining, s.remaining),
        last_sync_at = excluded.last_sync_at;

  with incoming as (
    select distinct on (private.name_key(x.name), x.market_key)
           private.name_key(x.name) as name_key, x.name, x.team, x.market_key, x.stat, coalesce(x.complete,false) as complete
    from jsonb_to_recordset(coalesce(p_stats, '[]'::jsonb)) as x(name text, team text, market_key text, stat numeric, complete boolean)
    where coalesce(x.name, '') <> '' and coalesce(x.market_key, '') <> '' and x.stat is not null
      and private.valid_prop_stat(x.market_key,x.stat)
  ),
  up as (
    insert into public.player_stats as ps (event_id, name_key, player_name, team, market_key, stat, is_final, updated_at)
    -- Display finality preserves the legacy p_final contract. Automatic grading
    -- separately requires complete, identified evidence in prop_stat_evidence.
    select p_event_id, i.name_key, i.name, i.team, i.market_key, i.stat, coalesce(p_final, false), now()
    from incoming i
    on conflict (event_id, name_key, market_key) do update
      set stat = excluded.stat, is_final = excluded.is_final, team = excluded.team,
          player_name = excluded.player_name, updated_at = excluded.updated_at
      where (not ps.is_final or ps.provider_player_id is null) and (ps.stat is distinct from excluded.stat or ps.is_final is distinct from excluded.is_final)
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
  update public.player_stats ps set provider_player_id=ev.provider_player_id
    from private.prop_stat_evidence ev where ps.event_id=p_event_id and ev.event_id=ps.event_id
      and ev.name_key=ps.name_key and ev.market_key=ps.market_key and ps.provider_player_id is null;
  perform private.auto_grade_props(p_event_id);
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
      and e.commence_time <= now() and e.commence_time > now() - interval '48 hours'
      and e.status not in ('canceled', 'postponed')
      and (s.last_sync_at is null or s.last_sync_at <= now() - interval '50 seconds')
      and exists (select 1 from public.wager_legs l
                  where l.tournament_id = t.id and l.event_id = e.id and l.participant_name <> '' and l.status='pending')
  ) g;
$$;
revoke all on function private.stats_due_jobs() from public;

