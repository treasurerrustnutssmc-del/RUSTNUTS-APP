-- The Home screen's club counts: how many roster places in each chapter nobody has claimed yet,
-- by status. Numbers only; the roster itself stays closed. Approved members only. The app adds
-- these to the signed-in members (src/domain/home.ts clubCounts). A roster row whose email
-- already belongs to a member (who joined before the roster was loaded, so never claimed it) is
-- that member, not a place, and is left out so nobody is counted twice.

create or replace function public.unclaimed_roster_counts()
returns table (chapter_id uuid, status public.member_status, n int)
language sql stable security definer set search_path = '' as $$
  select r.chapter_id, r.status, count(*)::int
  from private.roster r
  where r.claimed_by is null and private.is_approved_member()
    and not exists (
      select 1 from auth.users u join public.members m on m.id = u.id
      where lower(trim(u.email)) = lower(trim(r.email))
    )
  group by r.chapter_id, r.status;
$$;
revoke all on function public.unclaimed_roster_counts() from public, anon;
grant execute on function public.unclaimed_roster_counts() to authenticated;
