-- Checks the National Auditor's database side (constitution v4, 11.8) beyond the shared parity
-- cases: off the NEC, the records they read and the ones they don't, the two-thirds appointment
-- vote and renewal, requests and answers, and findings reports.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'chair@example.com'),  -- NEC Chairman, North
  ('00000000-0000-0000-0000-0000000008a2', 'sec@example.com'),    -- West Secretary
  ('00000000-0000-0000-0000-0000000008a3', 'aud@example.com'),    -- National Auditor, West
  ('00000000-0000-0000-0000-0000000008a4', 'rider@example.com'),  -- West Full
  ('00000000-0000-0000-0000-0000000008a5', 'pres@example.com'),   -- North President
  ('00000000-0000-0000-0000-0000000008a6', 'app@example.com'),    -- North applicant
  ('00000000-0000-0000-0000-0000000008a7', 'nsec@example.com');   -- North Secretary

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000008a1', 'north', 'Cara Chair', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000008a2', 'west', 'Sam Secretary', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000008a3', 'west', 'Audrey Auditor', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000008a4', 'west', 'Rob Rider', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000008a5', 'north', 'Pat President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000008a6', 'north', 'Andy Applicant', 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000008a7', 'north', 'Nell Secretary', 'full', 'approved')
) as v(id, slug, name, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, c.id, v.role::position_role, v.started::date
from (values
  ('00000000-0000-0000-0000-0000000008a1', null, 'nec_chair', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000008a2', 'west', 'secretary', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000008a3', null, 'nec_auditor', (private.club_date() - 330)::text),
  ('00000000-0000-0000-0000-0000000008a5', 'north', 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000008a7', 'north', 'secretary', '2025-08-16')
) as v(id, slug, role, started)
left join chapters c on c.slug = v.slug;

insert into member_private (member_id, email) values ('00000000-0000-0000-0000-0000000008a4', 'rob@example.com');
insert into emergency_contacts (member_id, name, relationship, phone) values ('00000000-0000-0000-0000-0000000008a4', 'Jo', 'Partner', '0400000000');
insert into member_decisions (member_id, kind, outcome, status, decided_on)
values ('00000000-0000-0000-0000-0000000008a4', 'application', 'approved', 'introduced', '2024-01-01');

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into out;
  reset role;
  return out;
end $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text) to authenticated;

\o
\echo 'The Auditor is off the NEC and runs nothing (11.2, 11.8)'
do $$
declare
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  app constant uuid := '00000000-0000-0000-0000-0000000008a6';
  north uuid := (select id from chapters where slug = 'north');
  west uuid := (select id from chapters where slug = 'west');
begin
  assert pg_temp.value_as(aud, 'select private.is_national()') = 'false', 'not national';
  assert pg_temp.value_as(aud, format('select private.is_board_of(%L)', west)) = 'false', 'not a board';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000008a5', 'select private.is_national()') = 'true', 'Presidents still are';
  assert pg_temp.try_as(aud, format('select public.approve_member(%L, %L)', app, 'introduced')) is not null, 'no approving';
  assert pg_temp.try_as(aud, format('select public.set_member_status(%L, %L)', rider, 'supporter')) is not null, 'no status changes';
  assert pg_temp.try_as(aud, format('select public.appoint_position(%L, %L, %L)', rider, west, 'president'))
    = 'Only the National Chairman or Secretary can seat a President.', 'no seating Presidents';
  assert pg_temp.try_as(aud, format('select public.end_position(%L)',
      (select id from positions where role = 'president' and ended_on is null)))
    = 'Only the National Chairman or Secretary can end a President’s term.', 'nor ending them';
end $$;

\echo 'The Auditor reads membership and attendance records, fees and decisions, not private details'
do $$
declare
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  app constant uuid := '00000000-0000-0000-0000-0000000008a6';
  north uuid := (select id from chapters where slug = 'north');
  west uuid := (select id from chapters where slug = 'west');
  s uuid;
  ch uuid;
begin
  insert into checkin_sessions (kind, chapter_id, title, held_on, code) values ('meeting', north, 'North meeting', private.club_date() - 7, 'AUD001') returning id into s;
  insert into attendance (session_id, member_id) values (s, app);
  insert into attendance_exemptions (session_id, member_id, reason) values (s, '00000000-0000-0000-0000-0000000008a7', 'Working');
  insert into member_decisions (member_id, kind, outcome, status, decided_on) values (app, 'application', 'approved', 'introduced', private.club_date());
  insert into charges (member_id, chapter_id, fy, kind, amount_cents, due_on) values ('00000000-0000-0000-0000-0000000008a7', north, 2026, 'annual', 36000, private.club_date()) returning id into ch;
  insert into payments (charge_id, amount_cents, paid_on, method, state) values (ch, 36000, private.club_date(), 'bank', 'claimed');

  assert pg_temp.value_as(aud, format('select count(*) from members where id = %L', app)) = '1', 'a pending applicant in another chapter';
  assert pg_temp.value_as(rider, format('select count(*) from members where id = %L', app)) = '0', 'members don''t';
  assert pg_temp.value_as(aud, format('select count(*) from member_decisions where member_id = %L', app)) = '1', 'application decisions';
  assert pg_temp.value_as(aud, format('select count(*) from attendance where member_id = %L', app)) = '1', 'attendance, applicants too';
  assert pg_temp.value_as(aud, 'select count(*) from attendance_exemptions') = '1', 'exemptions';
  assert pg_temp.value_as(rider, 'select count(*) from attendance_exemptions') = '0', 'members don''t see others'' exemptions';
  assert pg_temp.value_as(aud, format('select count(*) from charges where chapter_id = %L', north)) = '1', 'fees';
  assert pg_temp.value_as(aud, format('select count(*) from payments where charge_id = %L', ch)) = '1', 'payments';
  assert pg_temp.value_as(rider, format('select count(*) from charges where chapter_id = %L', north)) = '0', 'members don''t see fees';
  assert pg_temp.value_as(aud, format('select count(*) from member_private where member_id = %L', rider)) = '0', 'no private details';
  assert pg_temp.value_as(aud, format('select count(*) from emergency_contacts where member_id = %L', rider)) = '0', 'no emergency contacts';
  assert pg_temp.try_as(aud, format('select public.set_exemption(%L, %L, %L)', s, '00000000-0000-0000-0000-0000000008a7', null)) is not null, 'reading isn''t excusing';
end $$;

\echo 'The Auditor reads board and NEC meetings, draft minutes, votes and merch, but not conduct records'
do $$
declare
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  west uuid := (select id from chapters where slug = 'west');
  j jsonb;
begin
  insert into meetings (chapter_id, kind, title, starts_at, minutes) values (west, 'board', 'West board', now() - interval '3 days', 'Draft notes');
  insert into meetings (chapter_id, kind, title, starts_at) values (null, 'nec', 'NEC', now() - interval '3 days');
  insert into votes (chapter_id, question, electorate, threshold, quorum, closes_at)
  values (west, 'Board vote', 'chapter_board', 'majority', 1, now() + interval '3 days');
  insert into merch_items (chapter_id, name, price_cents) values (west, 'Proposed tee', 3000);
  insert into conduct_records (member_id, chapter_id, kind, summary, decided_on, notice_on)
  values (rider, west, 'other', 'Late to the ride', private.club_date(), private.club_date());

  j := pg_temp.value_as(aud, 'select public.club_business()')::jsonb;
  assert jsonb_array_length(j->'meetings') = 2, 'board and NEC meetings';
  assert (select m->>'minutes' from jsonb_array_elements(j->'meetings') m where m->>'kind' = 'board') = 'Draft notes', 'draft minutes';
  assert jsonb_array_length(j->'votes') = 1, 'the board''s vote';
  j := pg_temp.value_as(rider, 'select public.club_business()')::jsonb;
  assert jsonb_array_length(j->'meetings') = 0 and jsonb_array_length(j->'votes') = 0, 'members don''t';

  j := pg_temp.value_as(aud, 'select public.club_admin()')::jsonb;
  assert jsonb_array_length(j->'merch_items') = 1, 'a proposed merch item';
  assert jsonb_array_length(j->'conduct') = 0, 'conduct records stay with the board';
end $$;

\echo 'Appointing the Auditor needs a carried two-thirds NEC vote; the Chairman renews them'
do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000008a1';
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  pres constant uuid := '00000000-0000-0000-0000-0000000008a5';
  open_vote text := $q$select public.open_vote(null, null, %L, 'Appoint?', null, 'nec', %L, false, 1, now() + interval '7 days', 'nec_auditor')$q$;
  renewed uuid;
begin
  assert pg_temp.try_as(chair, format(open_vote, rider, 'two_thirds')) is null, 'a two-thirds vote about a Full Member';
  assert pg_temp.try_as(chair, format(open_vote, rider, 'majority'))
    = 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).', 'not a majority';
  assert pg_temp.try_as(chair, format(open_vote, pres, 'two_thirds'))
    = 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).', 'never a President';
  assert pg_temp.try_as(aud, format(open_vote, rider, 'two_thirds')) is not null, 'the Auditor doesn''t open NEC votes';

  -- Renewal: the term (started 330 days ago) is in its last 60 days.
  assert pg_temp.try_as(pres, 'select public.renew_auditor()') = 'Only the National Chairman renews the National Auditor.', 'only the Chairman';
  assert pg_temp.try_as(chair, 'select public.renew_auditor()')
    = 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).', 'needs a fresh vote';
  insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, closes_at, closed_at, result)
  values (null, aud, 'nec_auditor', 'Renew?', 'nec', 'majority', 1, now() - interval '1 day', now() - interval '1 day', 'carried');
  assert pg_temp.try_as(chair, 'select public.renew_auditor()')
    = 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).', 'a majority vote isn''t enough';
  insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, closes_at, closed_at, result)
  values (null, aud, 'nec_auditor', 'Renew?', 'nec', 'two_thirds', 1, now() - interval '1 day', now() - interval '1 day', 'carried');
  assert pg_temp.try_as(chair, 'select public.renew_auditor()') is null, 'renewed';
  assert (select count(*) from positions where member_id = aud and role = 'nec_auditor') = 2, 'each term is kept';
  assert (select started_on from positions where member_id = aud and role = 'nec_auditor' and ended_on is null) = private.club_date(), 'a new term from today';
  assert pg_temp.try_as(chair, 'select public.renew_auditor()') = 'The Auditor’s term isn’t ending yet. Renew in its last 60 days.', 'not twice';
  -- A majority vote about someone isn't a reinstatement vote for a two-thirds one, and the other way round.
  assert not private.has_carried_reinstate_vote(rider), 'no reinstatement from nothing';
