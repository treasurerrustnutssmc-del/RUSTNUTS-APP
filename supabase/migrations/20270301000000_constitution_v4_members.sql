-- Constitution v4 (Final Club Edition, 25 Oct 2026) for members, positions, fees and meetings.
-- Mirrors src/domain/access.ts, joining.ts, fees.ts and meetings.ts, same rules, same words.
-- See docs/superpowers/specs/2026-10-25-constitution-v4-audit.md.
--  * Only Full and Nomad members hold Club positions (4.6, 5.8); Nomads hold Non-Board roles only
--    (9.1); the National Auditor can't also be a President or Treasurer (11.8).
--  * An FNG reaches Full or Nomad only through a carried patch vote (4.7, 4.9); anyone else comes
--    back to Full or Nomad only with the NEC (5.6). Positions end first when the new status
--    can't hold them.
--  * A learner permit rider can't become an FNG (3.2).
--  * The continuation fee is half the chapter's FNG fee, charged once (4.11).
--  * Meetings need notice (10.4).
-- create or replace keeps each function's existing grants.

-- Why p_member can't hold p_role, or null.
create or replace function private.hold_problem(p_member uuid, p_role public.position_role)
returns text language plpgsql stable security definer set search_path = '' as $$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member;
  if target.status not in ('full', 'nomad') then
    return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  end if;
  if target.status = 'nomad' and p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms',
                                            'road_captain', 'nec_chair', 'nec_secretary', 'nec_auditor') then
    return 'Nomads can’t hold a board or national seat (9.1).';
  end if;
  if (p_role = 'nec_auditor' and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role in ('president', 'treasurer')))
     or (p_role in ('president', 'treasurer') and exists (
        select 1 from public.positions where member_id = p_member and ended_on is null and role = 'nec_auditor')) then
    return 'The National Auditor can’t also be a President or Treasurer (11.8).';
  end if;
  return null;
end;
$$;
revoke all on function private.hold_problem(uuid, public.position_role) from public, anon, authenticated;

-- A patch vote on this member has closed Carried (4.9).
create or replace function private.has_carried_patch_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes where subject_member_id = p_member and closed_at is not null and result = 'carried'
  );
$$;
revoke all on function private.has_carried_patch_vote(uuid) from public, anon, authenticated;

-- Their licence on file is a learner permit (3.2).
create or replace function private.is_learner(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_private where member_id = p_member and licence_class = 'learner');
$$;
revoke all on function private.is_learner(uuid) from public, anon, authenticated;

-- Positions ---------------------------------------------------------------------------------

create or replace function public.appoint_position(p_member uuid, p_chapter uuid, p_role public.position_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  is_national_role boolean := p_role in ('nec_chair', 'nec_secretary', 'nec_auditor');
  seat uuid;
  unfit text;
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

  unfit := private.hold_problem(p_member, p_role);
  if unfit is not null then raise exception '%', unfit; end if;

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

-- Status ------------------------------------------------------------------------------------

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
  if p_status in ('full', 'nomad') and target.status not in ('full', 'nomad') then
    if target.status = 'fng' then
      if not private.has_carried_patch_vote(p_member) then
        raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
      end if;
    elsif not private.is_national() then
      raise exception 'Only the NEC can bring someone back to Full or Nomad (5.6).';
    end if;
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  if p_status not in ('full', 'nomad') and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null and role <> 'founder'
  ) then
    raise exception 'End their positions first.';
  end if;
  if p_status = 'nomad' and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'End their board and national seats first (9.1).';
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
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
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

