-- Checks the ride planning extras: bike range, ride plans, route ratings, calling a ride, event
-- hubs and crew swaps. Each refusal in the same words and order as the app's rules (src/domain/
-- fuel.ts, ridePlan.ts, ratings.ts, rideCalls.ts, hubs.ts, swaps.ts), the happy paths, who can read
-- what, and no writes through the API.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'cara@example.com', now()),   -- NEC Chairman
  ('00000000-0000-0000-0000-0000000000c2', 'wes@example.com', now()),    -- West Road Captain (board)
  ('00000000-0000-0000-0000-0000000000c3', 'fran@example.com', now()),   -- Full, West, first aid
  ('00000000-0000-0000-0000-0000000000c4', 'gus@example.com', now()),    -- Full, West, no first aid
  ('00000000-0000-0000-0000-0000000000c5', 'fergus@example.com', now()), -- FNG
  ('00000000-0000-0000-0000-0000000000c6', 'sue@example.com', now()),    -- Supporter
  ('00000000-0000-0000-0000-0000000000c7', 'paul@example.com', now()),   -- pending
  ('00000000-0000-0000-0000-0000000000c8', 'hal@example.com', now()),    -- Full, on hiatus
  ('00000000-0000-0000-0000-0000000000c9', 'tina@example.com', now());   -- Full, first aid

insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state, v.hiatus
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'north', 'Cara Chair', 'Gavel', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Wes Captain', 'Compass', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Fran Full', 'Sparks', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c4', 'west', 'Gus Full', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c5', 'west', 'Fergus FNG', null, 'fng', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c6', 'west', 'Sue Supporter', null, 'supporter', 'approved', false),
  ('00000000-0000-0000-0000-0000000000c7', 'west', 'Paul Pending', null, 'introduced', 'pending', false),
  ('00000000-0000-0000-0000-0000000000c8', 'west', 'Hal Hiatus', null, 'full', 'approved', true),
  ('00000000-0000-0000-0000-0000000000c9', 'west', 'Tina Full', 'Tinker', 'full', 'approved', false)
) as v(id, slug, name, road, status, approval, hiatus)
join chapters c on c.slug = v.slug;

insert into member_private (member_id, first_aid_expiry) values
  ('00000000-0000-0000-0000-0000000000c3', current_date + 400),
  ('00000000-0000-0000-0000-0000000000c9', current_date + 400),
  ('00000000-0000-0000-0000-0000000000c4', null);

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000c1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'road_captain')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;

-- Rides: a West ride in 10 days, a cancelled one, one three days ago, and a club ride in 12 days.
insert into rides (id, source, starts_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000dd01', 'app', now() + interval '10 days', 'Black Spur loop', 'west', null),
  ('00000000-0000-0000-0000-00000000dd02', 'app', now() + interval '11 days', 'Rained out', 'west', now()),
  ('00000000-0000-0000-0000-00000000dd03', 'app', now() - interval '3 days', 'Last week', 'west', null),
  ('00000000-0000-0000-0000-00000000dd04', 'app', now() + interval '12 days', 'Not Dead Yet Run', 'club', null);

-- Fran is the RC of the Black Spur loop, Tina its Tail Gunner, Gus an Officer. All three are Going.
insert into ride_crew (ride_id, member_id, role) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c3', 'road_captain'),
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c9', 'tail_gunner'),
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c4', 'officer');
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c3', 'going'),
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c9', 'going'),
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c4', 'going'),
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c5', 'no');

insert into bikes (id, member_id, make, model, year) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000c3', 'Harley-Davidson', 'Sportster', 2010),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000c4', 'Honda', 'Goldwing', 2018);

insert into routes (id, name, gpx, distance_m) values
  ('00000000-0000-0000-0000-00000000ff01', 'Black Spur', '<gpx/>', 180000),
  ('00000000-0000-0000-0000-00000000ff02', 'Old road', '<gpx/>', 90000);
update routes set archived_at = now() where id = '00000000-0000-0000-0000-00000000ff02';

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