end $$;

\echo 'The Auditor writes requests; that board or the NEC answers; the Auditor closes them'
do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000008a1';
  sec constant uuid := '00000000-0000-0000-0000-0000000008a2';
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  pres constant uuid := '00000000-0000-0000-0000-0000000008a5';
  nsec constant uuid := '00000000-0000-0000-0000-0000000008a7';
  west uuid := (select id from chapters where slug = 'west');
  raise_it text := $q$select public.raise_audit_request(%L, %L, 'bank', %L, 'Please send the statement.', %L, null)$q$;
  r uuid;
  n uuid;
  j jsonb;
begin
  assert pg_temp.try_as(sec, format(raise_it, west, 'information', 'Statement', null)) = 'Only the National Auditor can do that (11.8).', 'only the Auditor';
  assert pg_temp.try_as(aud, format(raise_it, west, 'advice', 'Statement', null)) = 'Pick information or correction.', 'a kind';
  assert pg_temp.try_as(aud, format(raise_it, west, 'information', '  ', null)) = 'Give it a title.', 'a title';
  assert pg_temp.try_as(aud, format(raise_it, west, 'information', 'Statement', private.club_date() - 1)) = 'Pick a due date from today on, or none.', 'not due yesterday';
  r := pg_temp.value_as(aud, format(raise_it, west, 'information', 'Statement', private.club_date() + 14))::uuid;
  n := pg_temp.value_as(aud, format(raise_it, null, 'correction', 'Club fund', null))::uuid;

  assert pg_temp.try_as(nsec, format('select public.answer_audit_request(%L, %L)', r, 'Here'))
    = 'Only that chapter’s board answers this request.', 'not another chapter''s board';
  assert pg_temp.try_as(sec, format('select public.answer_audit_request(%L, %L)', n, 'Here'))
    = 'Only the NEC answers this request.', 'national ones are the NEC''s';
  assert pg_temp.try_as(aud, format('select public.answer_audit_request(%L, %L)', r, 'Here'))
    = 'Only that chapter’s board answers this request.', 'the Auditor doesn''t answer their own';
  assert pg_temp.try_as(sec, format('select public.answer_audit_request(%L, %L)', r, ' ')) = 'Write the answer first.', 'an answer';
  assert pg_temp.try_as(sec, format('select public.answer_audit_request(%L, %L)', r, 'Attached in the board folder.')) is null, 'answered';
  assert pg_temp.try_as(pres, format('select public.answer_audit_request(%L, %L)', n, 'Fixed.')) is null, 'a President answers for the NEC';

  j := pg_temp.value_as(sec, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'requests') = 1, 'the West board sees its own';
  j := pg_temp.value_as(nsec, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'requests') = 0, 'North''s board doesn''t see West''s';
  j := pg_temp.value_as(chair, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'requests') = 2, 'the NEC sees every request';
  j := pg_temp.value_as(rider, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'requests') = 0, 'members never';

  assert pg_temp.try_as(sec, format('select public.close_audit_request(%L, %L)', r, 'Done')) = 'Only the National Auditor can do that (11.8).', 'only the Auditor closes';
  assert pg_temp.try_as(aud, format('select public.close_audit_request(%L, %L)', r, ' ')) = 'Say why you’re closing it.', 'a note';
  assert pg_temp.try_as(aud, format('select public.close_audit_request(%L, %L)', r, 'Satisfied.')) is null, 'closed';
  assert pg_temp.try_as(aud, format('select public.close_audit_request(%L, %L)', r, 'Again')) = 'That request is closed.', 'once';
  assert pg_temp.try_as(sec, format('select public.answer_audit_request(%L, %L)', r, 'Late')) = 'That request is closed.', 'closed is final';
