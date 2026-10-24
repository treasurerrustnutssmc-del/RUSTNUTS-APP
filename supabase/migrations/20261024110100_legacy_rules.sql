-- Rules for Legacy members (left the club in good standing), mirrored in src/domain/access.ts and
-- src/data/demoActions.ts:
--  * a board can only move someone to Legacy once their positions have ended (an honour such as
--    Founder stays), and the move clears their hiatus;
--  * a Legacy member can't be appointed to a position;
--  * a new applicant is let in as Introduced, FNG, Supporter or Family, never straight to Full,
--    Nomad or Legacy.
-- create or replace keeps each function's existing grants.

create or replace function public.approve_member(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  if p_status not in ('introduced', 'fng', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Supporter or Family.';
  end if;

  update public.members set
    approval = 'approved',
    status = p_status,
    joined_on = coalesce(joined_on, today),
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.set_member_status(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such member.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can change this member’s status.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if p_status = 'legacy' and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null and role <> 'founder'
  ) then
    raise exception 'End their positions first.';
  end if;

  update public.members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    on_hiatus = case when p_status = 'legacy' then false else on_hiatus end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.appoint_position(p_member uuid, p_chapter uuid, p_role public.position_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  is_national_role boolean := p_role in ('nec_chair', 'nec_secretary', 'nec_auditor');
  seat uuid;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
  if p_member = me then raise exception 'You can’t appoint yourself.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if target.status = 'legacy' then raise exception 'Legacy members don’t hold positions.'; end if;

  seat := case when is_national_role then null else p_chapter end;
  if is_national_role then
    if p_role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman hands out national roles.'; end if;
  else
    if seat is null or seat <> target.chapter_id then raise exception 'They’re not a member of that chapter.'; end if;
    if p_role = 'president' then
      if not private.is_nec_officer() then
        raise exception 'Only the National Chairman, Secretary or Auditor can seat a President.';
      end if;
    elsif not private.is_board_of(seat) then
      raise exception 'Only that chapter’s board can appoint here.';
    end if;
  end if;

  if exists (
    select 1 from public.positions
    where member_id = p_member and role = p_role and chapter_id is not distinct from seat and ended_on is null
  ) then
    raise exception 'They already hold that role.';
  end if;
  if (is_national_role or p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
    and exists (
      select 1 from public.positions where role = p_role and chapter_id is not distinct from seat and ended_on is null
    ) then
    raise exception 'That seat is taken. End the current term first.';
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$$;
