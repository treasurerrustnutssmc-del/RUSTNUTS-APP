-- Launch audit decisions, part 4 (29 Oct 2026): who can act. Jeff's taps on the audit report's M5
-- and L2; see docs/superpowers/specs/2026-10-29-audit-decisions-design.md.
--
-- M5 "Vote to remove, free to resign". A role holder ends their own term whenever they like.
-- Ending someone else's chapter term needs a carried removal vote in the app, in the shape 9.3
-- gives: two-thirds of the chapter's Full Members for a board seat, a majority of the chapter board
-- for any other chapter role. The chapter board records the removal (for a President, an NEC
-- officer can too). National seats stay the Chairman's to end, and the Chairman's own seat and the
-- Founder honour stay the club admin's, as before.
--
-- L2 "Gate, with a by-request exception". Moving an FNG, Full Member or Nomad to Supporter follows
-- a 5.5 notice the board has decided in the last 90 days, unless the board records that it's at the
-- member's request. Every status change is recorded in status_changes, with the notice or the
-- request behind it.
--
-- The app applies the same rules with the same words (src/domain/votes.ts, src/domain/access.ts).

-- 1. A vote can name any role it's about: the national seats it already could, and now a chapter
--    role whose holder faces removal (9.3). The Chairman's seat changes by election and the Founder
--    honour is the admin's, so no vote names those.
alter table public.votes drop constraint if exists votes_subject_role_check;
alter table public.votes add constraint votes_subject_role_check
  check (subject_role is null or subject_role not in ('founder', 'nec_chair'));

