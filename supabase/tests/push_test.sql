-- Checks the push outbox: who each event reaches, that settings decide, that nothing repeats, that
-- the master switch holds everything, and that only the send function can read it.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'rita@example.com', now()),   -- West, going
  ('00000000-0000-0000-0000-0000000000a2', 'tom@example.com', now()),    -- West, maybe, changes off
  ('00000000-0000-0000-0000-0000000000a3', 'ned@example.com', now()),    -- West, can't make it, new rides on
  ('00000000-0000-0000-0000-0000000000a4', 'nora@example.com', now()),   -- North, new rides on
  ('00000000-0000-0000-0000-0000000000a5', 'paul@example.com', now()),   -- West president
  ('00000000-0000-0000-0000-0000000000a6', 'pete@example.com', now());   -- applies to join

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, 'full', 'approved'
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Rita Rider', 'Rusty', 'west'),
  ('00000000-0000-0000-0000-0000000000a2', 'Tom Gunner', null, 'west'),
  ('00000000-0000-0000-0000-0000000000a3', 'Ned Nearby', null, 'west'),
  ('00000000-0000-0000-0000-0000000000a4', 'Nora North', null, 'north'),
  ('00000000-0000-0000-0000-0000000000a5', 'Paul Prez', null, 'west')
) as v(id, name, road, slug)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000a5', id, 'president', current_date from chapters where slug = 'west';

insert into notification_prefs (member_id, ride_changes, new_rides, approvals) values
  ('00000000-0000-0000-0000-0000000000a2', false, false, true),
  ('00000000-0000-0000-0000-0000000000a3', true, true, true),
  ('00000000-0000-0000-0000-0000000000a4', true, true, true);

-- 7/11/2026 8:30 am Melbourne is 2026-11-06 21:30 UTC; fixed so the copy can be checked.
insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-0000000000b1', 'app', '2026-11-06 21:30+00', 'West breakfast run', 'west'),
  ('00000000-0000-0000-0000-0000000000b2', 'app', now() - interval '2 days', 'Last week', 'west');
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'going'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'maybe'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'no'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'going');

