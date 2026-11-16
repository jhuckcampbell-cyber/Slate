-- Submission receipts survive cancellation and serialize concurrent retries on the participant.
alter table public.wagers add column submission_id uuid;
alter table public.wagers add column submission_index integer;
-- A submission can contain several wagers; each position is unique within the submission.
create unique index wagers_submission_idx on public.wagers(participant_id, submission_id, submission_index);
create table private.wager_submissions (
  participant_id uuid not null references public.tournament_participants on delete cascade,
  submission_id uuid not null,
  result jsonb not null,
  primary key (participant_id, submission_id)
);
revoke all on private.wager_submissions from public, anon, authenticated;

alter function public.place_wagers(uuid, jsonb) set schema private;
alter function private.place_wagers(uuid, jsonb) rename to place_wagers_validated;
revoke all on function private.place_wagers_validated(uuid, jsonb) from public, anon, authenticated;

-- Optional UUID parameter; the first-item alias also supports clients using older generated types.
-- Two-argument callers continue to work through the default parameter.
create function public.place_wagers(p_tournament_id uuid, p_slip jsonb, p_submission_id uuid default null)
returns setof public.wagers
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid;
  v_submission uuid := coalesce(p_submission_id, (p_slip -> 0 ->> 'submission_id')::uuid);
  v_result jsonb;
  v_w public.wagers;
  v_index integer := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select p.id into v_pid from public.tournament_participants p
   where p.tournament_id = p_tournament_id and p.user_id = auth.uid() for update;
  if v_submission is not null and v_pid is not null then
    select s.result into v_result from private.wager_submissions s
     where s.participant_id = v_pid and s.submission_id = v_submission;
    if found then
      return query select * from jsonb_populate_recordset(null::public.wagers, v_result);
      return;
    end if;
  end if;
  v_result := '[]'::jsonb;
  for v_w in select * from private.place_wagers_validated(p_tournament_id, p_slip) loop
    if v_submission is not null then
      update public.wagers set submission_id = v_submission, submission_index = v_index
       where id = v_w.id returning * into v_w;
      v_index := v_index + 1;
    end if;
    v_result := v_result || jsonb_build_array(to_jsonb(v_w));
    return next v_w;
  end loop;
  if v_submission is not null then
    insert into private.wager_submissions values (v_pid, v_submission, v_result);
  end if;
end;
$$;
revoke all on function public.place_wagers(uuid, jsonb, uuid) from public, anon;
grant execute on function public.place_wagers(uuid, jsonb, uuid) to authenticated;

