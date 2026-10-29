-- The National Auditor in full (constitution v4, 11.8 and 13.8).
-- See docs/superpowers/specs/2026-10-29-national-auditor-design.md.
--
-- 1. The Auditor reviews and never runs anything: they stop counting as NEC (is_national,
--    is_nec_officer), so every action that checks those helpers now refuses them.
-- 2. They read the records 11.8 names: membership (pending applicants and decisions too),
--    attendance and exemptions, fees, board and NEC meetings, minutes, action items and votes,
--    document sign-offs and merch money. Private details, conduct records and chats stay out.
-- 3. Appointing them needs a carried two-thirds NEC vote about them in the last 90 days, and the
--    Chairman renews them for another twelve months with a fresh one (renew_auditor).
-- 4. Their written requests (information or correction) to a board or the NEC, the answers, and
--    their findings reports: audit_requests and audit_reports, read through club_audit().
-- Every rule mirrors src/domain/access.ts, votes.ts and audit.ts, with the same words.
-- Additive only: new read policies sit beside the old ones, nothing is dropped.

-- 1. Off the NEC ---------------------------------------------------------------------------------

create or replace function private.is_auditor()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'nec_auditor'
  );
$$;

-- The Chairman, the Secretary and the sitting Presidents. The Auditor holds a national seat but
-- isn't on the NEC (11.2, 11.8).
create or replace function private.is_national()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'president')
  );
$$;

-- National Chairman or Secretary. The Auditor doesn't seat the people they review (11.8).
create or replace function private.is_nec_officer()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary')
  );
$$;

-- The public copy the app once called, kept in step.
create or replace function public.is_national()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_member() and exists (
    select 1 from positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'president')
  );
$$;

-- Row-level security calls it as the signed-in member, like private.is_board_of.
revoke all on function private.is_auditor() from public, anon;
grant execute on function private.is_auditor() to authenticated;

-- 2. What the Auditor reads (11.8) --------------------------------------------------------------

-- A chapter's membership and attendance records: its board, the NEC, or the Auditor.
create or replace function private.reviews_chapter(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_board_of(p_chapter) or private.is_auditor();
$$;

-- A scope's private business (board and NEC meetings, draft minutes, votes): whoever runs it, or the Auditor.
create or replace function private.reviews_scope(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.runs_scope(p_chapter) or private.is_auditor();
$$;

revoke all on function private.reviews_chapter(uuid), private.reviews_scope(uuid) from public, anon, authenticated;

create policy members_auditor_read on public.members for select to authenticated using (private.is_auditor());
create policy member_decisions_auditor_read on public.member_decisions for select to authenticated using (private.is_auditor());
create policy attendance_auditor_read on public.attendance for select to authenticated using (private.is_auditor());
create policy attendance_exemptions_auditor_read on public.attendance_exemptions for select to authenticated using (private.is_auditor());

-- Fees: whoever handles them, the chapter's board, the NEC and the Auditor.
create or replace function private.can_see_fees(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_fees(target_chapter) or private.reviews_chapter(target_chapter);
$$;

-- Meetings, minutes, action items and votes: read with reviews_scope instead of runs_scope.
-- Secret ballots still never carry a member.
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

-- Document sign-offs: who has signed what, for policy compliance.
create or replace function public.club_documents()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'chapter_id', d.chapter_id, 'kind', d.kind, 'title', d.title, 'asks_sign_off', d.asks_sign_off,
        'review_months', d.review_months, 'reviewed_on', d.reviewed_on, 'created_by', d.created_by, 'created_at', d.created_at)
        order by d.title)
      from public.documents d where private.reads_document(d.kind)), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'document_id', v.document_id, 'number', v.number, 'label', v.label, 'what_changed', v.what_changed,
        'fresh_sign_off', v.fresh_sign_off, 'approving_body', v.approving_body, 'approved_on', v.approved_on,
        'commences_on', v.commences_on, 'published_by', v.published_by, 'published_at', v.published_at)
        order by v.document_id, v.number)
      from public.document_versions v join public.documents d on d.id = v.document_id
      where private.reads_document(d.kind)), '[]'::jsonb),
    'signoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id', s.version_id, 'document_id', v.document_id, 'member_id', s.member_id, 'signed_at', s.signed_at)
        order by s.signed_at)
      from public.document_signoffs s
      join public.document_versions v on v.id = s.version_id
      join public.documents d on d.id = v.document_id
      where private.is_approved_member() and (s.member_id = auth.uid() or private.reviews_scope(d.chapter_id))), '[]'::jsonb));
