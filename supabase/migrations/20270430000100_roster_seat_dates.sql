-- A seat from the club's sheet is one of the terms the constitution records as beginning
-- 1 August 2026 (17.6), so it runs from then, not from the day its holder first signed in.
-- (Otherwise the profile says "President since" the sign-in day and the term ends two years after it.)
create or replace function private.add_roster_position(p_member uuid, p_seat uuid, p_role public.position_role)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.positions (member_id, chapter_id, role, started_on)
  values (p_member, p_seat, p_role,
          case when p_role = 'founder' then private.club_date() else least(private.club_date(), date '2026-08-01') end);
  return true;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function private.add_roster_position(uuid, uuid, public.position_role) from public, anon, authenticated;
