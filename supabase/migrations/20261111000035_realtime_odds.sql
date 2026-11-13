-- Collect statement transition tables, then send once per sport/transaction (including
-- INSERT ON CONFLICT's insert/update statements and withdrawn prop deletes).
create table private.odds_signal_queue (
  transaction_id bigint not null,
  sport_key text not null,
  event_ids text[] not null,
  market_keys text[] not null,
  primary key (transaction_id, sport_key)
);
revoke all on private.odds_signal_queue from public, anon, authenticated;

create function private.collect_odds_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.odds_signal_queue as q
  select txid_current(), e.sport_key, array_agg(distinct c.event_id), array_agg(distinct c.market_key)
  from changed_odds c join public.events e on e.id = c.event_id
  group by e.sport_key
  on conflict (transaction_id, sport_key) do update
  set event_ids = array(select distinct unnest(q.event_ids || excluded.event_ids)),
      market_keys = array(select distinct unnest(q.market_keys || excluded.market_keys));
  return null;
end;
$$;
create function private.flush_odds_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare batch private.odds_signal_queue;
begin
  delete from private.odds_signal_queue
  where transaction_id = new.transaction_id and sport_key = new.sport_key returning * into batch;
  if found then
    perform realtime.send(jsonb_build_object(
      'event_ids', batch.event_ids, 'market_keys', batch.market_keys,
      'version', batch.transaction_id::text), 'odds', 'odds:' || batch.sport_key, true);
  end if;
  return null;
end;
$$;
revoke all on function private.collect_odds_signal(), private.flush_odds_signal() from public, anon, authenticated;
create trigger odds_signal_insert after insert on public.odds_cache
referencing new table as changed_odds for each statement execute function private.collect_odds_signal();
create trigger odds_signal_update after update on public.odds_cache
referencing new table as changed_odds for each statement execute function private.collect_odds_signal();
create trigger odds_signal_delete after delete on public.odds_cache
referencing old table as changed_odds for each statement execute function private.collect_odds_signal();
create constraint trigger odds_signal_flush after insert or update on private.odds_signal_queue
  deferrable initially deferred for each row execute function private.flush_odds_signal();

create policy "odds channels: authenticated receive broadcasts" on realtime.messages
for select to authenticated using (
  extension = 'broadcast' and topic = (select realtime.topic())
  and topic ~ '^odds:[a-z0-9_]+$'
);
-- No client INSERT policy. Anonymous-auth users have role authenticated; unauthenticated
-- anon connections have no access. Tournament membership policy remains independent.
