-- Checks the Rusty Bus: book_bus, decide_bus and cancel_bus, with the refusals in the same words and
-- order as src/domain/bus.ts, who manages the bus (the NEC or any board seat in any chapter), who can
-- book (approved Full and Nomad members, plus managers), the day limits counted from the Melbourne
-- date, booked straight away (a manager, or a recovery today or tomorrow), the clash edges (sharing a
-- day clashes, touching doesn't, only Booked bookings block), past days, trimming and the limits in
-- code points, who can read what, no writes through the API, the exclusion constraint, the lock, and
-- two managers saying yes at once from two sessions.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'cara@example.com', now()),     -- NEC Chairman (North member)
  ('00000000-0000-0000-0000-0000000000b2', 'wes@example.com', now()),      -- West President (so on the NEC)
  ('00000000-0000-0000-0000-0000000000b3', 'sam@example.com', now()),      -- West Secretary: a board seat
  ('00000000-0000-0000-0000-0000000000b4', 'nora@example.com', now()),     -- North Road Captain: a board seat
  ('00000000-0000-0000-0000-0000000000b5', 'fergus@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-0000000000b6', 'pete@example.com', now()),     -- Supporter, once West President
  ('00000000-0000-0000-0000-0000000000b7', 'fran@example.com', now()),     -- Full
  ('00000000-0000-0000-0000-0000000000b8', 'nick@example.com', now()),     -- Nomad
  ('00000000-0000-0000-0000-0000000000b9', 'paul@example.com', now()),     -- pending
  ('00000000-0000-0000-0000-0000000000ba', 'rita@example.com', now()),     -- Supporter on the Ride Committee
  ('00000000-0000-0000-0000-0000000000bb', 'stranger@example.com', now()), -- signed in, no record
  ('00000000-0000-0000-0000-0000000000bc', 'tess@example.com', now()),     -- Supporter, West Treasurer: a board seat
  ('00000000-0000-0000-0000-0000000000bd', 'sid@example.com', now());      -- Full, suspended, North Sergeant at Arms

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000b1', 'north', 'Cara Chair', 'Gavel', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'west', 'Wes President', 'Prez', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'west', 'Sam Secretary', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'north', 'Nora Captain', 'Compass', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b5', 'west', 'Fergus FNG', null, 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000b6', 'west', 'Pete Past', null, 'supporter', 'approved'),
  ('00000000-0000-0000-0000-0000000000b7', 'west', 'Fran Full', 'Sparks', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b8', 'north', 'Nick Nomad', 'Drifter', 'nomad', 'approved'),
  ('00000000-0000-0000-0000-0000000000b9', 'west', 'Paul Pending', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000ba', 'west', 'Rita Rides', null, 'supporter', 'approved'),
  ('00000000-0000-0000-0000-0000000000bc', 'west', 'Tess Treasurer', null, 'supporter', 'approved'),
  ('00000000-0000-0000-0000-0000000000bd', 'north', 'Sid Suspended', null, 'full', 'suspended')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000b1', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000b2', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000b3', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000b4', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000ba', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000000bc', 'west', 'treasurer'),
  ('00000000-0000-0000-0000-0000000000bd', 'north', 'sergeant_at_arms')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;
-- An ended seat gives no powers: Pete was West President once.
insert into positions (member_id, chapter_id, role, started_on, ended_on)
select '00000000-0000-0000-0000-0000000000b6', id, 'president', current_date - 400, current_date - 30
from chapters where slug = 'west';

-- Two rides: one on the calendar, one cancelled.
insert into rides (id, source, starts_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000aa01', 'app', now() + interval '20 days', 'Ride for Kids', 'supported', null),
  ('00000000-0000-0000-0000-00000000aa02', 'app', now() + interval '21 days', 'Rained out', 'club', now());

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

-- The same, as the authenticated role with no user at all (a lost session).
create function pg_temp.try_signed_out(stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
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

-- The book_bus call for these values.
create function pg_temp.book_sql(first date, last date, purpose text, ride uuid, driver uuid, notes text)
returns text language sql as $$
  select format('select public.book_bus(%L, %L, %L, %L, %L, %L)', first, last, purpose, ride, driver, notes);
$$;

-- book_bus as someone: its error, or null.
create function pg_temp.book(who uuid, first date, last date, purpose text, ride uuid, driver uuid, notes text)
returns text language sql as $$
  select pg_temp.try_as(who, pg_temp.book_sql(first, last, purpose, ride, driver, notes));
$$;

-- book_bus as someone, returning the new booking's id.
create function pg_temp.booked(who uuid, first date, last date, purpose text, ride uuid, driver uuid, notes text)
returns uuid language sql as $$
  select pg_temp.value_as(who, pg_temp.book_sql(first, last, purpose, ride, driver, notes))::uuid;
$$;

-- decide_bus and cancel_bus as someone: the error, or null.
create function pg_temp.decide(who uuid, booking uuid, yes boolean, reason text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.decide_bus(%L, %L, %L)', booking, yes, reason));
$$;
create function pg_temp.cancel(who uuid, booking uuid) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.cancel_bus(%L)', booking));
$$;

-- Puts a booking straight in the table (as the test's owner), for the cases the actions can't make.
create function pg_temp.put(first date, last date, status text, booker uuid, purpose text default 'other')
returns uuid language sql as $$
  insert into public.bus_bookings (first_day, last_day, purpose, status, booked_by, driver_id)
  values (first, last, purpose::public.bus_purpose, status::public.bus_status, booker, booker)
  returning id;
$$;

-- private.manages_bus for someone, called directly (members can't call it through the API).
create function pg_temp.manages(who uuid) returns boolean language plpgsql as $$
declare out boolean;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  out := private.manages_bus();
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

-- The status of a booking.
create function pg_temp.status_of(p_id uuid) returns text language sql stable as $$
  select status::text from public.bus_bookings where id = p_id;
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.try_signed_out(text), pg_temp.value_as(uuid, text),
  pg_temp.count_as(uuid, text), pg_temp.book_sql(date, date, text, uuid, uuid, text),
  pg_temp.book(uuid, date, date, text, uuid, uuid, text), pg_temp.booked(uuid, date, date, text, uuid, uuid, text),
  pg_temp.decide(uuid, uuid, boolean, text), pg_temp.cancel(uuid, uuid) to anon, authenticated;

\o
\echo 'Rusty Bus actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
declare
  fns constant regprocedure[] := array[
    'public.book_bus(date, date, public.bus_purpose, uuid, uuid, text)'::regprocedure,
    'public.decide_bus(uuid, boolean, text)'::regprocedure,
    'public.cancel_bus(uuid)'::regprocedure];
  f regprocedure;
  manages constant regprocedure := 'private.manages_bus()'::regprocedure;
begin
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid = any (fns)),
    'definer, empty search_path';
  foreach f in array fns loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
    assert not has_function_privilege('public', f, 'execute'), format('public can''t run %s', f);
    assert has_function_privilege('authenticated', f, 'execute'), format('members can run %s', f);
  end loop;
  assert (select prorettype = 'uuid'::regtype from pg_proc where oid = fns[1]), 'book returns the new id';
  assert (select prorettype = 'void'::regtype from pg_proc where oid = fns[2]), 'decide returns nothing';
  assert (select prorettype = 'void'::regtype from pg_proc where oid = fns[3]), 'cancel returns nothing';

  assert (select prorettype = 'boolean'::regtype and provolatile = 's' and proconfig @> array['search_path=""']
          from pg_proc where oid = manages), 'manages_bus: a stable yes or no, empty search_path';
  assert not has_function_privilege('anon', manages, 'execute'), 'anon can''t run manages_bus';
  assert not has_function_privilege('public', manages, 'execute'), 'public can''t run manages_bus';
  assert not has_function_privilege('authenticated', manages, 'execute'), 'members can''t run manages_bus';

  assert pg_temp.book(null, private.club_date(), private.club_date(), 'recovery', null, null, null) is not null,
    'the public can''t book';
  assert pg_temp.decide(null, gen_random_uuid(), true, null) is not null, 'nor decide';
  assert pg_temp.cancel(null, gen_random_uuid()) is not null, 'nor cancel';
  assert not exists (select 1 from bus_bookings), 'nothing was written';
end $$;

\echo 'Bus managers: the NEC, or a sitting board seat in any chapter; not an ended seat, the Ride Committee or a suspended member'
do $$
begin
  assert pg_temp.manages('00000000-0000-0000-0000-0000000000b1'), 'the NEC Chairman';
  assert pg_temp.manages('00000000-0000-0000-0000-0000000000b2'), 'a sitting President';
  assert pg_temp.manages('00000000-0000-0000-0000-0000000000b3'), 'a West Secretary';
  assert pg_temp.manages('00000000-0000-0000-0000-0000000000b4'), 'a North Road Captain';
  assert pg_temp.manages('00000000-0000-0000-0000-0000000000bc'), 'a Treasurer, even a Supporter';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000b6'), 'a President whose seat ended';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000ba'), 'the Ride Committee isn''t a board seat';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000bd'), 'a suspended Sergeant at Arms';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000b7'), 'a Full member';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000b5'), 'an FNG';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000b9'), 'an applicant';
  assert not pg_temp.manages('00000000-0000-0000-0000-0000000000bb'), 'a stranger';
  assert not pg_temp.manages(null), 'nobody';
end $$;

\echo 'Booking: signed in, approved, then Full, Nomad or a bus manager, before anything else'
do $$
declare
  t constant date := private.club_date();
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  pete constant uuid := '00000000-0000-0000-0000-0000000000b6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  rita constant uuid := '00000000-0000-0000-0000-0000000000ba';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000bb';
  sid constant uuid := '00000000-0000-0000-0000-0000000000bd';
  approved constant text := 'Only approved members can do that.';
  not_full constant text := 'Only Full and Nomad members can book the Rusty Bus.';
begin
  assert pg_temp.try_signed_out(pg_temp.book_sql(t, t, 'recovery', null, null, null)) = 'Sign in first.', 'signed out';
  assert pg_temp.try_signed_out(pg_temp.book_sql(null, null, null, gen_random_uuid(), gen_random_uuid(), repeat('x', 501)))
    = 'Sign in first.', 'signed out comes before everything';
  assert pg_temp.book(paul, t, t, 'recovery', null, paul, null) = approved, 'an applicant';
  assert pg_temp.book(stranger, t, t, 'recovery', null, stranger, null) = approved, 'no record';
  assert pg_temp.book(sid, t, t, 'recovery', null, sid, null) = approved, 'a suspended Full member with a board seat';
  assert pg_temp.book(paul, null, null, null, gen_random_uuid(), null, repeat('x', 501)) = approved,
    'approved comes before everything else';
  assert pg_temp.book(fergus, t + 5, t + 5, 'charity_ride', null, fergus, null) = not_full, 'an FNG';
  assert pg_temp.book(pete, t + 5, t + 5, 'charity_ride', null, pete, null) = not_full, 'a Supporter whose board seat ended';
  assert pg_temp.book(rita, t + 5, t + 5, 'charity_ride', null, rita, null) = not_full, 'a Supporter on the Ride Committee';
  assert pg_temp.book(fergus, null, t - 9, null, gen_random_uuid(), gen_random_uuid(), repeat('x', 501)) = not_full,
    'who books comes before the days';
  assert not exists (select 1 from bus_bookings), 'nothing was booked';
end $$;

\echo 'Then the days, in order: both given, last not before first, not in the past, 14 days at most, 12 months ahead at most'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  missing constant text := 'Pick the first and last day.';
  backwards constant text := 'The last day can’t be before the first.';
  past constant text := 'Bookings can’t start in the past.';
  too_long constant text := 'Keep a booking to 14 days at most.';
  too_far constant text := 'Book at most 12 months ahead.';
  year_on constant date := (t + interval '1 year')::date;
begin
  assert pg_temp.book(fran, null, t + 3, 'other', null, fran, null) = missing, 'no first day';
  assert pg_temp.book(fran, t + 3, null, 'other', null, fran, null) = missing, 'no last day';
  assert pg_temp.book(fran, null, null, null, gen_random_uuid(), gen_random_uuid(), repeat('x', 501)) = missing,
    'missing days come before everything after';

  assert pg_temp.book(fran, t + 3, t + 2, 'other', null, fran, null) = backwards, 'last before first';
  assert pg_temp.book(fran, t - 1, t - 2, 'other', null, fran, null) = backwards, 'backwards comes before the past';
  assert pg_temp.book(fran, t + 400, t + 2, null, null, null, null) = backwards, 'and before the rest';

  assert pg_temp.book(fran, t - 1, t, 'recovery', null, fran, null) = past, 'starting yesterday';
  assert pg_temp.book(fran, t - 1, t - 1, 'recovery', null, fran, null) = past, 'yesterday only';
  assert pg_temp.book(fran, t - 30, t, null, gen_random_uuid(), null, repeat('x', 501)) = past,
    'the past comes before the length and the rest';

  assert pg_temp.book(fran, t + 3, t + 17, 'other', null, fran, null) = too_long, '15 days';
  assert pg_temp.book(fran, t, t + 14, 'recovery', null, fran, null) = too_long, '15 days from today';
  assert pg_temp.book(fran, year_on, year_on + 20, 'other', null, fran, null) = too_long,
    'the length comes before how far ahead';

  assert pg_temp.book(fran, year_on + 1, year_on + 1, 'other', null, fran, null) = too_far, 'a year and a day ahead';
  assert pg_temp.book(fran, year_on + 1, year_on + 2, null, gen_random_uuid(), null, repeat('x', 501)) = too_far,
    'how far ahead comes before the purpose and the rest';
  assert not exists (select 1 from bus_bookings), 'nothing was booked';
end $$;

\echo 'Then the purpose, the ride, the driver and the notes, in that order'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  sid constant uuid := '00000000-0000-0000-0000-0000000000bd';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000bb';
  ride constant uuid := '00000000-0000-0000-0000-00000000aa01';
  rained_out constant uuid := '00000000-0000-0000-0000-00000000aa02';
  no_purpose constant text := 'Pick what it’s for.';
  no_ride constant text := 'That ride isn’t on the calendar.';
  no_driver constant text := 'Pick a driver who’s an approved member.';
  long_notes constant text := 'Keep the notes to 500 characters at most.';
begin
  assert pg_temp.book(fran, t + 3, t + 3, null, null, fran, null) = no_purpose, 'no purpose';
  assert pg_temp.book(fran, t + 3, t + 3, null, gen_random_uuid(), null, repeat('x', 501)) = no_purpose,
    'the purpose comes before the ride and the rest';

  assert pg_temp.book(fran, t + 3, t + 3, 'charity_ride', gen_random_uuid(), fran, null) = no_ride, 'a ride that isn''t there';
  assert pg_temp.book(fran, t + 3, t + 3, 'charity_ride', rained_out, fran, null) = no_ride, 'a cancelled ride';
  assert pg_temp.book(fran, t + 3, t + 3, 'charity_ride', rained_out, null, repeat('x', 501)) = no_ride,
    'the ride comes before the driver and the notes';

  assert pg_temp.book(fran, t + 3, t + 3, 'other', ride, null, null) = no_driver, 'no driver';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, gen_random_uuid(), null) = no_driver, 'a driver who isn''t there';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, paul, null) = no_driver, 'an applicant';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, sid, null) = no_driver, 'a suspended member';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, stranger, null) = no_driver, 'someone with no record';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, null, repeat('x', 501)) = no_driver,
    'the driver comes before the notes';

  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, fran, repeat('x', 501)) = long_notes, '501 characters';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, fran, repeat('🚐', 501)) = long_notes, '501 code points';
  assert pg_temp.book(fran, t + 3, t + 3, 'other', null, fran, repeat('é', 501)) = long_notes, '501 accented letters';
  assert not exists (select 1 from bus_bookings), 'nothing was booked';
