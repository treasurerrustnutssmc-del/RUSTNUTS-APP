-- Checks ride briefings: save_briefing and read_briefing, with the refusals in the same words and
-- order as src/domain/briefings.ts, the writer rule (crew managers plus this ride's Road Captain),
-- trimming and the limits in code points, who can read what, the calendar's briefings and reads,
-- and the ride-row lock.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),      -- West President (so on the NEC)
  ('00000000-0000-0000-0000-0000000000d2', 'nora@example.com', now()),     -- North Road Captain
  ('00000000-0000-0000-0000-0000000000d3', 'rick@example.com', now()),     -- West Ride Committee
  ('00000000-0000-0000-0000-0000000000d4', 'chair@example.com', now()),    -- NEC Chairman (North member)
  ('00000000-0000-0000-0000-0000000000d5', 'fran@example.com', now()),     -- Full, once West Road Captain; RC of e1
  ('00000000-0000-0000-0000-0000000000d6', 'fergus@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-0000000000d8', 'gail@example.com', now()),     -- Full, RC of e3, then moved to Officer
  ('00000000-0000-0000-0000-0000000000d9', 'paul@example.com', now()),     -- pending
  ('00000000-0000-0000-0000-0000000000db', 'stranger@example.com', now()); -- signed in, no record

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes President', 'Prez', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'north', 'Nora Captain', 'Compass', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'Rick Committee', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'Charlie Chair', 'Gavel', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d5', 'west', 'Fran Full', 'Sparks', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d6', 'west', 'Fergus FNG', null, 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000d8', 'north', 'Gail Going', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Paul Pending', null, 'introduced', 'pending')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000d2', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000000d4', null, 'nec_chair')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;
-- An ended seat gives no powers: Fran was West Road Captain once.
insert into positions (member_id, chapter_id, role, started_on, ended_on)
select '00000000-0000-0000-0000-0000000000d5', id, 'road_captain', current_date - 400, current_date - 30
from chapters where slug = 'west';

insert into rides (id, source, starts_at, all_day, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'app', now() + interval '7 days', false, 'West breakfast', 'west', null),
  ('00000000-0000-0000-0000-0000000000e2', 'app', now() + interval '7 days', false, 'Club run', 'club', null),
  ('00000000-0000-0000-0000-0000000000e3', 'app', now() + interval '7 days', false, 'North loop', 'north', null),
  ('00000000-0000-0000-0000-0000000000e4', 'app', now() + interval '7 days', false, 'Called off', 'west', now()),
  ('00000000-0000-0000-0000-0000000000e9', 'app', now() + interval '7 days', false, 'Supported run', 'supported', null);

-- Fran holds the West breakfast's Road Captain spot, without a board seat. Gail holds the North
-- loop's, for now. Fergus is an Officer on the breakfast.
insert into ride_crew (ride_id, member_id, role) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d5', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d6', 'officer'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d8', 'road_captain');

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

-- A ride's id from its last two hex digits.
create function pg_temp.ride(r text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000000' || r)::uuid;
$$;

-- The version of a ride's briefing stored now (its updated_at), or null when it has none.
create function pg_temp.seen(r text) returns timestamptz language sql stable as $$
  select updated_at from public.ride_briefings where ride_id = pg_temp.ride(r);
$$;

-- save_briefing as someone, on a ride (by its last two hex digits), on top of the version seen.
create function pg_temp.save(who uuid, r text, hazards text[], changes text, notes text, seen timestamptz)
returns text language sql as $$
  select pg_temp.try_as(who, format('select public.save_briefing(%L, %L, %L, %L, %L)', pg_temp.ride(r), hazards, changes,
    notes, seen));
$$;

-- read_briefing (Got it) as someone, on a ride, for the version seen.
create function pg_temp.got_it(who uuid, r text, seen timestamptz) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.read_briefing(%L, %L)', pg_temp.ride(r), seen));
$$;

-- n hazards, each the same line.
create function pg_temp.lines(n int, line text) returns text[] language sql immutable as $$
  select coalesce(array_agg(line), '{}') from generate_series(1, n);
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.try_signed_out(text), pg_temp.count_as(uuid, text),
  pg_temp.ride(text), pg_temp.seen(text), pg_temp.save(uuid, text, text[], text, text, timestamptz),
  pg_temp.got_it(uuid, text, timestamptz), pg_temp.lines(int, text) to anon, authenticated;

\o
\echo 'Briefing actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
declare
  fns constant regprocedure[] := array[
    'public.save_briefing(uuid, text[], text, text, timestamptz)'::regprocedure,
    'public.read_briefing(uuid, timestamptz)'::regprocedure,
    'public.ride_calendar()'::regprocedure];
  f regprocedure;
begin
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid = any (fns)),
    'definer, empty search_path';
  foreach f in array fns loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
    assert not has_function_privilege('public', f, 'execute'), format('public can''t run %s', f);
    assert has_function_privilege('authenticated', f, 'execute'), format('members can run %s', f);
  end loop;
  assert (select prorettype = 'void'::regtype from pg_proc where oid = fns[1]), 'save_briefing returns nothing';
  assert (select prorettype = 'void'::regtype from pg_proc where oid = fns[2]), 'read_briefing returns nothing';
  assert pg_temp.save(null, 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) is not null, 'the public can''t save';
  assert pg_temp.got_it(null, 'e1', pg_temp.seen('e1')) is not null, 'nor read';
  assert not exists (select 1 from ride_briefings), 'nothing was written';
