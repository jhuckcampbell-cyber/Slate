-- Closed beta: the feasibility test is whether a friend group starts a SECOND tournament.
-- A finished tournament counts as "repeated" when a tournament created after its lock shares at
-- least two of its players. Operator-only (service role): `npm run metrics`.
create function public.beta_metrics() returns jsonb
language sql stable security definer set search_path = '' as $$
  with finished as (
    select t.id, t.lock_time from public.tournaments t where t.status = 'settled'
  ),
  repeated as (
    select f.id
    from finished f
    where exists (
      select 1
      from public.tournaments later
      where later.id <> f.id and later.created_at > f.lock_time
        and (select count(*) from public.tournament_participants a
             join public.tournament_participants b on b.user_id = a.user_id
             where a.tournament_id = f.id and b.tournament_id = later.id) >= 2
    )
  ),
  sizes as (
    select count(*) as n from public.tournament_participants p group by p.tournament_id
  )
  select jsonb_build_object(
    'tournaments_created', (select count(*) from public.tournaments),
    'tournaments_finished', (select count(*) from finished),
    'finished_with_repeat', (select count(*) from repeated),
    'repeat_rate', case when (select count(*) from finished) = 0 then 0
                        else round((select count(*) from repeated)::numeric / (select count(*) from finished), 3) end,
    'players', (select count(distinct p.user_id) from public.tournament_participants p),
    'avg_players_per_tournament', coalesce((select round(avg(n), 1) from sizes), 0),
    'wagers', (select count(*) from public.wagers)
  );
$$;
revoke all on function public.beta_metrics() from public, anon, authenticated;
grant execute on function public.beta_metrics() to service_role;
