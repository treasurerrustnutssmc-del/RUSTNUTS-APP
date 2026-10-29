-- Checks charity ride sign-ups: running them (the ride's crew managers and the Charity Committee),
-- signing up to ride or help, places, and withdrawing. Each refusal in the same words and order as
-- the app's rules (src/domain/charity.ts), the happy paths, who can read what, and no writes
-- through the API.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'cara@example.com', now()),   -- NEC Chairman
  ('00000000-0000-0000-0000-0000000000c2', 'wes@example.com', now()),    -- West Road Captain (board)
  ('00000000-0000-0000-0000-0000000000c3', 'fran@example.com', now()),   -- Full, West
  ('00000000-0000-0000-0000-0000000000c4', 'gus@example.com', now()),    -- Full, West
  ('00000000-0000-0000-0000-0000000000c5', 'nina@example.com', now()),   -- North Charity Committee
  ('00000000-0000-0000-0000-0000000000c6', 'sue@example.com', now()),    -- Supporter
  ('00000000-0000-0000-0000-0000000000c7', 'paul@example.com', now()),   -- pending
  ('00000000-0000-0000-0000-0000000000c8', 'olly@example.com', now());   -- North board

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'north', 'Cara Chair', 'Gavel', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Wes Captain', 'Compass', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Fran Full', 'Sparks', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c4', 'west', 'Gus Full', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'Nina Charity', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c6', 'west', 'Sue Supporter', null, 'supporter', 'approved'),
  ('00000000-0000-0000-0000-0000000000c7', 'west', 'Paul Pending', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000c8', 'north', 'Olly North', null, 'full', 'approved')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000c1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'charity_committee'),
  ('00000000-0000-0000-0000-0000000000c8', 'north', 'secretary')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;

-- Rides: a West charity run in 10 days, a cancelled one, one three days ago, and an all-day
-- supported run in 12 days.
insert into rides (id, source, starts_at, title, category, cancelled_at, all_day) values
  ('00000000-0000-0000-0000-00000000dd01', 'app', now() + interval '10 days', 'Ride for Kids', 'west', null, false),
  ('00000000-0000-0000-0000-00000000dd02', 'app', now() + interval '11 days', 'Rained out', 'west', now(), false),
  ('00000000-0000-0000-0000-00000000dd03', 'app', now() - interval '3 days', 'Last week', 'west', null, false),
  ('00000000-0000-0000-0000-00000000dd04', 'app', now() + interval '12 days', 'Toy Run', 'supported', null, true);

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

-- save_charity(ride, cause, about, closes_on, places, jobs) as a statement.
create function pg_temp.save(ride text, cause text, about text, closes date, places int, jobs text[]) returns text language sql as $$
  select format('select public.save_charity(%L, %L, %L, %L, %s, %L::text[])', ride, cause, about, closes, coalesce(places::text, 'null'), jobs);
$$;
-- sign_up_charity(ride, riding, pillion, guests, guest_names, job, notes) as a statement.
create function pg_temp.sign(ride text, riding boolean, pillion boolean, guests int, names text, job text, notes text) returns text language sql as $$
  select format('select public.sign_up_charity(%L, %L, %L, %L, %L, %L, %L)', ride, riding, pillion, guests, names, job, notes);
$$;

\o
\echo 'Running sign-ups: the ride’s managers and the Charity Committee, in the app’s order'
\o /dev/null
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000c1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  nina constant uuid := '00000000-0000-0000-0000-0000000000c5';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  olly constant uuid := '00000000-0000-0000-0000-0000000000c8';
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  toys constant text := '00000000-0000-0000-0000-00000000dd04';
  c charity_rides%rowtype;
begin
  perform pg_temp.expect(null, pg_temp.save(kids, 'RCH', null, null, null, '{}'), 'permission denied for function save_charity');
  perform pg_temp.expect(paul, pg_temp.save(kids, 'RCH', null, null, null, '{}'), 'Only approved members can do that.');
  perform pg_temp.expect(cara, pg_temp.save(gen_random_uuid()::text, 'RCH', null, null, null, '{}'), 'No such ride.');
  perform pg_temp.expect(cara, pg_temp.save('00000000-0000-0000-0000-00000000dd02', 'RCH', null, null, null, '{}'), 'That ride was cancelled.');
  perform pg_temp.expect(cara, pg_temp.save('00000000-0000-0000-0000-00000000dd03', 'RCH', null, null, null, '{}'), 'Sign-ups can’t change after the ride day.');
  perform pg_temp.expect(fran, pg_temp.save(kids, 'RCH', null, null, null, '{}'), 'Only the board, ride committee, charity committee or NEC can run sign-ups.');
  perform pg_temp.expect(olly, pg_temp.save(kids, 'RCH', null, null, null, '{}'), 'Only the board, ride committee, charity committee or NEC can run sign-ups.');
  perform pg_temp.expect(wes, pg_temp.save(kids, '  ', null, null, null, '{}'), 'Say who the ride is raising money for.');
  perform pg_temp.expect(wes, pg_temp.save(kids, null, null, null, null, '{}'), 'Say who the ride is raising money for.');
  perform pg_temp.expect(wes, pg_temp.save(kids, repeat('x', 121), null, null, null, '{}'), 'That’s too long: 120 characters for the cause, 1000 for the rest.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', repeat('x', 1001), null, null, '{}'), 'That’s too long: 120 characters for the cause, 1000 for the rest.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, 0, '{}'), 'Places: 1 to 2000, or leave it blank.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, 2001, '{}'), 'Places: 1 to 2000, or leave it blank.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, null, '{a,b,c,d,e,f,g,h,i}'), 'Up to 8 helper jobs, 40 characters each.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, null, array[repeat('x', 41)]), 'Up to 8 helper jobs, 40 characters each.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, null, array['BBQ', ' bbq ']), 'Each job once.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, private.club_date() - 1, null, '{}'), 'Pick a closing day from today up to the ride day.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, private.club_date() + 20, null, '{}'), 'Pick a closing day from today up to the ride day.');

  -- The West board opens it: texts trimmed, blank jobs dropped.
  perform pg_temp.expect(wes, pg_temp.save(kids, ' Royal Children’s Hospital ', '', null, 5, array[' BBQ ', '', 'Marshal']), null);
  select * into c from charity_rides where ride_id = kids::uuid;
  assert c.cause = 'Royal Children’s Hospital', 'cause trimmed';
  assert c.about is null, 'blank about kept as none';
  assert c.jobs = array['BBQ', 'Marshal'], 'jobs trimmed, blanks dropped';
  assert c.places = 5 and c.updated_by = wes, 'places and who';
  -- The North Charity Committee runs a West ride, and a supported one; the NEC too.
  perform pg_temp.expect(nina, pg_temp.save(kids, 'Royal Children’s Hospital', 'Gold coin', null, 5, array['BBQ', 'Marshal']), null);
  perform pg_temp.expect(nina, pg_temp.save(toys, 'Toy Run', null, private.club_date(), null, '{}'), null);
  perform pg_temp.expect(cara, pg_temp.save(toys, 'Toy Run', null, private.club_date(), null, '{}'), null);