end $$;

\echo 'The first checks come in the app''s order: signed in, then approved'
do $$
declare
  paul constant uuid := '00000000-0000-0000-0000-0000000000d9';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000db';
  approved constant text := 'Only approved members can do that.';
begin
  assert pg_temp.try_signed_out(format('select public.save_briefing(%L, %L, null, null, null)',
    pg_temp.ride('e1'), array['Gravel'])) = 'Sign in first.', 'save: signed out';
  assert pg_temp.try_signed_out(format('select public.save_briefing(%L, null, null, null, null)',
    pg_temp.ride('ff'))) = 'Sign in first.', 'save: signed out comes before everything';
  assert pg_temp.try_signed_out(format('select public.read_briefing(%L, null)', pg_temp.ride('e1'))) = 'Sign in first.',
    'read: signed out';
  assert pg_temp.try_signed_out(format('select public.read_briefing(%L, null)', pg_temp.ride('ff'))) = 'Sign in first.',
    'read: signed out, before the ride';
  assert pg_temp.save(paul, 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) = approved, 'save: pending';
  assert pg_temp.save(stranger, 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) = approved, 'save: no record';
  assert pg_temp.save(paul, 'ff', pg_temp.lines(13, 'x'), null, null, pg_temp.seen('ff')) = approved, 'approved comes before the ride';
  assert pg_temp.got_it(paul, 'e1', pg_temp.seen('e1')) = approved, 'read: pending';
  assert pg_temp.got_it(stranger, 'ff', pg_temp.seen('ff')) = approved, 'read: no record, before the ride';
  assert not exists (select 1 from ride_briefings), 'nothing was written';
  assert not exists (select 1 from ride_briefing_reads), 'nor read';
end $$;

\echo 'save_briefing checks the ride, cancelled, the ride day, then who may write'
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  nobody constant text := 'Only the board, ride committee or this ride’s Road Captain can write the briefing.';
  over constant text := 'The briefing can’t change after the ride day.';
  midnight timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
begin
  insert into rides (id, source, starts_at, ends_at, all_day, title, category) values
    ('00000000-0000-0000-0000-0000000000e5', 'app', midnight + interval '1 minute', null, false, 'Dawn patrol', 'west'),
    ('00000000-0000-0000-0000-0000000000e6', 'app', midnight - interval '1 minute', null, false, 'Midnight run', 'west'),
    ('00000000-0000-0000-0000-0000000000e7', 'app', midnight, midnight + interval '2 days', true, 'Island weekend', 'club');
  -- Fran is the Road Captain of last night's ride too.
  insert into ride_crew (ride_id, member_id, role) values (pg_temp.ride('e6'), fran, 'road_captain');

  assert pg_temp.save(fergus, 'ff', array['Gravel'], null, null, pg_temp.seen('ff')) = 'No such ride.', 'a missing ride';
  assert pg_temp.save(rick, 'ff', null, null, null, pg_temp.seen('ff')) = 'No such ride.', 'before anything about the briefing';
  assert pg_temp.save(fergus, 'e4', array['Gravel'], null, null, pg_temp.seen('e4')) = 'That ride was cancelled.', 'cancelled';
  assert pg_temp.save(rick, 'e4', array['Gravel'], null, null, pg_temp.seen('e4')) = 'That ride was cancelled.', 'even for a manager';
  assert pg_temp.save(fergus, 'e6', array['Gravel'], null, null, pg_temp.seen('e6')) = over, 'the ride day comes before who may write';
  assert pg_temp.save(rick, 'e6', array['Gravel'], null, null, pg_temp.seen('e6')) = over, 'a ride that started a minute before midnight';
  assert pg_temp.save(fran, 'e6', array['Gravel'], null, null, pg_temp.seen('e6')) = over, 'even for its Road Captain';
  assert pg_temp.save(fergus, 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) = nobody, 'an FNG on the crew as an Officer';
  assert pg_temp.save(fergus, 'e1', pg_temp.lines(13, 'x'), null, null, pg_temp.seen('e1')) = nobody, 'who may write comes before the limits';
  assert pg_temp.save(fergus, 'e1', null, null, null, pg_temp.seen('e1')) = nobody, 'and before empty';
  assert pg_temp.save(nora, 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) = nobody, 'another chapter''s Road Captain on a West ride';
  assert pg_temp.save(fran, 'e2', array['Gravel'], null, null, pg_temp.seen('e2')) = nobody, 'an ended seat, and RC of a different ride';
  assert pg_temp.save('00000000-0000-0000-0000-0000000000d8', 'e1', array['Gravel'], null, null, pg_temp.seen('e1')) = nobody,
    'another ride''s Road Captain';
  assert not exists (select 1 from ride_briefings), 'nothing was written';
end $$;

