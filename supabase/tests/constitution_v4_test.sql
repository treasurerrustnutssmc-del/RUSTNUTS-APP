-- Checks constitution v4 (25 Oct 2026) in the database: who holds positions, status changes and
-- the patch vote, learner riders, the Patch review, the continuation fee and meeting notice. The
-- shared parity cases cover the simple refusals; this covers what needs votes, dates and money.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'sec@example.com', now()),     -- West Secretary
  ('00000000-0000-0000-0000-0000000000a2', 'chair@example.com', now()),   -- National Chairman (North)
  ('00000000-0000-0000-0000-0000000000a3', 'rider@example.com', now()),   -- West Full
  ('00000000-0000-0000-0000-0000000000a4', 'nomad@example.com', now()),   -- West Nomad
  ('00000000-0000-0000-0000-0000000000a5', 'sup@example.com', now()),     -- West Supporter
  ('00000000-0000-0000-0000-0000000000a6', 'fng@example.com', now()),     -- West FNG, 12 months in
  ('00000000-0000-0000-0000-0000000000a7', 'young@example.com', now()),   -- West FNG, 7 months in
  ('00000000-0000-0000-0000-0000000000a8', 'learner@example.com', now()), -- West applicant on L plates
  ('00000000-0000-0000-0000-0000000000a9', 'gone@example.com', now()),    -- West Legacy
  ('00000000-0000-0000-0000-0000000000b1', 'tre@example.com', now());     -- West Treasurer

insert into members (id, chapter_id, full_name, road_name, status, approval, fng_started_on)
select v.id::uuid, c.id, v.name, null, v.status::member_status, v.approval::approval_state,
       case v.id when '00000000-0000-0000-0000-0000000000a6' then (private.club_date() - interval '12 months')::date
                 when '00000000-0000-0000-0000-0000000000a7' then (private.club_date() - interval '7 months')::date end
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Sue Secretary', 'full', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a2', 'Cal Chair', 'full', 'approved', 'north'),
  ('00000000-0000-0000-0000-0000000000a3', 'Rita Rider', 'full', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a4', 'Noel Nomad', 'nomad', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a5', 'Sam Supporter', 'supporter', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a6', 'Fred Fng', 'fng', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a7', 'Yuri Young', 'fng', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a8', 'Lee Learner', 'introduced', 'pending', 'west'),
  ('00000000-0000-0000-0000-0000000000a9', 'Gus Gone', 'legacy', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000b1', 'Tom Treasurer', 'full', 'approved', 'west')
) as v(id, name, status, approval, chapter)
join chapters c on c.slug = v.chapter;

insert into member_private (member_id, licence_class) values
  ('00000000-0000-0000-0000-0000000000a8', 'learner'),
  ('00000000-0000-0000-0000-0000000000a5', 'learner');

insert into positions (member_id, chapter_id, role, started_on)
select v.m::uuid, (select id from chapters where slug = v.ch), v.role::position_role, date '2025-01-01'
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000b1', 'west', 'treasurer'),
  ('00000000-0000-0000-0000-0000000000a2', null, 'nec_chair')
) as v(m, ch, role);

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return null;
end $$;
grant execute on function pg_temp.try_as(uuid, text) to anon, authenticated;

\o
\echo 'Only Full and Nomad members hold positions; Nomads only Non-Board roles; the Auditor stands apart'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  chair constant uuid := '00000000-0000-0000-0000-0000000000a2';
  west uuid := (select id from chapters where slug = 'west');
  appoint text := 'select public.appoint_position(%L, %L, %L)';
begin
  assert pg_temp.try_as(sec, format(appoint, '00000000-0000-0000-0000-0000000000a6', west, 'officer'))
    = 'Only Full and Nomad members hold Club positions (4.6, 5.8).', 'not an FNG';
  assert pg_temp.try_as(sec, format(appoint, '00000000-0000-0000-0000-0000000000a5', west, 'tail_gunner'))
    = 'Only Full and Nomad members hold Club positions (4.6, 5.8).', 'not a Supporter';
  assert pg_temp.try_as(sec, format(appoint, '00000000-0000-0000-0000-0000000000a4', west, 'road_captain'))
    = 'Nomads can’t hold a board or national seat (9.1).', 'no board seat for a Nomad';
  assert pg_temp.try_as(chair, format(appoint, '00000000-0000-0000-0000-0000000000a4', null, 'nec_secretary'))
    = 'Nomads can’t hold a board or national seat (9.1).', 'nor a national one';
  assert pg_temp.try_as(sec, format(appoint, '00000000-0000-0000-0000-0000000000a4', west, 'officer')) is null, 'a Nomad can be an Officer';
  assert pg_temp.try_as(chair, format(appoint, '00000000-0000-0000-0000-0000000000b1', null, 'nec_auditor'))
    = 'The National Auditor can’t also be a President or Treasurer (11.8).', 'a Treasurer isn''t the Auditor';
  assert pg_temp.try_as(chair, format(appoint, '00000000-0000-0000-0000-0000000000a3', null, 'nec_auditor')) is null, 'Rita audits';
  assert pg_temp.try_as(chair, format(appoint, '00000000-0000-0000-0000-0000000000a3', west, 'president'))
    = 'The National Auditor can’t also be a President or Treasurer (11.8).', 'and so can''t be President';
