-- One heartbeat slot: no unbounded history; service role only.
create table public.odds_worker_heartbeat (
 id boolean primary key default true check(id),
 worker_id text not null,
 seen_at timestamptz not null default clock_timestamp()
);
alter table public.odds_worker_heartbeat enable row level security;
revoke all on public.odds_worker_heartbeat from public,anon,authenticated;
grant select on public.odds_worker_heartbeat to service_role;
create function public.odds_worker_beat(p_worker_id text) returns void
language sql security definer set search_path='' as $$
 insert into public.odds_worker_heartbeat(id,worker_id,seen_at) values(true,left(p_worker_id,128),clock_timestamp())
 on conflict(id) do update set worker_id=excluded.worker_id,seen_at=excluded.seen_at;
$$;
revoke all on function public.odds_worker_beat(text) from public,anon,authenticated;
grant execute on function public.odds_worker_beat(text) to service_role;
create or replace function private.trigger_odds_sync() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if exists(select 1 from public.odds_worker_heartbeat where seen_at>clock_timestamp()-interval '45 seconds') then return; end if;
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'odds_sync_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'odds_sync_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if jsonb_array_length(private.odds_sync_due_jobs()) = 0 then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.trigger_odds_sync() from public;