\echo 'Then the limits, in order: blank hazards left out, at most 12, 120 characters each, 2000 for changes and notes, not all empty'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  too_many constant text := 'That’s too many hazards (12 at most).';
  one_line constant text := 'Keep each hazard to one short line (120 characters at most).';
  too_long constant text := 'That’s too long (2000 characters at most).';
  empty constant text := 'Write at least one hazard, change or note.';
begin
  assert pg_temp.save(rick, 'e1', pg_temp.lines(13, 'Gravel'), null, null, pg_temp.seen('e1')) = too_many, '13 hazards';
  assert pg_temp.save(rick, 'e1', pg_temp.lines(13, repeat('x', 121)), repeat('x', 2001), null, pg_temp.seen('e1')) = too_many,
    'the count comes before each line''s length';
  assert pg_temp.save(rick, 'e1', pg_temp.lines(12, 'Gravel') || array['', '   ', E'\t\n', E' 　﻿', null],
    repeat('x', 2001), null, pg_temp.seen('e1')) = too_long, 'blank and missing lines are left out before counting';
  assert pg_temp.save(rick, 'e1', array['Gravel', repeat('x', 121)], null, null, pg_temp.seen('e1')) = one_line, '121 characters';
  assert pg_temp.save(rick, 'e1', array[repeat('🏍', 121)], null, null, pg_temp.seen('e1')) = one_line, '121 code points';
  assert pg_temp.save(rick, 'e1', array[repeat('x', 121)], repeat('x', 2001), repeat('x', 2001), pg_temp.seen('e1')) = one_line,
    'a line''s length comes before changes and notes';
  assert pg_temp.save(rick, 'e1', null, repeat('x', 2001), null, pg_temp.seen('e1')) = too_long, 'changes over 2000';
  assert pg_temp.save(rick, 'e1', null, null, repeat('x', 2001), pg_temp.seen('e1')) = too_long, 'notes over 2000';
  assert pg_temp.save(rick, 'e1', null, null, repeat('é', 2001), pg_temp.seen('e1')) = too_long, '2001 accented letters';
  assert pg_temp.save(rick, 'e1', '{}', repeat('🏍', 2001), null, pg_temp.seen('e1')) = too_long, '2001 code points';
  assert pg_temp.save(rick, 'e1', null, null, null, pg_temp.seen('e1')) = empty, 'nothing at all';
  assert pg_temp.save(rick, 'e1', '{}', '', '', pg_temp.seen('e1')) = empty, 'empty texts';
  assert pg_temp.save(rick, 'e1', array['', ' ', null], E' \t\r\n', E'  　', pg_temp.seen('e1')) = empty,
    'whitespace the app trims';
  assert not exists (select 1 from ride_briefings), 'nothing was written';
end $$;

\echo 'At the limits it saves: lengths count code points once trimmed'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  b ride_briefings%rowtype;
begin
  assert pg_temp.save(rick, 'e2', pg_temp.lines(12, E'\t ' || repeat('x', 120) || E' \n') || array['', '  '],
    E'\n' || repeat('🏍', 2000) || ' ', repeat('é', 2000), pg_temp.seen('e2')) is null, '12 lines of 120, changes and notes of 2000';
  select * into b from ride_briefings where ride_id = pg_temp.ride('e2');
  assert cardinality(b.hazards) = 12, 'twelve lines';
  assert (select bool_and(h = repeat('x', 120)) from unnest(b.hazards) h), 'each trimmed';
  assert b.changes = repeat('🏍', 2000) and b.notes = repeat('é', 2000), 'the texts, trimmed';
  assert pg_temp.save(rick, 'e2', array[repeat('🏍', 120)], null, null, pg_temp.seen('e2')) is null, '120 code points';
  assert (select hazards from ride_briefings where ride_id = pg_temp.ride('e2')) = array[repeat('🏍', 120)], 'saved';
end $$;

\echo 'Saving trims, leaves out blank lines, keeps the order, stores empty as none, and replaces the last save'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  b ride_briefings%rowtype;
begin
  assert pg_temp.save(rick, 'e1', array['  Gravel at Myrniong  ', '', E'\tRoadworks on the Western Hwy\n', '   ', null,
    'Kangaroos at dusk'], '  Single file through Myrniong, no staggered formation  ', E' \n ', pg_temp.seen('e1')) is null, 'Rick saves';
  select * into b from ride_briefings where ride_id = pg_temp.ride('e1');
  assert found, 'a briefing for the breakfast';
  assert b.hazards = array['Gravel at Myrniong', 'Roadworks on the Western Hwy', 'Kangaroos at dusk'],
    format('trimmed, blanks left out, in order: %s', b.hazards);
  assert b.changes = 'Single file through Myrniong, no staggered formation', 'changes trimmed';
  assert b.notes is null, 'blank notes are none';
  assert b.updated_by = rick and b.updated_at = now(), 'Rick, now';

  update ride_briefings set updated_at = now() - interval '1 hour' where ride_id = pg_temp.ride('e1');
  assert pg_temp.save(wes, 'e1', null, '', 'Coffee at the bakery', pg_temp.seen('e1')) is null, 'Wes saves over it';
  select * into b from ride_briefings where ride_id = pg_temp.ride('e1');
  assert b.hazards = '{}' and b.changes is null and b.notes = 'Coffee at the bakery', 'no hazards, no changes, a note';
  assert b.updated_by = wes and b.updated_at = now(), 'Wes, now';
  assert (select count(*) from ride_briefings where ride_id = pg_temp.ride('e1')) = 1, 'one briefing per ride';
