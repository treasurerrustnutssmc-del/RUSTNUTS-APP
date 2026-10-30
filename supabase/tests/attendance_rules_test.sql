-- Checks Big 4 designations, meeting categories and exemptions: designate_big4, undesignate_big4,
-- set_meeting_type and set_exemption, with the refusals in the same words and order as
-- src/domain/big4.ts and src/domain/attendance.ts; who can read the new tables; and that nothing is
-- written except through the actions.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'cara@example.com', now()),  -- NEC Chairman (North)
  ('00000000-0000-0000-0000-0000000000c2', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-0000000000c3', 'sam@example.com', now()),   -- West Secretary
  ('00000000-0000-0000-0000-0000000000c4', 'nora@example.com', now()),  -- North Road Captain
  ('00000000-0000-0000-0000-0000000000c5', 'fran@example.com', now()),  -- West Full
  ('00000000-0000-0000-0000-0000000000c6', 'fergus@example.com', now()), -- West FNG
  ('00000000-0000-0000-0000-0000000000c7', 'ned@example.com', now()),   -- National Secretary (North)
  ('00000000-0000-0000-0000-0000000000c8', 'al@example.com', now());    -- National Auditor (North)

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, 'approved'
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'north', 'Cara Chair', 'full'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Wes President', 'full'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Sam Secretary', 'full'),
  ('00000000-0000-0000-0000-0000000000c4', 'north', 'Nora Captain', 'full'),
  ('00000000-0000-0000-0000-0000000000c5', 'west', 'Fran Full', 'full'),
  ('00000000-0000-0000-0000-0000000000c6', 'west', 'Fergus FNG', 'fng'),
  ('00000000-0000-0000-0000-0000000000c7', 'north', 'Ned National', 'full'),
  ('00000000-0000-0000-0000-0000000000c8', 'north', 'Al Auditor', 'full')
) as v(id, slug, name, status)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000c1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000c4', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000c7', null, 'nec_secretary'),
  ('00000000-0000-0000-0000-0000000000c8', null, 'nec_auditor')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;

