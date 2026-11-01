-- Checks charity ride sign-ups from the club website: the public feed of rides taking them, the
-- website's door (service role only) with each refusal in the app's order and words, the places
-- limit shared with members' sign-ups, who can read the rows, and organisers removing one.
-- Spec: docs/superpowers/specs/2026-11-01-website-charity-signups-design.md
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c2', 'wes@example.com', now()),    -- West Road Captain (runs West rides)
  ('00000000-0000-0000-0000-0000000000c3', 'fran@example.com', now()),   -- Full, West
  ('00000000-0000-0000-0000-0000000000c5', 'nina@example.com', now()),   -- North Charity Committee
  ('00000000-0000-0000-0000-0000000000c7', 'paul@example.com', now());   -- pending

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Wes Captain', 'Compass', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Fran Full', 'Sparks', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'Nina Charity', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c7', 'west', 'Paul Pending', null, 'introduced', 'pending')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'charity_committee')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;

-- Rides: a West charity run in 10 days, a cancelled one, and a supported all-day run in 12 days.
insert into rides (id, source, starts_at, title, category, cancelled_at, all_day, location) values
  ('00000000-0000-0000-0000-00000000dd01', 'app', now() + interval '10 days', 'Ride for Kids', 'west', null, false, 'Sunbury BP'),
  ('00000000-0000-0000-0000-00000000dd02', 'app', now() + interval '11 days', 'Rained out', 'west', now(), false, null),
  ('00000000-0000-0000-0000-00000000dd04', 'app', now() + interval '12 days', 'Toy Run', 'supported', null, true, null);

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

-- Runs a statement with the service role (how site-api calls in) and returns its error, or null.
create function pg_temp.try_service(stmt text) returns text language plpgsql as $$
begin
  set local role service_role;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

create function pg_temp.expect(who uuid, stmt text, want text) returns void language plpgsql as $$
declare got text := pg_temp.try_as(who, stmt);
begin
  assert got is not distinct from want, format('%s: wanted %s, got %s', stmt, coalesce(want, 'allowed'), coalesce(got, 'allowed'));
end $$;

create function pg_temp.expect_service(stmt text, want text) returns void language plpgsql as $$
declare got text := pg_temp.try_service(stmt);
begin
  assert got is not distinct from want, format('%s: wanted %s, got %s', stmt, coalesce(want, 'allowed'), coalesce(got, 'allowed'));
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

