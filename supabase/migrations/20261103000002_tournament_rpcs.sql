-- Phase 1 RPCs: create/join tournaments, public share preview, pre-lock roster.
-- All SECURITY DEFINER with empty search_path; errors use stable codes the client maps to copy.

-- ---------------------------------------------------------------------------
-- Invite code suffix: 4 chars from the unambiguous alphabet, crypto RNG.
-- Keep alphabet in sync with src/lib/core/codes.ts.
-- ---------------------------------------------------------------------------
create function private.random_code_suffix() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(4);
  v_out text := '';
begin
  for i in 0..3 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 30), 1);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_tournament
-- ---------------------------------------------------------------------------
create function public.create_tournament(
  p_title text,
  p_event_ids text[],
  p_code_prefix text default 'SB',
  p_description text default null,
  p_starting_bankroll_cents int default 10000,
  p_max_bet_cents int default null,
  p_allowed_bet_types jsonb default null,
  p_lock_time timestamptz default null
) returns table (id uuid, code text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text := upper(coalesce(nullif(btrim(p_code_prefix), ''), 'SB'));
  v_event_count int;
  v_sport text;
  v_sport_count int;
  v_first_kickoff timestamptz;
  v_lock timestamptz;
  v_allowed jsonb;
  v_code text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_prefix !~ '^[A-Z0-9]{2,5}$' then
    v_prefix := 'SB';
  end if;

  -- Abuse guard (guests are cheap to create): max 10 tournaments per user per hour.
  if (select count(*) from public.tournaments t
      where t.host_id = v_uid and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'RATE_LIMITED';
  end if;

  if coalesce(cardinality(p_event_ids), 0) = 0 or cardinality(p_event_ids) > 20 then
    raise exception 'INVALID_EVENTS';
  end if;

  select count(*), min(e.sport_key), count(distinct e.sport_key), min(e.commence_time)
    into v_event_count, v_sport, v_sport_count, v_first_kickoff
  from public.events e
  where e.id = any (p_event_ids) and e.status = 'scheduled' and e.commence_time > now();

  if v_event_count <> cardinality(array(select distinct unnest(p_event_ids))) then
    raise exception 'INVALID_EVENTS';
  end if;
  if v_sport_count <> 1 then
    raise exception 'MIXED_SPORTS';
  end if;

  -- Lock defaults to first kickoff and may never be after it.
  v_lock := coalesce(p_lock_time, v_first_kickoff);
  if v_lock <= now() or v_lock > v_first_kickoff then
    raise exception 'INVALID_LOCK_TIME';
  end if;

  -- Merge host-provided rules over defaults; only whitelisted markets survive.
  v_allowed := jsonb_build_object(
    'markets', coalesce(
      (select jsonb_agg(distinct m)
       from jsonb_array_elements_text(coalesce(p_allowed_bet_types -> 'markets', '[]')) as m
       where m in ('h2h', 'spreads', 'totals')),
      '["h2h","spreads","totals"]'::jsonb),
    'parlays', coalesce((p_allowed_bet_types ->> 'parlays')::boolean, true),
    'max_parlay_legs', least(greatest(coalesce((p_allowed_bet_types ->> 'max_parlay_legs')::int, 6), 2), 10),
    'player_props', coalesce((p_allowed_bet_types ->> 'player_props')::boolean, false)
  );

  -- Generate a unique code (retry on the rare collision).
  for attempt in 1..10 loop
    v_code := v_prefix || '-' || private.random_code_suffix();
    exit when not exists (select 1 from public.tournaments t where t.code = v_code);
    if attempt = 10 then
      raise exception 'CODE_GENERATION_FAILED';
    end if;
  end loop;

  insert into public.tournaments (
    host_id, title, description, code, sport_key, starting_bankroll_cents,
    max_bet_cents, allowed_bet_types, lock_time, status
  ) values (
    v_uid, btrim(p_title), nullif(btrim(p_description), ''), v_code, v_sport,
    p_starting_bankroll_cents, p_max_bet_cents, v_allowed, v_lock, 'open'
  ) returning tournaments.id into v_id;

  insert into public.tournament_events (tournament_id, event_id)
  select v_id, distinct_ids.eid from (select distinct unnest(p_event_ids) as eid) distinct_ids;

  -- Host auto-joins.
  insert into public.tournament_participants (tournament_id, user_id, remaining_bankroll_cents)
  values (v_id, v_uid, p_starting_bankroll_cents);

  return query select v_id, v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- join_tournament: idempotent; rejected once revealed (unless already in).
-- ---------------------------------------------------------------------------
create function public.join_tournament(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_t from public.tournaments t where t.code = upper(btrim(p_code));
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND';
  end if;

  if exists (select 1 from public.tournament_participants p
             where p.tournament_id = v_t.id and p.user_id = v_uid) then
    return v_t.id;
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

-- ---------------------------------------------------------------------------
-- get_tournament_preview: PUBLIC (anon) data for the join page + OG image.
-- Only non-sensitive fields; never picks or bankrolls.
-- ---------------------------------------------------------------------------
create function public.get_tournament_preview(p_code text)
returns table (
  id uuid,
  code text,
  title text,
  description text,
  sport_key text,
  host_name text,
  lock_time timestamptz,
  status public.tournament_status,
  starting_bankroll_cents int,
  participant_count int,
  events jsonb
)
language sql stable security definer set search_path = '' as $$
  select
    t.id, t.code, t.title, t.description, t.sport_key,
    h.display_name,
    t.lock_time, t.status, t.starting_bankroll_cents,
    (select count(*)::int from public.tournament_participants p where p.tournament_id = t.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'home_team', e.home_team, 'away_team', e.away_team,
        'commence_time', e.commence_time) order by e.commence_time)
      from public.tournament_events te join public.events e on e.id = te.event_id
      where te.tournament_id = t.id), '[]'::jsonb)
  from public.tournaments t
  join public.profiles h on h.id = t.host_id
  where t.code = upper(btrim(p_code));
$$;

-- ---------------------------------------------------------------------------
-- get_roster: who's in, visible pre-lock to participants (no bankrolls, no picks).
-- Phase 2 adds has_submitted.
-- ---------------------------------------------------------------------------
create function public.get_roster(p_tournament_id uuid)
returns table (user_id uuid, display_name text, avatar_url text, is_host boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_participant(p_tournament_id) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  return query
  select pr.id, pr.display_name, pr.avatar_url, pr.id = t.host_id, p.joined_at
  from public.tournament_participants p
  join public.profiles pr on pr.id = p.user_id
  join public.tournaments t on t.id = p.tournament_id
  where p.tournament_id = p_tournament_id
  order by p.joined_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: default-deny, then open exactly what each role needs.
-- ---------------------------------------------------------------------------
revoke all on function private.random_code_suffix() from public;
revoke all on function public.create_tournament(text, text[], text, text, int, int, jsonb, timestamptz) from public, anon;
revoke all on function public.join_tournament(text) from public, anon;
revoke all on function public.get_roster(uuid) from public, anon;
revoke all on function public.get_tournament_preview(text) from public;

grant execute on function public.create_tournament(text, text[], text, text, int, int, jsonb, timestamptz) to authenticated;
grant execute on function public.join_tournament(text) to authenticated;
grant execute on function public.get_roster(uuid) to authenticated;
grant execute on function public.get_tournament_preview(text) to anon, authenticated;
