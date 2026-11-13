-- Serialize capacity checks without weakening lock/removal rules.
create or replace function public.join_tournament(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  perform private.enforce_rpc_rate('join_tournament');
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_t from public.tournaments t where t.code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND';
  end if;

  if exists (select 1 from public.tournament_participants p
             where p.tournament_id = v_t.id and p.user_id = v_uid) then
    return v_t.id;
  end if;

  if private.was_removed(v_t.id) then
    raise exception 'REMOVED_BY_HOST';
  end if;

  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;

  if (select count(*) from public.tournament_participants p where p.tournament_id = v_t.id) >= 100 then
    raise exception 'TOURNAMENT_FULL';
  end if;

  insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
  values (v_t.id, v_uid, v_t.starting_bankroll_cents)
  on conflict (tournament_id, user_id) do nothing;

  return v_t.id;
end;
$$;

create table public.grading_reviews (
 id bigint generated always as identity primary key,
 event_id text not null references public.events on delete cascade,
 kind text not null check(kind in ('score','stat','host')),
 subject text not null,
 previous jsonb not null,
 proposed jsonb not null,
 created_at timestamptz not null default now()
);
create unique index grading_reviews_provider_dedup on public.grading_reviews(event_id,kind,subject,previous,proposed) where kind<>'host';
alter table public.grading_reviews enable row level security;
revoke all on public.grading_reviews from public,anon,authenticated;
grant select on public.grading_reviews to authenticated;
create policy "hosts review after reveal" on public.grading_reviews for select to authenticated using (
 exists(select 1 from public.tournament_events te join public.tournaments t on t.id=te.tournament_id
 where te.event_id=grading_reviews.event_id and t.host_id=auth.uid() and t.lock_time<=now())
);
-- This trigger also freezes legacy final rows lacking provider identity.
create function private.preserve_final_stat() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.is_final then
  if new.stat is distinct from old.stat then
   insert into public.grading_reviews(event_id,kind,subject,previous,proposed)
   values(old.event_id,'stat',old.name_key||':'||old.market_key,
    jsonb_build_object('stat',old.stat),jsonb_build_object('stat',new.stat)) on conflict do nothing;
  end if;
  new.stat:=old.stat; new.is_final:=true;
 end if;
 return new;
end; $$;
revoke all on function private.preserve_final_stat() from public,anon,authenticated;
create trigger preserve_final_stat before update on public.player_stats
for each row execute function private.preserve_final_stat();

alter function public.scores_ingest(text,timestamptz,jsonb) set schema private;
alter function private.scores_ingest(text,timestamptz,jsonb) rename to scores_ingest_final_core;
revoke all on function private.scores_ingest_final_core(text,timestamptz,jsonb) from public,anon,authenticated;
create function public.scores_ingest(p_sport_key text,p_fetched_at timestamptz,p_scores jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('odds-ingest:'||p_sport_key));
 insert into public.grading_reviews(event_id,kind,subject,previous,proposed)
 select e.id,'score','final',jsonb_build_object('home_score',e.home_score,'away_score',e.away_score),
 jsonb_build_object('home_score',x.home_score,'away_score',x.away_score)
 from jsonb_to_recordset(p_scores) x(event_id text,completed boolean,home_score int,away_score int)
 join public.events e on e.id=x.event_id and e.sport_key=p_sport_key
 where e.status='final' and x.completed and x.home_score is not null and x.away_score is not null
 and (e.home_score,e.away_score) is distinct from (x.home_score,x.away_score)
 on conflict do nothing;
 return private.scores_ingest_final_core(p_sport_key,p_fetched_at,p_scores);
end; $$;
revoke all on function public.scores_ingest(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.scores_ingest(text,timestamptz,jsonb) to service_role;

-- Capture corrections even when the existing upsert excludes a finalized row.
alter function public.stats_ingest(text,text,boolean,jsonb,double precision) set schema private;
alter function private.stats_ingest(text,text,boolean,jsonb,double precision) rename to stats_ingest_final_core;
revoke all on function private.stats_ingest_final_core(text,text,boolean,jsonb,double precision) from public,anon,authenticated;
create function public.stats_ingest(p_event_id text,p_provider_id text,p_final boolean,p_stats jsonb,
 p_remaining double precision default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_stats jsonb;
begin
 perform 1 from public.events where id=p_event_id for update;
 insert into public.grading_reviews(event_id,kind,subject,previous,proposed)
 select ps.event_id,'stat',ps.name_key||':'||ps.market_key,jsonb_build_object('stat',ps.stat),
 jsonb_build_object('stat',x.stat)
 from jsonb_to_recordset(p_stats) x(name text,market_key text,stat numeric)
 join public.player_stats ps on ps.event_id=p_event_id and ps.name_key=private.name_key(x.name)
 and ps.market_key=x.market_key
 where p_final and ps.is_final and ps.stat is distinct from x.stat
 and private.valid_prop_stat(x.market_key,x.stat) on conflict do nothing;
 -- Changed final values are review-only: do not attach new grading evidence to an old value.
 select coalesce(jsonb_agg(x.value),'[]'::jsonb) into v_stats from jsonb_array_elements(p_stats) x
 where not exists(select 1 from public.player_stats ps where ps.event_id=p_event_id and ps.is_final
 and ps.name_key=private.name_key(x.value->>'name') and ps.market_key=x.value->>'market_key'
 and ps.stat is distinct from (x.value->>'stat')::numeric and x.value->>'stat' is not null);
 return private.stats_ingest_final_core(p_event_id,p_provider_id,p_final,v_stats,p_remaining);
end; $$;
revoke all on function public.stats_ingest(text,text,boolean,jsonb,double precision) from public,anon,authenticated;
grant execute on function public.stats_ingest(text,text,boolean,jsonb,double precision) to service_role;

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
  select p.tournament_id, p.id as participant_id, p.user_id, private.profile_display_name(p.user_id) as display_name,
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
from base b
order by b.tournament_id, rank, b.participant_id;