-- 2. Opening a vote: a removal vote (9.3) joins the patch (4.9), reinstatement (5.6) and national
--    seat (11.6, 11.8) votes. Same signature as before.
create or replace function public.open_vote(
  p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text,
  p_electorate public.electorate, p_threshold public.vote_threshold, p_secret boolean, p_quorum int,
  p_closes_at timestamptz, p_role public.position_role default null
) returns uuid language plpgsql security definer set search_path = '' as $$
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
  -- A vote that names a role: the NEC seats someone (11.6, 11.8), or a chapter removes someone (9.3).
  if p_role is not null and p_chapter is null and p_role not in ('nec_auditor', 'nec_secretary') then
    raise exception 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).';
  end if;
  if p_role in ('nec_auditor', 'nec_secretary') and (p_subject is null or p_chapter is not null) then
    raise exception 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).';
  end if;
  if p_role is not null and p_chapter is not null and (p_subject is null or p_role in ('founder', 'nec_chair')) then
    raise exception 'A removal vote is the chapter’s vote about one of its own role holders (9.3).';
  end if;
  if p_subject is not null and p_chapter is null then
    select * into subject from public.members where id = p_subject;
    if found and subject.approval = 'approved' and subject.status = 'full' then
      -- Seating a Full Member as National Auditor (11.8) or National Secretary (11.6): two-thirds of
      -- the NEC, on someone who could hold the seat.
      if p_role is null then
        raise exception 'Say which seat the vote is for: National Auditor or National Secretary (11.6, 11.8).';
      end if;
      if p_role = 'nec_auditor' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from public.positions where member_id = p_subject and ended_on is null
             and role in ('president', 'treasurer', 'nec_chair', 'nec_secretary'))) then
        raise exception 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
      end if;
      if p_role = 'nec_secretary' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from public.positions where member_id = p_subject and ended_on is null
             and role in ('nec_chair', 'nec_secretary', 'nec_auditor'))) then
        raise exception 'A vote to appoint the National Secretary is an NEC two-thirds vote on a Full Member who isn’t already National Chairman, Secretary or Auditor (11.6).';
      end if;
    elsif p_role is not null then
      raise exception 'Only a Full Member can be voted into a national seat (9.1).';
    elsif not found or subject.approval <> 'approved' or subject.status not in ('supporter', 'legacy', 'family', 'introduced')
       or p_electorate <> 'nec' or p_threshold <> 'majority' then
      -- Bringing someone back to Full or Nomad is the NEC's decision (5.6).
      raise exception 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).';
    end if;
  elsif p_subject is not null and p_role is not null then
    -- A removal vote (9.3): about a Full Member or Nomad who holds that role in this chapter. A board
    -- seat goes by two-thirds of the chapter's Full Members; any other chapter role by a board majority.
    select * into subject from public.members where id = p_subject;
    if not found or subject.approval <> 'approved' or subject.status not in ('full', 'nomad') or not exists (
         select 1 from public.positions
         where member_id = p_subject and chapter_id = p_chapter and role = p_role and ended_on is null) then
      raise exception 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).';
    end if;
    if p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
      if p_electorate <> 'chapter_patched' or p_threshold <> 'two_thirds' then
        raise exception 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).';
      end if;
    elsif p_electorate <> 'chapter_board' or p_threshold <> 'majority' then
      raise exception 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).';
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

  insert into public.votes (chapter_id, meeting_id, subject_member_id, subject_role, question, details, electorate,
                            threshold, secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, p_role, trim(p_question), nullif(trim(p_details), ''), p_electorate,
          p_threshold, coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.electors_for(p_electorate, p_chapter) e;
  return opened;
end;
$$;

-- 3. Closing a vote: only a patch vote (4.9) keeps its result alone. A removal vote of the chapter's
--    Full Members keeps its counts like any other vote.
create or replace function public.close_vote(p_vote uuid, p_casting text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  n_yes int; n_no int; n_abstain int; n_electors int;
  res public.vote_result;
  tied boolean;
  represented boolean;
  about_member boolean;
  chair uuid;
begin
  select * into v from public.votes where id = p_vote for update;
  if not found then raise exception 'No such vote.'; end if;
  perform private.require_scope(v.chapter_id);
  if v.closed_at is not null then raise exception 'That vote has already closed.'; end if;
  if now() < v.closes_at and exists (select 1 from public.vote_electors where vote_id = p_vote and voted_at is null) then
    raise exception 'Wait until it closes, or until everyone has voted.';
  end if;
  select count(*) filter (where choice = 'yes'), count(*) filter (where choice = 'no'), count(*) filter (where choice = 'abstain')
  into n_yes, n_no, n_abstain from public.vote_ballots where vote_id = p_vote;
  select count(*) into n_electors from public.vote_electors where vote_id = p_vote;
  select d.result, d.tied into res, tied from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, null, n_electors) d;
  represented := v.electorate <> 'club_patched' or private.chapters_represented(p_vote);
  if not represented then res := 'no_quorum'; tied := false; end if;
  about_member := v.subject_member_id is not null;
  chair := private.chair_of(v.chapter_id);
  if tied and about_member and p_casting is not null then
    raise exception 'No casting vote on a vote about a member (10.7): a tie is lost.';
  end if;
  -- The chair casts or declines, and a declined tie is lost (9.10).
  if tied and not about_member and chair is not null and (p_casting is null or me <> chair) then
    raise exception 'It’s a tie. The chair gives a casting vote or lets it fall.';
  end if;
  if not tied and p_casting is not null then raise exception 'There’s no tie, so no casting vote.'; end if;
  if p_casting in ('yes', 'no') and chair is null then
    raise exception 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
  end if;
  if p_casting is not null and p_casting not in ('yes', 'no', 'decline') then raise exception 'Pick an answer.'; end if;
  if tied and not about_member then
    select d.result into res from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, p_casting, n_electors) d;
  end if;

  -- A patch vote keeps only its result (4.9): no counts, and its ballots are blanked.
  if v.subject_member_id is not null and v.subject_role is null and v.electorate = 'chapter_patched' then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = res, casting_vote = nullif(p_casting, 'decline'),
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
end;
$$;

-- The patch and reinstatement helpers look only at votes that name no role, so a removal vote about
-- a member can't pass for either.
create or replace function private.has_carried_patch_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes v join public.members m on m.id = v.subject_member_id
    where v.subject_member_id = p_member and v.subject_role is null and v.electorate = 'chapter_patched'
      and v.closed_at is not null and v.result = 'carried'
      and (m.fng_started_on is null or private.club_date(v.opened_at) >= m.fng_started_on)
  );
$$;

create or replace function private.has_carried_reinstate_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and subject_role is null and electorate = 'nec' and threshold = 'majority'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
  );
$$;

-- 4. A removal vote about this term has carried (9.3): the chapter's vote, naming the holder and the
--    role, in the shape the role takes, closed in the last 90 days and since the term began.
create or replace function private.has_carried_removal_vote(p_position uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.positions p
    join public.votes v on v.subject_member_id = p.member_id and v.subject_role = p.role and v.chapter_id = p.chapter_id
    where p.id = p_position
      and v.electorate = case
        when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
          then 'chapter_patched' else 'chapter_board' end::public.electorate
      and v.threshold = case
        when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
          then 'two_thirds' else 'majority' end::public.vote_threshold
      and v.closed_at is not null and v.result = 'carried'
      and private.club_date(v.closed_at) >= private.club_date() - 90
      and private.club_date(v.closed_at) >= p.started_on
  );
$$;
revoke all on function private.has_carried_removal_vote(uuid) from public, anon, authenticated;

