-- Checks the Big 4 RSVP rules and the 5.5 notice beyond the shared parity cases: which meetings
-- 5.4 counts (same-day order, excused ones, events, special meetings, meetings still to come), who
-- can read the new tables, and that nothing is written except through the actions.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'sam@example.com', now()),   -- West Secretary
  ('00000000-0000-0000-0000-0000000000a2', 'fran@example.com', now()),  -- West Full
  ('00000000-0000-0000-0000-0000000000a3', 'nora@example.com', now()),  -- North Full
  ('00000000-0000-0000-0000-0000000000a4', 'nick@example.com', now());  -- North Secretary

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', 'approved'
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'west', 'Sam Secretary'),
  ('00000000-0000-0000-0000-0000000000a2', 'west', 'Fran Full'),
  ('00000000-0000-0000-0000-0000000000a3', 'north', 'Nora North'),
  ('00000000-0000-0000-0000-0000000000a4', 'north', 'Nick Secretary')
) as v(id, slug, name)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, 'secretary'
from (values ('00000000-0000-0000-0000-0000000000a1', 'west'), ('00000000-0000-0000-0000-0000000000a4', 'north')) as v(id, slug)
join chapters c on c.slug = v.slug;

insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-00000000bb01', 'app', now() + interval '30 days', 'Not Dead Yet Run', 'club');
insert into big4_rides (ride_id) values ('00000000-0000-0000-0000-00000000bb01');

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

-- A West meeting check-in, `days` from today.
create function pg_temp.meeting(key text, days int, kind text default null) returns uuid language sql as $$
  insert into checkin_sessions (id, kind, chapter_id, title, held_on, code, meeting_type)
  values (md5(key)::uuid, 'meeting', (select id from chapters where slug = 'west'), key, private.club_date() + days, upper(left(md5(key), 6)), kind)
  returning id;
$$;

\o
\echo '5.4 counts the three most recent official meetings: same-day ones they came to first, excused ones skipped'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000a2';
  ride constant uuid := '00000000-0000-0000-0000-00000000bb01';
begin
  perform pg_temp.meeting('old', -60);
  perform pg_temp.meeting('a', -10);
  perform pg_temp.meeting('b', -10);
  perform pg_temp.meeting('c', -10);
  perform pg_temp.meeting('d', -10);
  perform pg_temp.meeting('bbq', -5, 'event');
  perform pg_temp.meeting('next', 5);
  -- Four on one day; she came to two. Whatever order the ids fall in, the two she came to count.
  insert into attendance (session_id, member_id) values (md5('a')::uuid, fran), (md5('d')::uuid, fran), (md5('bbq')::uuid, fran);
  assert private.big4_problem(fran, ride, false) is null, 'two of the last three (same-day ones she came to first)';
  delete from attendance where session_id = md5('d')::uuid;
  assert private.big4_problem(fran, ride, false)
    = 'You need 2 of the last 3 meetings to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.',
    'one of three; the BBQ (an event) and next week''s meeting don''t count';
  -- Excused from two she missed: the three become a, then old (the rest on the day are excused away or missed).
  insert into attendance_exemptions (session_id, member_id, reason) values (md5('b')::uuid, fran, 'Work'), (md5('c')::uuid, fran, 'Work');
  assert private.big4_problem(fran, ride, false)
    = 'You need 2 of the last 3 meetings to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.',
    'still d missed';
  insert into attendance_exemptions (session_id, member_id, reason) values (md5('d')::uuid, fran, 'Work');
  assert private.big4_problem(fran, ride, false)
    = 'You need 2 of the last 2 meetings to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.',
    'a and old are the only two left';
  assert private.big4_problem(fran, ride, true) = 'They need 2 of the last 2 meetings to ride this Big 4 (5.4).', 'crew wording';
  insert into attendance (session_id, member_id) values (md5('old')::uuid, fran);
  assert private.big4_problem(fran, ride, false) is null, 'both now';
  -- A special meeting counts; one held after the ride doesn't.
  perform pg_temp.meeting('special', -1, 'special');
  assert private.big4_problem(fran, ride, false) is null, 'two of special, a, old';
end $$;

\echo 'One meeting held: that one is needed'
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000a3';
  ride constant uuid := '00000000-0000-0000-0000-00000000bb01';
