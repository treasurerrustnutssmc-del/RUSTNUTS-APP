-- Checks the Rusty Bus extras: change_bus, hand_bus_keys, log_bus_km, log_bus_cost, strike_bus_km and
-- strike_bus_cost, with the refusals in the same words and order as src/domain/bus.ts and
-- src/domain/busLog.ts; who the bus hands are (Full, Nomad, bus managers and whoever has the keys);
-- that a change never moves the status; readings kept in order; litres rounded and fuel only; who
-- reads the costs; and no writes through the API.
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

-- A booking made as the owner, its days from today.
create function pg_temp.bus(first int, last int, status text, booker uuid, purpose text default 'other') returns uuid
language sql as $$
  insert into public.bus_bookings (first_day, last_day, purpose, driver_id, status, booked_by)
  values (private.club_date() + first, private.club_date() + last, purpose::public.bus_purpose, booker, status::public.bus_status, booker)
  returning id;
$$;

create function pg_temp.change(who uuid, b uuid, first date, last date, purpose text, ride uuid, driver uuid, notes text)
returns text language sql as $$
  select pg_temp.try_as(who, format('select public.change_bus(%L, %L, %L, %L, %L, %L, %L)', b, first, last, purpose, ride, driver, notes));
$$;
create function pg_temp.keys(who uuid, recipient uuid, note text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.hand_bus_keys(%L, %L)', recipient, note));
$$;
create function pg_temp.km(who uuid, km int, day date, b uuid, note text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.log_bus_km(%L, %L, %L, %L)', km, day, b, note));
$$;
create function pg_temp.cost(who uuid, day date, kind text, cents int, litres numeric, b uuid, note text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.log_bus_cost(%L, %L, %L, %L, %L, %L)', day, kind, cents, litres, b, note));
$$;

\o
\echo 'Rusty Bus extras actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
declare
  fns constant regprocedure[] := array[
    'public.change_bus(uuid, date, date, public.bus_purpose, uuid, uuid, text)'::regprocedure,
    'public.hand_bus_keys(uuid, text)'::regprocedure,
    'public.log_bus_km(int, date, uuid, text)'::regprocedure,
    'public.log_bus_cost(date, public.bus_cost_kind, int, numeric, uuid, text)'::regprocedure,
    'public.strike_bus_km(uuid)'::regprocedure,
    'public.strike_bus_cost(uuid)'::regprocedure];
  helpers constant regprocedure[] := array['private.bus_hand()'::regprocedure, 'private.bus_key_holder()'::regprocedure];
  f regprocedure;
begin
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid = any (fns || helpers)),
    'definer, empty search_path';
  foreach f in array fns loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
    assert not has_function_privilege('public', f, 'execute'), format('public can''t run %s', f);
    assert has_function_privilege('authenticated', f, 'execute'), format('members can run %s', f);
  end loop;
  foreach f in array helpers loop
    assert not has_function_privilege('authenticated', f, 'execute'), format('members can''t run %s', f);
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
  end loop;
  assert pg_temp.keys(null, '00000000-0000-0000-0000-0000000000b7', null) is not null, 'the public can''t log keys';
  assert pg_temp.km(null, 100, private.club_date(), null, null) is not null, 'nor km';
  assert pg_temp.cost(null, private.club_date(), 'fuel', 100, null, null, null) is not null, 'nor costs';
  assert not exists (select 1 from bus_key_handovers) and not exists (select 1 from bus_km) and not exists (select 1 from bus_costs),
    'nothing was written';
end $$;

\echo 'Nobody writes the new tables through the API, and the public reads nothing'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  assert pg_temp.try_as(fran, format('insert into public.bus_key_handovers (to_id) values (%L)', fran)) like 'permission denied%', 'no insert of keys';
  assert pg_temp.try_as(cara, 'insert into public.bus_km (km, read_on) values (1, current_date)') like 'permission denied%', 'no insert of km';
  assert pg_temp.try_as(cara, 'insert into public.bus_costs (spent_on, kind, amount_cents) values (current_date, ''fuel'', 1)') like 'permission denied%',
    'no insert of costs';
  assert pg_temp.try_as(cara, 'update public.bus_km set km = 1') like 'permission denied%', 'no update';
  assert pg_temp.try_as(cara, 'delete from public.bus_costs') like 'permission denied%', 'no delete';
  assert pg_temp.try_as(cara, 'update public.bus_bookings set changed_by = null') like 'permission denied%', 'no update of bookings';
  assert pg_temp.count_as(null, 'public.bus_key_handovers') = -1, 'anon reads no keys';
  assert pg_temp.count_as(null, 'public.bus_km') = -1, 'anon reads no km';
  assert pg_temp.count_as(null, 'public.bus_costs') = -1, 'anon reads no costs';
end $$;

\echo 'Changing a booking: the checks in the app’s order'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  ride constant uuid := '00000000-0000-0000-0000-00000000aa01';
  gone constant uuid := '00000000-0000-0000-0000-00000000aa02';
  asked uuid := pg_temp.bus(30, 31, 'requested', fran);
  held uuid := pg_temp.bus(40, 42, 'approved', fran);
  other uuid := pg_temp.bus(44, 44, 'approved', nick);
  off uuid := pg_temp.bus(50, 50, 'cancelled', fran);
  over uuid := pg_temp.bus(-5, -2, 'approved', fran);
  underway uuid := pg_temp.bus(-1, 1, 'approved', fran);
  e text;
begin
  e := pg_temp.try_signed_out(format('select public.change_bus(%L, %L, %L, ''other'', null, %L, null)', held, t + 40, t + 42, fran));
  assert e = 'Sign in first.', e;
  assert pg_temp.change(paul, held, t + 40, t + 42, 'other', null, fran, null) = 'Only approved members can do that.';
  assert pg_temp.change(fran, gen_random_uuid(), t + 40, t + 42, 'other', null, fran, null) = 'No such booking.';
  assert pg_temp.change(nick, held, t + 40, t + 42, 'other', null, fran, null) = 'Only whoever booked it or the board can change it.';
  assert pg_temp.change(fran, off, t + 50, t + 50, 'other', null, fran, null) = 'That booking is already off.';
  assert pg_temp.change(fran, over, t - 5, t - 2, 'other', null, fran, null) = 'That booking’s days have passed.';
  assert pg_temp.change(fran, held, null, t + 42, 'other', null, fran, null) = 'Pick the first and last day.';
  assert pg_temp.change(fran, held, t + 42, t + 41, 'other', null, fran, null) = 'The last day can’t be before the first.';
  assert pg_temp.change(fran, underway, t - 1, t, 'other', null, fran, null) is null, 'under way keeps its first day';
  assert pg_temp.change(fran, underway, t - 2, t, 'other', null, fran, null) = 'Bookings can’t start in the past.';
  assert pg_temp.change(fran, asked, t - 1, t + 1, 'other', null, fran, null) = 'Bookings can’t start in the past.';
  assert pg_temp.change(fran, asked, t + 30, t + 44, 'other', null, fran, null) = 'Keep a booking to 14 days at most.';
  assert pg_temp.change(fran, asked, (t + interval '1 year')::date + 1, (t + interval '1 year')::date + 1, 'other', null, fran, null)
    = 'Book at most 12 months ahead.';
  assert pg_temp.change(fran, asked, t + 30, t + 31, null, null, fran, null) = 'Pick what it’s for.';
  assert pg_temp.change(fran, asked, t + 30, t + 31, 'other', gone, fran, null) = 'That ride isn’t on the calendar.';
  assert pg_temp.change(fran, asked, t + 30, t + 31, 'other', null, paul, null) = 'Pick a driver who’s an approved member.';
  assert pg_temp.change(fran, asked, t + 30, t + 31, 'other', null, fran, repeat('é', 501)) = 'Keep the notes to 500 characters at most.';
  -- A Waiting booking moves anywhere, even onto Booked days, and stays Waiting.
  assert pg_temp.change(fran, asked, t + 44, t + 44, 'club_event', ride, nick, '  Moved.  ') is null, 'a Waiting one moves';
  assert (select status = 'requested' and first_day = t + 44 and purpose = 'club_event' and ride_id = ride and driver_id = nick
            and notes = 'Moved.' and changed_by = fran and changed_at is not null from bus_bookings where id = asked),
    'stays Waiting, trimmed, changed by Fran';
  -- A Booked one: shrink it, or change the rest, but no adding days unless on the board.
  assert pg_temp.change(fran, held, t + 41, t + 41, 'other', null, nick, null) is null, 'shrunk';
  assert (select status = 'approved' and first_day = t + 41 and last_day = t + 41 from bus_bookings where id = held), 'still Booked';
  assert pg_temp.change(fran, held, t + 41, t + 42, 'other', null, nick, null) = 'Only the board or NEC can add days to a Booked booking.';
  assert pg_temp.change(cara, held, t + 41, t + 43, 'other', null, nick, null) is null, 'the board adds days';
  assert pg_temp.change(cara, held, t + 41, t + 44, 'other', null, nick, null) = 'The Rusty Bus is already booked then.';
  -- A member's Booked recovery moved to start tomorrow would go straight in anyway.
  assert pg_temp.change(fran, underway, t + 1, t + 3, 'recovery', null, fran, null) is null, 'a recovery from tomorrow';
  assert pg_temp.change(fran, underway, t + 2, t + 4, 'recovery', null, fran, null) = 'Only the board or NEC can add days to a Booked booking.';
end $$;

\echo 'Keys: bus hands only, an approved member, not the same holder, a short note'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000b5';
  pete constant uuid := '00000000-0000-0000-0000-0000000000b6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  tess constant uuid := '00000000-0000-0000-0000-0000000000bc';
  e text;
begin
  e := pg_temp.try_signed_out(format('select public.hand_bus_keys(%L, null)', fran));
  assert e = 'Sign in first.', e;
  assert pg_temp.keys(paul, fran, null) = 'Only approved members can do that.';
  assert pg_temp.keys(pete, fran, null) = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  assert pg_temp.keys(fergus, fran, null) = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.', 'an FNG without the keys';
  assert pg_temp.keys(fran, null, null) = 'Pick someone who’s an approved member.';
  assert pg_temp.keys(fran, paul, null) = 'Pick someone who’s an approved member.';
  assert pg_temp.keys(fran, fergus, repeat('🔑', 201)) = 'Keep the note to 200 characters at most.';
  assert pg_temp.keys(fran, fergus, '  ' || repeat('🔑', 200) || '  ') is null, 'Fran hands them to Fergus';
  assert pg_temp.keys(tess, fergus, null) = 'They already have the keys.';
  assert pg_temp.try_as(fran, 'select private.bus_key_holder()') like 'permission denied%', 'members can''t ask the helper';
  -- Fergus, an FNG, now holds the keys, so he's a bus hand: he can log km and pass them on.
  assert pg_temp.km(fergus, 1000, private.club_date(), null, null) is null, 'Fergus logs km';
  assert pg_temp.keys(fergus, pete, 'Back at the clubhouse') is null, 'Fergus hands them to Pete';
  assert pg_temp.keys(fergus, nick, null) = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.',
    'and then he can''t';
  assert pg_temp.count_as(fran, 'public.bus_key_handovers') = 2, 'members read every handover';
  assert (select note = 'Back at the clubhouse' and logged_by = fergus from bus_key_handovers where to_id = pete), 'logged by Fergus';
  assert (select char_length(note) = 200 from bus_key_handovers where to_id = fergus), 'trimmed';
end $$;

\echo 'Odometer: a day up to today, whole km, in order with the rest, a Booked booking, a short note'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  pete constant uuid := '00000000-0000-0000-0000-0000000000b6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  booked uuid := pg_temp.bus(-10, -9, 'approved', fran);
  asked uuid := pg_temp.bus(60, 60, 'requested', fran);
  e text;
begin
  -- Fergus's 1000 km today is the only reading so far; strike it out of the way first.
  update bus_km set struck_at = now(), struck_by = fran;
  e := pg_temp.try_signed_out(format('select public.log_bus_km(100, %L, null, null)', t));
  assert e = 'Sign in first.', e;
  assert pg_temp.km(paul, 100, t, null, null) = 'Only approved members can do that.';
  -- Pete has the keys from the last check, so swap them back to Fran before he's refused.
  perform pg_temp.keys(fran, fran, null);
  assert pg_temp.km(pete, 100, t, null, null) = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  assert pg_temp.km(fran, 100, null, null, null) = 'Pick the day, today or earlier.';
  assert pg_temp.km(fran, 100, t + 1, null, null) = 'Pick the day, today or earlier.';
  assert pg_temp.km(fran, 0, t, null, null) = 'The odometer is in whole km, up to 2,000,000.';
  assert pg_temp.km(fran, 2000001, t, null, null) = 'The odometer is in whole km, up to 2,000,000.';
  assert pg_temp.km(fran, null, t, null, null) = 'The odometer is in whole km, up to 2,000,000.';
  assert pg_temp.km(fran, 120000, t - 60, null, null) is null;
  assert pg_temp.km(fran, 121000, t - 30, null, null) is null;
  assert pg_temp.km(fran, 120999, t, null, null) = 'That reading is out of order with the ones before and after it.', 'lower than before';
  assert pg_temp.km(fran, 121000, t - 30, null, null) is null, 'equal on the same day';
  assert pg_temp.km(fran, 120500, t - 45, null, null) is null, 'fits between';
  assert pg_temp.km(fran, 120600, t - 50, null, null) = 'That reading is out of order with the ones before and after it.', 'higher than after';
  assert pg_temp.km(fran, 121100, t, asked, null) = 'Pick a Booked booking.';
  assert pg_temp.km(fran, 121100, t, gen_random_uuid(), null) = 'Pick a Booked booking.';
  assert pg_temp.km(fran, 121100, t, null, repeat('x', 201)) = 'Keep the note to 200 characters at most.';
  assert pg_temp.km(nick, 121100, t - 10, booked, '  Out  ') is null, 'Nick, on a booking';
  assert pg_temp.km(nick, 121433, t - 9, booked, '') is null;
  assert (select count(*) = 2 and bool_and(logged_by = nick) from bus_km where booking_id = booked), 'logged by Nick';
  assert (select note = 'Out' from bus_km where km = 121100), 'trimmed';
  assert (select note is null from bus_km where km = 121433), 'blank as none';
  -- Striking: whoever logged it, or the board; struck ones don't block the order.
  e := pg_temp.try_as(fran, format('select public.strike_bus_km(%L)', (select id from bus_km where km = 121433)));
  assert e = 'Only whoever logged it or the board can strike it out.', e;
  assert pg_temp.try_as(fran, format('select public.strike_bus_km(%L)', gen_random_uuid())) = 'No such entry.';
  assert pg_temp.try_as(nick, format('select public.strike_bus_km(%L)', (select id from bus_km where km = 121433))) is null;
  assert pg_temp.try_as(cara, format('select public.strike_bus_km(%L)', (select id from bus_km where km = 121433))) = 'That’s already struck out.';
  assert pg_temp.try_as(cara, format('select public.strike_bus_km(%L)', (select id from bus_km where km = 121100))) is null, 'the board strikes';
  assert pg_temp.km(fran, 121001, t - 9, null, null) is null, 'struck ones don''t count';
  assert (select struck_by = cara and struck_at is not null from bus_km where km = 121100), 'who struck it';
  assert pg_temp.count_as(pete, 'public.bus_km') = (select count(*) from bus_km), 'members read every reading';
end $$;

\echo 'Costs: the checks in order, litres rounded and fuel only; managers read them all, members their own'
do $$
declare
  t constant date := private.club_date();
  fran constant uuid := '00000000-0000-0000-0000-0000000000b7';
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
  pete constant uuid := '00000000-0000-0000-0000-0000000000b6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000b9';
  tess constant uuid := '00000000-0000-0000-0000-0000000000bc';
  cara constant uuid := '00000000-0000-0000-0000-0000000000b1';
  booked uuid := pg_temp.bus(-20, -20, 'approved', fran);
  e text;
begin
  e := pg_temp.try_signed_out(format('select public.log_bus_cost(%L, ''fuel'', 100, null, null, null)', t));
  assert e = 'Sign in first.', e;
  assert pg_temp.cost(paul, t, 'fuel', 100, null, null, null) = 'Only approved members can do that.';
  assert pg_temp.cost(pete, t, 'fuel', 100, null, null, null) = 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  assert pg_temp.cost(fran, t + 1, 'fuel', 100, null, null, null) = 'Pick the day, today or earlier.';
  assert pg_temp.cost(fran, null, 'fuel', 100, null, null, null) = 'Pick the day, today or earlier.';
  assert pg_temp.cost(fran, t, null, 100, null, null, null) = 'Pick what it was for.';
  assert pg_temp.cost(fran, t, 'fuel', 0, null, null, null) = 'Enter an amount from $0.01 to $100,000.';
  assert pg_temp.cost(fran, t, 'fuel', 10000001, null, null, null) = 'Enter an amount from $0.01 to $100,000.';
  assert pg_temp.cost(fran, t, 'fuel', null, null, null, null) = 'Enter an amount from $0.01 to $100,000.';
  assert pg_temp.cost(fran, t, 'rego', 100, 5, null, null) = 'Only fuel takes litres.';
  assert pg_temp.cost(fran, t, 'fuel', 100, 0, null, null) = 'Litres: more than 0, up to 1000.';
  assert pg_temp.cost(fran, t, 'fuel', 100, 0.004, null, null) = 'Litres: more than 0, up to 1000.', 'rounds to nothing';
  assert pg_temp.cost(fran, t, 'fuel', 100, 1000.01, null, null) = 'Litres: more than 0, up to 1000.';
  assert pg_temp.cost(fran, t, 'fuel', 100, null, gen_random_uuid(), null) = 'Pick a Booked booking.';
  assert pg_temp.cost(fran, t, 'fuel', 100, null, null, repeat('x', 201)) = 'Keep the note to 200 characters at most.';
  assert pg_temp.cost(fran, t, 'fuel', 9850, 52.456, booked, '  Shell  ') is null, 'Fran’s fuel';
  assert pg_temp.cost(nick, t - 100, 'rego', 92000, null, null, null) is null, 'Nick’s rego';
  assert pg_temp.cost(fran, t, 'fuel', 10000000, 1000, null, null) is null, 'the top of the range';
  assert (select litres = 52.46 and note = 'Shell' and booking_id = booked and logged_by = fran from bus_costs where amount_cents = 9850),
    'rounded and trimmed';
  assert pg_temp.count_as(fran, 'public.bus_costs') = 2, 'Fran reads her own';
  assert pg_temp.count_as(nick, 'public.bus_costs') = 1, 'Nick reads his own';
  assert pg_temp.count_as(pete, 'public.bus_costs') = 0, 'Pete reads none';
  assert pg_temp.count_as(tess, 'public.bus_costs') = 3, 'the West Treasurer reads them all';
  assert pg_temp.count_as(cara, 'public.bus_costs') = 3, 'the NEC reads them all';
  e := pg_temp.try_as(nick, format('select public.strike_bus_cost(%L)', (select id from bus_costs where amount_cents = 9850)));
  assert e = 'Only whoever logged it or the board can strike it out.', e;
  assert pg_temp.try_as(tess, format('select public.strike_bus_cost(%L)', (select id from bus_costs where amount_cents = 9850))) is null;
  assert pg_temp.try_as(fran, format('select public.strike_bus_cost(%L)', (select id from bus_costs where amount_cents = 9850))) = 'That’s already struck out.';
  assert pg_temp.try_as(fran, format('select public.strike_bus_cost(%L)', gen_random_uuid())) = 'No such entry.';
end $$;

\echo 'Entries stay when their people or booking go'
do $$
declare
  nick constant uuid := '00000000-0000-0000-0000-0000000000b8';
begin
  delete from members where id = nick;
  assert (select count(*) from bus_km where logged_by is null) >= 2, 'readings stay, with nobody named';
  assert exists (select 1 from bus_costs where kind = 'rego' and logged_by is null), 'costs stay';
  delete from bus_bookings;
  assert (select count(*) from bus_km where booking_id is not null) = 0, 'and no booking';
end $$;