end $$;

\echo 'A booking that waits: trimmed, at the limits, blank notes stored as none, the booker and now, its id returned'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  ride constant uuid := '00000000-0000-0000-0000-00000000aa01';
  year_on constant date := (t + interval '1 year')::date;
  new_id uuid;
  b bus_bookings%rowtype;
begin
  new_id := pg_temp.booked(fran, t + 20, t + 33, 'charity_ride', ride, fergus, E'\n  ' || repeat('🚐', 500) || E' \t　');
  select * into b from bus_bookings where bus_bookings.id = new_id;
  assert found, 'the returned id is the booking';
  assert b.first_day = t + 20 and b.last_day = t + 33, '14 days is fine';
  assert b.purpose = 'charity_ride' and b.ride_id = ride and b.driver_id = fergus, 'a charity ride, Fergus driving';
  assert b.notes = repeat('🚐', 500), '500 code points, trimmed';
  assert b.status = 'requested', 'a Full member''s charity ride waits for a yes';
  assert b.booked_by = fran and b.booked_at = now(), 'Fran, now';
  assert b.decided_by is null and b.decided_at is null and b.decline_reason is null, 'not decided';
  assert b.cancelled_by is null and b.cancelled_at is null, 'not cancelled';

  new_id := pg_temp.booked(nick, year_on, year_on, 'club_event', null, nick, E' \t\r\n　﻿ ');
  select * into b from bus_bookings where bus_bookings.id = new_id;
  assert b.first_day = year_on and b.status = 'requested', 'a Nomad, exactly 12 months ahead';
  assert b.notes is null, 'blank notes are none';
  new_id := pg_temp.booked(nick, t, t, 'other', null, nick, null);
  assert pg_temp.status_of(new_id) = 'requested', 'today is fine, and an Other for today still waits';
  assert (select notes is null from bus_bookings where bus_bookings.id = new_id), 'no notes at all';
  -- Undone, so the clash checks below start from nothing.
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

