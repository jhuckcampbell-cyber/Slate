-- "Were you removed from this tournament?" for the join page (2026-11-05). A removed player can reach the invite
-- link many ways (the live signal, a refresh racing it, an old text); the page asks the database instead of relying
-- on a ?removed=1 flag. Only answers for the caller, about themselves.
create function public.removed_from(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.tournament_removals r
    join public.tournaments t on t.id = r.tournament_id
    where t.code = upper(trim(p_code)) and r.user_id = (select auth.uid())
  );
$$;
revoke all on function public.removed_from(text) from public, anon;
grant execute on function public.removed_from(text) to authenticated;