end $$;

\o
\echo 'Signing up: ride or help, pillions and guests, places, closing, in the app’s order'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000c2';
  fran constant uuid := '00000000-0000-0000-0000-0000000000c3';
  gus constant uuid := '00000000-0000-0000-0000-0000000000c4';
  nina constant uuid := '00000000-0000-0000-0000-0000000000c5';
  sue constant uuid := '00000000-0000-0000-0000-0000000000c6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000c7';
  kids constant text := '00000000-0000-0000-0000-00000000dd01';
  toys constant text := '00000000-0000-0000-0000-00000000dd04';
  s charity_signups%rowtype;
begin
  perform pg_temp.expect(null, pg_temp.sign(kids, true, false, 0, null, null, null), 'permission denied for function sign_up_charity');
  perform pg_temp.expect(paul, pg_temp.sign(kids, true, false, 0, null, null, null), 'Only approved members can do that.');
  perform pg_temp.expect(fran, pg_temp.sign(gen_random_uuid()::text, true, false, 0, null, null, null), 'No such ride.');
  perform pg_temp.expect(fran, pg_temp.sign('00000000-0000-0000-0000-00000000dd02', true, false, 0, null, null, null), 'That ride was cancelled.');
  perform pg_temp.expect(fran, pg_temp.sign('00000000-0000-0000-0000-00000000dd03', true, false, 0, null, null, null), 'This ride doesn’t take sign-ups.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, false, false, 0, null, null, null), 'Say you’re riding, or pick a job to help with.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, false, true, 0, null, 'BBQ', null), 'A pillion needs a rider: say you’re riding too.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, false, -1, null, null, null), 'Guests: 0 to 10.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, false, 11, null, null, null), 'Guests: 0 to 10.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, false, 0, null, 'Buckets', null), 'That job isn’t on the list.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, false, 0, repeat('x', 201), null, null), 'Keep it short: 200 characters for guests’ names, 200 for notes.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, false, 0, null, null, repeat('x', 201)), 'Keep it short: 200 characters for guests’ names, 200 for notes.');

  -- Five places. Fran takes three (her, a pillion, a guest).
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, true, 1, ' Bec ', 'Marshal', ' Hi-vis on '), null);
  select * into s from charity_signups where ride_id = kids::uuid and member_id = fran;
  assert s.guest_names = 'Bec' and s.notes = 'Hi-vis on' and s.job = 'Marshal' and s.withdrawn_at is null, 'trimmed and kept';
  -- Supporters sign up to charity rides.
  perform pg_temp.expect(sue, pg_temp.sign(kids, true, true, 1, null, null, null), 'The ride’s full.');
  perform pg_temp.expect(sue, pg_temp.sign(kids, true, true, 0, null, null, null), null);
  -- Full now; a helper bringing nobody still fits, and a change to your own sign-up isn't counted twice.
  perform pg_temp.expect(gus, pg_temp.sign(kids, true, false, 0, null, null, null), 'The ride’s full.');
  perform pg_temp.expect(gus, pg_temp.sign(kids, false, false, 0, null, 'BBQ', null), null);
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, true, 1, null, 'Marshal', null), null);
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, true, 2, null, 'Marshal', null), 'The ride’s full.');

  -- A job someone's on stays on the list; a withdrawn helper doesn't hold it.
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, 5, array['Marshal']), 'Someone’s helping with “BBQ”, so keep that job.');

  -- Withdrawing.
  perform pg_temp.expect(nina, format('select public.withdraw_charity(%L)', kids), 'You’re not signed up.');
  perform pg_temp.expect(gus, format('select public.withdraw_charity(%L)', kids), null);
  assert (select withdrawn_at from charity_signups where ride_id = kids::uuid and member_id = gus) is not null, 'withdrawn';
  perform pg_temp.expect(gus, format('select public.withdraw_charity(%L)', kids), 'You’re not signed up.');
  perform pg_temp.expect(wes, pg_temp.save(kids, 'RCH', null, null, 5, array['Marshal']), null);
  perform pg_temp.expect(gus, pg_temp.sign(kids, false, false, 0, null, 'BBQ', null), 'That job isn’t on the list.');
  -- Signing up again brings the row back.
  perform pg_temp.expect(gus, pg_temp.sign(kids, false, false, 0, null, 'Marshal', null), null);
  assert (select withdrawn_at from charity_signups where ride_id = kids::uuid and member_id = gus) is null, 'back';

  -- The Toy Run closes today: open all day.
  perform pg_temp.expect(gus, pg_temp.sign(toys, true, false, 0, null, null, null), null);
  update charity_rides set closes_on = private.club_date() - 1 where ride_id = toys::uuid;
  perform pg_temp.expect(fran, pg_temp.sign(toys, true, false, 0, null, null, null), 'Sign-ups have closed.');
  -- Withdrawing still works after the closing day, until the start.
  perform pg_temp.expect(gus, format('select public.withdraw_charity(%L)', toys), null);
  -- After the start, neither.
  update rides set starts_at = now() - interval '1 hour', all_day = false where id = toys::uuid;
  update charity_rides set closes_on = null where ride_id = toys::uuid;
  perform pg_temp.expect(gus, pg_temp.sign(toys, true, false, 0, null, null, null), 'Sign-ups have closed.');
  perform pg_temp.expect(fran, pg_temp.sign(kids, true, true, 1, null, 'Marshal', null), null);
  update rides set starts_at = now() - interval '1 hour' where id = kids::uuid;
  perform pg_temp.expect(fran, format('select public.withdraw_charity(%L)', kids), 'Sign-ups have closed.');
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
  foreach t in array array['charity_rides', 'charity_signups'] loop
    assert pg_temp.count_as(fran, 'public.' || t) > 0, format('%s: members read it', t);
    assert pg_temp.count_as(paul, 'public.' || t) = 0, format('%s: applicants read nothing', t);
    assert pg_temp.count_as(null, 'public.' || t) = -1, format('%s: the public can’t select', t);
  end loop;
  perform pg_temp.expect(fran, 'update public.charity_rides set places = 1', 'permission denied for table charity_rides');
  perform pg_temp.expect(fran, 'update public.charity_signups set guests = 9', 'permission denied for table charity_signups');
  perform pg_temp.expect(fran, format('insert into public.charity_signups (ride_id, member_id) values (%L, %L)',
    '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000c4'), 'permission denied for table charity_signups');
end $$;

\o
\echo 'CHARITY SIGN-UP CHECKS PASSED'