-- book_bus as someone as if today (in Melbourne) were p_today: 'ok' or its error. The club's clock
-- is swapped for the call and put back after it, and the booking is undone.
create function pg_temp.book_on(p_today date, who uuid, first date, last date) returns text language plpgsql as $$
declare out text;
begin
  execute format($f$create or replace function private.club_date(at_time timestamptz default now())
    returns date language sql stable set search_path = '' as $b$select %L::date$b$ $f$, p_today);
  out := coalesce(pg_temp.book(who, first, last, 'other', null, who, null), 'ok');
  raise sqlstate 'U0002' using message = out;
exception when sqlstate 'U0002' then
  return sqlerrm;
end $$;

\echo '12 months ahead is the same date a year on: from 29 February, 28 February'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  too_far constant text := 'Book at most 12 months ahead.';
begin
  assert pg_temp.book_on('2028-02-29', fran, '2029-02-28', '2029-02-28') = 'ok', '29 Feb 2028 to 28 Feb 2029';
  assert pg_temp.book_on('2028-02-29', fran, '2029-03-01', '2029-03-01') = too_far, 'not 1 March';
  assert pg_temp.book_on('2027-02-28', fran, '2028-02-28', '2028-02-28') = 'ok', '28 Feb 2027 to 28 Feb 2028';
  assert pg_temp.book_on('2027-02-28', fran, '2028-02-29', '2028-02-29') = too_far, 'not 29 Feb 2028';
  assert pg_temp.book_on('2026-12-31', fran, '2027-12-31', '2028-01-13') = 'ok', 'over the new year, 14 days';
  assert pg_temp.book_on('2026-12-31', fran, '2026-12-30', '2026-12-31') = 'Bookings can’t start in the past.',
    'the day before the swapped today is the past';
  assert private.club_date() = (now() at time zone 'Australia/Melbourne')::date, 'the real clock is back';
  assert not exists (select 1 from bus_bookings), 'nothing was kept';