-- Asserts a statement, run as someone, is refused with these words (or allowed, for null).
create function pg_temp.expect(who uuid, stmt text, want text) returns void language plpgsql as $$
declare got text := pg_temp.try_as(who, stmt);
begin
  assert got is not distinct from want, format('%s: wanted %s, got %s', stmt, coalesce(want, 'allowed'), coalesce(got, 'allowed'));
end $$;

-- Runs a query as a signed-in user and returns its one value as text. Errors go on up.
create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
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
\echo 'Bike range: your own bike, 30 to 1000 km, blank clears it'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  sportster constant text := '00000000-0000-0000-0000-00000000ee01';
begin
  perform pg_temp.expect(null, format('select public.set_bike_range(%L, 200)', sportster), 'permission denied for function set_bike_range');
  perform pg_temp.expect(paul, format('select public.set_bike_range(%L, 200)', sportster), 'Only approved members can do that.');
  perform pg_temp.expect(gus, format('select public.set_bike_range(%L, 200)', sportster), 'That’s not your bike.');
  perform pg_temp.expect(fran, format('select public.set_bike_range(%L, 29)', sportster), 'Range is in km, from 30 to 1000.');
  perform pg_temp.expect(fran, format('select public.set_bike_range(%L, 1001)', sportster), 'Range is in km, from 30 to 1000.');
  perform pg_temp.expect(fran, format('select public.set_bike_range(%L, 180)', sportster), null);
  assert (select range_km from bikes where id = sportster::uuid) = 180, 'saved';
  perform pg_temp.expect(fran, format('select public.set_bike_range(%L, null)', sportster), null);
  assert (select range_km from bikes where id = sportster::uuid) is null, 'cleared';
  perform pg_temp.expect(fran, format('select public.set_bike_range(%L, 180)', sportster), null);
end $$;

\o
\echo 'Ride plans: who, when, the stop limits, trimming, km order and the version check'
\o /dev/null
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  ride constant text := '00000000-0000-0000-0000-00000000dd01';
  good constant text := '[{"kind":"lunch","name":"  Marysville Bakery ","km":95,"time":"12:30"},{"kind":"fuel","name":"Healesville","km":40.5,"time":null},{"kind":"other","name":"Lookout","km":null,"time":null}]';
  saved timestamptz;
  stops jsonb;
begin
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', gen_random_uuid(), '[]'), 'No such ride.');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', '00000000-0000-0000-0000-00000000dd02', '[]'), 'That ride was cancelled.');
  perform pg_temp.expect(wes, format('select public.save_ride_plan(%L, %L, null)', '00000000-0000-0000-0000-00000000dd03', '[]'), 'The plan can’t change after the ride day.');
  perform pg_temp.expect(gus, format('select public.save_ride_plan(%L, %L, null)', ride, '[]'),
    'Only the board, ride committee or this ride’s Road Captain can plan the ride.');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride,
    (select jsonb_agg(jsonb_build_object('kind', 'coffee', 'name', 'Stop ' || n, 'km', n, 'time', null)) from generate_series(1, 16) n)),
    'That’s too many stops (15 at most).');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"fuel","name":"   ","km":1,"time":null}]'),
    'Give each stop a short name (60 characters at most).');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride,
    jsonb_build_array(jsonb_build_object('kind', 'fuel', 'name', repeat('x', 61), 'km', 1, 'time', null))),
    'Give each stop a short name (60 characters at most).');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"wash","name":"Car wash","km":1,"time":null}]'),
    'Give each stop a short name (60 characters at most).');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"fuel","name":"Far","km":2000.5,"time":null}]'),
    'Check the km: 0 to 2000.');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"fuel","name":"Odd","km":-1,"time":null}]'),
    'Check the km: 0 to 2000.');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"fuel","name":"Late","km":5,"time":"24:00"}]'),
    'Write times as 24-hour HH:MM, like 10:30.');
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, '[{"kind":"fuel","name":"Late","km":5,"time":"9:30"}]'),
    'Write times as 24-hour HH:MM, like 10:30.');

  -- The RC saves; trimmed and in km order, stops without a km last.
  perform pg_temp.expect(fran, format('select public.save_ride_plan(%L, %L, null)', ride, good), null);
  select p.stops, p.updated_at into stops, saved from ride_plans p where p.ride_id = ride::uuid;
  assert stops->0->>'name' = 'Healesville' and stops->1->>'name' = 'Marysville Bakery' and stops->2->>'name' = 'Lookout',
    format('in km order and trimmed: %s', stops);
  assert (stops->0->>'km')::numeric = 40.5 and stops->2->'km' = 'null'::jsonb, 'km kept';
  assert (select updated_by from ride_plans where ride_id = ride::uuid) = fran, 'who saved';

  -- Someone opened it before that save: refused.
  perform pg_temp.expect(cara, format('select public.save_ride_plan(%L, %L, null)', ride, '[]'),
    'Someone else saved this plan while you were editing. Your changes aren’t saved: copy them, then open the plan again.');
  perform pg_temp.expect(cara, format('select public.save_ride_plan(%L, %L, %L)', ride, '[]', saved - interval '1 second'),
    'Someone else saved this plan while you were editing. Your changes aren’t saved: copy them, then open the plan again.');
  -- The NEC, on the version on screen: allowed, and an empty plan clears the stops.
  perform pg_temp.expect(cara, format('select public.save_ride_plan(%L, %L, %L)', ride, '[]', saved), null);
  assert (select jsonb_array_length(p.stops) from ride_plans p where p.ride_id = ride::uuid) = 0, 'cleared';
  -- The West board's Road Captain (a manager) saves the good plan again.
  saved := (select updated_at from ride_plans where ride_id = ride::uuid);
  perform pg_temp.expect(wes, format('select public.save_ride_plan(%L, %L, %L)', ride, good, saved), null);