$function$;

-- Merch items and orders: event funds and transactions. Conduct records stay with the board.
create or replace function public.club_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_approved_member() then
    return jsonb_build_object('conduct', '[]'::jsonb, 'merch_items', '[]'::jsonb, 'merch_orders', '[]'::jsonb,
      'contributions', '[]'::jsonb, 'chapter_proposals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'conduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'member_id', r.member_id, 'chapter_id', r.chapter_id, 'kind', r.kind, 'summary', r.summary, 'rule', r.rule,
        'decided_on', r.decided_on, 'notice_on', r.notice_on, 'suspended_until', r.suspended_until, 'recorded_by', r.recorded_by,
        'recorded_at', r.recorded_at, 'hold_until', r.hold_until, 'hold_reason', r.hold_reason,
        'appeal', (select jsonb_build_object(
            'lodged_on', a.lodged_on, 'lodged_by', a.lodged_by, 'grounds', a.grounds, 'panel', to_jsonb(a.panel),
            'hearing_on', a.hearing_on, 'outcome', a.outcome, 'outcome_note', a.outcome_note, 'decided_on', a.decided_on,
            'decided_by', a.decided_by, 'withdrawn_on', a.withdrawn_on)
          from public.conduct_appeals a where a.record_id = r.id)
        ) order by r.decided_on desc, r.recorded_at desc)
      from public.conduct_records r where private.conduct_kept(r) and private.sees_conduct(r)), '[]'::jsonb),
    'merch_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'chapter_id', i.chapter_id, 'name', i.name, 'details', i.details, 'sizes', to_jsonb(i.sizes),
        'price_cents', i.price_cents, 'patched_only', i.patched_only, 'status', i.status, 'proposed_by', i.proposed_by,
        'proposed_at', i.proposed_at, 'decided_by', i.decided_by, 'decided_at', i.decided_at, 'decline_reason', i.decline_reason
        ) order by i.proposed_at desc)
      from public.merch_items i where private.sees_merch_item(i) or private.is_auditor()), '[]'::jsonb),
    'merch_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'item_id', o.item_id, 'member_id', o.member_id, 'size', o.size, 'qty', o.qty, 'unit_cents', o.unit_cents,
        'note', o.note, 'status', o.status, 'ordered_at', o.ordered_at, 'decided_by', o.decided_by, 'decided_at', o.decided_at,
        'decline_reason', o.decline_reason, 'paid_on', o.paid_on, 'ledger_entry_id', o.ledger_entry_id, 'handed_over_on', o.handed_over_on
        ) order by o.ordered_at desc)
      from public.merch_orders o where private.sees_merch_order(o) or private.is_auditor()), '[]'::jsonb),
    'contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'title', k.title, 'purpose', k.purpose, 'total_cents', k.total_cents, 'status', k.status,
        'proposed_by', k.proposed_by, 'proposed_at', k.proposed_at, 'settled_at', k.settled_at, 'shares', k.shares,
        'decisions', (select coalesce(jsonb_agg(jsonb_build_object('chapter_id', d.chapter_id, 'yes', d.yes, 'vote_id', d.vote_id,
                        'recorded_by', d.recorded_by, 'recorded_at', d.recorded_at) order by d.recorded_at), '[]'::jsonb)
                      from public.contribution_decisions d where d.contribution_id = k.id)
        ) order by k.proposed_at desc)
      from public.national_contributions k), '[]'::jsonb),
    'chapter_proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'area', p.area, 'state', p.state, 'plan', p.plan, 'founder_ids', to_jsonb(p.founder_ids),
        'president_id', p.president_id, 'saa_id', p.saa_id, 'status', p.status, 'proposed_by', p.proposed_by,
        'proposed_at', p.proposed_at, 'vote_id', p.vote_id, 'decided_by', p.decided_by, 'decided_at', p.decided_at,
        'chapter_id', p.chapter_id
        ) order by p.proposed_at desc)
      from public.chapter_proposals p), '[]'::jsonb));