end $$;

\echo 'Briefing writers: the crew managers, plus whoever holds this ride''s Road Captain spot'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  chair constant uuid := '00000000-0000-0000-0000-0000000000d4';
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  gail constant uuid := '00000000-0000-0000-0000-0000000000d8';
  nobody constant text := 'Only the board, ride committee or this ride’s Road Captain can write the briefing.';
begin
  assert pg_temp.save(fran, 'e1', array['Gravel at Myrniong'], 'Single file through Myrniong', 'Fuel at Bacchus Marsh', pg_temp.seen('e1'))
    is null, 'Fran, the breakfast''s RC with no board seat, writes it';
  assert (select updated_by from ride_briefings where ride_id = pg_temp.ride('e1')) = fran, 'signed by Fran';
  assert pg_temp.save(fran, 'e9', array['Gravel'], null, null, pg_temp.seen('e9')) = nobody, 'but not another ride''s';

  assert pg_temp.save(gail, 'e3', array['Fog on the Black Spur'], null, null, pg_temp.seen('e3')) is null, 'Gail, RC of the North loop';
  update ride_crew set role = 'officer' where ride_id = pg_temp.ride('e3') and member_id = gail;
  assert pg_temp.save(gail, 'e3', array['Fog lifting'], null, null, pg_temp.seen('e3')) = nobody, 'moved to Officer, she can''t any more';
  assert (select hazards from ride_briefings where ride_id = pg_temp.ride('e3')) = array['Fog on the Black Spur'],
    'her briefing stays as it was';

  assert pg_temp.save(nora, 'e3', array['Fog lifting'], null, null, pg_temp.seen('e3')) is null, 'North RC on a North ride';
  assert pg_temp.save(nora, 'e9', array['Support van at the back'], null, null, pg_temp.seen('e9')) is null, 'any manager on a supported ride';
  assert pg_temp.save(chair, 'e1', array['Gravel at Myrniong'], null, 'Fuel at Bacchus Marsh', pg_temp.seen('e1')) is null,
    'the NEC Chairman on a West ride';
  assert pg_temp.save(wes, 'e3', array['Fog lifting'], 'Regroup at Marysville', null, pg_temp.seen('e3')) is null,
    'a sitting President is on the NEC';
  assert pg_temp.save(wes, 'e5', array['Low sun'], null, null, pg_temp.seen('e5')) is null, 'a ride that started this morning';
  assert pg_temp.save(wes, 'e7', null, null, 'Ferry at 9', pg_temp.seen('e7')) is null, 'an all-day ride that started today';
end $$;

\echo 'read_briefing checks signed in, approved, the ride, then that there is a briefing; any time, cancelled or past'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  none_yet constant text := 'There’s no briefing for this ride yet.';
  first_read timestamptz;
  -- The writers' own reads, from their saves above.
  n_reads constant bigint := (select count(*) from ride_briefing_reads);
begin
  assert not exists (select 1 from ride_briefing_reads where member_id = fergus), 'Fergus hasn''t read anything yet';
  insert into rides (id, source, starts_at, all_day, title, category) values
    ('00000000-0000-0000-0000-0000000000e8', 'app', now() + interval '7 days', false, 'Hills run', 'west');
  assert pg_temp.got_it(fergus, 'ff', pg_temp.seen('ff')) = 'No such ride.', 'a missing ride';
  assert pg_temp.got_it(rick, 'ff', pg_temp.seen('ff')) = 'No such ride.', 'even for a manager';
  assert pg_temp.got_it(fergus, 'e8', pg_temp.seen('e8')) = none_yet, 'a ride with no briefing';
  assert pg_temp.got_it(rick, 'e8', pg_temp.seen('e8')) = none_yet, 'not even for a manager';
  assert pg_temp.got_it(fergus, 'e4', pg_temp.seen('e4')) = none_yet, 'a cancelled ride with no briefing';
  assert (select count(*) from ride_briefing_reads) = n_reads, 'nothing was written';

  -- A cancelled ride's and last night's briefings still read.
  insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e4'), array['Flooding']),
    (pg_temp.ride('e6'), array['Black ice']);
  assert pg_temp.got_it(fergus, 'e4', pg_temp.seen('e4')) is null, 'a cancelled ride';
  assert pg_temp.got_it(rick, 'e4', pg_temp.seen('e4')) is null, 'Rick reads it too';
  assert pg_temp.got_it(fergus, 'e6', pg_temp.seen('e6')) is null, 'a past ride';

  assert pg_temp.got_it(fergus, 'e1', pg_temp.seen('e1')) is null, 'Fergus taps Got it';
  assert pg_temp.got_it(rick, 'e1', pg_temp.seen('e1')) is null, 'and Rick';
  select read_at into first_read from ride_briefing_reads where ride_id = pg_temp.ride('e1') and member_id = fergus;
  assert first_read = now(), 'read now';
  update ride_briefing_reads set read_at = now() - interval '1 day' where member_id = fergus;
  assert pg_temp.got_it(fergus, 'e1', pg_temp.seen('e1')) is null, 'he reads it again';
  assert (select read_at from ride_briefing_reads where ride_id = pg_temp.ride('e1') and member_id = fergus) = now(),
    'the read time moves to now';
  assert (select count(*) from ride_briefing_reads where ride_id = pg_temp.ride('e1') and member_id in (fergus, rick)) = 2,
    'one read each';
  assert (select count(*) from ride_briefing_reads where member_id = fergus) = 3, 'Fergus read three';
