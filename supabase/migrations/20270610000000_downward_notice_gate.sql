-- Deep audit (31 Oct 2026), finding F2: the 5.5 notice gate covered only a move to Supporter. A chapter
-- board could move a Full Member, Nomad or FNG to Legacy, or a Full Member or Nomad back to FNG, with no
-- notice and no record of a request. Every step down now follows a decided 5.5 notice in the last 90
-- days unless the board records that the member asked for it (the same p_by_request as Supporter).
-- Nomad stays ungated: it's sideways (5.3), and a Nomad keeps the disc. Same arguments, same grants;
-- src/domain/access.ts statusChangeProblem mirrors it. Safe to run twice.

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
  -- Moving an FNG, Full Member or Nomad down to Supporter, Legacy or FNG follows a 5.5 notice the board
  -- has decided in the last 90 days, unless the board records that the member asked for it (L2, widened
  -- from Supporter alone by the 31 Oct 2026 deep audit, F2). Nomad is sideways, not down. The NEC's 5.6
  -- branch above never moves anyone down, so this is the board's gate alone.
  if p_status in ('supporter', 'legacy', 'fng') and target.status in ('fng', 'full', 'nomad') and p_status <> target.status
     and not coalesce(p_by_request, false) then
    select id into notice from public.status_notices
    where member_id = p_member and outcome = 'decided' and closed_on >= today - 90
    order by closed_on desc, given_on desc
    limit 1;
    if notice is null then
      raise exception 'Moving them down to Supporter, Legacy or FNG follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
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
