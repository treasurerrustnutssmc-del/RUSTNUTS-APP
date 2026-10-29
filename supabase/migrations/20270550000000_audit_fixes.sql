-- The database repairs from the 29 Oct 2026 launch audit (the report lists them as M4, M7, L1,
-- L3, L4, L6, L7 and L8). Additive apart from six unused functions it drops; no data is deleted.
--
-- 1. The audit tables granted everything, TRUNCATE included, to anon and authenticated, and
--    row-level security doesn't cover TRUNCATE. Nobody reaches them directly (club_audit() reads,
--    the audit actions write), so the grants go.
-- 2. A push token is forgotten by its owner, signed in. The app does that before it signs out.
--    (register_push_device still binds a known token to whoever signs in on that phone: that's the
--    phone changing hands.)
-- 3. Who added a sponsor is the board's business: list_sponsors() shows it to the board only.
-- 4. The public copies of the private helpers (is_board_of, is_national, is_approved, member_phone)
--    and the first-day submit_application are dropped: nothing calls them. So is set_continuation_fee:
--    the continuation fee is half the Full fee (4.11), and the app works it out.
-- 5. The chat's JSON helpers pin their search path like every other function.
-- 6. Three constitution gaps in the votes:
--    - 10.6: a national vote needs voters from at least 51% of the chapters, or it has no quorum.
--    - 10.7: no casting vote on a vote about a member. A tie is lost.
--    - 11.6: the National Secretary, like the Auditor (11.8), is seated after a carried two-thirds
--      NEC vote about them. Votes now record which seat they're for (votes.subject_role), so one
--      vote seats one person in one seat, once. open_vote takes the seat as a last argument, which
--      the app sends only for a vote about a Full Member.
-- Safe to run once; a second Run changes nothing.

-- 1. The audit tables ---------------------------------------------------------------------------

revoke all on table public.audit_requests, public.audit_reports from public, anon, authenticated;

-- 2. Push tokens ----------------------------------------------------------------------------------

