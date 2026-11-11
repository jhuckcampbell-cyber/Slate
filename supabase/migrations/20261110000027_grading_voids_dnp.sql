-- Correctness: missing data is never zero and never evidence for a refund.
create function private.valid_prop_stat(p_market text, p_stat numeric) returns boolean
language sql immutable set search_path = '' as $$
  select p_stat between case when p_market in
    ('player_pass_yds','player_rush_yds','player_reception_yds') then -999 else 0 end and 9999
    and p_stat = trunc(p_stat)
    and p_market in ('player_pass_yds','player_rush_yds','player_reception_yds',
      'player_points','player_rebounds','player_assists','player_threes',
      'player_receptions','player_pass_tds','player_anytime_td');
$$;
revoke all on function private.valid_prop_stat(text,numeric) from public;
alter table public.prop_results drop constraint prop_results_stat_check;
alter table public.prop_results alter column stat drop not null;
alter table public.prop_results add column did_not_play boolean not null default false;
alter table public.prop_results add column source text not null default 'host';
alter table public.prop_results add constraint prop_results_stat_check check (
  (did_not_play and stat is null) or
  (not did_not_play and stat is not null and private.valid_prop_stat(market_key, stat)));
-- CHECK constraints execute as the inserting role; only the definer RPC writes results.