end $$;

\o
\echo 'Route ratings: 1 to 5 stars, a short comment, one per member, not on archived routes'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  sue constant uuid := '00000000-0000-0000-0000-0000000000c6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  route constant text := '00000000-0000-0000-0000-00000000ff01';
begin
  perform pg_temp.expect(paul, format('select public.rate_route(%L, 5, null)', route), 'Only approved members can do that.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 5, null)', gen_random_uuid()), 'That route no longer exists.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 5, null)', '00000000-0000-0000-0000-00000000ff02'), 'That route is archived.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 0, null)', route), 'Pick 1 to 5 stars.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 6, null)', route), 'Pick 1 to 5 stars.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, null, null)', route), 'Pick 1 to 5 stars.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 4, %L)', route, repeat('é', 281)), 'Keep the comment to 280 characters at most.');
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 4, %L)', route, repeat('é', 280)), null);
  perform pg_temp.expect(fran, format('select public.rate_route(%L, 5, %L)', route, '  Sweeping bends.  '), null);
  perform pg_temp.expect(sue, format('select public.rate_route(%L, 3, %L)', route, '   '), null);
  assert (select count(*) from route_ratings where route_id = route::uuid) = 2, 'one each';
  assert (select stars from route_ratings where member_id = fran) = 5, 'rating again replaces it';
  assert (select comment from route_ratings where member_id = fran) = 'Sweeping bends.', 'trimmed';
  assert (select comment from route_ratings where member_id = sue) is null, 'blank kept as none';
end $$;

\o
\echo 'Calling a ride: who, when, the reason and new day limits, Back on, and the chat line'
\o /dev/null
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  ride constant text := '00000000-0000-0000-0000-00000000dd01';
  ride_day date := date((now() + interval '10 days') at time zone 'Australia/Melbourne');
  c ride_calls%rowtype;
  chat uuid;
