-- Checks "I'm here" check-in: ask_check_in and answer_check_in, the refusals in the app's words and
-- order (src/domain/attendance.ts), the check-in opening itself at a ride, who hears (the push), who
-- reads checkin_requests, and that any check-in clears the wait.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000009a1', 'wes@example.com', now()),   -- West President, going
  ('00000000-0000-0000-0000-0000000009a2', 'sam@example.com', now()),   -- West Secretary, not going
  ('00000000-0000-0000-0000-0000000009a3', 'rick@example.com', now()),  -- Full, Road Captain on the ride's crew
  ('00000000-0000-0000-0000-0000000009a4', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000009a5', 'fran@example.com', now()),  -- Family
  ('00000000-0000-0000-0000-0000000009a6', 'ivy@example.com', now()),   -- Introduced applicant
  ('00000000-0000-0000-0000-0000000009a7', 'nora@example.com', now()),  -- North Secretary
  ('00000000-0000-0000-0000-0000000009a8', 'ollie@example.com', now());  -- Full, took an Officer spot on the day

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'Wes West', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a2', 'west', 'Sam Sec', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a3', 'west', 'Rick Captain', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a4', 'west', 'Nell Member', 'Cobra', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a5', 'west', 'Fran Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000009a6', 'west', 'Ivy Intro', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000009a7', 'north', 'Nora North', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a8', 'west', 'Ollie Officer', null, 'full', 'approved')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01'
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000009a2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000009a7', 'north', 'secretary')
) as v(id, slug, role);