create function private.void_dnp_props(p_tid uuid, p_event text, p_player text, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_wager uuid;
begin
  -- Same tournament lock as host grading serializes competing evidence and host entries.
  perform 1 from public.tournaments t where t.id = p_tid
    and (t.lock_time <= now() or t.status not in ('draft','open')) for update;
  if not found then return; end if;
  insert into public.prop_results
    (tournament_id,event_id,market_key,participant_name,stat,did_not_play,graded_by,source)
  select distinct p_tid,p_event,regexp_replace(l.market_key,'_alternate$',''),l.participant_name,
    null::numeric,true,t.host_id,p_source
  from public.wager_legs l join public.tournaments t on t.id=l.tournament_id
  where l.tournament_id=p_tid and l.event_id=p_event and l.participant_name=p_player
    and l.market_key like 'player\_%' and l.status='pending'
  on conflict do nothing;
  for v_wager in
    with voided as (
      update public.wager_legs l set status='void',settled_at=now()
      where l.tournament_id=p_tid and l.event_id=p_event and l.participant_name=p_player
        and l.status='pending' and exists (
          select 1 from public.prop_results r where r.tournament_id=p_tid and r.event_id=p_event
          and r.participant_name=l.participant_name
          and r.market_key=regexp_replace(l.market_key,'_alternate$','') and r.did_not_play)
      returning l.wager_id)
    select distinct wager_id from voided
  loop perform private.settle_wager(v_wager); end loop;
  perform private.signal(p_tid,'scores','{}'::jsonb);
end;
$$;
revoke all on function private.void_dnp_props(uuid,text,text,text) from public;

-- Explicit host confirmation, never inferred from an empty stat field.
drop function public.grade_prop(uuid,text,text,text,numeric);
CREATE OR REPLACE FUNCTION public.grade_prop(p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric, p_did_not_play boolean default false)
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

  if not coalesce(p_did_not_play, false) and not coalesce(private.valid_prop_stat(v_market, p_stat), false) then
    raise exception 'INVALID_STAT';
  end if;
  if p_did_not_play then
    perform private.void_dnp_props(p_tournament_id, p_event_id, p_participant_name, 'host');
    return jsonb_build_object('did_not_play', true);
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

revoke all on function public.grade_prop(uuid,text,text,text,numeric,boolean) from public,anon;
grant execute on function public.grade_prop(uuid,text,text,text,numeric,boolean) to authenticated;

-- Private evidence: no pick or bankroll information is exposed.
create table private.player_participation (
  event_id text not null references public.events on delete cascade,
  name_key text not null, player_name text not null,
  did_not_play boolean not null,is_final boolean not null,
  primary key(event_id,name_key)
);
revoke all on private.player_participation from public,anon,authenticated;
create or replace function public.stats_ingest(p_event_id text, p_provider_id text, p_final boolean, p_stats jsonb,
                                               p_remaining double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_changed int;
  v_tid uuid;
  v_dnp record;
begin
  insert into private.player_participation(event_id,name_key,player_name,did_not_play,is_final)
  select p_event_id,private.name_key(x.name),x.name,bool_and(x.did_not_play),coalesce(p_final,false)
  from jsonb_to_recordset(coalesce(p_stats,'[]')) x(name text,did_not_play boolean)
  where x.name <> '' and x.did_not_play is not null group by x.name
  on conflict(event_id,name_key) do update
    set did_not_play=private.player_participation.did_not_play and excluded.did_not_play,is_final=excluded.is_final
    where not private.player_participation.is_final;
  for v_dnp in
    select distinct l.tournament_id,l.participant_name
    from public.wager_legs l join private.player_participation pp
      on pp.event_id=l.event_id and pp.name_key=private.name_key(l.participant_name)
    where l.event_id=p_event_id and pp.did_not_play and pp.is_final and l.status='pending'
    order by l.tournament_id,l.participant_name
  loop
    perform private.void_dnp_props(v_dnp.tournament_id,p_event_id,v_dnp.participant_name,'feed');
  end loop;
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
      and private.valid_prop_stat(x.market_key,x.stat)
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


-- No elapsed-time fallback: operators investigate missing finals, without irreversible refunds.
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
         and e.status in ('postponed', 'canceled')
      returning l.wager_id
    )
    select distinct v.wager_id from voided v
  loop
    perform private.settle_wager(v_wager);
  end loop;
end;
$$;

revoke all on function private.void_stale_legs() from public;


create view private.grading_review as
select l.tournament_id,l.event_id,count(*) as pending_legs,
  case when e.status='final' then 'UNRESOLVED_PROPS' else 'MISSING_FINAL' end as reason
from public.wager_legs l join public.events e on e.id=l.event_id
join public.tournaments t on t.id=l.tournament_id
where l.status='pending' and e.commence_time < now()-interval '12 hours'
  and e.status not in ('canceled','postponed')
  and (t.lock_time <= now() or t.status not in ('draft','open'))
group by l.tournament_id,l.event_id,e.status;
revoke all on private.grading_review from public,anon,authenticated;
grant usage on schema private to service_role;
grant select on private.grading_review to service_role;
comment on view private.grading_review is 'Operator queue after 12 hours; no automatic refund for feed outages or missing host stats.';

-- Disqualified rows retain a display rank, but can never receive first place, even if all fail.
create or replace view public.leaderboard with (security_invoker = true) as
with pending as (
  select w.participant_id,
         sum(public.current_payout(w)) as payout,
         sum(public.live_probability(w) * public.current_payout(w)) as ev
  from public.wagers w
  where w.status = 'pending'
  group by w.participant_id
), placed as (
  select w.participant_id, count(*)::int as bets, sum(w.amount_cents)::bigint as wagered
  from public.wagers w
  group by w.participant_id
), base as (
  select p.tournament_id, p.id as participant_id, p.user_id, pr.display_name,
         p.remaining_bankroll_cents::bigint as cash_cents,
         (p.remaining_bankroll_cents + coalesce(pe.payout, 0))::bigint as max_cents,
         (p.remaining_bankroll_cents + coalesce(round(pe.ev), 0))::bigint as ev_cents,
         coalesce(pl.bets, 0) as bets_count,
         coalesce(pl.wagered, 0) as wagered_cents,
         (coalesce(pl.bets, 0) >= coalesce((t.allowed_bet_types ->> 'min_bets')::int, 0)
          and (not coalesce((t.allowed_bet_types ->> 'all_in')::boolean, false)
               or coalesce(pl.wagered, 0) >= t.starting_bankroll_cents)) as qualified
  from public.tournament_participants p
  join public.tournaments t on t.id = p.tournament_id
  join public.profiles pr on pr.id = p.user_id
  left join pending pe on pe.participant_id = p.id
  left join placed pl on pl.participant_id = p.id
)
select b.tournament_id, b.participant_id, b.user_id, b.display_name, b.cash_cents, b.max_cents, b.ev_cents,
       greatest(rank() over (partition by b.tournament_id order by b.qualified desc, b.ev_cents desc, b.cash_cents desc)::int,
         case when b.qualified then 1 else 2 end) as rank,
       case when not b.qualified then 'disqualified'
            when b.max_cents = 0 then 'busted'
            when b.max_cents < max(b.cash_cents) filter (where b.qualified) over (partition by b.tournament_id) then 'eliminated'
            else 'alive' end as standing,
       b.bets_count, b.wagered_cents, b.qualified
from base b;