end $$;

\echo 'save_briefing after the ride day is refused even when the briefing is already there'
do $$
begin
  assert pg_temp.save('00000000-0000-0000-0000-0000000000d3', 'e6', array['Ice gone'], null, null, pg_temp.seen('e6'))
    = 'The briefing can’t change after the ride day.', 'last night';
  assert pg_temp.save('00000000-0000-0000-0000-0000000000d3', 'e4', array['Dry now'], null, null, pg_temp.seen('e4'))
    = 'That ride was cancelled.', 'cancelled';
  assert (select hazards from ride_briefings where ride_id = pg_temp.ride('e6')) = array['Black ice'], 'unchanged';
  assert (select hazards from ride_briefings where ride_id = pg_temp.ride('e4')) = array['Flooding'], 'unchanged';
end $$;

\echo 'Nobody writes briefings or reads through the API; approved members see all of both, applicants and the public nothing'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  n_briefings bigint := (select count(*) from ride_briefings);
  n_reads bigint := (select count(*) from ride_briefing_reads);
begin
  assert n_briefings > 0 and n_reads > 0, 'there is something to read';
  assert pg_temp.try_as(rick, format($q$insert into ride_briefings (ride_id, notes) values (%L, 'Sneaky')$q$,
    pg_temp.ride('e2'))) is not null, 'insert a briefing';
  assert pg_temp.try_as(rick, $q$update ride_briefings set notes = 'Mine'$q$) is not null, 'update briefings';
  assert pg_temp.try_as(rick, $q$delete from ride_briefings$q$) is not null, 'remove briefings';
  assert pg_temp.try_as(rick, format($q$insert into ride_briefing_reads (ride_id, member_id) values (%L, %L)$q$,
    pg_temp.ride('e3'), rick)) is not null, 'insert a read';
  assert pg_temp.try_as(rick, $q$update ride_briefing_reads set read_at = now()$q$) is not null, 'update reads';
  assert pg_temp.try_as(rick, $q$delete from ride_briefing_reads$q$) is not null, 'remove reads';
  assert pg_temp.try_as(null, $q$delete from ride_briefings$q$) is not null, 'anon, briefings';
  assert pg_temp.try_as(null, $q$delete from ride_briefing_reads$q$) is not null, 'anon, reads';
  assert (select count(*) from ride_briefings) = n_briefings and (select count(*) from ride_briefing_reads) = n_reads,
    'untouched';
  assert not exists (select 1 from ride_briefings where notes in ('Sneaky', 'Mine')), 'really untouched';

  assert pg_temp.count_as(fergus, 'ride_briefings') = n_briefings, 'an FNG reads every briefing';
  assert pg_temp.count_as(fergus, 'ride_briefing_reads') = n_reads, 'and every read';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d9', 'ride_briefings') = 0, 'an applicant sees no briefings';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d9', 'ride_briefing_reads') = 0, 'nor any reads';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000db', 'ride_briefings') = 0, 'nor a stranger';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000db', 'ride_briefing_reads') = 0, 'nor a stranger, reads';
  assert pg_temp.count_as(null, 'ride_briefings') = -1, 'the public has no grant';
  assert pg_temp.count_as(null, 'ride_briefing_reads') = -1, 'nor on reads';
end $$;

\echo 'The table rules hold even for a direct write: at most 12 hazards, each one there and at most 120 characters, changes and notes of at most 2000'
do $$
begin
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), pg_temp.lines(13, 'x'));
    assert false, '13 hazards got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, changes) values (pg_temp.ride('e8'), repeat('🏍', 2001));
    assert false, 'long changes got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, notes) values (pg_temp.ride('e8'), repeat('x', 2001));
    assert false, 'long notes got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), null);
    assert false, 'null hazards got in';
  exception when not_null_violation then null;
  end;
  -- Each line too: there, not blank, and at most 120 characters.
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array['Gravel', repeat('x', 121)]);
    assert false, 'a 121-character line got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array[repeat('🏍', 121)]);
    assert false, '121 code points got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array['Gravel', null]);
    assert false, 'a missing line got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array['']);
    assert false, 'an empty line got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array[E' \t　']);
    assert false, 'a blank line got in';
  exception when check_violation then null;
  end;
  begin
    insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array['Gravel']);
    update ride_briefings set hazards = hazards || repeat('x', 121) where ride_id = pg_temp.ride('e8');
    assert false, 'a long line got in by an update';
  exception when check_violation then null;
  end;
  insert into ride_briefings (ride_id, hazards) values (pg_temp.ride('e8'), array[repeat('🏍', 120), 'Gravel']);
  delete from ride_briefings where ride_id = pg_temp.ride('e8');
  insert into ride_briefings (ride_id, hazards, changes, notes)
  values (pg_temp.ride('e8'), pg_temp.lines(12, 'x'), repeat('🏍', 2000), repeat('x', 2000));
  delete from ride_briefings where ride_id = pg_temp.ride('e8');
  insert into ride_briefings (ride_id) values (pg_temp.ride('e8'));
  assert (select hazards = '{}' and updated_at is not null from ride_briefings where ride_id = pg_temp.ride('e8')),
    'no hazards and a time by default';
  delete from ride_briefings where ride_id = pg_temp.ride('e8');
