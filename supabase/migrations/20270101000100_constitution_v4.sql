-- Constitution v4 (Final Club Edition, 25 Oct 2026) for meetings and votes.
-- A Chapter Board quorum is a majority of its distinct members, with at least three taking part
-- (8.5), so a board of fewer than three can't hold a vote. On a tie the chair may give a casting
-- vote or decline (p_casting 'decline'), and a declined tie is lost (9.10). Only the chair closes a
-- tied vote. After a meeting the board shares the draft minutes (share_minutes), and everyone who
-- sees the meeting reads them, marked draft until the board confirms them (10.8). Notes saved
-- before then stay with the board.
-- The replaced functions keep their signatures, so their grants are unchanged.

-- More than half a board, and at least three (8.5); otherwise as before.
create or replace function private.min_quorum(p_electorate public.electorate, p_electors int)
returns int language sql immutable set search_path = '' as $$
  select case p_electorate
    when 'chapter_board' then greatest(3, p_electors / 2 + 1)
    when 'nec' then greatest(1, ceil(p_electors * 51 / 100.0)::int)
    else greatest(1, ceil(p_electors / 3.0)::int)
  end;
$$;

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
  if p_subject is not null then
    select * into subject from public.members where id = p_subject;
    if not found or p_chapter is null or subject.chapter_id <> p_chapter or subject.approval <> 'approved'
       or subject.status <> 'fng' then
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

create or replace function public.close_vote(p_vote uuid, p_casting text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  n_yes int; n_no int; n_abstain int; n_electors int;
  outcome record;
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
  outcome := private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, null, n_electors);
  chair := private.chair_of(v.chapter_id);
  -- The chair casts or declines, and a declined tie is lost (9.10).
  if outcome.tied and chair is not null and (p_casting is null or me <> chair) then
    raise exception 'It’s a tie. The chair gives a casting vote or lets it fall.';
  end if;
  if not outcome.tied and p_casting is not null then raise exception 'There’s no tie, so no casting vote.'; end if;
  if p_casting in ('yes', 'no') and chair is null then
    raise exception 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
  end if;
  if p_casting is not null and p_casting not in ('yes', 'no', 'decline') then raise exception 'Pick an answer.'; end if;
  outcome := private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, p_casting, n_electors);

  -- A patch vote keeps only its result (4.9): no counts, and its ballots are blanked.
  if v.subject_member_id is not null then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = outcome.result, casting_vote = nullif(p_casting, 'decline'),
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
end;
$$;

-- Minutes ------------------------------------------------------------------------------------

alter table public.meetings add column minutes_shared_at timestamptz;

-- The board sends the draft to members after the meeting, within seven days (10.8).
create or replace function public.share_minutes(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  if m.starts_at > now() then raise exception 'The meeting hasn’t happened yet.'; end if;
  if nullif(trim(m.minutes), '') is null then raise exception 'Write the minutes first.'; end if;
  if m.minutes_shared_at is not null then raise exception 'The draft is already out to members.'; end if;
  update public.meetings set minutes_shared_at = now() where id = p_id;
end;
$$;
revoke all on function public.share_minutes(uuid) from public, anon;
grant execute on function public.share_minutes(uuid) to authenticated;

-- Everything the Business screen shows this person, in one piece: meetings they can see (minutes
-- only to whoever runs them until the draft is shared), their action items (or all of a scope they run), and the
-- votes they're on or run, with counts and open ballots only once closed and secret ballots never.
create or replace function public.club_business()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
                          or private.runs_scope(m.chapter_id) then m.minutes end,
        'minutes_shared_at', m.minutes_shared_at,
        'minutes_approved_at', m.minutes_approved_at, 'minutes_approved_by', m.minutes_approved_by,
        'cancelled_at', m.cancelled_at, 'created_by', m.created_by) order by m.starts_at, m.id)
      from public.meetings m
      where m.kind not in ('board', 'nec') or private.runs_scope(m.chapter_id)), '[]'::jsonb),
    'action_items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'created_at' - 'created_by' order by a.due_on nulls last, a.created_at)
      from public.action_items a
      where a.owner_id = me or private.runs_scope(a.chapter_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'chapter_id', v.chapter_id, 'meeting_id', v.meeting_id, 'subject_member_id', v.subject_member_id,
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
      where private.runs_scope(v.chapter_id)
         or exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me)), '[]'::jsonb)
  );
end;
$$;