-- 5. Ending a term: stepping down is free; removing someone follows the vote (9.3).
create or replace function public.end_position(p_position uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pos public.positions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into pos from public.positions where id = p_position for update;
  if not found then raise exception 'That position no longer exists.'; end if;
  if pos.ended_on is not null then raise exception 'That term has already ended.'; end if;
  if pos.role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
  if pos.role = 'nec_chair' then
    raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
  end if;

  -- Anyone can step down from their own role. Ending someone else's takes the right standing and,
  -- for a chapter role, a carried removal vote (9.3).
  if pos.member_id <> me then
    if pos.chapter_id is null then
      if not private.is_chairman() then raise exception 'Only the National Chairman can end a national role.'; end if;
    elsif pos.role = 'president' then
      if not (private.is_board_of(pos.chapter_id) or private.is_nec_officer()) then
        raise exception 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.';
      end if;
      if not private.has_carried_removal_vote(p_position) then
        raise exception 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
      end if;
    else
      if not private.is_board_of(pos.chapter_id) then raise exception 'Only that chapter’s board can end this term.'; end if;
      if not private.has_carried_removal_vote(p_position) then
        if pos.role in ('vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
          raise exception 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
        end if;
        raise exception 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).';
      end if;
    end if;
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), pos.started_on), ended_by = me
  where id = p_position;
end;
$$;

-- 6. Every status change is recorded: what changed, who did it, and the 5.5 notice or the member's
--    request behind a move to Supporter. Read by the member, their chapter's board, the national
--    roles and the National Auditor; written only by set_member_status.
create table if not exists public.status_changes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade, -- the member's at the time
  from_status public.member_status not null,
  to_status public.member_status not null,
  by_request boolean not null default false,
  notice_id uuid references public.status_notices (id) on delete set null,
  changed_by uuid references public.members (id) on delete set null,
  changed_on date not null default private.club_date(),
  changed_at timestamptz not null default now()
);
create index if not exists status_changes_member on public.status_changes (member_id, changed_at desc);
create index if not exists status_changes_chapter on public.status_changes (chapter_id);

alter table public.status_changes enable row level security;
revoke all on public.status_changes from public, anon, authenticated;
grant select on public.status_changes to authenticated;
drop policy if exists status_changes_read on public.status_changes;
create policy status_changes_read on public.status_changes for select to authenticated using (
  member_id = auth.uid() or private.sees_board_of(chapter_id) or private.is_auditor()
);

-- 7. Changing a status: the move to Supporter follows the 5.5 notice unless it's at the member's
--    request, and every change is recorded. The old two-argument form goes, so there's one.
drop function if exists public.set_member_status(uuid, public.member_status);
create or replace function public.set_member_status(p_member uuid, p_status public.member_status, p_by_request boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
  notice uuid;
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such member.'; end if;
  -- Bringing an approved Supporter, Family or Legacy member back to Full or Nomad is the NEC's (5.6);
  -- every other change, an applicant's approval first of all, is their chapter board's (8.2).
  if p_status in ('full', 'nomad') and target.status not in ('full', 'nomad', 'fng') and target.approval = 'approved' then
    if not private.is_national() then raise exception 'Only the NEC can bring someone back to Full or Nomad (5.6).'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if not private.has_carried_reinstate_vote(p_member) then
      raise exception 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
    end if;
  else
    if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can change this member’s status.'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if p_status in ('full', 'nomad') and target.status = 'fng' and not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
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
  -- Moving an FNG, Full Member or Nomad to Supporter follows a 5.5 notice the board has decided in the
  -- last 90 days, unless the board records that the member asked for it (L2). The NEC's 5.6 branch
  -- above never moves anyone to Supporter, so this is the board's gate alone.
  if p_status = 'supporter' and target.status in ('fng', 'full', 'nomad') and not coalesce(p_by_request, false) then
    select id into notice from public.status_notices
    where member_id = p_member and outcome = 'decided' and closed_on >= today - 90
    order by closed_on desc, given_on desc
    limit 1;
    if notice is null then
      raise exception 'Moving them to Supporter follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
    end if;
  end if;

  update public.members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    on_hiatus = case when p_status = 'legacy' then false else on_hiatus end,
    updated_at = now()
  where id = p_member;
  insert into public.status_changes (member_id, chapter_id, from_status, to_status, by_request, notice_id, changed_by)
  values (p_member, target.chapter_id, target.status, p_status, coalesce(p_by_request, false), notice, auth.uid());
end;
$$;
revoke all on function public.set_member_status(uuid, public.member_status, boolean) from public, anon;
grant execute on function public.set_member_status(uuid, public.member_status, boolean) to authenticated;