begin
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, null)', gen_random_uuid(), 'off'), 'No such ride.');
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, null)', '00000000-0000-0000-0000-00000000dd02', 'off'), 'That ride was cancelled.');
  perform pg_temp.expect(cara, format('select public.call_ride(%L, %L, null, null)', '00000000-0000-0000-0000-00000000dd03', 'off'), 'It’s too late to call this ride.');
  perform pg_temp.expect(gus, format('select public.call_ride(%L, %L, null, null)', ride, 'off'),
    'Only the board, ride committee or this ride’s Road Captain can call the ride.');
  -- A call has to change something.
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, null)', ride, 'on'), 'The ride isn’t off or postponed.');
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, %L, null)', ride, 'off', repeat('x', 201)), 'Keep the reason to 200 characters at most.');
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, %L)', ride, 'off', ride_day + 7), 'Only a postponed ride takes a new day.');
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, %L)', ride, 'postponed', ride_day), 'Pick a new day after the ride, within 12 months.');
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, %L)', ride, 'postponed', ride_day + 366), 'Pick a new day after the ride, within 12 months.');

  -- A ride from before the chat has none yet: the call makes it.
  delete from conversations where kind = 'ride' and ride_id = ride::uuid;
  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, %L, null)', ride, 'off', '  Rain and 90 km/h winds. '), null);
  perform pg_temp.expect(cara, format('select public.call_ride(%L, %L, null, null)', ride, 'off'), 'The ride’s already off.');
  select * into c from ride_calls where ride_id = ride::uuid;
  assert c.state = 'off' and c.reason = 'Rain and 90 km/h winds.' and c.called_by = fran and c.new_day is null, 'called off';
  select id into chat from conversations where kind = 'ride' and ride_id = ride::uuid;
  assert (select body from messages where conversation_id = chat order by created_at desc limit 1) = 'Ride’s off: Rain and 90 km/h winds.',
    'posted in the ride chat';
  assert (select author_id from messages where conversation_id = chat order by created_at desc limit 1) = fran, 'as the caller';

  perform pg_temp.expect(cara, format('select public.call_ride(%L, %L, %L, %L)', ride, 'postponed', 'Weather', ride_day + 7), null);
  select * into c from ride_calls where ride_id = ride::uuid;
  assert c.state = 'postponed' and c.new_day = ride_day + 7 and c.called_by = cara, 'postponed';
  assert (select body from messages where conversation_id = chat order by created_at desc limit 1) =
    format('Ride’s postponed to %s: Weather', to_char(ride_day + 7, 'DD/MM/YYYY')), 'postponed line';

  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, null, null)', ride, 'postponed'), null);
  assert (select body from messages where conversation_id = chat order by created_at desc limit 1) = 'Ride’s postponed.', 'bare postponed line';

  perform pg_temp.expect(fran, format('select public.call_ride(%L, %L, %L, null)', ride, 'on', 'ignored'), null);
  select * into c from ride_calls where ride_id = ride::uuid;
  assert c.state = 'on' and c.reason is null and c.new_day is null, 'back on clears the reason and day';
  assert (select body from messages where conversation_id = chat order by created_at desc limit 1) = 'Ride’s back on.', 'back on line';
end $$;

\o
\echo 'Hubs: who runs them, the limits, registering, members only, closing, beds, withdrawing'
\o /dev/null
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000c5';
  sue constant uuid := '00000000-0000-0000-0000-0000000000c6';
  tina constant uuid := '00000000-0000-0000-0000-0000000000c9';
  ndyr constant text := '00000000-0000-0000-0000-00000000dd04';
  r hub_registrations%rowtype;