-- Rides today (club time), one later, one called off; a West meeting today.
insert into rides (id, source, starts_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000c901', 'app', (private.club_date() + time '12:00') at time zone 'Australia/Melbourne', 'West run', 'west', null),
  ('00000000-0000-0000-0000-00000000c902', 'app', (private.club_date() + 5 + time '12:00') at time zone 'Australia/Melbourne', 'Later run', 'west', null),
  ('00000000-0000-0000-0000-00000000c903', 'app', (private.club_date() + time '12:00') at time zone 'Australia/Melbourne', 'Rained out', 'west', now()),
  ('00000000-0000-0000-0000-00000000c904', 'app', (private.club_date() + time '12:00') at time zone 'Australia/Melbourne', 'Nobody about', 'west', null);
insert into ride_crew (ride_id, member_id, role) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a3', 'road_captain'),
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a5', 'tail_gunner'),
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a8', 'officer');
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a1', 'going'),
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a2', 'no');
insert into checkin_sessions (id, kind, chapter_id, ride_id, title, held_on, code, opened_by) values
  ('00000000-0000-0000-0000-00000000ce01', 'meeting', (select id from chapters where slug = 'west'), null, 'Monthly', private.club_date(), 'IMHER1',
   '00000000-0000-0000-0000-0000000009a2'),
  ('00000000-0000-0000-0000-00000000ce02', 'meeting', (select id from chapters where slug = 'west'), null, 'Next month', private.club_date() + 20, 'IMHER2', null),
  ('00000000-0000-0000-0000-00000000ce03', 'meeting', (select id from chapters where slug = 'west'), null, 'Shut', private.club_date(), 'IMHER3', null);
update checkin_sessions set closed_at = now() where id = '00000000-0000-0000-0000-00000000ce03';

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

create function pg_temp.count_as(who uuid, stmt text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

\o
\echo 'I''m here: asking, confirming, who hears and who reads, in the app''s words and order'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000009a1';
  sam constant uuid := '00000000-0000-0000-0000-0000000009a2';
  rick constant uuid := '00000000-0000-0000-0000-0000000009a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  fran constant uuid := '00000000-0000-0000-0000-0000000009a5';
  ivy constant uuid := '00000000-0000-0000-0000-0000000009a6';
  nora constant uuid := '00000000-0000-0000-0000-0000000009a7';
  ollie constant uuid := '00000000-0000-0000-0000-0000000009a8';
  run constant text := '00000000-0000-0000-0000-00000000c901';
  sess uuid;
  heard text;
begin
  -- Refusals, in order.
  assert pg_temp.try_as(null, format('select public.ask_check_in(%L, null)', run)) like 'permission denied%', 'anon can''t';
  assert pg_temp.try_as(fran, format('select public.ask_check_in(%L, null)', run)) = 'Only members and applicants can check in.', 'Family';
  assert pg_temp.try_as(nell, format('select public.ask_check_in(%L, null)', gen_random_uuid())) = 'No such ride.', 'no ride';
  assert pg_temp.try_as(nell, $q$select public.ask_check_in('00000000-0000-0000-0000-00000000c903', null)$q$) = 'That ride was cancelled.', 'called off';
  assert pg_temp.try_as(nell, $q$select public.ask_check_in('00000000-0000-0000-0000-00000000c902', null)$q$) = 'You can only check in on the day.', 'not today';
  assert not exists (select 1 from checkin_sessions where ride_id = '00000000-0000-0000-0000-00000000c902'), 'nothing opened for a later ride';
  assert pg_temp.try_as(nell, format('select public.ask_check_in(null, %L)', gen_random_uuid())) = 'That check-in no longer exists.', 'no session';
  assert pg_temp.try_as(nell, $q$select public.ask_check_in(null, '00000000-0000-0000-0000-00000000ce02')$q$) = 'You can only check in on the day.', 'meeting later';
  assert pg_temp.try_as(nell, $q$select public.ask_check_in(null, '00000000-0000-0000-0000-00000000ce03')$q$) = 'That check-in has closed.', 'closed';

  -- Nell says she's here: the ride's check-in opens itself, and she waits.
  assert pg_temp.try_as(nell, format('select public.ask_check_in(%L, null)', run)) is null, 'Nell asks';
  select id into sess from checkin_sessions where ride_id = run::uuid;
  assert sess is not null, 'the check-in opened itself';
  assert (select opened_by is null and kind = 'ride' and title = 'West run' and held_on = private.club_date()
            and chapter_id = (select id from chapters where slug = 'west') from checkin_sessions where id = sess), 'opened like the board would';
  assert exists (select 1 from checkin_requests where session_id = sess and member_id = nell), 'Nell is waiting';
  assert not exists (select 1 from attendance where session_id = sess and member_id = nell), 'not in yet';
  assert pg_temp.try_as(nell, format('select public.ask_check_in(%L, null)', run)) is null, 'asking twice is fine';
  assert (select count(*) from checkin_requests where session_id = sess) = 1, 'still one ask';

  -- Who hears: the crew (Rick, not Family Fran) and the board member going (Wes); not Sam (not going), not Nell.
  select string_agg(m.full_name, ',' order by m.full_name) into heard
  from private.push_outbox o join members m on m.id = o.member_id where o.dedupe_key like 'checkin:' || sess || ':%';
  assert heard = 'Rick Captain,Wes West', 'heard by: ' || coalesce(heard, 'nobody');
  assert (select title from private.push_outbox where member_id = wes and dedupe_key like 'checkin:%') = 'Cobra is here', 'the road name';
  assert (select data->>'kind' = 'checkin' and data->>'sessionId' = sess::text from private.push_outbox where member_id = wes and dedupe_key like 'checkin:%'), 'opens the check-in';

  -- Who reads the waits: Nell her own; the crew and the board; not another member or North.
  assert pg_temp.count_as(nell, 'select count(*) from public.checkin_requests') = 1, 'own';
  assert pg_temp.count_as(rick, 'select count(*) from public.checkin_requests') = 1, 'crew';
  assert pg_temp.count_as(sam, 'select count(*) from public.checkin_requests') = 1, 'board';
  assert pg_temp.count_as(nora, 'select count(*) from public.checkin_requests') = 0, 'not North''s board';
  assert pg_temp.count_as(ivy, 'select count(*) from public.checkin_requests') = 0, 'not another member';
  assert pg_temp.try_as(nell, format('insert into public.checkin_requests (session_id, member_id) values (%L, %L)', sess, ivy)) like 'permission denied%', 'only through the actions';

  -- Answering.
  assert pg_temp.try_as(nell, format('select public.answer_check_in(%L, %L, true)', gen_random_uuid(), nell)) = 'That check-in no longer exists.', 'no session';
  assert pg_temp.try_as(nell, format('select public.answer_check_in(%L, %L, true)', sess, nell)) = 'Only the ride crew or the board can confirm check-ins.', 'not herself';
  assert pg_temp.try_as(fran, format('select public.answer_check_in(%L, %L, true)', sess, nell)) = 'Only the ride crew or the board can confirm check-ins.', 'not Family crew';
  assert pg_temp.try_as(nora, format('select public.answer_check_in(%L, %L, true)', sess, nell)) = 'Only the ride crew or the board can confirm check-ins.', 'not North';
  assert pg_temp.try_as(ollie, format('select public.answer_check_in(%L, %L, true)', sess, nell)) = 'Only the ride crew or the board can confirm check-ins.', 'not an Officer spot';
  assert pg_temp.try_as(rick, format('select public.answer_check_in(%L, %L, true)', sess, ivy)) = 'They’re not waiting to be confirmed.', 'nobody waiting';
  assert pg_temp.try_as(rick, format('select public.answer_check_in(%L, %L, true)', sess, nell)) is null, 'Rick confirms Nell';
  assert (select marked_by from attendance where session_id = sess and member_id = nell) = rick, 'in, ticked off by Rick';
  assert not exists (select 1 from checkin_requests where session_id = sess), 'no longer waiting';
  assert pg_temp.try_as(nell, format('select public.ask_check_in(%L, null)', run)) is null, 'asking once in does nothing';
  assert not exists (select 1 from checkin_requests where session_id = sess), 'still nothing waiting';

  -- Ivy (an applicant) asks and is turned down: no attendance.
  assert pg_temp.try_as(ivy, format('select public.ask_check_in(null, %L)', sess)) is null, 'Ivy asks by the check-in';
  assert pg_temp.try_as(wes, format('select public.answer_check_in(%L, %L, false)', sess, ivy)) is null, 'Wes says not here';
  assert not exists (select 1 from attendance where session_id = sess and member_id = ivy), 'not in';
  assert not exists (select 1 from checkin_requests where session_id = sess and member_id = ivy), 'not waiting';

  -- The crew waits for someone else; the board goes straight in.
  assert pg_temp.try_as(rick, format('select public.ask_check_in(%L, null)', run)) is null, 'Rick';
  assert exists (select 1 from checkin_requests where session_id = sess and member_id = rick), 'Rick waits';
  assert pg_temp.try_as(rick, format('select public.answer_check_in(%L, %L, true)', sess, rick)) = 'Someone else has to confirm you.', 'not himself';
  update members set status = 'family' where id = ivy;
  assert pg_temp.try_as(ivy, format('select public.ask_check_in(%L, null)', run)) = 'Only members and applicants can check in.', 'Family can''t ask';
  update members set status = 'introduced' where id = ivy;
  assert pg_temp.try_as(ivy, format('select public.ask_check_in(%L, null)', run)) is null, 'Ivy asks again';
  update members set approval = 'declined' where id = ivy;
  assert pg_temp.try_as(wes, format('select public.answer_check_in(%L, %L, true)', sess, ivy)) = 'They can’t be checked in.', 'declined since';
  update members set approval = 'pending' where id = ivy;
  assert pg_temp.try_as(wes, format('select public.answer_check_in(%L, %L, true)', sess, rick)) is null, 'Wes confirms Rick';
  assert pg_temp.try_as(sam, format('select public.ask_check_in(%L, null)', run)) is null, 'Sam';
  assert exists (select 1 from attendance where session_id = sess and member_id = sam), 'Sam straight in';

  -- A meeting: the board member who opened it hears. A code check-in clears the wait.
  assert pg_temp.try_as(nell, $q$select public.ask_check_in(null, '00000000-0000-0000-0000-00000000ce01')$q$) is null, 'Nell at the meeting';
  select string_agg(m.full_name, ',' order by m.full_name) into heard
  from private.push_outbox o join members m on m.id = o.member_id where o.dedupe_key like 'checkin:00000000-0000-0000-0000-00000000ce01:%';
  assert heard = 'Sam Sec', 'meeting heard by: ' || coalesce(heard, 'nobody');
  assert pg_temp.try_as(nell, $q$select public.check_in('IMHER1')$q$) is null, 'the code still works';
  assert not exists (select 1 from checkin_requests where session_id = '00000000-0000-0000-0000-00000000ce01'), 'the code cleared the wait';

  -- Closing ends the wait, and nobody confirms on a closed check-in.
  assert exists (select 1 from checkin_requests where session_id = sess and member_id = ivy), 'Ivy still waiting';
  assert pg_temp.try_as(sam, format('select public.close_checkin(%L)', sess)) is null, 'closed';
  assert not exists (select 1 from checkin_requests where session_id = sess), 'closing cleared the waits';
  assert pg_temp.try_as(wes, format('select public.answer_check_in(%L, %L, true)', sess, ivy)) = 'That check-in has closed.', 'closed';

  -- A ride with nobody near: everyone who runs it hears (the West board).
  assert pg_temp.try_as(nell, $q$select public.ask_check_in('00000000-0000-0000-0000-00000000c904', null)$q$) is null, 'Nell at a quiet ride';
  select string_agg(m.full_name, ',' order by m.full_name) into heard
  from private.push_outbox o join members m on m.id = o.member_id
  where o.dedupe_key like 'checkin:' || (select id from checkin_sessions where ride_id = '00000000-0000-0000-0000-00000000c904') || ':%';
  assert heard = 'Sam Sec,Wes West', 'fallback heard by: ' || coalesce(heard, 'nobody');
end $$;
\o
\echo 'I''m here checks passed'