end $$;

\echo 'Findings reports: drafts for the Auditor, issued ones for the NEC and every board'
do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000008a1';
  nsec constant uuid := '00000000-0000-0000-0000-0000000008a7';
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  save_it text := $q$select public.save_audit_report(%L, 'First review', %L, %L, %L, null)$q$;
  r uuid;
  gone uuid;
  j jsonb;
begin
  assert pg_temp.try_as(chair, format(save_it, null, private.club_date() - 30, private.club_date(), 'In order.')) = 'Only the National Auditor can do that (11.8).', 'only the Auditor';
  assert pg_temp.try_as(aud, format(save_it, null, private.club_date(), private.club_date() - 1, 'In order.')) = 'The period has to start before it ends.', 'a period';
  assert pg_temp.try_as(aud, format(save_it, null, private.club_date() - 30, private.club_date() + 1, 'In order.')) = 'The period can’t run past today.', 'not the future';
  assert pg_temp.try_as(aud, format(save_it, null, private.club_date() - 30, private.club_date(), ' ')) = 'Write the findings first.', 'findings';
  r := pg_temp.value_as(aud, format(save_it, null, private.club_date() - 30, private.club_date(), 'In order.'))::uuid;
  gone := pg_temp.value_as(aud, format(save_it, null, private.club_date() - 30, private.club_date(), 'Scrap this.'))::uuid;
  assert pg_temp.try_as(aud, format('select public.delete_audit_report(%L)', gone)) is null, 'a draft can go';
  assert pg_temp.try_as(aud, format(save_it, r, private.club_date() - 60, private.club_date(), 'In order, mostly.')) is null, 'a draft can change';

  j := pg_temp.value_as(chair, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'reports') = 0, 'drafts stay with the Auditor';
  assert pg_temp.try_as(aud, format('select public.issue_audit_report(%L)', r)) is null, 'issued';
  assert pg_temp.try_as(aud, format(save_it, r, private.club_date() - 60, private.club_date(), 'Changed.')) = 'That report has been issued, so it can’t change.', 'issued is final';
  assert pg_temp.try_as(aud, format('select public.delete_audit_report(%L)', r)) = 'That report has been issued, so it can’t change.', 'and stays';
  j := pg_temp.value_as(chair, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'reports') = 1 and j->'reports'->0->>'findings' = 'In order, mostly.', 'the NEC reads it';
  j := pg_temp.value_as(nsec, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'reports') = 1, 'so does every board';
  j := pg_temp.value_as(rider, 'select public.club_audit()')::jsonb;
  assert jsonb_array_length(j->'reports') = 0, 'members don''t';