end $$;

\echo 'An FNG goes Full only after a carried patch vote; only the NEC brings anyone else back'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  chair constant uuid := '00000000-0000-0000-0000-0000000000a2';
  fred constant uuid := '00000000-0000-0000-0000-0000000000a6';
  west uuid := (select id from chapters where slug = 'west');
  status text := 'select public.set_member_status(%L, %L)';
begin
  assert pg_temp.try_as(sec, format(status, fred, 'full'))
    = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).', 'no vote yet';
  insert into votes (chapter_id, subject_member_id, question, electorate, threshold, secret, quorum, closes_at, closed_at, result)
  values (west, fred, 'Patch Fred?', 'chapter_patched', 'unanimous', true, 1, now() - interval '1 day', now() - interval '1 day', 'lost');
  assert pg_temp.try_as(sec, format(status, fred, 'full'))
    = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).', 'a lost vote doesn''t count';
  insert into votes (chapter_id, subject_member_id, question, electorate, threshold, secret, quorum, opened_at, closes_at, closed_at, result)
  values (west, fred, 'Patch Fred, last time?', 'chapter_patched', 'unanimous', true, 1, now() - interval '2 years',
          now() - interval '2 years', now() - interval '2 years', 'carried');
  assert pg_temp.try_as(sec, format(status, fred, 'full'))
    = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).', 'a vote from an earlier trial doesn''t count';
  assert pg_temp.try_as(sec, format(status, '00000000-0000-0000-0000-0000000000a9', 'full'))
    = 'Only the NEC can bring someone back to Full or Nomad (5.6).', 'the board can''t reinstate';
  assert pg_temp.try_as(chair, format(status, '00000000-0000-0000-0000-0000000000a9', 'full')) is null, 'the NEC can';
  assert pg_temp.try_as(sec, format(status, '00000000-0000-0000-0000-0000000000b1', 'nomad'))
    = 'End their board and national seats first (9.1).', 'the Treasurer can''t go Nomad with the seat';
  assert pg_temp.try_as(chair, format(status, sec, 'supporter')) = 'End their positions first.', 'positions end first';
  assert pg_temp.try_as(sec, format(status, '00000000-0000-0000-0000-0000000000a5', 'fng'))
    = 'A learner permit rider can’t become an FNG yet (3.2).', 'no learner FNGs';
end $$;

\echo 'A learner permit applicant can''t be let in as an FNG'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  lee constant uuid := '00000000-0000-0000-0000-0000000000a8';
begin
  assert pg_temp.try_as(sec, format($q$select public.decide_application(%L, 'fng', 5, 0, 0, null)$q$, lee))
    = 'A learner permit rider can’t become an FNG yet (3.2).', 'decide';
  assert pg_temp.try_as(sec, format($q$select public.approve_member(%L, 'fng')$q$, lee))
    = 'A learner permit rider can’t become an FNG yet (3.2).', 'approve';
  assert pg_temp.try_as(sec, format($q$select public.decide_application(%L, 'introduced', 5, 0, 0, null)$q$, lee)) is null, 'introduced is fine';
end $$;

\echo 'A Patch review needs nine months and a carried patch vote'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  fred constant uuid := '00000000-0000-0000-0000-0000000000a6';
  yuri constant uuid := '00000000-0000-0000-0000-0000000000a7';
  west uuid := (select id from chapters where slug = 'west');
  review text := $q$select public.record_fng_review(%L, %s, 'patch', 6, 0, 0, null)$q$;
begin
  -- Yuri is seven months in: the 6-month review is the one due.
  assert pg_temp.try_as(sec, format(review, yuri, 6)) = 'Full Membership can’t be granted before nine months (4.7).', 'too early';
  assert pg_temp.try_as(sec, format(review, fred, 12))
    = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).', 'the board''s tally isn''t enough';
  insert into votes (chapter_id, subject_member_id, question, electorate, threshold, secret, quorum, closes_at, closed_at, result)
  values (west, fred, 'Patch Fred?', 'chapter_patched', 'unanimous', true, 1, now() - interval '1 hour', now() - interval '1 hour', 'carried');
  assert pg_temp.try_as(sec, format(review, fred, 12)) is null, 'patched after the vote';
  assert (select status from members where id = fred) = 'full', 'Fred is Full';
end $$;

\echo 'The continuation fee is half the FNG fee, charged once ever, and nobody types it in'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  tre constant uuid := '00000000-0000-0000-0000-0000000000b1';
  west uuid := (select id from chapters where slug = 'west');
  fy int := private.fy_of(private.club_date());
  zed uuid := '00000000-0000-0000-0000-0000000000c1';