-- website_signup(ride, name, email, phone, riding, pillion, guests, guest_names, job, notes) as a statement.
create function pg_temp.door(ride text, name text, email text, phone text, riding boolean, pillion boolean, guests int,
  names text, job text, notes text) returns text language sql as $$
  select format('select public.website_signup(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    ride, name, email, phone, riding, pillion, guests, names, job, notes);
$$;

\o
\echo 'The website feed: only rides with the website tick, no member data'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  toys constant text := '00000000-0000-0000-0000-00000000dd04';
  n int;
  r record;
begin
  -- The West board opens Ride for Kids to the website (4 places, one job); the Toy Run stays members-only.
  perform pg_temp.expect(wes, format('select public.save_charity(%L, %L, %L, null, 4, %L::text[], true)', kids, 'Royal Children’s Hospital', 'Gold coin', '{BBQ}'), null);
  perform pg_temp.expect(wes, format('select public.save_charity(%L, %L, null, null, null, %L::text[])', toys, 'Toy Run', '{}'), null);
  assert (select website from charity_rides where ride_id = kids::uuid), 'the tick is kept';
  assert not (select website from charity_rides where ride_id = toys::uuid), 'off by default';

  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select count(*) into n from public.public_charity_rides();
  assert n = 1, format('one ride on the website, got %s', n);
  select * into r from public.public_charity_rides();
  assert r.ride_id = kids::uuid and r.title = 'Ride for Kids' and r.location = 'Sunbury BP' and r.cause = 'Royal Children’s Hospital'
    and r.about = 'Gold coin' and r.jobs = array['BBQ'] and r.places = 4 and r.places_left = 4 and r.open, 'the feed row';
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert pg_temp.count_as(null, 'public.website_signups') = -1, 'anon can’t read website sign-ups';
end $$;

\o
\echo 'The website’s door: refusals in the app’s order, then one list with the members'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  toys constant text := '00000000-0000-0000-0000-00000000dd04';
  w website_signups%rowtype;
  r record;
begin
  -- Nobody but the service role.
  perform pg_temp.expect(null, pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 0, null, null, null), 'permission denied for function website_signup');
  perform pg_temp.expect(wes, pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 0, null, null, null), 'permission denied for function website_signup');

  perform pg_temp.expect_service(pg_temp.door(gen_random_uuid()::text, 'Sam', 'sam@example.com', null, true, false, 0, null, null, null), 'This ride isn’t taking sign-ups from the website.');
  perform pg_temp.expect_service(pg_temp.door(toys, 'Sam', 'sam@example.com', null, true, false, 0, null, null, null), 'This ride isn’t taking sign-ups from the website.');
  perform pg_temp.expect_service(pg_temp.door('00000000-0000-0000-0000-00000000dd02', 'Sam', 'sam@example.com', null, true, false, 0, null, null, null), 'This ride isn’t taking sign-ups from the website.');
  perform pg_temp.expect_service(pg_temp.door(kids, '  ', 'sam@example.com', null, true, false, 0, null, null, null), 'Tell us your name.');
  perform pg_temp.expect_service(pg_temp.door(kids, repeat('x', 81), 'sam@example.com', null, true, false, 0, null, null, null), 'Keep your name to 80 characters.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example', null, true, false, 0, null, null, null), 'That email address does not look right.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', repeat('1', 31), true, false, 0, null, null, null), 'Keep the phone number to 30 characters.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, false, false, 0, null, null, null), 'Say you’re riding, or pick a job to help with.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, false, true, 0, null, 'BBQ', null), 'A pillion needs a rider: say you’re riding too.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 11, null, null, null), 'Guests: 0 to 10.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 0, null, 'Buckets', null), 'That job isn’t on the list.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 0, null, null, repeat('x', 201)), 'Keep it short: 200 characters for guests’ names, 200 for notes.');

  -- Four places. Fran (a member) takes two: her and a pillion.
  perform pg_temp.expect(fran, format('select public.sign_up_charity(%L, true, true, 0, null, null, null)', kids), null);
  -- Sam from the website wants three more: too many.
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam', 'sam@example.com', null, true, false, 2, 'Bec and Joe', null, null), 'The ride’s full.');
  -- Sam alone fits, with a job and trimmed texts; the email is kept lower-case.
  perform pg_temp.expect_service(pg_temp.door(kids, ' Sam Rider ', ' Sam@Example.com ', ' 0400 000 000 ', true, false, 0, null, 'BBQ', ' Late start '), null);
  select * into w from website_signups where ride_id = kids::uuid;
  assert w.name = 'Sam Rider' and w.email = 'sam@example.com' and w.phone = '0400 000 000' and w.riding and w.job = 'BBQ' and w.notes = 'Late start', 'the row kept';
  -- A helper bringing nobody always fits, even now the places are nearly gone.
  perform pg_temp.expect_service(pg_temp.door(kids, 'Kim Helper', 'kim@example.com', null, false, false, 0, null, 'BBQ', null), null);
  -- The same email again replaces Sam's answer rather than adding a second one (and can't take more than the places).
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam Rider', 'sam@example.com', null, true, true, 1, 'Bec', null, null), 'The ride’s full.');
  perform pg_temp.expect_service(pg_temp.door(kids, 'Sam Rider', 'sam@example.com', null, true, true, 0, null, null, 'Pillion now'), null);
  assert (select count(*) from website_signups where ride_id = kids::uuid and email = 'sam@example.com') = 1, 'one row per email per ride';
  assert (select pillion from website_signups where ride_id = kids::uuid and email = 'sam@example.com'), 'the answer replaced';

  -- The ride is now full (2 members + 2 from the website): a member can't add a guest either.
  perform pg_temp.expect(fran, format('select public.sign_up_charity(%L, true, true, 1, %L, null, null)', kids, 'Joe'), 'The ride’s full.');
  -- The feed says so, and the numbers everyone sees include the website people.
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select * into r from public.public_charity_rides();
  reset role;
  assert r.places_left = 0, format('no places left on the website, got %s', r.places_left);
  perform set_config('request.jwt.claim.sub', fran::text, true);
  set local role authenticated;
  select * into r from public.signup_counts() where ride_id = kids::uuid;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert r.charity_people = 2 and r.website_riding = 1 and r.website_pillions = 1 and r.website_guests = 0 and r.website_helping = 1 and r.website_people = 2,
    format('the counts: %s', r);

  -- Closed: the closing day has passed.
  update charity_rides set closes_on = private.club_date() - 1 where ride_id = kids::uuid;
  perform pg_temp.expect_service(pg_temp.door(kids, 'Late Larry', 'larry@example.com', null, false, false, 0, null, 'BBQ', null), 'Sign-ups have closed.');
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select * into r from public.public_charity_rides();
  reset role;
  assert not r.open, 'the feed says closed';
  update charity_rides set closes_on = null where ride_id = kids::uuid;
