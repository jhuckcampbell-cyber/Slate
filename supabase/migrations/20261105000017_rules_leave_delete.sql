-- Friend-group rules + exits (2026-11-05).
-- * Host rules in allowed_bet_types: all_in (bet the whole bankroll) and min_bets (at least N bets, 0-20). A player who
--   misses them isn't kicked out: the leaderboard ranks them below everyone who met them (standing 'disqualified'), so the
--   rule is visible, fair, and can't be gamed by holding cash back. Unbet cash still counts for those who qualified.
-- * leave_tournament (player) and delete_tournament (host): before lock only. After lock the picks are frozen by the
--   lock-guard triggers and friends are sweating them; nothing disappears mid-game.

CREATE OR REPLACE FUNCTION public.create_tournament(p_title text, p_event_ids text[], p_code_prefix text DEFAULT 'SB'::text, p_description text DEFAULT NULL::text, p_starting_bankroll_cents integer DEFAULT 10000, p_max_bet_cents integer DEFAULT NULL::integer, p_allowed_bet_types jsonb DEFAULT NULL::jsonb, p_lock_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'player_props', coalesce((p_allowed_bet_types ->> 'player_props')::boolean, false),
    'same_game_parlays', coalesce((p_allowed_bet_types ->> 'same_game_parlays')::boolean, true),
    'all_in', coalesce((p_allowed_bet_types ->> 'all_in')::boolean, false),
    'min_bets', least(greatest(coalesce((p_allowed_bet_types ->> 'min_bets')::int, 0), 0), 20)
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
$function$;

CREATE OR REPLACE FUNCTION public.update_tournament(p_tournament_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
  v_key text;
  v_val jsonb;
  v_rules jsonb;
  v_markets jsonb;
  v_first_kickoff timestamptz;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- FOR UPDATE serializes with joins (FOR SHARE) and other host actions.
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'INVALID_CHANGES';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('title', 'description', 'lock_time', 'max_bet_cents', 'allowed_bet_types',
                     'starting_bankroll_cents') then
      raise exception 'INVALID_CHANGES';
    end if;
  end loop;

  if p_changes ? 'title' then
    if jsonb_typeof(p_changes -> 'title') <> 'string'
       or char_length(btrim(p_changes ->> 'title')) not between 1 and 60 then
      raise exception 'INVALID_TITLE';
    end if;
    v_t.title := btrim(p_changes ->> 'title');
  end if;

  if p_changes ? 'description' then
    if jsonb_typeof(p_changes -> 'description') not in ('string', 'null')
       or char_length(coalesce(p_changes ->> 'description', '')) > 280 then
      raise exception 'INVALID_CHANGES';
    end if;
    v_t.description := nullif(btrim(p_changes ->> 'description'), '');
  end if;

  if p_changes ? 'starting_bankroll_cents' then
    v_val := p_changes -> 'starting_bankroll_cents';
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^[0-9]+$'
       or (v_val #>> '{}')::bigint not between 100 and 100000000 then
      raise exception 'INVALID_BANKROLL';
    end if;
    -- Others' bankrolls were dealt at join time; with only the host in (and no bets), re-deal is safe.
    if exists (select 1 from public.tournament_participants p
               where p.tournament_id = v_t.id and p.user_id <> v_uid)
       or exists (select 1 from public.wagers w where w.tournament_id = v_t.id) then
      raise exception 'BANKROLL_LOCKED';
    end if;
    v_t.starting_bankroll_cents := (v_val #>> '{}')::int;
  end if;

  if p_changes ? 'max_bet_cents' then
    v_val := p_changes -> 'max_bet_cents';
    if jsonb_typeof(v_val) = 'null' then
      v_t.max_bet_cents := null;
    elsif jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^[0-9]+$'
          and (v_val #>> '{}')::bigint between 100 and v_t.starting_bankroll_cents then
      v_t.max_bet_cents := (v_val #>> '{}')::int;
    else
      raise exception 'INVALID_MAX_BET';
    end if;
  elsif v_t.max_bet_cents > v_t.starting_bankroll_cents then
    raise exception 'INVALID_MAX_BET';   -- bankroll lowered below the existing cap
  end if;

  if p_changes ? 'allowed_bet_types' then
    v_val := p_changes -> 'allowed_bet_types';
    if jsonb_typeof(v_val) <> 'object'
       or (v_val ? 'markets' and jsonb_typeof(v_val -> 'markets') <> 'array')
       or (v_val ? 'parlays' and jsonb_typeof(v_val -> 'parlays') <> 'boolean')
       or (v_val ? 'max_parlay_legs' and jsonb_typeof(v_val -> 'max_parlay_legs') <> 'number')
       or (v_val ? 'all_in' and jsonb_typeof(v_val -> 'all_in') <> 'boolean')
       or (v_val ? 'min_bets' and jsonb_typeof(v_val -> 'min_bets') <> 'number') then
      raise exception 'INVALID_RULES';
    end if;
    v_rules := v_t.allowed_bet_types || v_val;
    select coalesce(jsonb_agg(distinct m order by m), '[]'::jsonb) into v_markets
      from jsonb_array_elements_text(coalesce(v_rules -> 'markets', '[]'::jsonb)) as m
     where m in ('h2h', 'spreads', 'totals');
    if jsonb_array_length(v_markets) = 0 then
      raise exception 'INVALID_RULES';
    end if;
    v_t.allowed_bet_types := jsonb_build_object(
      'markets', v_markets,
      'parlays', coalesce((v_rules ->> 'parlays')::boolean, true),
      'max_parlay_legs', least(greatest(coalesce(round((v_rules ->> 'max_parlay_legs')::numeric)::int, 6), 2), 10),
      'player_props', coalesce((v_rules ->> 'player_props')::boolean, false),
      'same_game_parlays', coalesce((v_rules ->> 'same_game_parlays')::boolean, true),
      'all_in', coalesce((v_rules ->> 'all_in')::boolean, false),
      'min_bets', least(greatest(coalesce(round((v_rules ->> 'min_bets')::numeric)::int, 0), 0), 20));
  end if;

  if p_changes ? 'lock_time' then
    v_val := p_changes -> 'lock_time';
    if jsonb_typeof(v_val) <> 'string' then
      raise exception 'INVALID_LOCK_TIME';
    end if;
    begin
      v_t.lock_time := (v_val #>> '{}')::timestamptz;
    exception when others then
      raise exception 'INVALID_LOCK_TIME';
    end;
    select min(e.commence_time) into v_first_kickoff
      from public.tournament_events te join public.events e on e.id = te.event_id
     where te.tournament_id = v_t.id;
    if v_t.lock_time <= now() or v_t.lock_time > v_first_kickoff then
      raise exception 'INVALID_LOCK_TIME';
    end if;
  end if;

  update public.tournaments t
     set title = v_t.title,
         description = v_t.description,
         lock_time = v_t.lock_time,
         max_bet_cents = v_t.max_bet_cents,
         allowed_bet_types = v_t.allowed_bet_types,
         starting_bankroll_cents = v_t.starting_bankroll_cents
   where t.id = v_t.id;

  if p_changes ? 'starting_bankroll_cents' then
    update public.tournament_participants p
       set remaining_bankroll_cents = v_t.starting_bankroll_cents
     where p.tournament_id = v_t.id and p.user_id = v_uid;
  end if;
end;
$function$;

create function public.leave_tournament(p_tournament_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or not exists (select 1 from public.tournament_participants p
                              where p.tournament_id = p_tournament_id and p.user_id = v_uid) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  if v_t.host_id = v_uid then raise exception 'HOST_CANNOT_LEAVE'; end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then raise exception 'TOURNAMENT_LOCKED'; end if;
  delete from public.tournament_participants p where p.tournament_id = p_tournament_id and p.user_id = v_uid;
end;
$$;

create function public.delete_tournament(p_tournament_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then raise exception 'TOURNAMENT_LOCKED'; end if;
  perform private.signal(p_tournament_id, 'tournament', jsonb_build_object('status', 'deleted'));
  delete from public.tournaments t where t.id = p_tournament_id;
end;
$$;
revoke all on function public.leave_tournament(uuid), public.delete_tournament(uuid) from public, anon;
grant execute on function public.leave_tournament(uuid), public.delete_tournament(uuid) to authenticated;

-- Leaderboard: + bets_count, wagered_cents, qualified. Qualified players rank first; the rest are 'disqualified'.
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
  select p.tournament_id, p.id as participant_id, p.user_id, pr.display_name,
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
  join public.profiles pr on pr.id = p.user_id
  left join pending pe on pe.participant_id = p.id
  left join placed pl on pl.participant_id = p.id
)
select b.tournament_id, b.participant_id, b.user_id, b.display_name, b.cash_cents, b.max_cents, b.ev_cents,
       rank() over (partition by b.tournament_id order by b.qualified desc, b.ev_cents desc, b.cash_cents desc)::int as rank,
       case when not b.qualified then 'disqualified'
            when b.max_cents = 0 then 'busted'
            when b.max_cents < max(b.cash_cents) filter (where b.qualified) over (partition by b.tournament_id) then 'eliminated'
            else 'alive' end as standing,
       b.bets_count, b.wagered_cents, b.qualified
from base b;