end $$;

\echo 'The Auditor isn''t an NEC officer or a ride leader; one vote seats them once; no renewing yourself'
do $$
declare
  chair constant uuid := '00000000-0000-0000-0000-0000000008a1';
  aud constant uuid := '00000000-0000-0000-0000-0000000008a3';
  rider constant uuid := '00000000-0000-0000-0000-0000000008a4';
  not_nec constant text := 'The National Auditor isn’t on the NEC, so can’t also be National Chairman or Secretary (11.8).';
  vote_rule constant text := 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
  open_vote text := $q$select public.open_vote(null, null, %L, 'Appoint?', null, 'nec', 'two_thirds', false, 1, now() + interval '7 days', 'nec_auditor')$q$;
begin
  assert pg_temp.try_as(chair, format('select public.appoint_position(%L, null, %L)', aud, 'nec_secretary')) = not_nec, 'the Auditor isn''t made Secretary';
  assert pg_temp.try_as(chair, format(open_vote, chair)) = vote_rule, 'no Auditor vote on the Chairman';
  assert not private.is_ride_leader(aud), 'the Auditor doesn''t lead rides';
  assert private.is_ride_leader(chair), 'the Chairman still does';

  -- Tried inside a block that's rolled back, so the club's seats stay as they were.
  begin
    insert into positions (member_id, chapter_id, role, started_on) values (rider, null, 'nec_secretary', '2025-08-16');
    assert pg_temp.try_as(chair, format(open_vote, rider)) = vote_rule, 'no Auditor vote on the Secretary';
    insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, closes_at, closed_at, result)
    values (null, rider, 'nec_auditor', 'Appoint?', 'nec', 'two_thirds', 1, now() - interval '5 days', now() - interval '5 days', 'carried');
    assert private.hold_problem(rider, 'nec_auditor') = not_nec, 'the Secretary isn''t made Auditor';
    delete from positions where member_id = rider and role = 'nec_secretary';
    assert private.has_carried_auditor_vote(rider), 'a fresh vote';
    insert into positions (member_id, chapter_id, role, started_on, ended_on) values (rider, null, 'nec_auditor', private.club_date() - 2, private.club_date() - 1);
    assert not private.has_carried_auditor_vote(rider), 'a vote from before their last term doesn''t seat them again';

    update positions set ended_on = private.club_date() where role = 'nec_auditor' and ended_on is null;
    insert into positions (member_id, chapter_id, role, started_on) values (chair, null, 'nec_auditor', private.club_date() - 330);
    insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, closes_at, closed_at, result)
    values (null, chair, 'nec_auditor', 'Renew?', 'nec', 'two_thirds', 1, now() - interval '1 day', now() - interval '1 day', 'carried');
    assert pg_temp.try_as(chair, 'select public.renew_auditor()') = 'You can’t renew yourself.', 'nobody renews themselves';
    raise exception 'roll back';
  exception when raise_exception then
    if sqlerrm <> 'roll back' then raise; end if;
  end;
  assert (select count(*) from positions where member_id = rider and role in ('nec_secretary', 'nec_auditor')) = 0, 'rolled back';
end $$;

\echo 'AUDITOR CHECKS PASSED'