create or replace function public.forget_push_device(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = p_token and member_id = auth.uid();
$$;
revoke all on function public.forget_push_device(text) from public, anon;
grant execute on function public.forget_push_device(text) to authenticated;

-- 3. Sponsors -------------------------------------------------------------------------------------

create or replace function public.list_sponsors()
returns table (id uuid, name text, blurb text, url text, deal text, logo_path text, chapter_id uuid,
               added_by uuid, archived_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.blurb, s.url,
         case when private.is_approved_member() then s.deal end,
         s.logo_path, s.chapter_id,
         case when private.is_any_board() then s.added_by end,
         s.archived_at
  from public.sponsors s
  where s.archived_at is null or private.is_any_board()
  order by s.name;
$$;

-- 4. Unused functions -----------------------------------------------------------------------------

drop function if exists public.is_board_of(uuid);
drop function if exists public.is_national();
drop function if exists public.is_approved(uuid);
drop function if exists public.member_phone(uuid);
drop function if exists public.submit_application(uuid, text, text, text, text, text, public.member_status);
drop function if exists public.set_continuation_fee(uuid, integer, integer);

-- 5. The chat's JSON helpers ----------------------------------------------------------------------

alter function private.media_json(public.message_media, public.messages) set search_path = '';
alter function private.ride_json(public.rides) set search_path = '';
alter function private.ride_last_day(public.rides) set search_path = '';

-- 6. Votes ----------------------------------------------------------------------------------------

-- Which national seat a two-thirds NEC vote about a Full Member is for (11.6, 11.8).
alter table public.votes add column if not exists subject_role public.position_role
  check (subject_role in ('nec_auditor', 'nec_secretary'));
-- Until now the only such votes were about the Auditor.
update public.votes set subject_role = 'nec_auditor'
where subject_role is null and subject_member_id is not null and chapter_id is null
  and electorate = 'nec' and threshold = 'two_thirds';

-- The NEC voted by two-thirds, in the last 90 days, to seat this member in that national seat. The
-- vote has to close after their last term in the seat began: one vote seats them once (11.6, 11.8).
create or replace function private.has_carried_nec_vote(p_member uuid, p_role public.position_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and subject_role = p_role and chapter_id is null
      and electorate = 'nec' and threshold = 'two_thirds'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
      and private.club_date(closed_at) > coalesce(
        (select max(started_on) from public.positions where member_id = p_member and role = p_role), '-infinity'::date)
  );
$$;
create or replace function private.has_carried_auditor_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_carried_nec_vote(p_member, 'nec_auditor');
$$;

-- 10.6: a national vote is quorate only with voters from at least 51% of the chapters (the chapters
-- with someone on the vote's electoral roll).
create or replace function private.chapters_represented(p_vote uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with chapter as (
    select m.chapter_id, bool_or(e.voted_at is not null) as voted
    from public.vote_electors e join public.members m on m.id = e.member_id
    where e.vote_id = p_vote
    group by m.chapter_id)
  select count(*) filter (where voted) >= greatest(1, ceil(count(*) * 51 / 100.0)::int) from chapter;
$$;

revoke all on function private.has_carried_nec_vote(uuid, public.position_role), private.has_carried_auditor_vote(uuid),
  private.chapters_represented(uuid) from public, anon, authenticated;

-- open_vote gains the seat argument, so the old signature goes first.
drop function if exists public.open_vote(uuid, uuid, uuid, text, text, public.electorate, public.vote_threshold, boolean, integer, timestamptz);

create or replace function public.open_vote(p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text, p_electorate electorate, p_threshold vote_threshold, p_secret boolean, p_quorum integer, p_closes_at timestamp with time zone, p_role public.position_role default null)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_role is not null and p_role not in ('nec_auditor', 'nec_secretary') then
    raise exception 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).';
  end if;
  if p_role is not null and (p_subject is null or p_chapter is not null) then
    raise exception 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).';
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
$function$;

revoke all on function public.open_vote(uuid, uuid, uuid, text, text, public.electorate, public.vote_threshold, boolean, integer, timestamptz, public.position_role)
  from public, anon;
grant execute on function public.open_vote(uuid, uuid, uuid, text, text, public.electorate, public.vote_threshold, boolean, integer, timestamptz, public.position_role)
  to authenticated;

create or replace function public.appoint_position(p_member uuid, p_chapter uuid, p_role position_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        raise exception 'Only the National Chairman or Secretary can seat a President.';
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
  -- The Auditor (11.8) and the Secretary (11.6) are seated after a carried two-thirds NEC vote about them.
  if p_role in ('nec_auditor', 'nec_secretary') and not private.has_carried_nec_vote(p_member, p_role) then
    raise exception 'Appointing the National % needs a carried two-thirds NEC vote about them in the last 90 days (%).',
      case p_role when 'nec_auditor' then 'Auditor' else 'Secretary' end,
      case p_role when 'nec_auditor' then '11.8' else '11.6' end;
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$function$;

-- As before, plus: a national vote without voters from 51% of the chapters has no quorum (10.6), and
-- a vote about a member gets no casting vote, so its tie is lost (10.7).
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
  if v.subject_member_id is not null and v.electorate = 'chapter_patched' then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = res, casting_vote = nullif(p_casting, 'decline'),
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
end;
$$;

-- The votes in club_business() carry their seat.
create or replace function public.club_business()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('meetings', '[]'::jsonb, 'action_items', '[]'::jsonb, 'votes', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'chapter_id', m.chapter_id, 'kind', m.kind, 'title', m.title, 'starts_at', m.starts_at,
        'location', m.location, 'agenda', m.agenda,
        -- A shared draft goes to everyone who sees the meeting (10.8).
        'minutes', case when m.minutes_approved_at is not null or m.minutes_shared_at is not null
                          or private.reviews_scope(m.chapter_id) then m.minutes end,
        'minutes_shared_at', m.minutes_shared_at,
        'minutes_approved_at', m.minutes_approved_at, 'minutes_approved_by', m.minutes_approved_by,
        'cancelled_at', m.cancelled_at, 'created_by', m.created_by) order by m.starts_at, m.id)
      from public.meetings m
      where m.kind not in ('board', 'nec') or private.reviews_scope(m.chapter_id)), '[]'::jsonb),
    'action_items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'created_at' - 'created_by' order by a.due_on nulls last, a.created_at)
      from public.action_items a
      where a.owner_id = me or private.reviews_scope(a.chapter_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'chapter_id', v.chapter_id, 'meeting_id', v.meeting_id, 'subject_member_id', v.subject_member_id,
        'subject_role', v.subject_role,
        'question', v.question, 'details', v.details, 'electorate', v.electorate, 'threshold', v.threshold,
        'secret', v.secret, 'quorum', v.quorum, 'opened_at', v.opened_at, 'closes_at', v.closes_at,
        'closed_at', v.closed_at, 'result', v.result, 'casting_vote', v.casting_vote, 'created_by', v.created_by,
        'tally', case when v.closed_at is not null and v.yes_count is not null
                      then jsonb_build_object('yes', v.yes_count, 'no', v.no_count, 'abstain', v.abstain_count) end,
        'elector_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                        from public.vote_electors e where e.vote_id = v.id),
        'voted_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                      from public.vote_electors e where e.vote_id = v.id and e.voted_at is not null),
        'my_voted', exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me and e.voted_at is not null),
        'ballots', case when v.closed_at is not null and not v.secret then (
                     select coalesce(jsonb_agg(jsonb_build_object('member_id', b.member_id, 'choice', b.choice)
                                               order by b.member_id), '[]'::jsonb)
                     from public.vote_ballots b where b.vote_id = v.id)
                   else '[]'::jsonb end
        ) order by v.opened_at desc, v.id)
      from public.votes v
      where private.reviews_scope(v.chapter_id)
         or exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me)), '[]'::jsonb)
  );
end;
$function$;
