-- Unlinked anonymous guests have no durable identity after clearing their session.
-- Verified email snapshots survive account replacement; UUID remains the guest fallback.
alter table private.tournament_removals drop constraint tournament_removals_user_id_fkey;
alter table private.tournament_removals add column verified_email text;
update private.tournament_removals r set verified_email=lower(btrim(u.email))
 from auth.users u where u.id=r.user_id and u.email_confirmed_at is not null;
create index tournament_removals_email on private.tournament_removals(tournament_id,verified_email);
create or replace function private.was_removed(p_tournament_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from private.tournament_removals r
 where r.tournament_id=p_tournament_id and (r.user_id=auth.uid() or r.verified_email in
 (select lower(btrim(u.email)) from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null)));
$$;
revoke all on function private.was_removed(uuid) from public,anon,authenticated;

create or replace function public.remove_participant(p_tournament_id uuid, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  perform private.enforce_rpc_rate('remove_participant');
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  if p_user_id = v_t.host_id then
    raise exception 'CANNOT_REMOVE_HOST';
  end if;

  -- Snapshot before deletion, without consulting wagers or bankrolls.
  insert into private.tournament_removals(tournament_id,user_id,verified_email)
  select p_tournament_id,u.id,case when u.email_confirmed_at is not null then lower(btrim(u.email)) end
  from auth.users u where u.id=p_user_id
  on conflict (tournament_id,user_id) do update set verified_email=excluded.verified_email;
  delete from public.tournament_participants p
   where p.tournament_id = p_tournament_id and p.user_id = p_user_id;
  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  insert into private.tournament_removals (tournament_id, user_id)
  values (p_tournament_id, p_user_id)
  on conflict do nothing;
end;
$$;
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

  select * into v_t from public.tournaments t where t.code = upper(btrim(p_code)) for share;
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
create or replace function public.removed_from(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce((select private.was_removed(t.id) from public.tournaments t
 where t.code=upper(btrim(p_code))),false);
$$;
revoke all on function public.remove_participant(uuid,uuid),public.join_tournament(text),public.removed_from(text) from public,anon;
grant execute on function public.remove_participant(uuid,uuid),public.join_tournament(text),public.removed_from(text) to authenticated;
-- Private operational tables are owner-only; RLS also denies accidental future grants.
do $$ declare r record; begin
 for r in select n.nspname,c.relname from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private') and c.relkind in ('r','p')
 loop execute format('alter table %I.%I enable row level security',r.nspname,r.relname); end loop;
end $$;
