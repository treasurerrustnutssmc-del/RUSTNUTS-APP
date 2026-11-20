-- Checks rides ridden in legs: who may link rides as legs (set_ride_legs), in the app's words and
-- order (src/domain/rideLegs.ts), and who reads ride_legs.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000008a1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-0000000008a2', 'rc@example.com', now()),    -- West ride committee
  ('00000000-0000-0000-0000-0000000008a3', 'nrc@example.com', now()),   -- North ride committee
  ('00000000-0000-0000-0000-0000000008a5', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000008a6', 'paul@example.com', now());  -- pending

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000008a1', 'west', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-0000000008a2', 'west', 'Rick Committee', 'approved'),
  ('00000000-0000-0000-0000-0000000008a3', 'north', 'Nora Committee', 'approved'),
  ('00000000-0000-0000-0000-0000000008a5', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-0000000008a6', 'west', 'Paul Pending', 'pending')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01'
from (values
  ('00000000-0000-0000-0000-0000000008a1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000008a2', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000008a3', 'north', 'ride_committee')
) as v(id, slug, role);

insert into rides (id, source, starts_at, ends_at, all_day, title, category) values
  ('00000000-0000-0000-0000-00000000b401', 'feed', now() + interval '3 days', now() + interval '5 days', true, 'Big 4 out', 'club'),
  ('00000000-0000-0000-0000-00000000b402', 'app', now() + interval '3 days 6 hours', null, false, 'Second leg', 'club'),
  ('00000000-0000-0000-0000-00000000b403', 'app', now() + interval '4 days', null, false, 'Leg home', 'club'),
  ('00000000-0000-0000-0000-00000000b404', 'app', now() + interval '4 days', null, false, 'West run', 'west'),
  ('00000000-0000-0000-0000-00000000b405', 'app', now() + interval '30 days', null, false, 'Far off', 'club'),
  ('00000000-0000-0000-0000-00000000b406', 'app', now() - interval '3 days', null, false, 'Old run', 'club'),
  ('00000000-0000-0000-0000-00000000b407', 'app', now() + interval '5 days', null, false, 'Extra', 'club');

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

create function pg_temp.legs_sql(ids text[]) returns text language sql as $$
  select format('select public.set_ride_legs(%L::uuid[])', ids);
$$;

create function pg_temp.trip(ride uuid) returns text language sql as $$
  select string_agg(right(l.ride_id::text, 3), ',' order by l.leg_no)
  from ride_legs l where l.trip_id = (select trip_id from ride_legs where ride_id = ride);
$$;

\o
\echo 'Ride legs: linking rides as legs, the refusals in the app''s words and order'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000008a1';
  rc constant uuid := '00000000-0000-0000-0000-0000000008a2';
  nrc constant uuid := '00000000-0000-0000-0000-0000000008a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000008a5';
  paul constant uuid := '00000000-0000-0000-0000-0000000008a6';
  b1 constant text := '00000000-0000-0000-0000-00000000b401';
  b2 constant text := '00000000-0000-0000-0000-00000000b402';
  b3 constant text := '00000000-0000-0000-0000-00000000b403';
  w4 constant text := '00000000-0000-0000-0000-00000000b404';
  far constant text := '00000000-0000-0000-0000-00000000b405';
  old constant text := '00000000-0000-0000-0000-00000000b406';
  x7 constant text := '00000000-0000-0000-0000-00000000b407';
  ok text := pg_temp.legs_sql(array[b1, b2, b3]);
begin
  assert pg_temp.try_as(null, ok) like 'permission denied%', 'anon can''t';
  assert pg_temp.try_as(paul, ok) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, b2, b3, w4, far, old, x7])) = 'A ride has at most 6 legs.', 'too many';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, b1])) = 'List each leg once.', 'twice';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, gen_random_uuid()::text])) = 'No such ride.', 'no ride';
  assert pg_temp.try_as(nell, ok) = 'Only the board, ride committee or NEC can make and change rides.', 'no seat';
  assert pg_temp.try_as(nrc, pg_temp.legs_sql(array[b1, w4])) = 'Only that chapter’s board or ride committee can run its rides.', 'North on a West ride';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[old, b1])) = 'That ride is history; it can’t change now.', 'history';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, far])) = 'Legs start within 14 days of the first.', 'spread';

  assert pg_temp.try_as(rc, ok) is null, 'West committee links the three club legs';
  assert pg_temp.trip(b2::uuid) = '401,402,403', 'in the order given: ' || coalesce(pg_temp.trip(b2::uuid), 'none');
  assert (select set_by from ride_legs where ride_id = b1::uuid) = rc, 'who linked them';

  -- Re-linking in a new order with a fourth leg replaces the trip.
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, b3, b2, x7])) is null, 'relinked';
  assert pg_temp.trip(b1::uuid) = '401,403,402,407', 'new order: ' || pg_temp.trip(b1::uuid);
  -- Linking two of them elsewhere takes them out of the old trip; a trip left with one ride ends.
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b2, x7])) is null, 'two moved to their own trip';
  assert pg_temp.trip(b2::uuid) = '402,407', 'their own trip';
  assert pg_temp.trip(b1::uuid) = '401,403', 'the old trip keeps the rest, renumbered: ' || pg_temp.trip(b1::uuid);
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b2])) is null, 'unlink';
  assert pg_temp.trip(b2::uuid) is null and pg_temp.trip(x7::uuid) is null, 'a trip of one is no trip';
  assert pg_temp.trip(b1::uuid) = '401,403', 'other trips untouched';

  -- A trip under way: a leg that's history stays in when the trip changes, and can be unlinked.
  update rides set starts_at = now() - interval '2 days', ends_at = null, all_day = false where id = b1::uuid;
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, b3, x7])) is null, 'history leg already in the trip stays';
  assert pg_temp.trip(b1::uuid) = '401,403,407', 'with the new leg: ' || pg_temp.trip(b1::uuid);
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1, b2])) = 'That ride is history; it can’t change now.', 'not into a new trip';
  assert pg_temp.try_as(wes, pg_temp.legs_sql(array[b1])) is null, 'unlinking a history leg';
  assert pg_temp.trip(b3::uuid) = '403,407', 'the rest stay a trip';

  -- Members read the legs; the public doesn't.
  perform set_config('request.jwt.claim.sub', nell::text, true);
  set local role authenticated;
  assert (select count(*) from ride_legs) = 2, 'members read legs';
  reset role;
  perform set_config('request.jwt.claim.sub', paul::text, true);
  set local role authenticated;
  assert (select count(*) from ride_legs) = 0, 'pending members don''t';
  reset role;
  assert pg_temp.try_as(null, 'select count(*) from public.ride_legs') like 'permission denied%', 'anon can''t read';
  assert pg_temp.try_as(nell, format('insert into public.ride_legs (ride_id, trip_id, leg_no) values (%L, %L, 1)', far, far))
    like 'permission denied%', 'no direct writes';
end $$;

\echo ride_legs: ok
