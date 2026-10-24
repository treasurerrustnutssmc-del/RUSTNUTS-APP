-- Checks the ride calendar: who can see rides and answers, the RSVP rules, and the feed sync.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'rider@example.com', now()),     -- approved Full
  ('00000000-0000-0000-0000-0000000000b2', 'legacy@example.com', now()),    -- approved Legacy
  ('00000000-0000-0000-0000-0000000000b3', 'applicant@example.com', now()), -- pending
  ('00000000-0000-0000-0000-0000000000b4', 'stranger@example.com', now());  -- signed in, no record

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000b1', 'Rita Rider', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Len Legacy', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'Al Applicant', 'introduced', 'pending')
) as v(id, name, status, approval)
cross join (select id from chapters where slug = 'west') c;

insert into private.ride_feeds (id, url, category) values
  ('00000000-0000-0000-0000-00000000f001', 'https://example.com/west.ics', 'west'),
  ('00000000-0000-0000-0000-00000000f002', 'https://example.com/north.ics', 'north');

insert into rides (id, source, starts_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'app', now() + interval '7 days', 'Coffee run', 'west', null),
  ('00000000-0000-0000-0000-0000000000c2', 'app', now() - interval '1 hour', 'Already rolling', 'west', null),
  ('00000000-0000-0000-0000-0000000000c3', 'app', now() + interval '7 days', 'Called off', 'club', now());

-- Runs a statement as a signed-in user (or anon when who is null) and returns its error, or null.
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

grant execute on function pg_temp.try_as(uuid, text), pg_temp.count_as(uuid, text) to anon, authenticated;

\o
\echo 'Approved members of any status see rides and answers; nobody else does'
do $$
begin
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b1', 'rides') = 3, 'a Full member sees every ride';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b2', 'rides') = 3, 'a Legacy member does too';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b3', 'rides') in (0, -1), 'an applicant sees none';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b4', 'rides') in (0, -1), 'a stranger sees none';
  assert pg_temp.count_as(null, 'rides') in (0, -1), 'the public sees none';
  assert pg_temp.count_as(null, 'rsvps') in (0, -1), 'nor answers';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b1', 'private.ride_feeds') = -1, 'feeds are out of reach';
end $$;

\echo 'Rides and answers can only change through the app''s actions'
do $$
declare rita constant uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  assert pg_temp.try_as(rita, $q$insert into rides (starts_at, title, category) values (now(), 'Mine', 'west')$q$) is not null, 'insert ride';
  assert pg_temp.try_as(rita, $q$update rides set title = 'Hacked'$q$) is not null, 'update ride';
  assert pg_temp.try_as(rita, $q$delete from rides$q$) is not null, 'delete ride';
  assert pg_temp.try_as(rita, format($q$insert into rsvps (ride_id, member_id, answer) values (%L, %L, 'going')$q$,
    '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2')) is not null, 'answer for someone else';
  assert pg_temp.try_as(rita, $q$select public.apply_ride_sync('00000000-0000-0000-0000-00000000f001', '[]')$q$) is not null, 'run the sync';
  assert pg_temp.try_as(rita, $q$select public.record_ride_sync_error('00000000-0000-0000-0000-00000000f001', 'x')$q$) is not null, 'log a sync error';
  assert pg_temp.try_as(rita, $q$select * from public.ride_feeds_for_sync()$q$) is not null, 'list the feeds';
  assert pg_temp.try_as(null, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c1', 'going')$q$) is not null, 'anon answers';
  assert (select count(*) from rides) = 3, 'rides untouched';
end $$;

\echo 'A member answers for themselves, and can change their mind'
do $$
declare rita constant uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  assert pg_temp.try_as(rita, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c1', 'going')$q$) is null, 'going';
  assert pg_temp.try_as(rita, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c1', 'maybe')$q$) is null, 'maybe';
  assert (select count(*) from rsvps where member_id = rita) = 1, 'one answer per ride';
  assert (select answer from rsvps where member_id = rita) = 'maybe', 'the latest answer';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b2', $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c1', 'going')$q$) is null,
    'a Legacy member can answer';
end $$;

\echo 'Answers are refused with the same words as the app'
do $$
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b3', $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c1', 'going')$q$)
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b1', $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000ff', 'going')$q$)
    = 'No such ride.', 'missing ride';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b1', $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c3', 'going')$q$)
    = 'That ride was cancelled.', 'cancelled';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b1', $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000c2', 'going')$q$)
    = 'That ride has already started.', 'started';