create or replace function public.set_tournament_tokens(p_tournament_id uuid, p_tokens jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tournaments%rowtype;
  v_clear boolean;
  v_n integer;
  v_sum numeric;
  v_max numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found or v_t.host_id <> v_uid then raise exception 'NOT_HOST'; end if;
  if v_t.lock_time <= now() or v_t.status not in ('draft', 'open') then raise exception 'TOURNAMENT_LOCKED'; end if;
  v_clear := p_tokens is null or jsonb_typeof(p_tokens) = 'null';
  if not v_clear then
    if jsonb_typeof(p_tokens) is distinct from 'array' then raise exception 'INVALID_TOKENS'; end if;
    v_clear := jsonb_array_length(p_tokens) = 0;
  end if;
  if not v_clear then
    if exists (select 1 from jsonb_array_elements(p_tokens) x
               where jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-9]+$') then
      raise exception 'INVALID_TOKENS';
    end if;
    if exists (select 1 from jsonb_array_elements(p_tokens) x
               where (x #>> '{}')::numeric < 100 or mod((x #>> '{}')::numeric, 100) <> 0) then
      raise exception 'INVALID_TOKENS';
    end if;
    select count(*)::int, sum((x #>> '{}')::numeric), max((x #>> '{}')::numeric)
      into v_n, v_sum, v_max from jsonb_array_elements(p_tokens) x;
    if v_n not between 2 and 10 or v_sum <> v_t.starting_bankroll_cents
       or coalesce((v_t.allowed_bet_types ->> 'min_bets')::int, 0) > v_n
       or (v_t.max_bet_cents is not null and v_t.max_bet_cents < v_max) then
      raise exception 'INVALID_TOKENS';
    end if;
  end if;
  -- Public roster state locks configuration before another player can bet.
  -- Only the host's own wagers may affect the solo-host case.
  perform 1 from public.tournament_participants p where p.tournament_id = v_t.id for update;
  if exists (select 1 from public.tournament_participants p where p.tournament_id = v_t.id and p.user_id <> v_uid)
     or exists (select 1 from public.wagers w join public.tournament_participants p on p.id = w.participant_id
                where w.tournament_id = v_t.id and p.user_id = v_uid) then
    raise exception 'TOKENS_LOCKED';
  end if;
  if v_clear then
    perform set_config('slate.clear_tokens', 'on', true);
    update public.tournaments set allowed_bet_types = (allowed_bet_types - 'tokens') || '{"all_in":false}'::jsonb
     where id = v_t.id;
    perform set_config('slate.clear_tokens', '', true);
  else
    update public.tournaments set allowed_bet_types = allowed_bet_types || jsonb_build_object(
      'tokens', (select jsonb_agg((x #>> '{}')::bigint order by (x #>> '{}')::bigint) from jsonb_array_elements(p_tokens) x),
      'all_in', true) where id = v_t.id;
  end if;
end;
$$;
revoke all on function public.set_tournament_tokens(uuid, jsonb) from public, anon;
grant execute on function public.set_tournament_tokens(uuid, jsonb) to authenticated;

-- Bankroll edits consult only public membership and the caller's own wagers.
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
       or exists (select 1 from public.wagers w
                   join public.tournament_participants p on p.id = w.participant_id
                   where w.tournament_id = v_t.id and p.user_id = v_uid) then
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

CREATE OR REPLACE FUNCTION public.grade_prop(p_tournament_id uuid, p_event_id text, p_market_key text, p_participant_name text, p_stat numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.tournaments%rowtype;
  v_status text;
  v_wager uuid;
  v_n int := 0;
  v_market text := regexp_replace(p_market_key, '_alternate$', '');
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.host_id is distinct from auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if v_t.lock_time > now() and v_t.status in ('draft', 'open') then
    raise exception 'TOURNAMENT_LOCKED';
  end if;
  if p_stat is null or p_stat < 0 or p_stat > 9999 then
    raise exception 'INVALID_STAT';
  end if;
  select e.status into v_status from public.events e
  join public.tournament_events te on te.event_id = e.id and te.tournament_id = p_tournament_id
  where e.id = p_event_id;
  if v_status is null then
    raise exception 'NOTHING_TO_GRADE';
  end if;
  if v_status <> 'final' then
    raise exception 'GAME_NOT_FINAL';  -- final ⇒ after lock, so no hidden pick is involved
  end if;
  if exists (select 1 from public.prop_results r
             where r.tournament_id = p_tournament_id and r.event_id = p_event_id
               and r.market_key = v_market and r.participant_name = p_participant_name) then
    raise exception 'ALREADY_GRADED';
  end if;
  if not exists (select 1 from public.wager_legs l
                 where l.tournament_id = p_tournament_id and l.event_id = p_event_id
                   and l.market_key in (v_market, v_market || '_alternate') and l.participant_name = p_participant_name
                   and l.status = 'pending') then
    raise exception 'NOTHING_TO_GRADE';
  end if;

  insert into public.prop_results (tournament_id, event_id, market_key, participant_name, stat, graded_by)
  values (p_tournament_id, p_event_id, v_market, p_participant_name, p_stat, auth.uid());

  for v_wager in
    with graded as (
      update public.wager_legs l
         set status = case
                        when l.selection = 'Yes' then case when p_stat >= 1 then 'hit' else 'miss' end
                        else case sign((p_stat - l.line) * case when l.selection = 'Over' then 1 else -1 end)
                               when 1 then 'hit' when 0 then 'push' else 'miss' end
                      end::public.leg_status,
             settled_at = now()
       where l.tournament_id = p_tournament_id and l.event_id = p_event_id
         and l.market_key in (v_market, v_market || '_alternate') and l.participant_name = p_participant_name
         and l.status = 'pending'
         and (l.selection = 'Yes' or (l.selection in ('Over', 'Under') and l.line is not null))
      returning l.wager_id
    )
    select distinct g.wager_id from graded g
  loop
    perform private.settle_wager(v_wager);
    v_n := v_n + 1;
  end loop;

  perform private.signal(p_tournament_id, 'scores', '{}'::jsonb);
  return jsonb_build_object('wagers', v_n);
end;
$function$;