create or replace function public.decide_application(
  p_member uuid, p_status public.member_status, p_for int, p_against int, p_abstained int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    if p_status is null then raise exception 'Only that chapter’s board can decline this applicant.'; end if;
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  if p_status is not null and p_status not in ('introduced', 'fng', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Supporter or Family.';
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  perform private.check_votes(p_for, p_against, p_abstained);

  if p_status is null then
    perform public.decline_member(p_member);
  else
    perform public.approve_member(p_member, p_status);
  end if;
  insert into public.member_decisions (member_id, kind, outcome, status, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'application', case when p_status is null then 'declined' else 'approved' end, p_status,
          p_for, p_against, p_abstained, nullif(trim(p_note), ''), private.club_date(), auth.uid());
end;
$$;

-- FNG reviews and the continuation fee -----------------------------------------------------

create or replace function public.record_fng_review(
  p_member uuid, p_at_months int, p_outcome text, p_for int, p_against int, p_abstained int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  due record;
  today date := private.club_date();
  fng_fee int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_member = me then raise exception 'You can’t record your own review.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can record this review.'; end if;
  select * into due from private.fng_due(p_member);
  if due.at_months is null then raise exception 'They’re not an FNG.'; end if;
  if p_at_months is distinct from due.at_months then raise exception 'Record the review that’s due.'; end if;
  if due.due_on - today > 30 then raise exception 'That review isn’t due yet.'; end if;
  perform private.check_votes(p_for, p_against, p_abstained);
  if p_outcome not in ('continue', 'patch', 'not_continuing') then raise exception 'Pick an outcome.'; end if;
  -- Patching in is the chapter's Full Members' call, by a patch vote, not the board's tally (4.9).
  if p_outcome = 'patch' then
    if target.fng_started_on is not null and target.fng_started_on + interval '9 months' > today then
      raise exception 'Full Membership can’t be granted before nine months (4.7).';
    end if;
    if not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
    end if;
  end if;

  insert into public.member_decisions (member_id, kind, at_months, outcome, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'fng_review', p_at_months, p_outcome, p_for, p_against, p_abstained, nullif(trim(p_note), ''),
          today, me);

  if p_outcome = 'patch' then
    update public.members set status = 'full', patched_on = coalesce(patched_on, today), updated_at = now() where id = p_member;
  elsif p_outcome = 'not_continuing' then
    update public.members set status = 'supporter', updated_at = now() where id = p_member;
  elsif p_at_months >= 12 and not target.on_hiatus then
    -- Past twelve months, carrying on as an FNG costs half the chapter's FNG fee for the year,
    -- once ever (4.11). Members on hiatus don't pay.
    select amount_cents into fng_fee from public.fee_rates
    where chapter_id = target.chapter_id and fy = private.fy_of(today) and status = 'fng';
    if fng_fee is not null and not exists (
      select 1 from public.charges where member_id = p_member and kind = 'continuation'
    ) then
      insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
      values (p_member, target.chapter_id, private.fy_of(today), 'continuation', 'FNG continuation fee', fng_fee / 2,
              today + 30, me);
    end if;
  end if;
end;
$$;

create or replace function public.set_continuation_fee(p_chapter uuid, p_fy int, p_amount_cents int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_set_fees(p_chapter) then
    raise exception 'Only that chapter’s board sets its fees.';
  end if;
  raise exception 'The continuation fee is half the FNG fee (4.11), so the app works it out.';
end;
$$;

-- Meetings ----------------------------------------------------------------------------------

create or replace function public.save_meeting(
  p_id uuid, p_chapter uuid, p_kind public.meeting_kind, p_title text, p_starts_at timestamptz,
  p_location text, p_agenda jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  existing public.meetings%rowtype;
  v_agenda jsonb := coalesce(p_agenda, '[]'::jsonb);
  notice_days int;
  notice_name text;
  saved uuid;
begin
  if p_id is not null then
    select * into existing from public.meetings where id = p_id for update;
    if not found then raise exception 'No such meeting.'; end if;
    perform private.require_scope(existing.chapter_id);
  end if;
  perform private.require_scope(p_chapter);
  if existing.cancelled_at is not null then raise exception 'That meeting was cancelled.'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'Give the meeting a title.'; end if;
  if p_starts_at is null then raise exception 'Pick a date and time.'; end if;
  if (p_chapter is null and p_kind = 'board') or (p_chapter is not null and p_kind = 'nec') then
    raise exception 'That kind of meeting doesn’t fit here.';
  end if;
  if jsonb_typeof(v_agenda) <> 'array' or exists (
    select 1 from jsonb_array_elements(v_agenda) a where nullif(trim(a->>'title'), '') is null) then
    raise exception 'Each agenda item needs a title.';
  end if;

  -- Notice (10.4): counted when a meeting is called, or moved earlier, for a time still to come.
  -- Board meetings have no notice rule; an urgent NEC meeting may go ahead sooner (11.5).
  select n.days, n.name into notice_days, notice_name from (values
    (false, 'general'::public.meeting_kind, 7, 'A chapter meeting'),
    (false, 'special'::public.meeting_kind, 7, 'A special meeting'),
    (false, 'agm'::public.meeting_kind, 14, 'An Annual Chapter Meeting'),
    (true, 'general'::public.meeting_kind, 14, 'A National Club meeting'),
    (true, 'special'::public.meeting_kind, 14, 'A National Club meeting'),
    (true, 'agm'::public.meeting_kind, 14, 'The Association AGM')
  ) as n(national, kind, days, name)
  where n.national = (p_chapter is null) and n.kind = p_kind;
  if notice_days is not null and p_starts_at > now()
     and (p_id is null or p_starts_at < existing.starts_at)
     and p_starts_at - now() < make_interval(days => notice_days) then
    raise exception '% needs % days’ notice (10.4).', notice_name, notice_days;
  end if;

  v_agenda := coalesce((
    select jsonb_agg(jsonb_build_object('title', trim(a->>'title'), 'notes', nullif(trim(a->>'notes'), '')) order by pos)
    from jsonb_array_elements(v_agenda) with ordinality as x(a, pos)), '[]'::jsonb);

  if p_id is null then
    insert into public.meetings (chapter_id, kind, title, starts_at, location, agenda, created_by)
    values (p_chapter, p_kind, trim(p_title), p_starts_at, nullif(trim(p_location), ''), v_agenda, me)
    returning id into saved;
  else
    update public.meetings set chapter_id = p_chapter, kind = p_kind, title = trim(p_title), starts_at = p_starts_at,
      location = nullif(trim(p_location), ''), agenda = v_agenda
    where id = p_id returning id into saved;
  end if;
  return saved;
end;
$$;