begin
  perform pg_temp.expect(cara, format('select public.save_hub(%L, true, null, null, null, null)', gen_random_uuid()), 'No such ride.');
  perform pg_temp.expect(cara, format('select public.save_hub(%L, true, null, null, null, null)', '00000000-0000-0000-0000-00000000dd02'), 'That ride was cancelled.');
  perform pg_temp.expect(cara, format('select public.save_hub(%L, true, null, null, null, null)', '00000000-0000-0000-0000-00000000dd03'), 'The hub can’t change after the ride day.');
  -- Fran is an RC on another ride but doesn't run the club's rides.
  perform pg_temp.expect(fran, format('select public.save_hub(%L, true, null, null, null, null)', ndyr), 'Only the board, ride committee or NEC can run the hub.');
  perform pg_temp.expect(wes, format('select public.save_hub(%L, true, null, 0, null, null)', ndyr), 'Group beds: 1 to 500, or leave it blank.');
  perform pg_temp.expect(wes, format('select public.save_hub(%L, true, null, 501, null, null)', ndyr), 'Group beds: 1 to 500, or leave it blank.');
  perform pg_temp.expect(wes, format('select public.save_hub(%L, true, null, null, %L, null)', ndyr, repeat('x', 1001)), 'That’s too long (1000 characters at most).');
  perform pg_temp.expect(wes, format('select public.save_hub(%L, true, null, null, null, %L)', ndyr, repeat('x', 1001)), 'That’s too long (1000 characters at most).');

  -- No hub yet.
  perform pg_temp.expect(fran, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'group'), 'This ride doesn’t take registrations.');
  perform pg_temp.expect(wes, format('select public.save_hub(%L, true, null, 3, %L, %L)', ndyr, ' Bright Motel, 2 nights ', ''), null);
  assert (select accommodation from ride_hubs where ride_id = ndyr::uuid) = 'Bright Motel, 2 nights', 'trimmed';
  assert (select notes from ride_hubs where ride_id = ndyr::uuid) is null, 'blank kept as none';

  perform pg_temp.expect(sue, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'group'), 'This one’s for FNG, Full and Nomad members.');
  perform pg_temp.expect(fran, format('select public.register_hub(%L, %L, false, %L, null)', ndyr, 'group', repeat('x', 81)),
    'Keep it short: 80 characters for who you’re sharing with, 200 for notes.');
  perform pg_temp.expect(fran, format('select public.register_hub(%L, %L, false, null, %L)', ndyr, 'group', repeat('x', 201)),
    'Keep it short: 80 characters for who you’re sharing with, 200 for notes.');
  perform pg_temp.expect(fran, format('select public.register_hub(%L, %L, true, %L, %L)', ndyr, 'group', ' Gus ', 'No onions'), null);
  select * into r from hub_registrations where ride_id = ndyr::uuid and member_id = fran;
  assert r.staying = 'group' and r.pillion and r.share_with = 'Gus' and r.notes = 'No onions' and r.withdrawn_at is null, 'registered';
  -- Three beds: Fran and her pillion take two. Gus with a pillion would make four.
  perform pg_temp.expect(gus, format('select public.register_hub(%L, %L, true, null, null)', ndyr, 'group'), 'The group booking is full.');
  perform pg_temp.expect(gus, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'group'), null);
  -- Fran changing her own registration doesn't count her twice.
  perform pg_temp.expect(fran, format('select public.register_hub(%L, %L, true, null, null)', ndyr, 'group'), null);
  perform pg_temp.expect(fergus, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'group'), 'The group booking is full.');
  perform pg_temp.expect(fergus, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'camping'), null);

  -- Withdrawing frees the beds; registering again brings you back.
  perform pg_temp.expect(tina, format('select public.withdraw_hub(%L)', ndyr), 'You’re not registered.');
  perform pg_temp.expect(gus, format('select public.withdraw_hub(%L)', ndyr), null);
  assert (select withdrawn_at from hub_registrations where ride_id = ndyr::uuid and member_id = gus) is not null, 'withdrawn';
  perform pg_temp.expect(tina, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'group'), null);
  perform pg_temp.expect(gus, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'own'), null);
  assert (select withdrawn_at from hub_registrations where ride_id = ndyr::uuid and member_id = gus) is null, 'back';

  -- Closed yesterday: no registering, but withdrawing still works.
  -- A new closing day runs from today to the ride day; one already set can stay.
  perform pg_temp.expect(cara, format('select public.save_hub(%L, false, %L, null, null, null)', ndyr, private.club_date() - 1),
    'Pick a closing day from today up to the ride day.');
  perform pg_temp.expect(cara, format('select public.save_hub(%L, false, %L, null, null, null)', ndyr,
    (select date(starts_at at time zone 'Australia/Melbourne') + 1 from rides where id = ndyr::uuid)), 'Pick a closing day from today up to the ride day.');
  update ride_hubs set closes_on = private.club_date() - 1 where ride_id = ndyr::uuid;
  perform pg_temp.expect(cara, format('select public.save_hub(%L, false, %L, null, null, null)', ndyr, private.club_date() - 1), null);
  perform pg_temp.expect(sue, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'day'), 'Registrations have closed.');
  perform pg_temp.expect(gus, format('select public.withdraw_hub(%L)', ndyr), null);
  -- Open to everyone approved once members only is off.
  perform pg_temp.expect(cara, format('select public.save_hub(%L, false, %L, null, null, null)', ndyr, private.club_date()), null);
  perform pg_temp.expect(sue, format('select public.register_hub(%L, %L, false, null, null)', ndyr, 'day'), null);
  -- A past ride's registrations are closed.
  insert into ride_hubs (ride_id, members_only) values ('00000000-0000-0000-0000-00000000dd03', false);
  perform pg_temp.expect(sue, format('select public.register_hub(%L, %L, false, null, null)', '00000000-0000-0000-0000-00000000dd03', 'day'), 'Registrations have closed.');
  perform pg_temp.expect(sue, format('select public.withdraw_hub(%L)', '00000000-0000-0000-0000-00000000dd03'), 'You’re not registered.');