create function pg_temp.try_as(who uuid, r text, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  execute format('set local role %I', r);
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
grant execute on function pg_temp.try_as(uuid, text, text) to anon, authenticated, service_role;

create function pg_temp.outbox(who uuid) returns text language sql as $$
  select string_agg(title || ' / ' || body, ' | ' order by id) from private.push_outbox where member_id = who
$$;

\o
\echo 'Ride changes reach going and maybe, by their settings, once'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000a2';
  ned constant uuid := '00000000-0000-0000-0000-0000000000a3';
begin
  delete from private.push_outbox; -- the set-up rides were new rides
  -- Touching a ride without changing its time or cancelling it (what a sync does) notifies nobody.
  update rides set title = 'West brekkie run', synced_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
  assert (select count(*) from private.push_outbox) = 0, 'a rename or re-sync is quiet';
  update rides set starts_at = '2026-11-06 22:00+00' where id = '00000000-0000-0000-0000-0000000000b1';
  assert pg_temp.outbox(rita) = 'Ride time changed / West brekkie run · now Sat 07/11/2026 9:00 am', pg_temp.outbox(rita);
  assert pg_temp.outbox(tom) is null, 'Tom turned ride changes off';
  assert pg_temp.outbox(ned) is null, 'Ned can''t make it';
  update rides set starts_at = '2026-11-06 22:00+00', synced_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
  assert (select count(*) from private.push_outbox where member_id = rita) = 1, 'the same time again is quiet';
  update rides set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
  update rides set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
  assert pg_temp.outbox(rita) like '% | Ride cancelled / West brekkie run · Sat 07/11/2026', pg_temp.outbox(rita);
  assert (select count(*) from private.push_outbox where member_id = rita) = 2, 'cancelled once';
  update rides set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000b2';
  assert (select count(*) from private.push_outbox where member_id = rita) = 2, 'a ride already over is quiet';
end $$;

\echo 'Nobody hears about their own change; nothing waits to be sent while the switch is off'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  r uuid;
begin
  delete from private.push_outbox;
  insert into rides (source, starts_at, title, category) values ('app', now() + interval '5 days', 'Hills run', 'north') returning id into r;
  insert into rsvps (ride_id, member_id, answer) values (r, rita, 'going'), (r, '00000000-0000-0000-0000-0000000000a3', 'going');
  perform set_config('request.jwt.claim.sub', rita::text, true);
  update rides set cancelled_at = now() where id = r;
  perform set_config('request.jwt.claim.sub', '', true);
  assert pg_temp.outbox(rita) is null, 'Rita cancelled it herself';
  assert pg_temp.outbox('00000000-0000-0000-0000-0000000000a3') like 'Ride cancelled / Hills run%', 'Ned hears';
  assert (select status from private.push_outbox where member_id = '00000000-0000-0000-0000-0000000000a3') = 'held',
    'held the moment it is written while the switch is off, so it can never go out later';
end $$;

\echo 'A calendar event that moves is a time change, not a cancellation and a new ride'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  ned constant uuid := '00000000-0000-0000-0000-0000000000a3';
  feed uuid;
  first_id uuid;
begin
  delete from private.push_outbox;
  insert into private.ride_feeds (url, category) values ('https://example.com/west.ics', 'west') returning id into feed;
  perform public.apply_ride_sync(feed, jsonb_build_array(jsonb_build_object('uid', 'ev-1', 'startsAt', '2026-11-14T21:30:00Z',
    'title', 'Saturday run', 'category', 'west')));
  select id into first_id from rides where external_uid = 'ev-1';
  insert into rsvps (ride_id, member_id, answer) values (first_id, rita, 'going');
  delete from private.push_outbox;
  perform public.apply_ride_sync(feed, jsonb_build_array(jsonb_build_object('uid', 'ev-1', 'startsAt', '2026-11-14T22:30:00Z',
    'title', 'Saturday run', 'category', 'west')));
  assert pg_temp.outbox(rita) = 'Ride time changed / Saturday run · now Sun 15/11/2026 9:30 am', pg_temp.outbox(rita);
  assert pg_temp.outbox(ned) is null, 'not a new ride either';
  assert (select data->>'rideId' from private.push_outbox where member_id = rita)
    = (select id::text from rides where external_uid = 'ev-1' and cancelled_at is null), 'opens the ride where it is now';
end $$;

\echo 'New rides reach members in those colours who asked'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  ned constant uuid := '00000000-0000-0000-0000-0000000000a3';
  nora constant uuid := '00000000-0000-0000-0000-0000000000a4';
begin
  delete from private.push_outbox;
  insert into rides (source, starts_at, title, category) values ('app', now() + interval '10 days', 'West run', 'west');
  assert pg_temp.outbox(ned) like 'New ride / West run · %', 'Ned asked for West rides';
  assert pg_temp.outbox(nora) is null, 'Nora is North';
  assert pg_temp.outbox(rita) is null, 'Rita left new rides off (the default)';
  insert into rides (source, starts_at, title, category) values ('app', now() + interval '10 days', 'Club day', 'club');
  assert pg_temp.outbox(nora) like 'New ride / Club day · %', 'club rides are everyone''s';
  insert into rides (source, starts_at, title, category) values ('app', now() + interval '90 days', 'Far off', 'club');
  insert into rides (source, starts_at, title, category) values ('app', now() - interval '1 day', 'Already gone', 'club');
  assert (select count(*) from private.push_outbox where title = 'New ride' and body like 'Far off%' or body like 'Already gone%') = 0,
    'only rides in the next 60 days';
end $$;

\echo 'A new applicant reaches that chapter''s board'
do $$
declare
  paul constant uuid := '00000000-0000-0000-0000-0000000000a5';
begin
  delete from private.push_outbox;
  insert into members (id, chapter_id, full_name, status, approval)
  select '00000000-0000-0000-0000-0000000000a6', id, 'Pete Pending', 'introduced', 'pending' from chapters where slug = 'west';
  assert pg_temp.outbox(paul) = 'Waiting for approval / Pete Pending asked to join West', pg_temp.outbox(paul);
  assert (select count(*) from private.push_outbox) = 1, 'only the board';
end $$;

\echo 'Live ride alerts reach everyone sharing on the ride, whatever their settings'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000a2';
  ned constant uuid := '00000000-0000-0000-0000-0000000000a3';
  r uuid;
begin
  delete from private.push_outbox;
  insert into rides (source, starts_at, title, category) values ('app', now() + interval '70 days', 'Today', 'non_nuts') returning id into r;
  insert into live_riders (ride_id, member_id, stops_at) values (r, rita, now() + interval '1 hour'), (r, tom, now() + interval '1 hour'),
    (r, ned, now() - interval '1 minute');
  insert into ride_alerts (ride_id, member_id, kind) values (r, rita, 'emergency');
  assert pg_temp.outbox(tom) = 'EMERGENCY: Rusty needs help / Open live ride', pg_temp.outbox(tom);
  assert pg_temp.outbox(rita) is null, 'not the rider who raised it';
  assert pg_temp.outbox(ned) is null, 'not someone whose sharing has switched off';
  assert (select data->>'rideId' from private.push_outbox where member_id = tom) = r::text, 'opens the ride';
  insert into ride_alerts (ride_id, member_id, kind) values (r, ned, 'out');
  assert pg_temp.outbox(tom) like '% | Ned is out of the ride / Open live ride', pg_temp.outbox(tom);
end $$;

\echo 'Phones register themselves; only the send function reads the outbox'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000a2';
  res jsonb;
begin
  assert pg_temp.try_as(tom, 'authenticated', $s$select public.register_push_device('ExponentPushToken[tom]', 'ios')$s$) is null;
  assert pg_temp.try_as(rita, 'authenticated', $s$select public.register_push_device('ExponentPushToken[shared]', 'android')$s$) is null;
  assert pg_temp.try_as(tom, 'authenticated', $s$select public.register_push_device('ExponentPushToken[shared]', 'android')$s$) is null;
  assert (select member_id from push_devices where token = 'ExponentPushToken[shared]') = tom, 'a phone belongs to whoever signed in last';
  assert pg_temp.try_as(null, 'anon', $s$select public.register_push_device('x', 'ios')$s$) is not null, 'signed out can''t';
  assert pg_temp.try_as(tom, 'authenticated', 'select count(*) from public.push_devices') is not null,
    'nobody reads the phones list directly';
  assert pg_temp.try_as(tom, 'authenticated', 'select public.push_take(10)') is not null, 'members can''t take the outbox';
  assert pg_temp.try_as(null, 'anon', 'select public.push_take(10)') is not null, 'nor can anyone signed out';

  -- Switch off (no setting): everything queued is held, and stays held.
  res := public.push_take(10);
  assert (res->>'enabled')::boolean = false and jsonb_array_length(res->'messages') = 0, res::text;
  assert (select count(*) from private.push_outbox where status = 'held') = 3
    and not exists (select 1 from private.push_outbox where status = 'queued'), 'all three live alerts are held';
  insert into private.app_settings (key, value) values ('push_enabled', 'true');
  res := public.push_take(10);
  assert jsonb_array_length(res->'messages') = 0, 'held rows are never sent later';

  -- Switch on: a new event goes out to the member's phones.
  insert into rides (id, source, starts_at, title, category) values
    ('00000000-0000-0000-0000-0000000000b9', 'app', now() + interval '80 days', 'Coast run', 'north');
  insert into rsvps (ride_id, member_id, answer) values ('00000000-0000-0000-0000-0000000000b9', rita, 'going');
  update rides set starts_at = now() + interval '81 days' where id = '00000000-0000-0000-0000-0000000000b9';
  res := public.push_take(10);
  assert (res->>'enabled')::boolean, 'on';
  assert jsonb_array_length(res->'messages') = 0, 'Rita has no phone registered yet, so nothing to send';
  assert (select status from private.push_outbox where member_id = rita order by id desc limit 1) = 'skipped';
  perform pg_temp.try_as(rita, 'authenticated', $s$select public.register_push_device('ExponentPushToken[rita]', 'ios')$s$);
  update rides set starts_at = now() + interval '82 days' where id = '00000000-0000-0000-0000-0000000000b9';
  res := public.push_take(10);
  assert res->'messages'->0->'tokens' = '["ExponentPushToken[rita]"]'::jsonb, res::text;
  assert (select status from private.push_outbox where id = (res->'messages'->0->>'id')::bigint) = 'sending';
  perform public.push_done(array[(res->'messages'->0->>'id')::bigint], '{}', array['ExponentPushToken[rita]']);
  assert (select status from private.push_outbox where id = (res->'messages'->0->>'id')::bigint) = 'sent';
  assert not exists (select 1 from push_devices where token = 'ExponentPushToken[rita]'), 'a dead token is removed';
  assert pg_temp.try_as(null, 'anon', $s$select public.forget_push_device('ExponentPushToken[shared]')$s$) is null,
    'a phone that signed out with no signal removes itself later, signed out';
  assert not exists (select 1 from push_devices where token = 'ExponentPushToken[shared]'), 'signing out removes this phone';
end $$;

\echo 'PUSH CHECKS PASSED'