end;
$function$;

-- 3. Appointment by a two-thirds NEC vote, renewable ----------------------------------------------

-- Reinstatement is a majority vote; a two-thirds vote about a Full Member is for the Auditor.
create or replace function private.has_carried_reinstate_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and electorate = 'nec' and threshold = 'majority'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
  );
$$;

-- The NEC voted by two-thirds, in the last 90 days, to appoint this member National Auditor (11.8).
create or replace function private.has_carried_auditor_vote(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes
    where subject_member_id = p_member and chapter_id is null and electorate = 'nec' and threshold = 'two_thirds'
      and closed_at is not null and result = 'carried'
      and private.club_date(closed_at) >= private.club_date() - 90
  );
$$;

revoke all on function private.has_carried_reinstate_vote(uuid), private.has_carried_auditor_vote(uuid)
  from public, anon, authenticated;

create or replace function public.open_vote(p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text, p_electorate electorate, p_threshold vote_threshold, p_secret boolean, p_quorum integer, p_closes_at timestamp with time zone)
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
  if p_subject is not null and p_chapter is null then
    select * into subject from public.members where id = p_subject;
    if found and subject.approval = 'approved' and subject.status = 'full' then
      -- Appointing the National Auditor: two-thirds of the NEC, never a President or Treasurer (11.8).
      if exists (select 1 from public.positions where member_id = p_subject and ended_on is null and role in ('president', 'treasurer'))
         or p_electorate <> 'nec' or p_threshold <> 'two_thirds' then
        raise exception 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President or Treasurer (11.8).';
      end if;
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

  insert into public.votes (chapter_id, meeting_id, subject_member_id, question, details, electorate, threshold,
                            secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, trim(p_question), nullif(trim(p_details), ''), p_electorate, p_threshold,
          coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.electors_for(p_electorate, p_chapter) e;
  return opened;
end;
$function$;

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
  if p_role = 'nec_auditor' and not private.has_carried_auditor_vote(p_member) then
    raise exception 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).';
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$function$;

create or replace function public.end_position(p_position uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if pos.member_id = me then raise exception 'You can’t end your own term.'; end if;

  if pos.chapter_id is null then
    if pos.role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman can end a national role.'; end if;
  elsif pos.role = 'president' then
    if not private.is_nec_officer() then
      raise exception 'Only the National Chairman or Secretary can end a President’s term.';
    end if;
  elsif not private.is_board_of(pos.chapter_id) then
    raise exception 'Only that chapter’s board can end this term.';
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), pos.started_on), ended_by = me
  where id = p_position;
end;
$function$;

-- With a fresh carried vote, the Chairman renews the sitting Auditor in the last 60 days of their
-- term or after it: the old term ends today and a new twelve-month one starts today (11.8).
create or replace function public.renew_auditor()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  seat public.positions%rowtype;
  unfit text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_chairman() then raise exception 'Only the National Chairman renews the National Auditor.'; end if;
  select * into seat from public.positions where role = 'nec_auditor' and ended_on is null for update;
  if not found then raise exception 'There’s no sitting National Auditor to renew.'; end if;
  if (seat.started_on + interval '1 year')::date - private.club_date() > 60 then
    raise exception 'The Auditor’s term isn’t ending yet. Renew in its last 60 days.';
  end if;
  unfit := private.hold_problem(seat.member_id, 'nec_auditor');
  if unfit is not null then raise exception '%', unfit; end if;
  if not private.has_carried_auditor_vote(seat.member_id) then
    raise exception 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).';
  end if;
  update public.positions set ended_on = greatest(private.club_date(), seat.started_on), ended_by = me where id = seat.id;
  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (seat.member_id, null, 'nec_auditor', private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.renew_auditor() from public, anon;
grant execute on function public.renew_auditor() to authenticated;
-- 4. Requests and findings reports ---------------------------------------------------------------

create table public.audit_requests (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id), -- null: the NEC
  kind text not null check (kind in ('information', 'correction')),
  area text not null check (area in ('policy', 'membership', 'attendance', 'event_funds', 'bank', 'transactions', 'controls')),
  title text not null check (char_length(title) between 1 and 120),
  details text not null check (char_length(details) between 1 and 4000),
  due_on date,
  ledger_entry_id uuid references public.ledger_entries (id) on delete set null,
  raised_by uuid references public.members (id) on delete set null,
  raised_at timestamptz not null default now(),
  answer text check (char_length(answer) between 1 and 4000),
  answered_by uuid references public.members (id) on delete set null,
  answered_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.members (id) on delete set null,
  close_note text check (char_length(close_note) between 1 and 1000),
  check ((closed_at is null) = (close_note is null))
);

