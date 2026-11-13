-- Existing host RPC signature: generated client types remain compatible.
alter function public.grade_prop(uuid,text,text,text,numeric,boolean) set schema private;
alter function private.grade_prop(uuid,text,text,text,numeric,boolean) rename to grade_prop_initial;
revoke all on function private.grade_prop_initial(uuid,text,text,text,numeric,boolean) from public,anon,authenticated;
create function public.grade_prop(p_tournament_id uuid,p_event_id text,p_market_key text,
 p_participant_name text,p_stat numeric,p_did_not_play boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_market text:=regexp_replace(p_market_key,'_alternate$','');
 v_old public.prop_results%rowtype;
 v_t public.tournaments%rowtype;
begin
 if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
 -- Same event -> tournament ordering as automatic grading.
 perform 1 from public.events where id=p_event_id for update;
 select * into v_t from public.tournaments where id=p_tournament_id for update;
 if not found or v_t.host_id is distinct from auth.uid() then raise exception 'NOT_HOST'; end if;
 if v_t.lock_time>now() then raise exception 'GAME_NOT_FINAL'; end if;
 select * into v_old from public.prop_results where tournament_id=p_tournament_id
 and event_id=p_event_id and market_key=v_market and participant_name=p_participant_name;
 if not found then
  return private.grade_prop_initial(p_tournament_id,p_event_id,v_market,p_participant_name,p_stat,p_did_not_play);
 end if;
 perform private.enforce_rpc_rate('grade_prop');
 -- DNP evidence is immutable, including while another parlay leg is pending.
 if v_old.stat is null then raise exception 'ALREADY_GRADED'; end if;
 -- Lock all affected wagers before testing irreversibility. Lost wagers count too.
 perform 1 from public.wagers w where exists(select 1 from public.wager_legs l
 where l.wager_id=w.id and l.tournament_id=p_tournament_id and l.event_id=p_event_id
 and l.market_key in (v_market,v_market||'_alternate') and l.participant_name=p_participant_name)
 order by w.id for update;
 if exists(select 1 from public.wagers w join public.wager_legs l on l.wager_id=w.id
 where l.tournament_id=p_tournament_id and l.event_id=p_event_id
 and l.market_key in (v_market,v_market||'_alternate') and l.participant_name=p_participant_name
 and w.status<>'pending') then raise exception 'ALREADY_GRADED'; end if;
 if coalesce(p_did_not_play,false) then raise exception 'CORRECTION_REQUIRES_REVIEW'; end if;
 if not coalesce(private.valid_prop_stat(v_market,p_stat),false) then raise exception 'INVALID_STAT'; end if;
 if v_old.stat=p_stat then return jsonb_build_object('unchanged',true); end if;
 insert into public.grading_reviews(event_id,kind,subject,previous,proposed)
 values(p_event_id,'host',p_tournament_id||':'||v_market||':'||p_participant_name,
 jsonb_build_object('stat',v_old.stat,'by',v_old.graded_by),jsonb_build_object('stat',p_stat,'by',auth.uid()))
 on conflict do nothing;
 delete from public.prop_results where tournament_id=p_tournament_id and event_id=p_event_id
 and market_key=v_market and participant_name=p_participant_name;
 update public.wager_legs set status='pending',settled_at=null
 where tournament_id=p_tournament_id and event_id=p_event_id and participant_name=p_participant_name
 and market_key in (v_market,v_market||'_alternate');
 return private.grade_prop_result(p_tournament_id,p_event_id,v_market,p_participant_name,p_stat,false,'host');
end; $$;
revoke all on function public.grade_prop(uuid,text,text,text,numeric,boolean) from public,anon;
grant execute on function public.grade_prop(uuid,text,text,text,numeric,boolean) to authenticated;