end $$;

\o
\echo 'Spam limits: thirty an hour from everyone, five a day from one address'
\o /dev/null
do $$
declare
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  i int;
begin
  -- Room to breathe: no places limit for this part.
  update charity_rides set places = null where ride_id = kids::uuid;
  for i in 1..28 loop
    perform pg_temp.expect_service(pg_temp.door(kids, 'Robot ' || i, format('r%s@example.com', i), null, false, false, 0, null, 'BBQ', null), null);
  end loop;
  -- 30 in the last hour now (Sam, Kim and 28 robots).
  perform pg_temp.expect_service(pg_temp.door(kids, 'One More', 'more@example.com', null, false, false, 0, null, 'BBQ', null), 'Too many sign-ups just now. Try again later, or email the club.');
  -- Older than an hour doesn't count.
  update website_signups set created_at = now() - interval '2 hours', updated_at = now() - interval '2 hours' where name like 'Robot %';
  perform pg_temp.expect_service(pg_temp.door(kids, 'One More', 'more@example.com', null, false, false, 0, null, 'BBQ', null), null);
  -- One address, five times today (across rides): the sixth is refused.
  insert into rides (id, source, starts_at, title, category) select gen_random_uuid(), 'app', now() + interval '20 days', 'Run ' || g, 'west' from generate_series(1, 5) g;
  insert into charity_rides (ride_id, cause, website) select id, 'Cause', true from rides where title like 'Run %';
  insert into website_signups (ride_id, name, email, riding) select id, 'Busy Bee', 'bee@example.com', true from rides where title like 'Run %';
  perform pg_temp.expect_service(pg_temp.door(kids, 'Busy Bee', 'bee@example.com', null, true, false, 0, null, null, null), 'Too many sign-ups just now. Try again later, or email the club.');
end $$;

\o
\echo 'Who reads website sign-ups, and organisers removing one'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  nina constant uuid := '00000000-0000-0000-0000-0000000000c5';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  sam uuid;
  total bigint;
begin
  select count(*) into total from website_signups where ride_id = kids::uuid;
  assert pg_temp.count_as(wes, 'public.website_signups') = total + 5, 'the West board sees the West rides’ website sign-ups';
  assert pg_temp.count_as(nina, 'public.website_signups') = total + 5, 'the Charity Committee sees them all';
  assert pg_temp.count_as(fran, 'public.website_signups') = 0, 'a plain member sees none';
  assert pg_temp.count_as(paul, 'public.website_signups') = 0, 'an applicant sees none';
  -- No writes through the API.
  perform pg_temp.expect(wes, format('insert into public.website_signups (ride_id, name, email, riding) values (%L, %L, %L, true)', kids, 'X', 'x@example.com'), 'permission denied for table website_signups');
  perform pg_temp.expect(wes, 'delete from public.website_signups', 'permission denied for table website_signups');

  select id into sam from website_signups where email = 'sam@example.com';
  perform pg_temp.expect(null, format('select public.remove_website_signup(%L)', sam), 'permission denied for function remove_website_signup');
  perform pg_temp.expect(paul, format('select public.remove_website_signup(%L)', sam), 'Only approved members can do that.');
  perform pg_temp.expect(fran, format('select public.remove_website_signup(%L)', sam), 'No such sign-up.');
  perform pg_temp.expect(wes, format('select public.remove_website_signup(%L)', gen_random_uuid()), 'No such sign-up.');
  perform pg_temp.expect(wes, format('select public.remove_website_signup(%L)', sam), null);
  assert not exists (select 1 from website_signups where id = sam), 'Sam removed';
  -- After the ride day nothing changes.
  update rides set starts_at = now() - interval '2 days' where id = kids::uuid;
  perform pg_temp.expect(wes, format('select public.remove_website_signup(%L)', (select id from website_signups where email = 'kim@example.com')), 'Sign-ups can’t change after the ride day.');
  -- A ride that's gone takes its website sign-ups with it.
  delete from charity_rides where ride_id = kids::uuid;
  assert not exists (select 1 from website_signups where ride_id = kids::uuid), 'gone with the sheet';
end $$;

\o
\echo 'website_signups: all checks passed'