end $$;

\o
\echo 'Swaps: asking, the eligibility checks, one open ask, answering, trading and withdrawing'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000c5';
  hal constant uuid := '00000000-0000-0000-0000-0000000000c8';
  tina constant uuid := '00000000-0000-0000-0000-0000000000c9';
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  ride constant text := '00000000-0000-0000-0000-00000000dd01';
  ask uuid;
begin
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', gen_random_uuid(), gus), 'No such ride.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', '00000000-0000-0000-0000-00000000dd02', gus), 'That ride was cancelled.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', '00000000-0000-0000-0000-00000000dd03', gus), 'The crew can’t change after the ride day.');
  perform pg_temp.expect(wes, format('select public.ask_swap(%L, %L, null)', ride, gus), 'You’re not on this ride’s crew.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', ride, fran), 'Pick someone else.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', ride, gen_random_uuid()), 'That member no longer exists.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', ride, fergus), 'Only Full and Nomad members can crew a ride.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', ride, hal), 'Members on hiatus can’t crew a ride.');
  -- Tina (TG) asking Gus, who has no first aid.
  perform pg_temp.expect(tina, format('select public.ask_swap(%L, %L, null)', ride, gus), 'Tail Gunners need a current first aid certificate on file.');
  -- Gus (Officer) asking Tina to trade: Gus can't be TG without first aid.
  perform pg_temp.expect(gus, format('select public.ask_swap(%L, %L, null)', ride, tina), 'Tail Gunners need a current first aid certificate on file.');
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, %L)', ride, wes, repeat('x', 201)), 'Keep the note to 200 characters at most.');

  -- Fran asks Wes (not on the crew) to take the RC spot.
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, %L)', ride, wes, ' Work came up '), null);
  select id into ask from crew_swaps where asked_by = fran and state = 'asked';
  assert (select note from crew_swaps where id = ask) = 'Work came up', 'note trimmed';
  assert (select role from crew_swaps where id = ask) = 'road_captain' and (select their_role from crew_swaps where id = ask) is null, 'the spots';
  perform pg_temp.expect(fran, format('select public.ask_swap(%L, %L, null)', ride, cara), 'You’ve already asked someone. Withdraw that first.');

  perform pg_temp.expect(gus, format('select public.answer_swap(%L, true)', gen_random_uuid()), 'No such swap.');
  perform pg_temp.expect(gus, format('select public.answer_swap(%L, true)', ask), 'That ask isn’t for you.');
  perform pg_temp.expect(gus, format('select public.withdraw_swap(%L)', ask), 'Only whoever asked can withdraw it.');
  perform pg_temp.expect(wes, format('select public.answer_swap(%L, true)', ask), null);
  assert (select role from ride_crew where ride_id = ride::uuid and member_id = wes) = 'road_captain', 'Wes is RC';
  assert not exists (select 1 from ride_crew where ride_id = ride::uuid and member_id = fran), 'Fran is off the crew';
  assert (select answer from rsvps where ride_id = ride::uuid and member_id = wes) = 'going', 'Wes is Going';
  assert (select answer from rsvps where ride_id = ride::uuid and member_id = fran) = 'going', 'Fran is still Going';
  assert (select state from crew_swaps where id = ask) = 'accepted' and (select answered_at from crew_swaps where id = ask) is not null, 'accepted';
  perform pg_temp.expect(wes, format('select public.answer_swap(%L, false)', ask), 'That ask has already been answered.');
  perform pg_temp.expect(fran, format('select public.withdraw_swap(%L)', ask), 'That ask has already been answered.');

  -- A trade: Wes (RC) and Gus (Officer).
  perform pg_temp.expect(wes, format('select public.ask_swap(%L, %L, null)', ride, gus), null);
  select id into ask from crew_swaps where asked_by = wes and state = 'asked';
  assert (select their_role from crew_swaps where id = ask) = 'officer', 'a trade';
  perform pg_temp.expect(gus, format('select public.answer_swap(%L, true)', ask), null);
  assert (select role from ride_crew where ride_id = ride::uuid and member_id = gus) = 'road_captain', 'Gus is RC';
  assert (select role from ride_crew where ride_id = ride::uuid and member_id = wes) = 'officer', 'Wes is an Officer';

  -- The crew changes under an ask: refused on a yes, and a no still closes it.
  perform pg_temp.expect(gus, format('select public.ask_swap(%L, %L, null)', ride, fran), null);
  select id into ask from crew_swaps where asked_by = gus and state = 'asked';
  update ride_crew set role = 'officer' where ride_id = ride::uuid and member_id = gus;
  perform pg_temp.expect(fran, format('select public.answer_swap(%L, true)', ask), 'The crew has changed since. Ask again.');
  perform pg_temp.expect(fran, format('select public.answer_swap(%L, false)', ask), null);
  assert (select state from crew_swaps where id = ask) = 'declined', 'declined';

  -- Withdrawing.
  perform pg_temp.expect(gus, format('select public.ask_swap(%L, %L, null)', ride, fran), null);
  select id into ask from crew_swaps where asked_by = gus and state = 'asked';
  perform pg_temp.expect(gus, format('select public.withdraw_swap(%L)', ask), null);
  assert (select state from crew_swaps where id = ask) = 'withdrawn', 'withdrawn';
  perform pg_temp.expect(fran, format('select public.answer_swap(%L, true)', ask), 'That ask has already been answered.');