end $$;

\echo 'The sync adds rides, cancels ones that left the calendar, and never touches the past'
do $$
declare
  west constant uuid := '00000000-0000-0000-0000-00000000f001';
  north constant uuid := '00000000-0000-0000-0000-00000000f002';
  a_time timestamptz := date_trunc('minute', now()) + interval '10 days';
  b_time timestamptz := date_trunc('minute', now()) + interval '20 days';
  moved timestamptz := date_trunc('minute', now()) + interval '21 days';
  old_ride uuid;
  n int;
begin
  insert into rides (feed_id, external_uid, starts_at, title, category)
  values (west, 'past@x', now() - interval '3 days', 'Last week', 'west'),
         (north, 'n1@x', now() + interval '5 days', 'North ride', 'north');

  n := public.apply_ride_sync(west, jsonb_build_array(
    jsonb_build_object('uid', 'a@x', 'startsAt', a_time, 'endsAt', null, 'allDay', false, 'title', 'Breakfast',
                       'location', 'Laverton', 'notes', null, 'category', 'west'),
    jsonb_build_object('uid', 'b@x', 'startsAt', b_time, 'endsAt', b_time + interval '3 hours', 'allDay', false,
                       'title', 'Day ride', 'location', null, 'notes', 'Full tank', 'category', 'club')));
  assert n = 2, 'two rides upserted';
  assert (select count(*) from rides where feed_id = west and cancelled_at is null) = 3, 'both added, last week''s kept';
  assert (select last_ok_at is not null and last_error is null from private.ride_feeds where id = west), 'feed marked OK';

  select id into old_ride from rides where external_uid = 'b@x';
  insert into rsvps (ride_id, member_id, answer) values (old_ride, '00000000-0000-0000-0000-0000000000b1', 'going');

  -- b@x moves a day later; last week's ride is no longer in the feed.
  perform public.apply_ride_sync(west, jsonb_build_array(
    jsonb_build_object('uid', 'a@x', 'startsAt', a_time, 'endsAt', null, 'allDay', false, 'title', 'Breakfast (new place)',
                       'location', 'Werribee', 'notes', null, 'category', 'west'),
    jsonb_build_object('uid', 'b@x', 'startsAt', moved, 'endsAt', null, 'allDay', false,
                       'title', 'Day ride', 'location', null, 'notes', null, 'category', 'club')));
  assert (select cancelled_at is not null from rides where id = old_ride), 'the old time is cancelled';
  assert exists (select 1 from rsvps where ride_id = old_ride), 'its answers are kept';
  assert exists (select 1 from rides where external_uid = 'b@x' and starts_at = moved and cancelled_at is null), 'the new time is there';
  assert (select title from rides where external_uid = 'a@x') = 'Breakfast (new place)', 'details refreshed';
  assert (select cancelled_at is null from rides where external_uid = 'past@x'), 'the past is left alone';
  assert (select cancelled_at is null from rides where external_uid = 'n1@x'), 'another feed is left alone';

  -- It comes back to its old time.
  perform public.apply_ride_sync(west, jsonb_build_array(
    jsonb_build_object('uid', 'b@x', 'startsAt', b_time, 'endsAt', null, 'allDay', false,
                       'title', 'Day ride', 'location', null, 'notes', null, 'category', 'club')));
  assert (select cancelled_at is null from rides where id = old_ride), 'un-cancelled when it returns';

  perform public.record_ride_sync_error(west, 'Not a calendar');
  assert (select last_error from private.ride_feeds where id = west) = 'Not a calendar', 'error recorded';
  assert (select count(*) from rides where feed_id = west and cancelled_at is null) = 2, 'an error cancels nothing';
end $$;