end $$;

\echo 'Booked straight away: a manager, or a recovery today or tomorrow; anything else waits'
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  tess constant uuid := '00000000-0000-0000-0000-0000000000bc';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  new_id uuid;
  b bus_bookings%rowtype;
begin
  new_id := pg_temp.booked(fran, t, t + 1, 'recovery', null, fergus, null);
  select * into b from bus_bookings where bus_bookings.id = new_id;
  assert b.status = 'approved', 'a Full member''s recovery from today is booked at once';
  assert b.decided_by = fran and b.decided_at = now(), 'decided by Fran, now';
  assert b.decline_reason is null, 'with no reason';

  new_id := pg_temp.booked(nick, t + 2, t + 4, 'recovery', null, nick, null);
  assert pg_temp.status_of(new_id) = 'requested', 'a recovery from 2 days on waits, even next to a Booked one';
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  tess constant uuid := '00000000-0000-0000-0000-0000000000bc';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  new_id uuid;
begin
  -- Tomorrow, on its own.
  new_id := pg_temp.booked(nick, t + 1, t + 3, 'recovery', null, nick, null);
  assert pg_temp.status_of(new_id) = 'approved', 'a Nomad''s recovery from tomorrow is booked at once';
  assert (select decided_by = nick and decided_at = now() from bus_bookings where bus_bookings.id = new_id),
    'decided by Nick';
  new_id := pg_temp.booked(fran, t + 4, t + 4, 'recovery', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'a recovery in 4 days waits';
  assert (select decided_by is null and decided_at is null from bus_bookings where bus_bookings.id = new_id),
    'undecided';
  new_id := pg_temp.booked(fran, t, t, 'charity_ride', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'a charity ride today waits';
  new_id := pg_temp.booked(cara, t + 40, t + 41, 'club_event', null, fran, null);
  assert pg_temp.status_of(new_id) = 'approved', 'the NEC''s club event is booked at once';
  assert (select decided_by = cara and decided_at = now() from bus_bookings where bus_bookings.id = new_id),
    'decided by Cara';
  new_id := pg_temp.booked(tess, t + 50, t + 50, 'other', null, tess, null);
  assert pg_temp.status_of(new_id) = 'approved', 'a Supporter with a board seat books, at once';
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

\echo 'A clash on straight away is refused; a waiting booking may overlap; only Booked bookings block'
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  sam constant uuid := '00000000-0000-0000-0000-0000000000b3';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  clash constant text := 'The Rusty Bus is already booked then.';
  new_id uuid;
  n bigint;
begin
  -- Booked: today and tomorrow; and days 50 to 52.
  perform pg_temp.put(t, t + 1, 'approved', nick, 'recovery');
  perform pg_temp.put(t + 50, t + 52, 'approved', cara, 'club_event');
  n := (select count(*) from bus_bookings);

  assert pg_temp.book(fran, t + 1, t + 1, 'recovery', null, fran, null) = clash, 'a recovery tomorrow, already booked';
  assert pg_temp.book(fran, t, t + 3, 'recovery', null, fran, null) = clash, 'a recovery from today, overlapping';
  assert pg_temp.book(sam, t + 52, t + 54, 'other', null, sam, null) = clash, 'a manager, sharing the last day';
  assert pg_temp.book(sam, t + 48, t + 50, 'other', null, sam, null) = clash, 'a manager, sharing the first day';
  assert pg_temp.book(sam, t + 51, t + 51, 'other', null, sam, null) = clash, 'a single day inside';
  assert pg_temp.book(sam, t + 45, t + 58, 'other', null, sam, null) = clash, 'a range covering it';
  assert (select count(*) from bus_bookings) = n, 'a refused clash isn''t left waiting';

  new_id := pg_temp.booked(sam, t + 53, t + 54, 'other', null, sam, null);
  assert pg_temp.status_of(new_id) = 'approved', 'touching the last day doesn''t clash';
  new_id := pg_temp.booked(sam, t + 47, t + 49, 'other', null, sam, null);
  assert pg_temp.status_of(new_id) = 'approved', 'touching the first day doesn''t clash';
  new_id := pg_temp.booked(fran, t + 2, t + 2, 'recovery', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'a recovery in 2 days waits, and doesn''t clash';
  new_id := pg_temp.booked(fran, t + 2, t + 2, 'recovery', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'two waiting bookings may overlap';

  new_id := pg_temp.booked(fran, t + 50, t + 52, 'charity_ride', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'a waiting booking may overlap a Booked one';
  new_id := pg_temp.booked(fran, t + 1, t + 1, 'charity_ride', null, fran, null);
  assert pg_temp.status_of(new_id) = 'requested', 'even on tomorrow''s booked recovery, when it waits';

  -- Waiting, declined and cancelled bookings on days 60 to 62 don't block.
  perform pg_temp.put(t + 60, t + 62, 'requested', fran);
  perform pg_temp.put(t + 60, t + 62, 'declined', fran);
  perform pg_temp.put(t + 60, t + 62, 'cancelled', fran);
  new_id := pg_temp.booked(cara, t + 60, t + 62, 'other', null, cara, null);
  assert pg_temp.status_of(new_id) = 'approved', 'waiting, declined and cancelled bookings never block';
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

\echo 'Deciding: signed in, approved, a bus manager, the booking, still waiting, days not passed, then the clash or the reason'
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000b4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  pete constant uuid := '00000000-0000-0000-0000-0000000000b6';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  rita constant uuid := '00000000-0000-0000-0000-0000000000ba';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000bb';
  approved constant text := 'Only approved members can do that.';
  not_board constant text := 'Only the board or NEC can say yes or no to Rusty Bus bookings.';
  no_such constant text := 'No such booking.';
  decided constant text := 'That booking has already been decided.';
  passed constant text := 'That booking’s days have passed.';
  clash constant text := 'The Rusty Bus is already booked then.';
  long_reason constant text := 'Keep the reason to 300 characters at most.';
  waiting uuid;
  booked uuid;
  declined uuid;
  cancelled uuid;
  gone uuid;
  ending_today uuid;
  clashing uuid;
  n bigint;
begin
  -- Made in the block, so they are undone with it.
  waiting := pg_temp.put(t + 10, t + 12, 'requested', fran);
  booked := pg_temp.put(t + 20, t + 22, 'approved', fran);
  declined := pg_temp.put(t + 30, t + 30, 'declined', fran);
  cancelled := pg_temp.put(t + 31, t + 31, 'cancelled', fran);
  gone := pg_temp.put(t - 3, t - 1, 'requested', fran);
  ending_today := pg_temp.put(t - 2, t, 'requested', fran);
  clashing := pg_temp.put(t + 22, t + 23, 'requested', fran);
  n := (select count(*) from bus_bookings);
  assert pg_temp.try_signed_out(format('select public.decide_bus(%L, true, null)', waiting)) = 'Sign in first.', 'signed out';
  assert pg_temp.try_signed_out('select public.decide_bus(null, null, null)') = 'Sign in first.',
    'signed out comes before everything';
  assert pg_temp.decide(paul, waiting, true, null) = approved, 'an applicant';
  assert pg_temp.decide(stranger, gen_random_uuid(), false, repeat('x', 301)) = approved, 'no record, before the rest';

  assert pg_temp.decide(fran, waiting, true, null) = not_board, 'a Full member, even the booker';
  assert pg_temp.decide(pete, waiting, true, null) = not_board, 'a President whose seat ended';
  assert pg_temp.decide(rita, waiting, true, null) = not_board, 'the Ride Committee';
  assert pg_temp.decide(fergus, gen_random_uuid(), false, repeat('x', 301)) = not_board, 'who decides comes before the booking';

  assert pg_temp.decide(nora, gen_random_uuid(), true, null) = no_such, 'a booking that isn''t there';
  assert pg_temp.decide(nora, null, true, null) = no_such, 'no booking at all';

  assert pg_temp.decide(nora, booked, true, null) = decided, 'already Booked';
  assert pg_temp.decide(nora, declined, true, null) = decided, 'already Declined';
  assert pg_temp.decide(nora, cancelled, false, null) = decided, 'Cancelled';
  assert pg_temp.decide(nora, booked, false, repeat('x', 301)) = decided, 'decided comes before the reason';

  assert pg_temp.decide(nora, gone, true, null) = passed, 'its last day was yesterday';
  assert pg_temp.decide(nora, gone, false, repeat('x', 301)) = passed, 'passed comes before the reason';

  assert pg_temp.decide(nora, clashing, true, null) = clash, 'a yes that shares a day with a Booked one';
  assert pg_temp.decide(nora, clashing, true, repeat('x', 301)) = clash, 'a yes ignores the reason''s length';

  assert pg_temp.decide(nora, waiting, false, repeat('x', 301)) = long_reason, 'a no with 301 characters';
  assert pg_temp.decide(nora, waiting, false, repeat('🚐', 301)) = long_reason, 'a no with 301 code points';
  assert (select count(*) from bus_bookings where status = 'requested') = 4, 'still four waiting';
  assert (select count(*) from bus_bookings) = n, 'nothing new';

  assert pg_temp.decide(cara, ending_today, true, repeat('x', 301)) is null, 'a booking ending today can still get a yes';
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

\echo 'A yes books it, a no declines it with the reason trimmed (blank is none); both record who and when'
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  sam constant uuid := '00000000-0000-0000-0000-0000000000b3';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  a uuid;
  b uuid;
  c uuid;
  d uuid;
  e uuid;
  r bus_bookings%rowtype;
begin
  -- Made in the block, so they are undone with it.
  a := pg_temp.put(t + 10, t + 12, 'requested', fran);
  b := pg_temp.put(t + 12, t + 14, 'requested', fran);
  c := pg_temp.put(t + 13, t + 13, 'requested', fran);
  d := pg_temp.put(t + 15, t + 15, 'requested', fran);
  e := pg_temp.put(t - 1, t + 1, 'requested', fran);
  assert pg_temp.decide(sam, a, true, '  ignored  ') is null, 'Sam says yes to 10 to 12';
  select * into r from bus_bookings where id = a;
  assert r.status = 'approved' and r.decided_by = sam and r.decided_at = now(), 'Booked, by Sam, now';
  assert r.decline_reason is null, 'a yes keeps no reason';
  assert r.booked_by = fran, 'still Fran''s';

  assert pg_temp.decide(cara, b, true, null) = 'The Rusty Bus is already booked then.', '12 to 14 now clashes';
  assert pg_temp.decide(cara, c, true, null) is null, 'but 13 alone doesn''t';
  assert pg_temp.decide(cara, b, false, E'\n Clashes with the run ' || repeat('🚐', 278) || E' \t') is null, 'a no';
  select * into r from bus_bookings where id = b;
  assert r.status = 'declined' and r.decided_by = cara and r.decided_at = now(), 'Declined, by Cara, now';
  assert r.decline_reason = 'Clashes with the run ' || repeat('🚐', 278), 'the reason, trimmed, 299 code points';
  assert char_length(r.decline_reason) = 299, 'counted in code points';

  assert pg_temp.decide(cara, d, false, repeat('é', 300)) is null, '300 code points is fine';
  assert (select decline_reason = repeat('é', 300) from bus_bookings where id = d), 'kept';
  assert pg_temp.decide(cara, e, false, E'  \t　 ') is null, 'a no with a blank reason';
  select * into r from bus_bookings where id = e;
  assert r.status = 'declined' and r.decline_reason is null, 'blank is none';
  assert pg_temp.decide(cara, e, true, null) = 'That booking has already been decided.', 'and it stays decided';
  raise sqlstate 'U0001';
exception when sqlstate 'U0001' then null;
end $$;

\echo 'Cancelling: signed in, approved, the booking, the booker, its driver or a manager, not already off, days not passed'
do $$
declare
  t constant date := private.club_date();
  nora constant uuid := '00000000-0000-0000-0000-0000000000b4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  rita constant uuid := '00000000-0000-0000-0000-0000000000ba';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000bb';
  approved constant text := 'Only approved members can do that.';
  no_such constant text := 'No such booking.';
  not_yours constant text := 'Only whoever booked it, its driver or the board can cancel it.';
  off constant text := 'That booking is already off.';
  passed constant text := 'That booking’s days have passed.';
  waiting uuid := pg_temp.put(t + 10, t + 12, 'requested', fran);
  booked uuid := pg_temp.put(t + 20, t + 22, 'approved', fran);
  declined uuid := pg_temp.put(t + 30, t + 30, 'declined', fran);
  cancelled uuid := pg_temp.put(t + 31, t + 31, 'cancelled', fran);
  gone uuid := pg_temp.put(t - 5, t - 2, 'approved', fran);
  gone_off uuid := pg_temp.put(t - 3, t - 1, 'cancelled', fran);
  n bigint := (select count(*) from bus_bookings);
begin
  assert pg_temp.try_signed_out(format('select public.cancel_bus(%L)', waiting)) = 'Sign in first.', 'signed out';
  assert pg_temp.try_signed_out('select public.cancel_bus(null)') = 'Sign in first.', 'signed out comes before everything';
  assert pg_temp.cancel(paul, waiting) = approved, 'an applicant';
  assert pg_temp.cancel(stranger, gen_random_uuid()) = approved, 'no record, before the booking';

  assert pg_temp.cancel(fergus, gen_random_uuid()) = no_such, 'a booking that isn''t there';
  assert pg_temp.cancel(fergus, null) = no_such, 'no booking at all';

  assert pg_temp.cancel(nick, waiting) = not_yours, 'a Nomad who neither booked nor drives it';
  assert pg_temp.cancel(rita, booked) = not_yours, 'the Ride Committee';
  assert pg_temp.cancel(fergus, declined) = not_yours, 'who cancels comes before already off';
  assert pg_temp.cancel(fergus, gone) = not_yours, 'and before the days';

  assert pg_temp.cancel(fran, declined) = off, 'Declined';
  assert pg_temp.cancel(fran, cancelled) = off, 'Cancelled';
  assert pg_temp.cancel(nora, gone_off) = off, 'already off comes before the days';

  assert pg_temp.cancel(fran, gone) = passed, 'the booker, on days that have passed';
  assert pg_temp.cancel(nora, gone) = passed, 'a manager too';
  assert (select count(*) from bus_bookings where status = 'cancelled') = 2, 'nothing more cancelled';
  assert (select count(*) from bus_bookings) = n, 'nothing new';
end $$;

\echo 'The booker, the driver or a manager cancels a Waiting or a Booked booking; one that started yesterday still can be'
do $$
declare
  t constant date := private.club_date();
  nora constant uuid := '00000000-0000-0000-0000-0000000000b4';
  sam constant uuid := '00000000-0000-0000-0000-0000000000b3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  waiting uuid := pg_temp.put(t + 40, t + 42, 'requested', fran);
  booked uuid := pg_temp.put(t + 43, t + 45, 'approved', fran);
  driven uuid;
  ongoing uuid := pg_temp.put(t - 1, t + 1, 'approved', nick);
  r bus_bookings%rowtype;
begin
  update bus_bookings set decided_by = sam, decided_at = now() - interval '2 days' where id = booked;
  insert into bus_bookings (first_day, last_day, purpose, status, booked_by, driver_id)
  values (t + 46, t + 46, 'recovery', 'approved', fran, fergus) returning id into driven;

  assert pg_temp.cancel(fran, waiting) is null, 'the booker cancels a Waiting booking';
  select * into r from bus_bookings where id = waiting;
  assert r.status = 'cancelled' and r.cancelled_by = fran and r.cancelled_at = now(), 'Cancelled, by Fran, now';
  assert pg_temp.cancel(fran, waiting) = 'That booking is already off.', 'once';

  assert pg_temp.cancel(nora, booked) is null, 'a manager cancels a Booked one';
  select * into r from bus_bookings where id = booked;
  assert r.status = 'cancelled' and r.cancelled_by = nora and r.cancelled_at = now(), 'by Nora, now';
  assert r.decided_by = sam and r.decided_at < now(), 'the yes it had is kept';

  assert pg_temp.cancel(fergus, driven) is null, 'its driver, an FNG, cancels it';
  assert (select cancelled_by = fergus from bus_bookings where id = driven), 'by Fergus';

  assert pg_temp.cancel(nick, ongoing) is null, 'one that started yesterday and ends tomorrow';
  assert pg_temp.status_of(ongoing) = 'cancelled', 'is off';
  assert pg_temp.booked(fran, t, t, 'recovery', null, fran, null) is not null, 'and the bus is free today again';
  assert (select count(*) from bus_bookings where status = 'approved' and first_day = t) = 1, 'booked by Fran';
end $$;

\echo 'Nobody writes bookings through the API; approved members see all of them, past ones too, applicants and the public nothing'
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  n bigint := (select count(*) from bus_bookings);
  n_past bigint := (select count(*) from bus_bookings where last_day < private.club_date());
  sig text := (select string_agg(id::text || status::text || coalesce(notes, ''), ',' order by id) from bus_bookings);
begin
  assert n > 0 and n_past > 0, 'there is something to read, past days included';
  assert pg_temp.try_as(cara, format($q$insert into bus_bookings (first_day, last_day, purpose, status)
    values (%L, %L, 'other', 'approved')$q$, t + 90, t + 90)) is not null, 'insert, even as the Chairman';
  assert pg_temp.try_as(cara, $q$update bus_bookings set status = 'approved', notes = 'Mine'$q$) is not null, 'edit';
  assert pg_temp.try_as(cara, $q$delete from bus_bookings$q$) is not null, 'remove';
  assert pg_temp.try_as(fergus, $q$update bus_bookings set status = 'cancelled'$q$) is not null, 'an FNG edits';
  assert pg_temp.try_as(null, $q$delete from bus_bookings$q$) is not null, 'anon removes';
  assert pg_temp.try_as(null, format($q$insert into bus_bookings (first_day, last_day, purpose, status)
    values (%L, %L, 'other', 'approved')$q$, t + 90, t + 90)) is not null, 'anon inserts';
  assert (select count(*) from bus_bookings) = n, 'untouched';
  assert (select string_agg(id::text || status::text || coalesce(notes, ''), ',' order by id) from bus_bookings) = sig,
    'really untouched';

  assert pg_temp.count_as(fergus, 'bus_bookings') = n, 'an FNG reads every booking';
  assert pg_temp.count_as(fergus, format('bus_bookings where last_day < %L', t)) = n_past, 'past ones too';
  assert pg_temp.count_as(cara, 'bus_bookings') = n, 'and so does the Chairman';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000b9', 'bus_bookings') = 0, 'an applicant sees none';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000bd', 'bus_bookings') = 0, 'nor a suspended member';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000bb', 'bus_bookings') = 0, 'nor a stranger';
  assert pg_temp.count_as(null, 'bus_bookings') = -1, 'the public has no grant';
end $$;

\echo 'The table rules hold even for a direct write, and the database itself never double-books'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  w uuid;
begin
  begin
    insert into bus_bookings (first_day, last_day, purpose, status) values (t + 5, t + 4, 'other', 'requested');
    assert false, 'last before first got in';
  exception when check_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status) values (t + 5, t + 19, 'other', 'requested');
    assert false, '15 days got in';
  exception when check_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status, notes) values (t + 5, t + 5, 'other', 'requested', repeat('🚐', 501));
    assert false, 'long notes got in';
  exception when check_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status, decline_reason) values (t + 5, t + 5, 'other', 'declined', repeat('🚐', 301));
    assert false, 'a long reason got in';
  exception when check_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status) values (null, t + 5, 'other', 'requested');
    assert false, 'no first day got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status) values (t + 5, t + 5, null, 'requested');
    assert false, 'no purpose got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose) values (t + 5, t + 5, 'other');
    assert false, 'no status got in';
  exception when not_null_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status, ride_id) values (t + 5, t + 5, 'other', 'requested', gen_random_uuid());
    assert false, 'a ride that isn''t there got in';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into bus_bookings (first_day, last_day, purpose, status, driver_id) values (t + 5, t + 5, 'other', 'requested', gen_random_uuid());
    assert false, 'a driver who isn''t there got in';
  exception when foreign_key_violation then null;
  end;

  -- Days 100 to 102 are booked; a second Booked one sharing day 102 can't get in, by insert or update.
  perform pg_temp.put(t + 100, t + 102, 'approved', fran);
  begin
    perform pg_temp.put(t + 102, t + 104, 'approved', fran);
    assert false, 'a double booking got in';
  exception when exclusion_violation then null;
  end;
  begin
    perform pg_temp.put(t + 101, t + 101, 'approved', fran);
    assert false, 'a single day inside got in';
  exception when exclusion_violation then null;
  end;
  w := pg_temp.put(t + 101, t + 103, 'requested', fran);
  perform pg_temp.put(t + 102, t + 102, 'declined', fran);
  perform pg_temp.put(t + 100, t + 100, 'cancelled', fran);
  begin
    update bus_bookings set status = 'approved' where id = w;
    assert false, 'a waiting booking was made Booked over a Booked one';
  exception when exclusion_violation then null;
  end;
  perform pg_temp.put(t + 103, t + 104, 'approved', fran);
  assert (select count(*) from bus_bookings where first_day between t + 100 and t + 104) = 5,
    'waiting, declined, cancelled and touching bookings all sit beside it';
  assert (select status = 'requested' and booked_at = now() from bus_bookings where id = w), 'booked now by default';
