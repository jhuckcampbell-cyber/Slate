-- Phase 1 core schema: profiles, events, tournaments, participants + visibility helpers + RLS.
-- Rule: clients never write tournaments/participants directly (RPCs only). See CLAUDE.md.

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies call private.* helpers as the querying role, so it needs USAGE + EXECUTE.
-- `private` is not exposed through the Data API (config.toml api.schemas), so these
-- functions are not callable as RPCs.
grant usage on schema private to authenticated;

create type public.tournament_status as enum ('draft', 'open', 'locked', 'live', 'settled');

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (public-facing identity; email/phone stay in auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  avatar_url text,
  is_guest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Auto-create a profile for every new auth user (anonymous guests included).
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    left(coalesce(v_name, 'Player ' || upper(left(new.id::text, 4))), 24),
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Guest "claims" their account by linking email/phone → no longer anonymous.
create function private.handle_user_claimed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_anonymous and not coalesce(new.is_anonymous, false) then
    update public.profiles set is_guest = false where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_claimed after update of is_anonymous on auth.users
  for each row execute function private.handle_user_claimed();

-- ---------------------------------------------------------------------------
-- events (canonical games; written only by service role / odds sync)
-- ---------------------------------------------------------------------------
create table public.events (
  id text primary key,                               -- provider event id
  sport_key text not null,                           -- americanfootball_nfl, basketball_nba, ...
  sport_title text,
  home_team text not null,
  away_team text not null,
  commence_time timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'final', 'postponed', 'canceled')),
  home_score int,
  away_score int,
  scores_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
create index events_upcoming_idx on public.events (sport_key, commence_time);

create trigger events_touch before update on public.events
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- tournaments
-- ---------------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  description text check (char_length(description) <= 280),
  -- Keep in sync with src/lib/core/codes.ts (CODE_PATTERN / CODE_ALPHABET).
  code text not null unique check (code ~ '^[A-Z0-9]{2,5}-[2-9A-HJ-KMNP-TV-Z]{4}$'),
  sport_key text not null,
  starting_bankroll_cents int not null default 10000
    check (starting_bankroll_cents between 100 and 100000000),
  max_bet_cents int check (max_bet_cents > 0),       -- null = up to remaining bankroll
  min_total_wager_cents int not null default 0 check (min_total_wager_cents >= 0),
  allowed_bet_types jsonb not null default
    '{"markets":["h2h","spreads","totals"],"parlays":true,"max_parlay_legs":6,"player_props":false}',
  lock_time timestamptz not null,
  status public.tournament_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_bet_cents is null or max_bet_cents <= starting_bankroll_cents),
  check (min_total_wager_cents <= starting_bankroll_cents)
);
create index tournaments_host_idx on public.tournaments (host_id);
create index tournaments_lock_idx on public.tournaments (status, lock_time);

create trigger tournaments_touch before update on public.tournaments
  for each row execute function private.touch_updated_at();

create table public.tournament_events (
  tournament_id uuid not null references public.tournaments on delete cascade,
  event_id text not null references public.events,
  primary key (tournament_id, event_id)
);
create index tournament_events_event_idx on public.tournament_events (event_id);

-- ---------------------------------------------------------------------------
-- tournament_participants (bankroll is BLIND pre-lock: it would leak bet sizes)
-- ---------------------------------------------------------------------------
create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  remaining_bankroll_cents int not null check (remaining_bankroll_cents >= 0),
  total_potential_payout_cents int not null default 0 check (total_potential_payout_cents >= 0),
  expected_value_cents int,
  rank int,
  joined_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
create index participants_user_idx on public.tournament_participants (user_id);

-- ---------------------------------------------------------------------------
-- Visibility helpers. SECURITY DEFINER so policies can consult other RLS-protected
-- tables without recursion. Fully-qualified names + empty search_path.
-- ---------------------------------------------------------------------------
create function private.is_participant(p_tournament_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournament_participants p
    where p.tournament_id = p_tournament_id and p.user_id = (select auth.uid())
  );
$$;

-- TIME-based: reveal happens at lock_time exactly, independent of the status cron.
create function private.is_revealed(p_tournament_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and (t.lock_time <= now() or t.status not in ('draft', 'open'))
  );
$$;

create function private.shares_tournament(p_other_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tournament_participants mine
    join public.tournament_participants theirs on theirs.tournament_id = mine.tournament_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_other_user
  );
$$;

revoke all on function private.is_participant(uuid), private.is_revealed(uuid),
  private.shares_tournament(uuid) from public;
grant execute on function private.is_participant(uuid), private.is_revealed(uuid),
  private.shares_tournament(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: anon gets nothing on tables (public preview is an RPC). Authenticated
-- (incl. anonymous guests) gets SELECT, plus column-scoped UPDATE on own profile.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.events, public.tournaments, public.tournament_events,
  public.tournament_participants from anon, authenticated;
grant select on public.profiles, public.events, public.tournaments, public.tournament_events,
  public.tournament_participants to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_events enable row level security;
alter table public.tournament_participants enable row level security;

create policy "profiles: self or tournament-mates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_tournament(id));

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "events: readable by signed-in users" on public.events
  for select to authenticated using (true);

create policy "tournaments: host or participant" on public.tournaments
  for select to authenticated
  using (host_id = (select auth.uid()) or private.is_participant(id));

create policy "tournament_events: participants" on public.tournament_events
  for select to authenticated
  using (private.is_participant(tournament_id));

create policy "participants: own row, or everyone after reveal" on public.tournament_participants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (private.is_participant(tournament_id) and private.is_revealed(tournament_id))
  );
