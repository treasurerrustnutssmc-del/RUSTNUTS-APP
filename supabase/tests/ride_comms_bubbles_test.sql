-- Ride comms bubbles (Jeff, 22 Nov 2026): who's connected to each ride's comms, the counts the
-- bubbles show, and an emergency from a bubble buzzing everyone on that ride's comms as well as
-- everyone sharing. Spec: docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'rita@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'tom@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'ned@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a4', 'sam@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a5', 'fay@example.com', now());
insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Rita Rider', 'Rita', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'Tom Talker', 'Tommo', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a3', 'Ned Sharer', 'Ned', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a4', 'Sam Suspended', null, 'full', 'suspended'),
  ('00000000-0000-0000-0000-0000000000a5', 'Fay Family', null, 'family', 'approved')
) as v(id, name, road, status, approval)
join chapters c on c.slug = 'west';

insert into rides (id, source, starts_at, ends_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'app', now() - interval '1 hour', now() + interval '2 hours', 'On now', 'west', null),
  ('00000000-0000-0000-0000-0000000000b2', 'app', now() - interval '1 hour', now() + interval '2 hours', 'Also on', 'supported', null),
  ('00000000-0000-0000-0000-0000000000b3', 'app', now() - interval '3 days', now() - interval '3 days' + interval '3 hours', 'Finished', 'west', null);

-- Runs a statement as a signed-in member and returns its error, or null.
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

create function pg_temp.get_as(who uuid, query text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute query into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function pg_temp.sweep(rooms jsonb) returns jsonb language plpgsql as $$
declare answer jsonb;
begin
  set local role service_role;
  select public.voice_sweep(rooms) into answer;
  reset role;
  return answer;
end $$;

create function pg_temp.here(ride uuid) returns text language sql as $$
  select coalesce(string_agg(m.road_name, ',' order by m.road_name), '')
  from public.ride_voice_presence p join public.members m on m.id = p.member_id where p.ride_id = ride
$$;

\o
\echo 'Nobody reads who is connected directly'
\o /dev/null
do $$
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', 'select count(*) from public.ride_voice_presence') is not null, 'members';
  assert pg_temp.try_as(null, 'select count(*) from public.ride_voice_presence') is not null, 'anyone';
end $$;

\o
\echo 'A phone says it has joined or left a ride''s comms, only while the ride is on'
\o /dev/null
do $$
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b1', true)$s$) is null, 'joins';
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b1') = 'Rita', pg_temp.here('00000000-0000-0000-0000-0000000000b1');
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b1', true)$s$) is null, 'twice is fine';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b3', true)$s$) = 'This ride’s finished.', 'finished';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a4',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b1', true)$s$) = 'Only approved members can do that.', 'suspended';
  assert pg_temp.try_as(null, $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b1', true)$s$) is not null, 'signed out';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b1', false)$s$) is null, 'leaves';
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b1') = '', 'gone';
  -- Leaving after the ride has finished still works (the phone tidies up).
  insert into ride_voice_presence (ride_id, member_id, seen_at) values
    ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', now());
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1',
    $s$select public.ride_comms_here('00000000-0000-0000-0000-0000000000b3', false)$s$) is null, 'leaves a finished ride';
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b3') = '', 'gone from the finished ride';
end $$;

