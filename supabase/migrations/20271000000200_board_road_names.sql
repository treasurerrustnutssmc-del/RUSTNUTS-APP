-- The board edits a member's road name (Jeff, 24 Nov 2026). Road names are often given on a ride,
-- so the member's chapter board and the NEC (Chairman, Secretary, sitting Presidents) can set or
-- clear one from Manage member. Members still change their own in Edit profile (save_profile).
-- Mirrors src/domain/access.ts setRoadNameProblem, in the same words. Safe to run twice.

create or replace function public.set_member_road_name(p_member uuid, p_road_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  t public.members%rowtype;
begin
  -- No row lock until the checks pass: the update below takes it.
  select * into t from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.id = me then raise exception 'Change your own road name in Edit profile.'; end if;
  if not private.sees_board_of(t.chapter_id) then raise exception 'Only that member’s chapter board or the NEC can do that.'; end if;
  if t.approval <> 'approved' then raise exception 'They’re not an approved member.'; end if;
  update public.members set road_name = nullif(trim(p_road_name), ''), updated_at = now() where id = p_member;
end;
$$;

revoke all on function public.set_member_road_name(uuid, text) from public, anon;
grant execute on function public.set_member_road_name(uuid, text) to authenticated;