create table public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  from_on date not null,
  to_on date not null check (to_on >= from_on),
  findings text not null check (char_length(findings) between 1 and 20000),
  recommendations text check (char_length(recommendations) <= 20000),
  written_by uuid references public.members (id) on delete set null,
  saved_at timestamptz not null default now(),
  issued_at timestamptz
);

-- Nobody reaches these directly: club_audit() reads, and the actions below write.
alter table public.audit_requests enable row level security;
alter table public.audit_reports enable row level security;

create or replace function private.require_auditor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_auditor() then raise exception 'Only the National Auditor can do that (11.8).'; end if;
  return auth.uid();
end;
$$;

-- Trimmed text, refused with the app's words when it's empty or too long.
create or replace function private.audit_text(p_text text, p_empty text, p_max int)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if nullif(trim(p_text), '') is null then raise exception '%', p_empty; end if;
  if char_length(trim(p_text)) > p_max then raise exception 'Keep it to % characters at most.', p_max; end if;
  return trim(p_text);
end;
$$;

revoke all on function private.require_auditor(), private.audit_text(text, text, int) from public, anon, authenticated;

create or replace function public.raise_audit_request(
  p_chapter uuid, p_kind text, p_area text, p_title text, p_details text, p_due date, p_ledger_entry uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_auditor();
  line public.ledger_entries%rowtype;
  t text;
  d text;
  new_id uuid;
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'Pick a chapter, or the NEC.';
  end if;
  if p_kind is null or p_kind not in ('information', 'correction') then raise exception 'Pick information or correction.'; end if;
  if p_area is null or p_area not in ('policy', 'membership', 'attendance', 'event_funds', 'bank', 'transactions', 'controls') then
    raise exception 'Pick what it’s about.';
  end if;
  t := private.audit_text(p_title, 'Give it a title.', 120);
  d := private.audit_text(p_details, 'Say what you need.', 4000);
  if p_due is not null and p_due < private.club_date() then raise exception 'Pick a due date from today on, or none.'; end if;
  if p_ledger_entry is not null then
    select * into line from public.ledger_entries where id = p_ledger_entry;
    if not found then raise exception 'That line isn’t in the books.'; end if;
    if line.chapter_id is distinct from p_chapter then raise exception 'That line is in another fund.'; end if;
  end if;
  insert into public.audit_requests (chapter_id, kind, area, title, details, due_on, ledger_entry_id, raised_by)
  values (p_chapter, p_kind, p_area, t, d, p_due, p_ledger_entry, me)
  returning id into new_id;
  return new_id;
end;
$$;

-- That chapter's board answers; for national requests, the NEC. The answer can be updated until it's closed.
create or replace function public.answer_audit_request(p_id uuid, p_answer text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  r public.audit_requests%rowtype;
  a text;
begin
  select * into r from public.audit_requests where id = p_id for update;
  if not found then raise exception 'That request isn’t there any more.'; end if;
  if not private.runs_scope(r.chapter_id) then
    if r.chapter_id is null then raise exception 'Only the NEC answers this request.'; end if;
    raise exception 'Only that chapter’s board answers this request.';
  end if;
  if r.closed_at is not null then raise exception 'That request is closed.'; end if;
  a := private.audit_text(p_answer, 'Write the answer first.', 4000);
  update public.audit_requests set answer = a, answered_by = me, answered_at = now() where id = p_id;
end;
$$;

create or replace function public.close_audit_request(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_auditor();
  r public.audit_requests%rowtype;
  n text;
begin
  select * into r from public.audit_requests where id = p_id for update;
  if not found then raise exception 'That request isn’t there any more.'; end if;
  if r.closed_at is not null then raise exception 'That request is closed.'; end if;
  n := private.audit_text(p_note, 'Say why you’re closing it.', 1000);
  update public.audit_requests set closed_at = now(), closed_by = me, close_note = n where id = p_id;
end;
$$;

-- A draft the Auditor may still change.
create or replace function private.audit_draft(p_id uuid)
returns public.audit_reports language plpgsql security definer set search_path = '' as $$
declare r public.audit_reports;
begin
  perform private.require_auditor();
  select * into r from public.audit_reports where id = p_id for update;
  if not found then raise exception 'That report isn’t there any more.'; end if;
  if r.issued_at is not null then raise exception 'That report has been issued, so it can’t change.'; end if;
  return r;
end;
$$;

revoke all on function private.audit_draft(uuid) from public, anon, authenticated;

-- Saves a draft: a new one when p_id is null.
create or replace function public.save_audit_report(
  p_id uuid, p_title text, p_from date, p_to date, p_findings text, p_recommendations text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_auditor();
  t text;
  f text;
  saved uuid;
begin
  if p_id is not null then perform private.audit_draft(p_id); end if;
  t := private.audit_text(p_title, 'Give the report a title.', 120);
  if p_from is null or p_to is null then raise exception 'Pick the period it covers.'; end if;
  if p_from > p_to then raise exception 'The period has to start before it ends.'; end if;
  if p_to > private.club_date() then raise exception 'The period can’t run past today.'; end if;
  f := private.audit_text(p_findings, 'Write the findings first.', 20000);
  if char_length(trim(p_recommendations)) > 20000 then raise exception 'Keep it to 20000 characters at most.'; end if;
  if p_id is null then
    insert into public.audit_reports (title, from_on, to_on, findings, recommendations, written_by)
    values (t, p_from, p_to, f, nullif(trim(p_recommendations), ''), me)
    returning id into saved;
  else
    update public.audit_reports
    set title = t, from_on = p_from, to_on = p_to, findings = f, recommendations = nullif(trim(p_recommendations), ''),
        written_by = me, saved_at = now()
    where id = p_id
    returning id into saved;
  end if;
  return saved;
end;
$$;

create or replace function public.issue_audit_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit_draft(p_id);
  update public.audit_reports set issued_at = now() where id = p_id;
end;
$$;

create or replace function public.delete_audit_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit_draft(p_id);
  delete from public.audit_reports where id = p_id;
end;
$$;

-- Requests for the Auditor, whoever answers for that scope, and the NEC; drafts for the Auditor,
-- issued reports for the NEC and every chapter board too.
create or replace function public.club_audit()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  auditor boolean := private.is_auditor();
  nec boolean := private.is_national();
  boards boolean := private.is_any_board();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('requests', '[]'::jsonb, 'reports', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'chapter_id', r.chapter_id, 'kind', r.kind, 'area', r.area, 'title', r.title, 'details', r.details,
        'due_on', r.due_on, 'ledger_entry_id', r.ledger_entry_id, 'raised_by', r.raised_by, 'raised_at', r.raised_at,
        'answer', r.answer, 'answered_by', r.answered_by, 'answered_at', r.answered_at,
        'closed_at', r.closed_at, 'closed_by', r.closed_by, 'close_note', r.close_note) order by r.raised_at desc)
      from public.audit_requests r
      where auditor or nec or private.runs_scope(r.chapter_id)), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'from_on', a.from_on, 'to_on', a.to_on, 'findings', a.findings,
        'recommendations', a.recommendations, 'written_by', a.written_by, 'saved_at', a.saved_at, 'issued_at', a.issued_at)
        order by coalesce(a.issued_at, a.saved_at) desc)
      from public.audit_reports a
      where auditor or (a.issued_at is not null and (nec or boards))), '[]'::jsonb));
end;
$$;

revoke all on function
  public.raise_audit_request(uuid, text, text, text, text, date, uuid), public.answer_audit_request(uuid, text),
  public.close_audit_request(uuid, text), public.save_audit_report(uuid, text, date, date, text, text),
  public.issue_audit_report(uuid), public.delete_audit_report(uuid), public.club_audit()
  from public, anon;
grant execute on function
  public.raise_audit_request(uuid, text, text, text, text, date, uuid), public.answer_audit_request(uuid, text),
  public.close_audit_request(uuid, text), public.save_audit_report(uuid, text, date, date, text, text),
  public.issue_audit_report(uuid), public.delete_audit_report(uuid), public.club_audit()
  to authenticated;