begin
  insert into checkin_sessions (id, kind, chapter_id, title, held_on, code)
  values (md5('north')::uuid, 'meeting', (select id from chapters where slug = 'north'), 'North', private.club_date() - 3, 'NORTH1');
  assert private.big4_problem(nora, ride, false)
    = 'You need the last meeting to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.', 'the last meeting';
end $$;

\echo 'Excuses and notices: the member and their chapter board read them; nobody writes them directly'
do $$
declare
  sam constant uuid := '00000000-0000-0000-0000-0000000000a1';
  fran constant uuid := '00000000-0000-0000-0000-0000000000a2';
  nora constant uuid := '00000000-0000-0000-0000-0000000000a3';
  nick constant uuid := '00000000-0000-0000-0000-0000000000a4';
  ride constant uuid := '00000000-0000-0000-0000-00000000bb01';
  err text;
begin
  assert pg_temp.try_as(sam, format('select set_big4_waiver(%L, %L, %L)', ride, fran, 'work')) is null, 'excused';
  assert (select ground = 'work' and granted_by = sam from big4_waivers where member_id = fran), 'stored';
  assert pg_temp.try_as(sam, format('select give_status_notice(%L, %L, %L, %L, %L)', fran, 'attendance', E'  Meetings 1 of 6\n', ' Supporter ', private.club_date() + 14)) is null, 'given';
  assert (select record = 'Meetings 1 of 6' and proposal = 'Supporter' and chapter_id = (select id from chapters where slug = 'west')
          and given_by = sam and given_on = private.club_date() from status_notices where member_id = fran), 'trimmed and stored';

  assert pg_temp.count_as(fran, 'big4_waivers') = 1 and pg_temp.count_as(fran, 'status_notices') = 1, 'the member reads their own';
  assert pg_temp.count_as(sam, 'big4_waivers') = 1 and pg_temp.count_as(sam, 'status_notices') = 1, 'their board reads them';
  assert pg_temp.count_as(nora, 'big4_waivers') = 0 and pg_temp.count_as(nora, 'status_notices') = 0, 'another member doesn''t';
  assert pg_temp.count_as(nick, 'big4_waivers') = 0 and pg_temp.count_as(nick, 'status_notices') = 0, 'another chapter''s board doesn''t';
  assert pg_temp.count_as(null, 'status_notices') = -1, 'anon can''t';

  err := pg_temp.try_as(sam, format('insert into big4_waivers (ride_id, member_id, ground) values (%L, %L, %L)', ride, nora, 'work'));
  assert err like 'permission denied%', format('no direct insert, not %s', err);
  err := pg_temp.try_as(fran, 'update status_notices set outcome = ''withdrawn''');
  assert err like 'permission denied%', format('no direct update, not %s', err);
  err := pg_temp.try_as(sam, 'delete from status_notices');
  assert err like 'permission denied%', format('no direct delete, not %s', err);
  err := pg_temp.try_as(fran, format('select private.big4_problem(%L, %L, false)', fran, ride));
  assert err like 'permission denied%', format('the helper is private, not %s', err);

  -- Reply, then the board records its decision only after the respond-by date.
  assert pg_temp.try_as(fran, format('select respond_to_notice(id, %L) from status_notices where member_id = %L', ' I was away for work. ', fran)) is null, 'replied';
  assert (select response = 'I was away for work.' and responded_at is not null from status_notices where member_id = fran), 'reply stored';
  err := pg_temp.try_as(sam, format('select close_status_notice(id, %L, %L) from status_notices where member_id = %L', 'decided', '', fran));
  assert err = format('The board decides after %s (5.5).', to_char(private.club_date() + 14, 'DD/MM/YYYY')), err;
  assert pg_temp.try_as(sam, format('select close_status_notice(id, %L, %L) from status_notices where member_id = %L', 'withdrawn', '  ', fran)) is null, 'withdrawn';
  assert (select outcome = 'withdrawn' and outcome_note is null and closed_by = sam and closed_on = private.club_date() from status_notices where member_id = fran), 'closed';
  -- Closed, so a new one about the same thing can be given.
  assert pg_temp.try_as(sam, format('select give_status_notice(%L, %L, %L, %L, %L)', fran, 'attendance', 'Meetings', 'Supporter', private.club_date() + 30)) is null, 'a fresh notice';
end $$;

\echo 'BIG 4 RSVP RULES AND NOTICES PASSED'
