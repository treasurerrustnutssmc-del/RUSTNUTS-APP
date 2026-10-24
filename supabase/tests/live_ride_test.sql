-- Checks live ride mode: nobody reads the tables directly, the live window and 12-hour switch-off,
-- who sees what, the alert rules, and that nothing is kept once the window closes.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'rita@example.com', now()),  -- plain Full member
  ('00000000-0000-0000-0000-0000000000d2', 'tom@example.com', now()),   -- Tail Gunner
  ('00000000-0000-0000-0000-0000000000d3', 'pete@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-0000000000d4', 'ned@example.com', now());   -- Full, not sharing

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'Rita Rider', 'Rita', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'Tom Gunner', 'Tommo', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'Pete Pending', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000d4', 'Ned Nearby', null, 'full', 'approved')
) as v(id, name, road, status, approval)
cross join (select id from chapters where slug = 'west') c;

insert into member_private (member_id, phone) values
  ('00000000-0000-0000-0000-0000000000d1', '0400 000 001'),
  ('00000000-0000-0000-0000-0000000000d2', '0400 000 002');
insert into emergency_contacts (member_id, name, relationship, phone) values
  ('00000000-0000-0000-0000-0000000000d1', 'Rob Rider', 'Husband', '0400 111 111');
insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000d2', id, 'tail_gunner', current_date from chapters where slug = 'west';

insert into rides (id, source, starts_at, ends_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'app', now() + interval '1 hour', now() + interval '4 hours', 'Live now', 'west', null),
  ('00000000-0000-0000-0000-0000000000e2', 'app', now() + interval '3 hours', null, 'Not open yet', 'west', null),
  ('00000000-0000-0000-0000-0000000000e3', 'app', now() - interval '10 hours', now() - interval '3 hours', 'All over', 'west', null),
  ('00000000-0000-0000-0000-0000000000e4', 'app', now() + interval '1 hour', null, 'Called off', 'west', now()),
  ('00000000-0000-0000-0000-0000000000e5', 'app', now() - interval '1 hour', now() + interval '20 hours', 'Long one', 'west', null);

-- Runs a statement as a signed-in user and returns its error, or null.
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

