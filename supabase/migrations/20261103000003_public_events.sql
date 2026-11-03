-- Game schedules are public data; the create wizard lists them before the host has a session.
grant select on public.events to anon;

drop policy "events: readable by signed-in users" on public.events;
create policy "events: public schedule" on public.events
  for select to anon, authenticated using (true);
