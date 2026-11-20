-- A board can let a pending sign-up in as Full: for a patched member who signed up with a
-- different email to their roster row, so the roster didn't claim them (Steve Peroulis, 20 Nov
-- 2026). The members_patch_in_fee trigger raises their pro rata fee, as for any new Full. Mirrors APPROVE_AS in src/domain/labels.ts. Safe to run twice.

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
  if p_status not in ('introduced', 'fng', 'full', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Full, Supporter or Family.';
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  if p_status = 'full' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t be let in as Full.';
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
  if p_status is not null and p_status not in ('introduced', 'fng', 'full', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Full, Supporter or Family.';
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  if p_status = 'full' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t be let in as Full.';
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