-- Runs a query as a signed-in user and returns its single value as jsonb.
create function pg_temp.get_as(who uuid, query text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute format('select to_jsonb((%s))', query) into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function pg_temp.count_as(who uuid, tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  execute format('select count(*) from %s', tbl) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.get_as(uuid, text), pg_temp.count_as(uuid, text)
  to anon, authenticated;

\o
\echo 'The live tables are out of reach; only the actions can touch them'
do $$
declare rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
begin
  assert pg_temp.count_as(rita, 'public.live_riders') in (0, -1), 'riders are not readable';
  assert pg_temp.count_as(rita, 'public.ride_alerts') in (0, -1), 'alerts are not readable';
  assert pg_temp.try_as(rita, $s$insert into public.live_riders (ride_id, member_id, stops_at)
    values ('00000000-0000-0000-0000-0000000000e1', auth.uid(), now() + interval '1 day')$s$) is not null,
    'nobody writes riders directly';
  assert pg_temp.try_as(null, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$) is not null,
    'the public cannot start';
end $$;

\echo 'Live mode opens 2 hours before the start and closes when the ride is over'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  pete constant uuid := '00000000-0000-0000-0000-0000000000d3';
begin
  assert pg_temp.try_as(pete, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$)
    = 'Only approved members can do that.', 'an applicant cannot share';
  assert pg_temp.try_as(rita, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e2')$s$)
    = 'Live ride opens 2 hours before the start.', 'too early';
  assert pg_temp.try_as(rita, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e3')$s$)
    = 'This ride’s finished.', 'too late';
  assert pg_temp.try_as(rita, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e4')$s$)
    = 'That ride was cancelled.', 'cancelled';
  assert pg_temp.try_as(rita, $s$select public.start_live_ride('00000000-0000-0000-0000-000000000999')$s$)
    = 'No such ride.', 'no ride';
end $$;

\echo 'Sharing switches itself off at the window close, or after 12 hours if sooner'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  stops timestamptz;
begin
  stops := (pg_temp.get_as(rita, $s$public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$) #>> '{}')::timestamptz;
  assert stops = (select ends_at + interval '2 hours' from rides where id = '00000000-0000-0000-0000-0000000000e1'),
    'closes 2 hours after the end';
  stops := (pg_temp.get_as(rita, $s$public.start_live_ride('00000000-0000-0000-0000-0000000000e5')$s$) #>> '{}')::timestamptz;
  assert stops <= now() + interval '12 hours' and stops > now() + interval '11 hours', 'capped at 12 hours';
end $$;

\echo 'Only riders who are sharing see the ride, and leaders'' numbers reach everyone'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
  ned constant uuid := '00000000-0000-0000-0000-0000000000d4';
  s jsonb;
begin
  assert pg_temp.try_as(ned, $s$select public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$)
    = 'Share your location first.', 'someone not sharing sees nothing';
  assert pg_temp.try_as(ned, $s$select public.update_live_position('00000000-0000-0000-0000-0000000000e1', -37.8, 144.9, 10, 0, 0)$s$)
    = 'Share your location first.', 'or posts a fix';
  perform pg_temp.get_as(tom, $s$public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$);
  perform pg_temp.get_as(tom, $s$public.update_live_position('00000000-0000-0000-0000-0000000000e1', -37.81, 144.95, 8, 90, 60)$s$);
  s := pg_temp.get_as(rita, $s$public.update_live_position('00000000-0000-0000-0000-0000000000e1', -37.80, 144.90, 12, 0, 50)$s$);
  assert jsonb_array_length(s->'riders') = 2, 'both riders show';
  assert s->'me'->>'stops_at' is not null, 'with when I switch off';
  assert (select r->>'phone' from jsonb_array_elements(s->'riders') r where r->>'name' = 'Tommo') = '0400 000 002',
    'the TG''s number reaches a rider';
  assert (select (r->>'leader')::boolean from jsonb_array_elements(s->'riders') r where r->>'name' = 'Tommo'), 'the TG is a leader';
  assert (select r->>'phone' from jsonb_array_elements(s->'riders') r where r->>'name' = 'Rita') is null,
    'a plain rider''s number stays private';
  assert (select (r->>'lat')::float8 from jsonb_array_elements(s->'riders') r where r->>'name' = 'Tommo') = -37.81,
    'with their latest fix';
  assert jsonb_array_length(s->'contacts') = 0, 'no emergency contacts without an emergency';
  assert (select count(*) from public.live_riders where member_id = rita) = 2, 'one row per ride, no trail';
end $$;

\echo 'An emergency gives leaders the rider''s number and emergency contacts'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
  first_id uuid;
  again uuid;
  s jsonb;
begin
  first_id := (pg_temp.get_as(rita, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'emergency', -37.8, 144.9)$s$) #>> '{}')::uuid;
  again := (pg_temp.get_as(rita, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'emergency', null, null)$s$) #>> '{}')::uuid;
  assert first_id = again, 'a resend returns the open emergency, not a second one';
  assert (select lat from public.ride_alerts where id = first_id) = -37.8, 'an unknown position keeps the last one';
  s := pg_temp.get_as(tom, $s$public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$);
  assert jsonb_array_length(s->'contacts') = 1 and s->'contacts'->0->>'phone' = '0400 111 111', 'the leader sees her contact';
  assert (select r->>'phone' from jsonb_array_elements(s->'riders') r where r->>'name' = 'Rita') = '0400 000 001',
    'and her number';
  assert (s->'alerts'->0->>'phone') = '0400 000 001' and (s->'alerts'->0->>'name') = 'Rita', 'on the alert too';
  s := pg_temp.get_as(rita, $s$public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$);
  assert jsonb_array_length(s->'contacts') = 0, 'a plain rider never sees anyone''s contacts';
  assert (s->'alerts'->0->>'phone') is null, 'or a rider''s number on an alert';
end $$;

\echo 'Clearing alerts: the rider who raised it, or a leader'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
  ned constant uuid := '00000000-0000-0000-0000-0000000000d4';
  a uuid := (select id from public.ride_alerts where kind = 'emergency');
  s jsonb;
begin
  assert pg_temp.try_as(ned, format('select public.resolve_ride_alert(%L)', a)) = 'Only the rider or a ride leader can clear this.',
    'not someone else';
  assert pg_temp.try_as(rita, format('select public.resolve_ride_alert(%L)', a)) is null, 'the rider can';
  assert pg_temp.try_as(tom, format('select public.resolve_ride_alert(%L)', a)) = 'Already cleared.', 'only once';
  assert pg_temp.try_as(tom, $s$select public.resolve_ride_alert('00000000-0000-0000-0000-000000000999')$s$) = 'That alert has gone.',
    'a missing alert';
  s := pg_temp.get_as(tom, $s$public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$);
  assert jsonb_array_length(s->'contacts') = 0, 'contacts go once the emergency is cleared';
  assert jsonb_array_length(s->'alerts') = 1, 'the cleared alert shows for a while';
  assert s->'alerts'->0->>'phone' is null, 'but her number goes with it';
  assert (select r->>'phone' from jsonb_array_elements(s->'riders') r where r->>'name' = 'Rita') is null,
    'everywhere';
end $$;

\echo 'An emergency gets through after your own sharing has stopped, while the ride is on'
do $$
declare
  ned constant uuid := '00000000-0000-0000-0000-0000000000d4';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
  a uuid;
begin
  a := (pg_temp.get_as(ned, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'emergency', -37.9, 144.8,
        now() - interval '20 minutes')$s$) #>> '{}')::uuid;
  assert a is not null, 'Ned isn''t sharing but his emergency goes through';
  assert (select created_at from public.ride_alerts where id = a) < now() - interval '19 minutes',
    'stamped with when he pressed it, not when signal came back';
  assert pg_temp.try_as(ned, $s$select public.raise_ride_alert('00000000-0000-0000-0000-0000000000e3', 'emergency', null, null)$s$)
    = 'This ride’s finished.', 'not once the ride is over';
  assert pg_temp.try_as(ned, $s$select public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'emergency', 95, 144)$s$)
    = 'That location doesn’t look right.', 'a fix has to be a real place';
  assert pg_temp.try_as(tom, $s$select public.update_live_position('00000000-0000-0000-0000-0000000000e1', -37.8, 200, 10, 0, 0)$s$)
    = 'That location doesn’t look right.', 'positions too';
  -- One open emergency per rider, even if two arrive at once.
  begin
    insert into public.ride_alerts (ride_id, member_id, kind) values ('00000000-0000-0000-0000-0000000000e1', ned, 'emergency');
    assert false, 'a second open emergency is refused by the table itself';
  exception when unique_violation then null;
  end;
  -- A leader who isn't sharing on the ride can't clear it.
  perform pg_temp.get_as(tom, $s$public.stop_live_ride('00000000-0000-0000-0000-0000000000e1')$s$);
  assert pg_temp.try_as(tom, format('select public.resolve_ride_alert(%L)', a)) = 'Only the rider or a ride leader can clear this.',
    'a leader at home can''t clear it';
  perform pg_temp.get_as(tom, $s$public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$);
  assert pg_temp.try_as(tom, format('select public.resolve_ride_alert(%L)', a)) is null, 'a leader on the ride can';
end $$;

\echo 'Regroup pins: leaders only, and a new one replaces the last'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
begin
  assert pg_temp.try_as(rita, $s$select public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'regroup', -37.8, 144.9)$s$)
    = 'Only ride leaders can set a regroup pin.', 'a plain rider cannot';
  perform pg_temp.get_as(tom, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'regroup', -37.8, 144.9)$s$);
  perform pg_temp.get_as(tom, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'regroup', -37.9, 145.0)$s$);
  assert (select count(*) from public.ride_alerts where kind = 'regroup' and resolved_at is null) = 1, 'one open pin';
  assert (select lat from public.ride_alerts where kind = 'regroup' and resolved_at is null) = -37.9, 'the newest';
end $$;

\echo 'Leaving the ride stops your sharing but leaves the TG your last spot'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000d1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
  s jsonb;
begin
  perform pg_temp.get_as(rita, $s$public.raise_ride_alert('00000000-0000-0000-0000-0000000000e1', 'out', -37.85, 144.88)$s$);
  assert not exists (select 1 from public.live_riders where member_id = rita and ride_id = '00000000-0000-0000-0000-0000000000e1'),
    'her position is gone';
  s := pg_temp.get_as(tom, $s$public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$);
  assert exists (select 1 from jsonb_array_elements(s->'alerts') a where a->>'kind' = 'out' and a->>'name' = 'Rita'
                 and (a->>'lat')::float8 = -37.85 and a->>'phone' = '0400 000 001'), 'the TG sees where and her number';
  assert pg_temp.try_as(rita, $s$select public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$)
    = 'Share your location first.', 'she no longer sees the ride';
  -- Switching back on in the window renews her.
  assert pg_temp.try_as(rita, $s$select public.start_live_ride('00000000-0000-0000-0000-0000000000e1')$s$) is null, 'she can rejoin';
  assert pg_temp.try_as(rita, $s$select public.stop_live_ride('00000000-0000-0000-0000-0000000000e1')$s$) is null, 'and stop';
  assert not exists (select 1 from public.live_riders where member_id = rita and ride_id = '00000000-0000-0000-0000-0000000000e1'),
    'stopping deletes her row';
end $$;

\echo 'Nothing is kept: cleanup deletes riders past switch-off and everything once the window closes'
do $$
declare tom constant uuid := '00000000-0000-0000-0000-0000000000d2';
begin
  -- Rita's other ride, switched off by the clock.
  update public.live_riders set stops_at = now() - interval '1 minute' where ride_id = '00000000-0000-0000-0000-0000000000e5';
  perform private.live_ride_cleanup();
  assert not exists (select 1 from public.live_riders where ride_id = '00000000-0000-0000-0000-0000000000e5'), 'switched-off rider gone';
  assert exists (select 1 from public.live_riders where ride_id = '00000000-0000-0000-0000-0000000000e1'), 'live ride untouched';
  assert pg_temp.try_as(tom, $s$select public.live_ride_state('00000000-0000-0000-0000-0000000000e5')$s$)
    = 'Share your location first.', 'an expired row is never shown, even before cleanup';
  -- A ride cancelled while people are sharing stops at once, before cleanup runs.
  update public.rides set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
  assert pg_temp.try_as(tom, $s$select public.live_ride_state('00000000-0000-0000-0000-0000000000e1')$s$)
    = 'Share your location first.', 'a cancelled ride shows nothing';
  update public.rides set cancelled_at = null where id = '00000000-0000-0000-0000-0000000000e1';
  -- The ride finished hours ago.
  update public.rides set starts_at = now() - interval '9 hours', ends_at = now() - interval '6 hours'
  where id = '00000000-0000-0000-0000-0000000000e1';
  perform private.live_ride_cleanup();
  assert (select count(*) from public.live_riders) = 0, 'no riders kept';
  assert (select count(*) from public.ride_alerts) = 0, 'no alerts kept';
end $$;

\echo 'All-day rides: midnight to midnight, Melbourne time'
do $$
declare w record;
begin
  select * into w from private.live_window(row(
    gen_random_uuid(), 'app', null, null, timestamptz '2027-01-28 13:00:00+00', timestamptz '2027-01-31 13:00:00+00', true,
    'Big 4', null, null, 'club', null, now())::public.rides);
  assert w.opens = timestamptz '2027-01-28 13:00:00+00' and w.closes = timestamptz '2027-01-31 13:00:00+00', 'three days';
  select * into w from private.live_window(row(
    gen_random_uuid(), 'app', null, null, timestamptz '2025-10-04 23:00:00+00', null, false,
    'DST day', null, null, 'club', null, now())::public.rides);
  assert w.closes = timestamptz '2025-10-05 13:00:00+00', 'no end: midnight AEDT on the changeover day';
end $$;

\echo 'LIVE RIDE CHECKS PASSED'