\o
\echo 'The sweep records who LiveKit says is in each open room, leaving out anyone it takes out'
\o /dev/null
do $$
declare answer jsonb;
begin
  insert into ride_voice_presence (ride_id, member_id, seen_at) values
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', now());  -- Ned left since
  answer := pg_temp.sweep($j$[
    {"room": "ride-00000000-0000-0000-0000-0000000000b1",
     "members": ["00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000a4"]},
    {"room": "ride-00000000-0000-0000-0000-0000000000b3", "members": ["00000000-0000-0000-0000-0000000000a1"]}
  ]$j$);
  assert answer = $j$[
    {"room": "ride-00000000-0000-0000-0000-0000000000b1", "close": false, "remove": ["00000000-0000-0000-0000-0000000000a4"]},
    {"room": "ride-00000000-0000-0000-0000-0000000000b3", "close": true, "remove": []}
  ]$j$::jsonb, 'the sweep''s answer is unchanged: ' || answer::text;
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b1') = 'Rita,Tommo', pg_temp.here('00000000-0000-0000-0000-0000000000b1');
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b3') = '', 'a closed room has nobody';
  -- The same identity twice (it shouldn't happen) never stops the sweep.
  answer := pg_temp.sweep($j$[{"room": "ride-00000000-0000-0000-0000-0000000000b1",
    "members": ["00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a1"]}]$j$);
  assert answer = '[]'::jsonb, answer::text;
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b1') = 'Rita', pg_temp.here('00000000-0000-0000-0000-0000000000b1');
  -- An empty open room clears its ride.
  perform pg_temp.sweep($j$[{"room": "ride-00000000-0000-0000-0000-0000000000b1", "members": []}]$j$);
  assert pg_temp.here('00000000-0000-0000-0000-0000000000b1') = '', 'empty room';
end $$;

\o
\echo 'The bubbles get counts only, for rides on now that the member may join, seen in the last 3 minutes'
\o /dev/null
do $$
declare got jsonb;
begin
  delete from ride_voice_presence;
  insert into ride_voice_presence (ride_id, member_id, seen_at) values
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', now()),
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', now() - interval '2 minutes'),
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', now() - interval '4 minutes'),  -- stale
    ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', now()),
    ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a2', now());  -- finished ride
  got := pg_temp.get_as('00000000-0000-0000-0000-0000000000a3', 'select public.ride_comms_counts()');
  assert got = $j$[
    {"ride_id": "00000000-0000-0000-0000-0000000000b1", "connected": 2},
    {"ride_id": "00000000-0000-0000-0000-0000000000b2", "connected": 1}
  ]$j$::jsonb, got::text;
  got := pg_temp.get_as('00000000-0000-0000-0000-0000000000a5', 'select public.ride_comms_counts()');
  assert got = '[]'::jsonb, 'family can''t join, so see nothing: ' || got::text;
  assert pg_temp.try_as(null, 'select public.ride_comms_counts()') is not null, 'signed out';
end $$;

\o
\echo 'An emergency buzzes everyone on that ride''s comms as well as everyone sharing; fuel stays with the sharers'
\o /dev/null
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000a2';
  ned constant uuid := '00000000-0000-0000-0000-0000000000a3';
  sam constant uuid := '00000000-0000-0000-0000-0000000000a4';
  b1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  b2 constant uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  delete from ride_voice_presence;
  delete from private.push_outbox;
  -- Ned shares his location on b1; Tom is only on b1's comms; Sam (suspended) was on it; Rita is on b2's comms.
  insert into live_riders (ride_id, member_id, stops_at) values (b1, ned, now() + interval '1 hour');
  insert into ride_voice_presence (ride_id, member_id, seen_at) values
    (b1, tom, now()), (b1, sam, now()), (b1, ned, now()), (b2, rita, now()),
    (b1, rita, now() - interval '10 minutes');  -- Rita left b1's comms long ago
  insert into ride_alerts (ride_id, member_id, kind) values (b1, rita, 'emergency');
  assert (select string_agg(m.road_name, ',' order by m.road_name) from private.push_outbox o join members m on m.id = o.member_id)
    = 'Ned,Tommo', (select string_agg(member_id::text || ' ' || title, ', ') from private.push_outbox);
  assert (select count(*) from private.push_outbox where member_id = ned) = 1, 'once, though sharing and on comms';
  assert (select title from private.push_outbox where member_id = tom) = 'EMERGENCY: Rita needs help', 'same words';
  assert (select body from private.push_outbox where member_id = ned) = 'Open live ride', 'a sharer sees them on the map';
  assert (select body from private.push_outbox where member_id = tom) = 'On On now. Open the live ride and share your location to see where.',
    (select body from private.push_outbox where member_id = tom);
  assert not exists (select 1 from private.push_outbox where member_id = sam), 'not someone no longer allowed on the ride';
  delete from private.push_outbox;
  insert into ride_alerts (ride_id, member_id, kind) values (b1, rita, 'fuel');
  assert (select string_agg(m.road_name, ',') from private.push_outbox o join members m on m.id = o.member_id) = 'Ned',
    'fuel only to sharers';
  -- From a bubble: raised by a rider who is only on comms, not sharing.
  delete from private.push_outbox;
  assert pg_temp.try_as(tom, $s$select public.raise_ride_alert('00000000-0000-0000-0000-0000000000b1', 'emergency', null, null)$s$) is null,
    'a rider on comms can raise one without sharing';
  assert (select string_agg(m.road_name, ',' order by m.road_name) from private.push_outbox o join members m on m.id = o.member_id) = 'Ned',
    'the sender isn''t buzzed; Rita left comms long ago';
end $$;

\o
\echo 'Ride comms bubbles checks passed'