end $$;

\echo 'Each action takes the Rusty Bus lock and holds it until it commits'
create extension if not exists dblink;
-- The advisory locks this session holds on the Rusty Bus key right now, by mode.
create function pg_temp.bus_locks() returns text[] language sql as $$
  select coalesce(array_agg(l.mode order by l.mode), '{}') from pg_locks l
  where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
    and l.classid::bigint = (hashtext('rusty_bus')::bigint >> 32) & 4294967295
    and l.objid::bigint = hashtext('rusty_bus')::bigint & 4294967295;
$$;
-- The same database, socket, port and user as the connection the test runs on.
create function pg_temp.here() returns text language sql as $$
  select format('dbname=%s host=%s port=%s user=%s', current_database(),
    split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), session_user);
$$;
-- Whether a second session can take the Rusty Bus lock right now, without waiting.
create function pg_temp.other_session_can() returns boolean language sql as $$
  select ok from dblink(pg_temp.here(), 'select pg_try_advisory_xact_lock(hashtext(''rusty_bus''))') as t(ok boolean);
$$;
do $$
declare
  t constant date := private.club_date();
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  w uuid := pg_temp.put(t + 120, t + 120, 'requested', fran);
  b uuid := pg_temp.put(t + 121, t + 121, 'approved', fran);
  locks text[];
  other boolean;
