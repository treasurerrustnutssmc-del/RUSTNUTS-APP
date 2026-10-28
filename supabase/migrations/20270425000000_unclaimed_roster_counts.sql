-- The Home screen's club counts: how many roster places in each chapter nobody has claimed yet,
-- by status. Numbers only; the roster itself stays closed. Approved members only. The app adds
-- these to the signed-in members (src/domain/home.ts clubCounts).

create or replace function public.unclaimed_roster_counts()
returns table (chapter_id uuid, status public.member_status, n int)
language sql stable security definer set search_path = '' as $$
  select r.chapter_id, r.status, count(*)::int
  from private.roster r
  where r.claimed_by is null and private.is_approved_member()
  group by r.chapter_id, r.status;
$$;
revoke all on function public.unclaimed_roster_counts() from public, anon;
grant execute on function public.unclaimed_roster_counts() to authenticated;
