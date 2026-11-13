-- Keep historical identity rows when Auth removes credentials; never cascade standings.
alter table public.profiles drop constraint profiles_id_fkey;

-- Only the owner can read profile metadata. Tournament names remain available via
-- narrowly scoped helpers and existing roster RPCs.
drop policy "profiles: self or tournament-mates" on public.profiles;
create policy "profiles: self" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create function private.profile_display_name(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.display_name from public.profiles p
  where p.id = p_id and (p.id = auth.uid() or private.shares_tournament(p.id));
$$;
revoke all on function private.profile_display_name(uuid) from public, anon;
grant execute on function private.profile_display_name(uuid) to authenticated;

-- Preserve the roster contract while withholding another player's avatar.
create or replace function public.get_roster(p_tournament_id uuid)
returns table (
  user_id uuid, display_name text, avatar_url text, is_host boolean, joined_at timestamptz,
  has_submitted boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_participant(p_tournament_id) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  return query
  select pr.id, pr.display_name,
         case when pr.id = auth.uid() then pr.avatar_url else null::text end,
         pr.id = t.host_id, p.joined_at,
         exists (select 1 from public.wagers w where w.participant_id = p.id)
  from public.tournament_participants p
  join public.profiles pr on pr.id = p.user_id
  join public.tournaments t on t.id = p.tournament_id
  where p.tournament_id = p_tournament_id
  order by p.joined_at;
end;
$$;
revoke all on function public.get_roster(uuid) from public, anon;
grant execute on function public.get_roster(uuid) to authenticated;

create function private.prepare_account_deletion(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize host creation/transfer/status changes with the final Auth deletion.
  lock table public.tournaments in share row exclusive mode;
  if exists (select 1 from public.tournaments
             where host_id = p_id and status in ('draft', 'open', 'locked')) then
    raise exception 'ACCOUNT_HOSTS_ACTIVE_TOURNAMENT';
  end if;
  update public.profiles set display_name = 'Deleted player', avatar_url = null
    where id = p_id;
end;
$$;
revoke all on function private.prepare_account_deletion(uuid) from public, anon, authenticated;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform private.prepare_account_deletion(auth.uid());
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Recheck in the actual Auth transaction: preparation and admin deletion are two
-- requests, and a new tournament could have been created between them.
create function private.on_account_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.prepare_account_deletion(old.id);
  return old;
end;
$$;
revoke all on function private.on_account_deleted() from public, anon, authenticated;
create trigger on_account_deleted before delete on auth.users
  for each row execute function private.on_account_deleted();
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
from base b;