end $$;

\o
\echo 'Who reads what: approved members everything, applicants and the public nothing, no writes'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  t text;
begin
  foreach t in array array['ride_plans', 'route_ratings', 'ride_calls', 'ride_hubs', 'hub_registrations', 'crew_swaps'] loop
    assert pg_temp.count_as(fran, 'public.' || t) > 0, format('%s: members read it', t);
    assert pg_temp.count_as(paul, 'public.' || t) = 0, format('%s: applicants read nothing', t);
    assert pg_temp.count_as(null, 'public.' || t) = -1, format('%s: the public can’t select', t);
  end loop;
  perform pg_temp.expect(fran, format('insert into public.route_ratings (route_id, member_id, stars) values (%L, %L, 1)',
    '00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-0000000000c4'), 'permission denied for table route_ratings');
  perform pg_temp.expect(fran, 'update public.ride_calls set state = ''off''', 'permission denied for table ride_calls');
  perform pg_temp.expect(fran, 'update public.crew_swaps set state = ''accepted''', 'permission denied for table crew_swaps');
  perform pg_temp.expect(fran, 'update public.hub_registrations set staying = ''group''', 'permission denied for table hub_registrations');
  perform pg_temp.expect(fran, 'update public.ride_plans set stops = ''[]''', 'permission denied for table ride_plans');
  perform pg_temp.expect(fran, 'update public.ride_hubs set beds = 1', 'permission denied for table ride_hubs');
  -- Bikes stay writable by their owner as before; the range has its own check.
  perform pg_temp.expect(fran, format('update public.bikes set range_km = 5 where id = %L', '00000000-0000-0000-0000-00000000ee01'),
    'new row for relation "bikes" violates check constraint "bikes_range_km_check"');
end $$;

\o
\echo 'RIDE PLANNING EXTRAS CHECKS PASSED'
