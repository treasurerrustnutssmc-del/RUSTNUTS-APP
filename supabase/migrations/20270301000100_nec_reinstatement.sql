-- Bringing someone back to Full or Nomad needs the NEC's approval (5.6), Jeff's call on 25 Oct 2026:
-- a carried NEC majority vote about them, closed in the last 90 days (inferred). Then their
-- chapter's board makes the change. One NEC member alone can't. Mirrors src/domain/access.ts
-- (statusChangeProblem) and votes.ts (openVoteProblem), same rules, same words.
-- A club-wide vote with a subject is that reinstatement vote; a chapter one is still a patch vote.
-- create or replace keeps each function's existing grants.

-- The NEC voted, in the last 90 days, to bring this member back (5.6).
create or replace function private.has_carried_reinstate_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and electorate = 'nec' and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
  );
$$;
revoke all on function private.has_carried_reinstate_vote(uuid) from public, anon, authenticated;

-- A patch vote is the chapter's (4.9): an NEC vote about an FNG doesn't patch them.
create or replace function private.has_carried_patch_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes v join public.members m on m.id = v.subject_member_id
    where v.subject_member_id = p_member and v.electorate = 'chapter_patched' and v.closed_at is not null and v.result = 'carried'
      and (m.fng_started_on is null or private.club_date(v.opened_at) >= m.fng_started_on)
  );
$$;
revoke all on function private.has_carried_patch_vote(uuid) from public, anon, authenticated;

create or replace function public.open_vote(
  p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text,
  p_electorate public.electorate, p_threshold public.vote_threshold, p_secret boolean, p_quorum int,
  p_closes_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  electors int;
  subject public.members%rowtype;
  opened uuid;
begin
  perform private.require_scope(p_chapter);
  if nullif(trim(p_question), '') is null then raise exception 'Ask a question.'; end if;
  if (p_chapter is null) <> (p_electorate in ('club_patched', 'nec')) then
    raise exception 'That electorate doesn’t fit here.';
  end if;
  select count(*) into electors from private.electors_for(p_electorate, p_chapter);
  if electors = 0 then raise exception 'Nobody can vote in that electorate yet.'; end if;
  if p_electorate = 'chapter_board' and electors < 3 then
    raise exception 'A board vote needs at least three board members (8.5).';
  end if;
  if p_quorum is null or p_quorum < private.min_quorum(p_electorate, electors) or p_quorum > electors then
    raise exception 'Quorum must be between % and %.', private.min_quorum(p_electorate, electors), electors;
  end if;
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Pick a closing time in the future.'; end if;
  if p_closes_at > now() + interval '1440 hours' then raise exception 'Votes can stay open for 60 days at most.'; end if;
  if p_subject is not null and p_chapter is null then
    -- Bringing someone back to Full or Nomad is the NEC's decision (5.6).
    select * into subject from public.members where id = p_subject;
    if not found or subject.approval <> 'approved' or subject.status not in ('supporter', 'legacy', 'family', 'introduced')
       or p_electorate <> 'nec' or p_threshold <> 'majority' then
      raise exception 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).';
    end if;
  elsif p_subject is not null then
    select * into subject from public.members where id = p_subject;
    if not found or subject.chapter_id <> p_chapter or subject.approval <> 'approved' or subject.status <> 'fng' then
      raise exception 'A patch vote is for an approved FNG of that chapter.';
    end if;
    if p_electorate <> 'chapter_patched' or p_threshold <> 'unanimous' or not coalesce(p_secret, false) then
      raise exception 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
    end if;
    -- Full Membership can't be granted before nine months (4.7).
    if subject.fng_started_on is not null and subject.fng_started_on + interval '9 months' > private.club_date() then
      raise exception 'A patch vote can open only nine months into the FNG’s trial (4.7).';
    end if;
  end if;
  if p_meeting is not null and not exists (
    select 1 from public.meetings where id = p_meeting and chapter_id is not distinct from p_chapter) then
    raise exception 'No such meeting.';
  end if;

  insert into public.votes (chapter_id, meeting_id, subject_member_id, question, details, electorate, threshold,
                            secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, trim(p_question), nullif(trim(p_details), ''), p_electorate, p_threshold,
          coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.electors_for(p_electorate, p_chapter) e;
  return opened;
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
  if p_status in ('full', 'nomad') and target.status not in ('full', 'nomad') then
    if target.status = 'fng' then
      if not private.has_carried_patch_vote(p_member) then
        raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
      end if;
    elsif not private.has_carried_reinstate_vote(p_member) then
      raise exception 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
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