begin
  assert pg_temp.try_as(tre, format('select public.set_continuation_fee(%L, %s, 5000)', west, fy))
    = 'The continuation fee is half the FNG fee (4.11), so the app works it out.', 'not by hand';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a3', format('select public.set_continuation_fee(%L, %s, 5000)', west, fy))
    = 'Only that chapter’s board sets its fees.', 'not a member either';
  assert pg_temp.try_as(tre, format($q$select public.set_fee_rate(%L, %s, 'fng', 25001, %L)$q$, west, fy, private.club_date() + 30)) is null, 'FNG fee';

  insert into auth.users (id, email, email_confirmed_at) values (zed, 'zed@example.com', now());
  insert into members (id, chapter_id, full_name, status, approval, fng_started_on)
  values (zed, west, 'Zed Long', 'fng', 'approved', (private.club_date() - interval '15 months')::date);
  -- Zed already paid a continuation fee in an earlier year, and his 12-month review is on file.
  insert into member_decisions (member_id, kind, at_months, outcome, decided_on) values (zed, 'fng_review', 12, 'continue', private.club_date() - 90);
  insert into charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on)
  values (zed, west, fy - 1, 'continuation', 'FNG continuation fee', 9000, private.club_date() - 60);
  assert pg_temp.try_as(sec, format($q$select public.record_fng_review(%L, 15, 'continue', 6, 0, 0, null)$q$, zed)) is null, 'reviewed at 15';
  assert (select count(*) from charges where member_id = zed and kind = 'continuation') = 1, 'paid once, not again';

  delete from charges where member_id = zed;
  delete from member_decisions where member_id = zed and at_months = 15;
  assert pg_temp.try_as(sec, format($q$select public.record_fng_review(%L, 15, 'continue', 6, 0, 0, null)$q$, zed)) is null, 'reviewed at 15 again';
  assert (select amount_cents from charges where member_id = zed and kind = 'continuation') = 12500, 'half of $250.01, rounded down';
end $$;

\echo 'Meetings need v4''s notice when they''re called or moved earlier'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  chair constant uuid := '00000000-0000-0000-0000-0000000000a2';
  west uuid := (select id from chapters where slug = 'west');
  save text := $q$select public.save_meeting(%L, %L, %L, 'Meeting', %L, null, '[]')$q$;
  m uuid;
begin
  assert pg_temp.try_as(sec, format(save, null, west, 'general', now() + interval '6 days'))
    = 'A chapter meeting needs 7 days’ notice (10.4).', 'chapter meeting, 6 days';
  assert pg_temp.try_as(sec, format(save, null, west, 'general', now() + interval '7 days 1 minute')) is null, '7 days is enough';
  assert pg_temp.try_as(sec, format(save, null, west, 'agm', now() + interval '10 days'))
    = 'An Annual Chapter Meeting needs 14 days’ notice (10.4).', 'ACM';
  assert pg_temp.try_as(sec, format(save, null, west, 'board', now() + interval '1 day')) is null, 'no notice rule for a board meeting';
  assert pg_temp.try_as(sec, format(save, null, west, 'general', now() - interval '3 days')) is null, 'a past meeting is a record';
  assert pg_temp.try_as(chair, format(save, null, null, 'agm', now() + interval '13 days'))
    = 'The Association AGM needs 14 days’ notice (10.4).', 'Association AGM';
  assert pg_temp.try_as(chair, format(save, null, null, 'special', now() + interval '13 days'))
    = 'A National Club meeting needs 14 days’ notice (10.4).', 'national special';
  assert pg_temp.try_as(chair, format(save, null, null, 'nec', now() + interval '1 day')) is null, 'an urgent NEC meeting is allowed';

  insert into meetings (chapter_id, kind, title, starts_at, created_by)
  values (west, 'general', 'Called last week', now() + interval '5 days', sec) returning id into m;
  assert pg_temp.try_as(sec, format(save, m, west, 'general', now() + interval '5 days')) is null, 'editing a meeting already called';
  assert pg_temp.try_as(sec, format(save, m, west, 'general', now() + interval '6 days')) is null, 'moving it later';
  assert pg_temp.try_as(sec, format(save, m, west, 'general', now() + interval '4 days'))
    = 'A chapter meeting needs 7 days’ notice (10.4).', 'moving it earlier';
  assert pg_temp.try_as(sec, format(save, m, west, 'agm', now() + interval '5 days'))
    = 'An Annual Chapter Meeting needs 14 days’ notice (10.4).', 'turning it into an ACM';
  update meetings set starts_at = now() - interval '7 days' where id = m;
  assert pg_temp.try_as(sec, format(save, m, west, 'general', now() + interval '2 days'))
    = 'A chapter meeting needs 7 days’ notice (10.4).', 'bringing a past meeting forward';
end $$;

\echo 'CONSTITUTION V4 CHECKS PASSED'