insert into rides (id, source, starts_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000dd01', 'app', now() + interval '20 days', 'Not Dead Yet Run', 'club', null),
  ('00000000-0000-0000-0000-00000000dd02', 'app', now() + interval '21 days', 'Rained out', 'club', now()),
  ('00000000-0000-0000-0000-00000000dd03', 'app', now() + interval '22 days', 'Ride for Kids', 'supported', null),
  ('00000000-0000-0000-0000-00000000dd04', 'app', now() - interval '3 days', 'Last week', 'west', null),
  ('00000000-0000-0000-0000-00000000dd05', 'app', now() + interval '30 days', 'West Big 4', 'west', null);

insert into checkin_sessions (id, kind, chapter_id, ride_id, title, held_on, code) values
  ('00000000-0000-0000-0000-00000000ee01', 'meeting', (select id from chapters where slug = 'west'), null, 'Monthly', private.club_date() + 7, 'AAAAA1'),
  ('00000000-0000-0000-0000-00000000ee02', 'meeting', (select id from chapters where slug = 'west'), null, 'Last month', private.club_date() - 20, 'AAAAA2'),
  ('00000000-0000-0000-0000-00000000ee03', 'ride', null, '00000000-0000-0000-0000-00000000dd04', 'Last week', private.club_date() - 3, 'AAAAA3');
insert into attendance (session_id, member_id) values
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000c5');

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

create function pg_temp.count_as(who uuid, tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute format('select count(*) from %s', tbl) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

\o
\echo 'Big 4: the Chair, a President or the National Secretary designate Club-only rides ahead of time'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  sam constant uuid := '00000000-0000-0000-0000-0000000000c3';
  ned constant uuid := '00000000-0000-0000-0000-0000000000c7';
  al constant uuid := '00000000-0000-0000-0000-0000000000c8';
  west uuid := (select id from chapters where slug = 'west');
  err text;
begin
  err := pg_temp.try_as(sam, 'select designate_big4(''00000000-0000-0000-0000-00000000dd01'', null)');
  assert err = 'Only the NEC designates Big 4 rides (5.11).', format('a Secretary is refused, not %s', err);
  err := pg_temp.try_as(al, 'select designate_big4(''00000000-0000-0000-0000-00000000dd01'', null)');
  assert err = 'Only the NEC designates Big 4 rides (5.11).', format('the Auditor is refused, not %s', err);
  err := pg_temp.try_as(null, 'select designate_big4(''00000000-0000-0000-0000-00000000dd01'', null)');
  assert err like 'permission denied%', format('anon can''t call it, not %s', err);
  err := pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-0000000000ff'', null)');
  assert err = 'No such ride.', err;
  err := pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-00000000dd02'', null)');
  assert err = 'That ride was cancelled.', err;
  err := pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-00000000dd03'', null)');
  assert err = 'Big 4 rides are Club-only: pick a club, North or West ride.', err;
  err := pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-00000000dd04'', null)');
  assert err = 'A Big 4 is designated before the ride, not after (5.11).', err;
  err := pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-00000000dd01'', ''00000000-0000-0000-0000-0000000000ff'')');
  assert err = 'No such chapter.', err;

  assert pg_temp.try_as(cara, 'select designate_big4(''00000000-0000-0000-0000-00000000dd01'', null)') is null, 'the Chair designates';
  assert pg_temp.try_as(ned, format('select designate_big4(%L, %L)', '00000000-0000-0000-0000-00000000dd05', west)) is null, 'the National Secretary designates';
  assert pg_temp.try_as(wes, 'select designate_big4(''00000000-0000-0000-0000-00000000dd05'', null)') is null, 'a President changes it';
  assert (select chapter_id is null and designated_by = wes from big4_rides where ride_id = '00000000-0000-0000-0000-00000000dd05'),
    'designating again changes the chapter and who did it';
  assert (select count(*) from big4_rides) = 2, 'two Big 4s';

  -- A past designation (put in directly) can't be removed.
  insert into big4_rides (ride_id) values ('00000000-0000-0000-0000-00000000dd04');
  err := pg_temp.try_as(cara, 'select undesignate_big4(''00000000-0000-0000-0000-00000000dd04'')');
  assert err = 'A Big 4 is designated before the ride, not after (5.11).', err;
  err := pg_temp.try_as(sam, 'select undesignate_big4(''00000000-0000-0000-0000-00000000dd01'')');
  assert err = 'Only the NEC designates Big 4 rides (5.11).', err;
  err := pg_temp.try_as(cara, 'select undesignate_big4(''00000000-0000-0000-0000-00000000dd03'')');
  assert err = 'That ride isn’t a Big 4.', err;
  assert pg_temp.try_as(cara, 'select undesignate_big4(''00000000-0000-0000-0000-00000000dd05'')') is null, 'the Chair removes one';
  assert not exists (select 1 from big4_rides where ride_id = '00000000-0000-0000-0000-00000000dd05'), 'gone';
end $$;

\echo 'Meeting kinds: set by the runners, on meetings only, before they are held'
do $$
declare
  sam constant uuid := '00000000-0000-0000-0000-0000000000c3';
  nora constant uuid := '00000000-0000-0000-0000-0000000000c4';
  err text;
begin
  err := pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-0000000000ff'', ''event'')');
  assert err = 'That check-in no longer exists.', err;
  err := pg_temp.try_as(nora, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee01'', ''event'')');
  assert err = 'Only that chapter’s board can run this check-in.', err;
  err := pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee03'', ''event'')');
  assert err = 'Only a meeting check-in has a kind.', err;
  err := pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee01'', ''bbq'')');
  assert err = 'Pick what kind of meeting it is.', err;
  err := pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee02'', ''event'')');
  assert err = 'A meeting’s kind is set before the day it’s held (4.6).', err;
  insert into checkin_sessions (id, kind, chapter_id, title, held_on, code) values
    ('00000000-0000-0000-0000-00000000ee04', 'meeting', (select id from chapters where slug = 'west'), 'Tonight', private.club_date(), 'AAAAA4');
  err := pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee04'', ''event'')');
  assert err = 'A meeting’s kind is set before the day it’s held (4.6).', format('not on the day: %s', err);
  -- Opening and classifying in one go; a bad kind opens nothing.
  err := pg_temp.try_as(sam, format('select open_checkin(%L, null, %L, %L, %L, %L)', 'meeting', (select id from chapters where slug = 'west'), 'Barbie', private.club_date() + 3, 'bbq'));
  assert err = 'Pick what kind of meeting it is.', err;
  assert not exists (select 1 from checkin_sessions where title = 'Barbie'), 'nothing opened';
  assert pg_temp.try_as(sam, format('select open_checkin(%L, null, %L, %L, %L, %L)', 'meeting', (select id from chapters where slug = 'west'), 'Barbie', private.club_date() + 3, 'event')) is null, 'opened';
  assert (select meeting_type from checkin_sessions where title = 'Barbie') = 'event', 'as an event';
  assert pg_temp.try_as(sam, format('select open_checkin(%L, null, %L, %L, %L)', 'meeting', (select id from chapters where slug = 'west'), 'Plain', private.club_date() + 3)) is null, 'the old five still works';
  assert (select meeting_type from checkin_sessions where title = 'Plain') is null, 'as ordinary';
  assert pg_temp.try_as(sam, 'select set_meeting_type(''00000000-0000-0000-0000-00000000ee01'', ''special'')') is null, 'set';
  assert (select meeting_type from checkin_sessions where id = '00000000-0000-0000-0000-00000000ee01') = 'special', 'stored';
  begin
    update checkin_sessions set meeting_type = 'event' where id = '00000000-0000-0000-0000-00000000ee03';
    assert false, 'a ride can''t have a meeting kind';
  exception when check_violation then null;
  end;