begin
  assert pg_temp.bus_locks() = '{}', 'no lock to begin with';
  assert pg_temp.other_session_can(), 'a second session can take the lock when nobody holds it';

  -- Each action runs in a block that is then undone, which also lets go of its lock.
  begin
    perform pg_temp.booked(fran, t + 130, t + 130, 'other', null, fran, null);
    locks := pg_temp.bus_locks();
    other := pg_temp.other_session_can();
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{ExclusiveLock}', format('book holds the lock, not %s', locks);
  assert not other, 'so a second session waits';

  begin
    assert pg_temp.decide(cara, w, true, null) is null, 'Cara says yes';
    locks := pg_temp.bus_locks();
    other := pg_temp.other_session_can();
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{ExclusiveLock}', format('decide holds the lock, not %s', locks);
  assert not other, 'so a second session waits for a decision';

  begin
    assert pg_temp.cancel(fran, b) is null, 'Fran cancels';
    locks := pg_temp.bus_locks();
    other := pg_temp.other_session_can();
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{ExclusiveLock}', format('cancel holds the lock, not %s', locks);
  assert not other, 'so a second session waits for a cancel';
  assert pg_temp.bus_locks() = '{}' and pg_temp.other_session_can(), 'and it is let go';
  assert pg_temp.status_of(w) = 'requested' and pg_temp.status_of(b) = 'approved', 'the checks changed nothing';