end $$;

-- Reads ride_calendar() as someone, or the error.
create function pg_temp.calendar_as(who uuid) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    select public.ride_calendar() into out;
  exception when others then
    out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;
grant execute on function pg_temp.calendar_as(uuid) to anon, authenticated;

\echo 'The calendar brings the shown rides'' briefings and reads, with all six lists'
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  cal jsonb;
  expected jsonb;
begin
  cal := pg_temp.calendar_as(fergus);
  assert cal ?& array['rides', 'rsvps', 'crew', 'ride_routes', 'briefings', 'briefing_reads', 'synced_at'],
    format('all six lists and the sync time: %s', (select array_agg(k) from jsonb_object_keys(cal) k));
  assert (select count(*) from jsonb_object_keys(cal)) = 7, 'and nothing else';
  assert jsonb_array_length(cal->'crew') > 0, 'the crew is still there';

  select jsonb_agg(jsonb_build_object('ride_id', ride_id, 'hazards', to_jsonb(hazards), 'changes', changes,
                                      'notes', notes, 'updated_by', updated_by, 'updated_at', updated_at) order by ride_id)
  into expected from ride_briefings where ride_id <> pg_temp.ride('e6');
  assert cal->'briefings' = expected, format('shown rides'' briefings, in ride order: %s', cal->'briefings');
  assert jsonb_array_length(cal->'briefings') = 7, 'e1, e2, e3, e4, e5, e7, e9';
  assert not exists (select 1 from jsonb_array_elements(cal->'briefings') x where x->>'ride_id' = pg_temp.ride('e6')::text),
    'not last night''s';
  assert (select bool_and(jsonb_typeof(x->'hazards') = 'array') from jsonb_array_elements(cal->'briefings') x),
    'hazards as a list';
  assert (select x->'hazards' from jsonb_array_elements(cal->'briefings') x where x->>'ride_id' = pg_temp.ride('e3')::text)
    = '["Fog lifting"]', 'the North loop''s';
  assert (select bool_and(x - 'ride_id' - 'hazards' - 'changes' - 'notes' - 'updated_by' - 'updated_at' = '{}'::jsonb)
          from jsonb_array_elements(cal->'briefings') x), 'just those six fields';

  select jsonb_agg(jsonb_build_object('ride_id', ride_id, 'member_id', member_id, 'read_at', read_at)
                   order by ride_id, member_id)
  into expected from ride_briefing_reads where ride_id <> pg_temp.ride('e6');
  assert cal->'briefing_reads' = expected, format('shown rides'' reads, by ride then member: %s', cal->'briefing_reads');
  -- Fergus's and Rick's taps on the breakfast and the cancelled ride, plus each writer's own read
  -- from their saves: the breakfast (Rick, Wes, Fran, the Chairman), the club run (Rick), the North
  -- loop (Gail, Nora, Wes), the supported run (Nora), and Wes's two on today's rides.
  assert jsonb_array_length(cal->'briefing_reads') = 14, format('fourteen reads, not %s', jsonb_array_length(cal->'briefing_reads'));
  assert (select count(*) from jsonb_array_elements(cal->'briefing_reads') x
          where x->>'member_id' in ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d6')
            and x->>'ride_id' in (pg_temp.ride('e1')::text, pg_temp.ride('e4')::text)) = 4,
    'two each on the breakfast and the cancelled ride';
  assert (select bool_and(x - 'ride_id' - 'member_id' - 'read_at' = '{}'::jsonb)
          from jsonb_array_elements(cal->'briefing_reads') x), 'just those three fields';

  assert pg_temp.calendar_as('00000000-0000-0000-0000-0000000000d9') = '{"rides": [], "rsvps": [], "synced_at": null}',
    'an applicant gets the same empty calendar as before';
  assert pg_temp.calendar_as('00000000-0000-0000-0000-0000000000db') = '{"rides": [], "rsvps": [], "synced_at": null}',
    'and so does a stranger';
  assert pg_temp.calendar_as(null) ? 'error', 'the public can''t ask';
end $$;

\echo 'save_briefing locks the ride the same way as the crew, routes and answers do, so they queue'
create extension if not exists pgrowlocks;
-- The row locks held on a ride (by its last two hex digits) right now.
create function pg_temp.ride_locks(r text) returns text[] language sql as $$
  select l.modes from pgrowlocks('public.rides') l join public.rides x on x.ctid = l.locked_row
  where x.id = pg_temp.ride(r);