end $$;

\echo 'Exemptions: their chapter board excuses, never themselves, not when they came; a blank reason clears'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  sam constant uuid := '00000000-0000-0000-0000-0000000000c3';
  nora constant uuid := '00000000-0000-0000-0000-0000000000c4';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c5';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000c6';
  err text;
begin
  err := pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-0000000000ff', fergus, 'Work'));
  assert err = 'That check-in no longer exists.', err;
  err := pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000ff', 'Work'));
  assert err = 'That member no longer exists.', err;
  err := pg_temp.try_as(nora, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fergus, 'Work'));
  assert err = 'Only their chapter’s board can excuse them.', err;
  err := pg_temp.try_as(fran, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fergus, 'Work'));
  assert err = 'Only their chapter’s board can excuse them.', err;
  err := pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', sam, 'Work'));
  assert err = 'Someone else on the board has to excuse you.', err;
  err := pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fran, 'Work'));
  assert err = 'They checked in, so there’s nothing to excuse.', err;

  assert pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fergus, '  Work trip ')) is null, 'excused';
  assert (select reason = 'Work trip' and granted_by = sam from attendance_exemptions where member_id = fergus), 'trimmed, with who';
  err := pg_temp.try_as(cara, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fergus, 'Injury'));
  assert err = 'Only their chapter’s board can excuse them.', coalesce(err, 'the Chairman excused a West member without a West seat');
  assert pg_temp.try_as(wes, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee02', fergus, 'Injury')) is null, 'another West board member changes it';
  assert (select reason = 'Injury' and granted_by = wes from attendance_exemptions where member_id = fergus), 'changed';
  assert pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee03', fergus, 'Bike broke down')) is null, 'excused from a ride';

  -- Who can see them: the member and their chapter board, not other members or other chapters.
  assert pg_temp.count_as(fergus, 'attendance_exemptions') = 2, 'the member sees their own';
  assert pg_temp.count_as(sam, 'attendance_exemptions') = 2, 'their board sees them';
  assert pg_temp.count_as(fran, 'attendance_exemptions') = 0, 'another member doesn''t';
  assert pg_temp.count_as(nora, 'attendance_exemptions') = 0, 'another chapter''s board doesn''t';
  assert pg_temp.count_as(null, 'attendance_exemptions') = -1, 'anon can''t';
  assert pg_temp.count_as(fran, 'big4_rides') = 2, 'members see the Big 4s';
  assert pg_temp.count_as(null, 'big4_rides') = -1, 'anon can''t';

  assert pg_temp.try_as(sam, format('select set_exemption(%L, %L, %L)', '00000000-0000-0000-0000-00000000ee03', fergus, ' ')) is null, 'a blank reason clears';
  assert (select count(*) from attendance_exemptions where member_id = fergus) = 1, 'one left';

  -- Nothing is written directly.
  err := pg_temp.try_as(sam, format('insert into attendance_exemptions (session_id, member_id, reason) values (%L, %L, %L)', '00000000-0000-0000-0000-00000000ee01', fergus, 'x'));
  assert err like 'permission denied%', err;
  err := pg_temp.try_as(cara, 'insert into big4_rides (ride_id) values (''00000000-0000-0000-0000-00000000dd05'')');
  assert err like 'permission denied%', err;
  err := pg_temp.try_as(sam, 'update checkin_sessions set meeting_type = ''event''');
  assert err like 'permission denied%', err;
end $$;
\echo 'Attendance rules checks passed'