end $$;

-- Two overlapping requests on days 200 to 202 and 202 to 204, committed so other sessions see them.
insert into bus_bookings (id, first_day, last_day, purpose, status, booked_by, driver_id)
select v.id::uuid, private.club_date() + v.first, private.club_date() + v.last, 'club_event', 'requested',
  '00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7'
from (values ('00000000-0000-0000-0000-00000000bb01', 200, 202), ('00000000-0000-0000-0000-00000000bb02', 202, 204))
  as v(id, first, last);

-- Opens a session as a member, in a transaction it leaves open.
create function pg_temp.open_as(conn text, who uuid) returns void language plpgsql as $$
begin
  perform dblink_connect(conn, pg_temp.here());
  perform dblink_exec(conn, 'begin');
  perform dblink_exec(conn, 'set local role authenticated');
  perform dblink_exec(conn, format('set local request.jwt.claim.sub = %L', who));
end $$;
-- A session's backend process.
create function pg_temp.pid_of(conn text) returns int language sql as $$
  select p from dblink(conn, 'select pg_backend_pid()') as t(p int);
$$;
-- Waits until a session's backend is stuck waiting on a lock. True when it is, false after 10 seconds.
create function pg_temp.waits(pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists (select 1 from pg_locks where pg_locks.pid = waits.pid and not granted) then return true; end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
-- The outcome of a statement sent with dblink_send_query: its error, or null.
create function pg_temp.outcome(conn text) returns text language plpgsql as $$
declare
  err text;
begin
  begin
    perform * from dblink_get_result(conn) as t(r text);
  exception when others then
    err := sqlerrm;
  end;
  -- Read to the end, so the connection is free again.
  perform * from dblink_get_result(conn, false) as t(r text);
  return err;
end $$;

\echo 'Two managers say yes at once to overlapping requests from two sessions: the first wins, the second gets the clash'
do $$
declare
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000b2';
  first_one constant uuid := '00000000-0000-0000-0000-00000000bb01';
  second_one constant uuid := '00000000-0000-0000-0000-00000000bb02';
  wes_pid int;
  waited boolean;
  err text;
begin
  perform pg_temp.open_as('cara', cara);
  perform pg_temp.open_as('wes', wes);
  perform * from dblink('cara', format('select public.decide_bus(%L, true, null)::text', first_one)) as t(r text);
  -- Cara's yes isn't committed yet: Wes's yes waits on the lock, then sees it.
  wes_pid := pg_temp.pid_of('wes');
  perform dblink_send_query('wes', format('select public.decide_bus(%L, true, null)::text', second_one));
  waited := pg_temp.waits(wes_pid);
  perform dblink_exec('cara', 'commit');
  err := pg_temp.outcome('wes');
  perform dblink_exec('wes', 'rollback');
  perform dblink_disconnect('cara');
  perform dblink_disconnect('wes');

  assert waited, 'Wes''s yes waited for Cara''s';
  assert err = 'The Rusty Bus is already booked then.', format('Wes is told it clashes, not %s', coalesce(err, 'nothing'));
  assert pg_temp.status_of(first_one) = 'approved', 'Cara''s yes stands';
  assert pg_temp.status_of(second_one) = 'requested', 'Wes''s request still waits';
  assert (select decided_by = cara from bus_bookings where id = first_one), 'decided by Cara';
end $$;

\echo 'Without the lock, the exclusion constraint still holds between two sessions'
do $$
declare
  t constant date := private.club_date();
  two_pid int;
  waited boolean;
  err text;
begin
  perform dblink_connect('one', pg_temp.here());
  perform dblink_connect('two', pg_temp.here());
  perform dblink_exec('one', 'begin');
  perform dblink_exec('one', format($q$insert into public.bus_bookings (first_day, last_day, purpose, status)
    values (%L, %L, 'other', 'approved')$q$, t + 300, t + 302));
  two_pid := pg_temp.pid_of('two');
  perform dblink_send_query('two', format($q$insert into public.bus_bookings (first_day, last_day, purpose, status)
    values (%L, %L, 'other', 'approved') returning id::text$q$, t + 302, t + 303));
  waited := pg_temp.waits(two_pid);
  perform dblink_exec('one', 'commit');
  err := pg_temp.outcome('two');
  perform dblink_disconnect('one');
  perform dblink_disconnect('two');

  assert waited, 'the second insert waited for the first';
  assert err like 'conflicting key value violates exclusion constraint%', format('refused, not %s', coalesce(err, 'let in'));
  assert (select count(*) from bus_bookings where first_day >= t + 300) = 1, 'only the first is there';
end $$;

\echo 'A booking stays when its booker, driver or decider leaves, and when its ride is removed'
do $$
declare
  t constant date := private.club_date();
  sam constant uuid := '00000000-0000-0000-0000-0000000000b3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  ride constant uuid := '00000000-0000-0000-0000-00000000aa01';
  new_id uuid;
  r bus_bookings%rowtype;
begin
  new_id := pg_temp.booked(sam, t + 26, t + 26, 'charity_ride', ride, fergus, 'For the kids');
  update bus_bookings set cancelled_by = fergus where bus_bookings.id = new_id;
  delete from members where members.id = fergus;
  delete from members where members.id = sam;
  delete from rides where rides.id = ride;
  select * into r from bus_bookings where bus_bookings.id = new_id;
  assert found, 'the booking stays';
  assert r.booked_by is null and r.driver_id is null and r.decided_by is null and r.cancelled_by is null,
    'with nobody named';
  assert r.ride_id is null, 'and no ride';
  assert r.status = 'approved' and r.notes = 'For the kids', 'the rest as it was';
end $$;