$$;
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  locks text[];
begin
  -- The action runs in a block that is then undone, which also lets go of its locks.
  begin
    assert pg_temp.save(rick, 'e8', array['Wet roads'], null, null, pg_temp.seen('e8')) is null, 'Rick writes the hills run''s';
    locks := pg_temp.ride_locks('e8');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{"For No Key Update"}', format('save_briefing locks the ride first, not %s', locks);
  assert not exists (select 1 from ride_briefings where ride_id = pg_temp.ride('e8')), 'the check changed nothing';
end $$;

\echo 'Got it carries the version on screen: an older one is refused, after the no-briefing check; within 1 ms is the same'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  paul constant uuid := '00000000-0000-0000-0000-0000000000d9';
  changed constant text := 'The briefing changed while you had it open. Read the new version, then tap Got it.';
  -- The database keeps microseconds; the app has only the milliseconds of it.
  stored constant timestamptz := '2026-10-20 10:00:00.123456+00';
  on_screen constant timestamptz := '2026-10-20 10:00:00.123+00';
begin
  insert into rides (id, source, starts_at, all_day, title, category) values
    ('00000000-0000-0000-0000-0000000000ea', 'app', now() + interval '7 days', false, 'Coast run', 'west'),
    ('00000000-0000-0000-0000-0000000000eb', 'app', now() + interval '7 days', false, 'Gippsland loop', 'west');
  insert into ride_briefings (ride_id, hazards, updated_at) values (pg_temp.ride('ea'), array['Sand on the Great Ocean Rd'], stored);

  assert pg_temp.got_it(fergus, 'ea', on_screen) is null, 'the version on screen, to the millisecond';
  assert pg_temp.got_it(rick, 'ea', stored - interval '1 millisecond') is null, 'exactly 1 ms older still counts';
  assert pg_temp.got_it(rick, 'ea', stored + interval '1 hour') is null, 'a newer stamp is not refused';
  delete from ride_briefing_reads where ride_id = pg_temp.ride('ea');

  assert pg_temp.got_it(fergus, 'ea', stored - interval '1001 microseconds') = changed, 'more than 1 ms older';
  assert pg_temp.got_it(fergus, 'ea', '2026-10-19 10:00:00+00') = changed, 'a day older';
  assert pg_temp.got_it(fergus, 'ea', null) = changed, 'no version at all';
  assert pg_temp.got_it(rick, 'ea', null) = changed, 'not even for a manager';
  assert not exists (select 1 from ride_briefing_reads where ride_id = pg_temp.ride('ea')), 'a refused read writes nothing';

  -- An old read stays as it was when Got it is refused.
  insert into ride_briefing_reads (ride_id, member_id, read_at) values (pg_temp.ride('ea'), fergus, stored - interval '1 day');
  assert pg_temp.got_it(fergus, 'ea', stored - interval '1 day') = changed, 'Fergus on yesterday''s card';
  assert (select read_at from ride_briefing_reads where ride_id = pg_temp.ride('ea') and member_id = fergus)
    = stored - interval '1 day', 'his read is still out of date';

  -- Every other check comes first.
  assert pg_temp.try_signed_out(format('select public.read_briefing(%L, null)', pg_temp.ride('ea'))) = 'Sign in first.',
    'signed out';
  assert pg_temp.got_it(paul, 'ea', null) = 'Only approved members can do that.', 'approved';
  assert pg_temp.got_it(fergus, 'ff', null) = 'No such ride.', 'the ride';
  assert pg_temp.got_it(fergus, 'eb', '2026-10-19 10:00:00+00') = 'There’s no briefing for this ride yet.',
    'no briefing comes before an old version';
end $$;

\echo 'save_briefing carries the version the editor opened on: a save on top of a newer one is refused, right after who may write'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  clash constant text :=
    'Someone else saved this briefing while you were editing. Your changes aren’t saved: copy them, then open the briefing again.';
  stored constant timestamptz := '2026-10-20 10:00:00.123456+00';
begin
  assert pg_temp.seen('ea') = stored, 'the coast run''s briefing is at its stored version';
  assert pg_temp.save(rick, 'ea', array['Fog'], null, null, stored - interval '1001 microseconds') = clash,
    'opened more than 1 ms before the stored version';
  assert pg_temp.save(rick, 'ea', array['Fog'], null, null, '2026-10-19 10:00:00+00') = clash, 'opened a day before';
  assert pg_temp.save(rick, 'ea', array['Fog'], null, null, null) = clash, 'opened when there was no briefing';
  -- It comes before every content check.
  assert pg_temp.save(rick, 'ea', pg_temp.lines(13, 'x'), null, null, null) = clash, 'before too many';
  assert pg_temp.save(rick, 'ea', array[repeat('x', 121)], null, null, null) = clash, 'before a long line';
  assert pg_temp.save(rick, 'ea', null, repeat('x', 2001), null, null) = clash, 'before long changes';
  assert pg_temp.save(rick, 'ea', null, null, null, null) = clash, 'before empty';
  -- And after who may write, the ride day and the rest.
  assert pg_temp.save(fergus, 'ea', array['Fog'], null, null, null) =
    'Only the board, ride committee or this ride’s Road Captain can write the briefing.', 'who may write comes first';
  assert pg_temp.save(rick, 'e6', array['Fog'], null, null, null) = 'The briefing can’t change after the ride day.',
    'the ride day comes first';
  assert pg_temp.save(rick, 'e4', array['Fog'], null, null, null) = 'That ride was cancelled.', 'cancelled comes first';
  assert pg_temp.seen('ea') = stored and (select hazards from ride_briefings where ride_id = pg_temp.ride('ea'))
    = array['Sand on the Great Ocean Rd'], 'a refused save changes nothing';

  assert pg_temp.save(rick, 'ea', array['Fog'], null, null, '2026-10-20 10:00:00.123+00') is null,
    'opened on the stored version, to the millisecond';
  assert pg_temp.seen('ea') = now(), 'saved now';
  assert pg_temp.save(wes, 'ea', array['Fog lifting'], null, null, now() - interval '1 millisecond') is null,
    'exactly 1 ms older still counts';

  assert pg_temp.save(rick, 'eb', array['Logging trucks'], null, null, '2026-10-19 10:00:00+00') is null,
    'no briefing stored, so nothing to clash with';
end $$;

\echo 'Saving also marks the writer''s own read, at the same time, and leaves everyone else''s'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  r ride_briefing_reads%rowtype;
begin
  insert into ride_briefing_reads (ride_id, member_id, read_at) values (pg_temp.ride('eb'), fergus, now() - interval '1 day')
  on conflict (ride_id, member_id) do update set read_at = excluded.read_at;
  update ride_briefings set updated_at = now() - interval '2 days' where ride_id = pg_temp.ride('eb');
  update ride_briefing_reads set read_at = now() - interval '3 days' where ride_id = pg_temp.ride('eb') and member_id = rick;
  assert pg_temp.save(rick, 'eb', array['Logging trucks', 'Wet bridge'], null, null, pg_temp.seen('eb')) is null, 'Rick saves';
  select * into r from ride_briefing_reads where ride_id = pg_temp.ride('eb') and member_id = rick;
  assert found and r.read_at = pg_temp.seen('eb') and r.read_at = now(), 'his read is the save''s time';
  assert (select count(*) from ride_briefing_reads where ride_id = pg_temp.ride('eb') and member_id = rick) = 1,
    'one read, moved';
  assert (select read_at from ride_briefing_reads where ride_id = pg_temp.ride('eb') and member_id = fergus)
    = now() - interval '1 day', 'Fergus''s read stays, now out of date';
  assert (select read_at < updated_at from ride_briefing_reads br join ride_briefings b using (ride_id)
          where br.ride_id = pg_temp.ride('eb') and br.member_id = fergus), 'so he''s asked to read it again';

  -- A refused save marks nothing.
  delete from ride_briefing_reads where ride_id = pg_temp.ride('eb') and member_id = rick;
  assert pg_temp.save(rick, 'eb', array['Fog'], null, null, null) is not null, 'a clash';
  assert pg_temp.save(rick, 'eb', null, null, null, pg_temp.seen('eb')) is not null, 'empty';
  assert not exists (select 1 from ride_briefing_reads where ride_id = pg_temp.ride('eb') and member_id = rick),
    'no read for a refused save';
end $$;

\echo 'Got it waits for a save in progress on the same briefing, so it checks the version that save leaves'
create function pg_temp.briefing_locks(r text) returns text[] language sql as $$
  select l.modes from pgrowlocks('public.ride_briefings') l join public.ride_briefings x on x.ctid = l.locked_row
  where x.ride_id = pg_temp.ride(r);
$$;
do $$
declare
  locks text[];
begin
  begin
    assert pg_temp.got_it('00000000-0000-0000-0000-0000000000d6', 'eb', pg_temp.seen('eb')) is null, 'Fergus reads it';
    locks := pg_temp.briefing_locks('eb');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{"For Share"}', format('read_briefing shares the briefing row, not %s', locks);
end $$;

\echo 'A briefing and its reads go with the ride; a member leaving takes their reads and leaves their briefings unsigned'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
begin
  assert exists (select 1 from ride_briefings where updated_by = wes), 'Wes wrote some';
  delete from members where id = wes;
  assert not exists (select 1 from ride_briefings where updated_by = wes), 'unsigned now';
  assert exists (select 1 from ride_briefings where ride_id = pg_temp.ride('e7') and updated_by is null), 'but still there';
  delete from members where id = fergus;
  assert not exists (select 1 from ride_briefing_reads where member_id = fergus), 'Fergus''s reads went with him';
  assert exists (select 1 from ride_briefing_reads where ride_id = pg_temp.ride('e1')), 'Rick''s stays';

  delete from rides where id = pg_temp.ride('e1');
  assert not exists (select 1 from ride_briefings where ride_id = pg_temp.ride('e1')), 'the briefing went with the ride';
  assert not exists (select 1 from ride_briefing_reads where ride_id = pg_temp.ride('e1')), 'and its reads';
end $$;
