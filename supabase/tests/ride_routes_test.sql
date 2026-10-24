-- Checks ride routes: the route library (save_route, archive_route, route_gpx) and each ride's route
-- (set_ride_route), with the refusals in the same words and order as src/domain/routes.ts, the GPX
-- checks, who can read what, and the calendar's ride_routes.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),      -- West President (so on the NEC)
  ('00000000-0000-0000-0000-0000000000d2', 'nora@example.com', now()),     -- North Road Captain
  ('00000000-0000-0000-0000-0000000000d3', 'rick@example.com', now()),     -- West Ride Committee
  ('00000000-0000-0000-0000-0000000000d4', 'chair@example.com', now()),    -- NEC Chairman (North member)
  ('00000000-0000-0000-0000-0000000000d5', 'fran@example.com', now()),     -- Full, once West Road Captain
  ('00000000-0000-0000-0000-0000000000d6', 'fergus@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-0000000000d7', 'tess@example.com', now()),     -- West Treasurer
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
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'Tess Treasurer', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Paul Pending', null, 'introduced', 'pending')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000d2', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000000d4', null, 'nec_chair'),
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'treasurer')
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

-- Runs a query as someone and returns its one value as text, or 'error: ...'.
create function pg_temp.value_as(who uuid, query text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute query into out;
  exception when others then
    out := 'error: ' || sqlerrm;
  end;
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

-- A small, good GPX file: two track points.
create function pg_temp.good_gpx() returns text language sql immutable as $$
  select '<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="-37.80" lon="144.90"><name>Servo</name></wpt>
  <trk><name>Loop</name><trkseg>
    <trkpt lat="-37.80" lon="144.90"><ele>10</ele></trkpt>
    <trkpt lat="-37.81" lon="144.91"><ele>25</ele></trkpt>
  </trkseg></trk>
</gpx>';
$$;

-- The id of a route by its name (routes are named uniquely in this test).
create function pg_temp.rid(route_name text) returns uuid language sql as $$
  select id from public.routes where name = route_name;
$$;

-- save_route as someone: a route (null for a new one), its name, chapter slug (null for the whole
-- club) and GPX, with a fixed summary.
create function pg_temp.save(who uuid, route uuid, route_name text, chapter text, gpx text, notes text default null)
returns text language sql as $$
  select pg_temp.try_as(who, format('select public.save_route(%L, %L, %L, %L, %L, 1234, 56, %L, %L, %L)',
    route, route_name, (select id from public.chapters where slug = chapter), notes, gpx,
    '[[-37.8,144.9],[-37.81,144.91]]', '[{"name":"Servo","lat":-37.8,"lng":144.9}]',
    '{"minLat":-37.81,"minLng":144.9,"maxLat":-37.8,"maxLng":144.91}'));
$$;

create function pg_temp.archive(who uuid, route uuid) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.archive_route(%L)', route));
$$;

-- set_ride_route as someone, on a ride (by its last two hex digits), to a route (null clears it).
create function pg_temp.pick(who uuid, ride text, route uuid) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.set_ride_route(%L, %L)',
    ('00000000-0000-0000-0000-0000000000' || ride)::uuid, route));
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.try_signed_out(text), pg_temp.value_as(uuid, text),
  pg_temp.count_as(uuid, text), pg_temp.good_gpx(), pg_temp.rid(text), pg_temp.save(uuid, uuid, text, text, text, text),
  pg_temp.archive(uuid, uuid), pg_temp.pick(uuid, text, uuid) to anon, authenticated;

\o
\echo 'This Postgres reads XML (it was built with libxml)'
do $$
begin
  assert xml_is_well_formed_document('<a/>'), 'xml support';
end $$;

\echo 'Route actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
declare
  fns constant regprocedure[] := array[
    'public.save_route(uuid, text, uuid, text, text, int, int, jsonb, jsonb, jsonb)'::regprocedure,
    'public.archive_route(uuid)'::regprocedure,
    'public.set_ride_route(uuid, uuid)'::regprocedure,
    'public.route_gpx(uuid)'::regprocedure,
    'private.manages_chapter_rides(uuid)'::regprocedure,
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
  assert pg_temp.save(null, null, 'Anon loop', 'west', pg_temp.good_gpx()) is not null, 'the public can''t call it';
  assert not exists (select 1 from routes), 'nothing was written';
end $$;

\echo 'The first checks come in the app''s order: signed in, then approved'
do $$
declare
  paul constant uuid := '00000000-0000-0000-0000-0000000000d9';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000db';
  approved constant text := 'Only approved members can do that.';
begin
  assert pg_temp.try_signed_out(format('select public.save_route(null, %L, null, null, %L, 1, 1, null, null, null)',
    'Lost', pg_temp.good_gpx())) = 'Sign in first.', 'save: signed out';
  assert pg_temp.try_signed_out(format('select public.archive_route(%L)', gen_random_uuid())) = 'Sign in first.',
    'archive: signed out';
  assert pg_temp.try_signed_out(format('select public.set_ride_route(%L, null)',
    '00000000-0000-0000-0000-0000000000e1')) = 'Sign in first.', 'pick: signed out';
  assert pg_temp.try_signed_out(format('select public.route_gpx(%L)', gen_random_uuid())) = 'Sign in first.',
    'gpx: signed out';
  assert pg_temp.save(paul, null, 'Paul''s loop', 'west', pg_temp.good_gpx()) = approved, 'save: pending';
  assert pg_temp.save(stranger, null, 'Stranger loop', 'west', pg_temp.good_gpx()) = approved, 'save: no record';
  assert pg_temp.save(paul, gen_random_uuid(), '', 'west', 'nonsense') = approved, 'approved comes before everything else';
  assert pg_temp.archive(paul, gen_random_uuid()) = approved, 'archive: pending';
  assert pg_temp.pick(paul, 'ff', null) = approved, 'pick: pending, before the ride';
  assert pg_temp.pick(stranger, 'e1', null) = approved, 'pick: no record';
  assert pg_temp.try_as(paul, format('select public.route_gpx(%L)', gen_random_uuid())) = approved, 'gpx: pending';
  assert not exists (select 1 from routes), 'nothing was written';
end $$;

\echo 'save_route checks the route, then who may change it, then the name, then the file'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  nobody constant text := 'Only the board or ride committee can change routes.';
  no_name constant text := 'Give the route a name.';
begin
  assert pg_temp.save(fergus, gen_random_uuid(), 'Ghost', 'west', pg_temp.good_gpx()) = 'That route no longer exists.',
    'a missing route comes before who may change it';
  assert pg_temp.save(rick, gen_random_uuid(), 'Ghost', 'west', pg_temp.good_gpx()) = 'That route no longer exists.',
    'a manager editing a missing route';
  assert pg_temp.save(fergus, null, 'Fergus loop', 'west', pg_temp.good_gpx()) = nobody, 'an FNG';
  assert pg_temp.save(fran, null, 'Fran loop', null, pg_temp.good_gpx()) = nobody, 'an ended seat gives no powers';
  assert pg_temp.save(fergus, null, '', 'west', 'nonsense') = nobody, 'who may change it comes before the name and file';
  assert pg_temp.save(rick, null, '', 'west', pg_temp.good_gpx()) = no_name, 'a blank name';
  assert pg_temp.save(rick, null, '   ', 'west', pg_temp.good_gpx()) = no_name, 'spaces only';
  assert pg_temp.save(rick, null, E'\t\n', 'west', pg_temp.good_gpx()) = no_name, 'a tab and a newline only';
  assert pg_temp.save(rick, null, E'\u00a0\u3000\ufeff', 'west', pg_temp.good_gpx()) = no_name,
    'other whitespace the app trims';
  assert pg_temp.save(rick, null, E'\t' || repeat('x', 81) || E'\n', 'west', pg_temp.good_gpx()) = no_name,
    'too long once trimmed';
  assert pg_temp.save(rick, null, null, 'west', pg_temp.good_gpx()) = no_name, 'no name at all';
  assert pg_temp.save(rick, null, repeat('x', 81), 'west', pg_temp.good_gpx()) = no_name, '81 characters';
  assert pg_temp.save(rick, null, '', 'west', 'nonsense') = no_name, 'the name comes before the file';
  assert pg_temp.save(rick, null, '', 'west', null) = no_name, 'and before a missing file';
  assert not exists (select 1 from routes), 'nothing was written';
end $$;

\echo 'A GPX file has to be under 5 MB, well-formed GPX, with at least two track or route points'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  too_big constant text := 'That file is too big (5 MB at most).';
  not_gpx constant text := 'That isn’t a GPX file.';
  no_track constant text := 'That route has no track in it.';
  head constant text := '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>'
    || '<trkpt lat="-37.80" lon="144.90"/><trkpt lat="-37.81" lon="144.91"/></trkseg></trk>';
  big_gpx text := '<gpx><trk><trkseg>' || repeat('<trkpt lat="-37.80" lon="144.90"/>', 160000) || '</trkseg></trk></gpx>';
begin
  -- The size comes first: an oversized file is refused for its size, whatever is in it.
  assert octet_length(big_gpx) > 5242880, 'the big file really is big';
  assert pg_temp.save(rick, null, 'Big', 'west', big_gpx) = too_big, 'a big GPX file';
  assert pg_temp.save(rick, null, 'Big junk', 'west', repeat('x', 5242881)) = too_big, 'big junk';
  -- 5 MB counts bytes, not characters: 2,621,441 two-byte characters is one byte over.
  assert pg_temp.save(rick, null, 'Big accents', 'west', repeat('é', 2621441)) = too_big, 'bytes, not characters';
  assert pg_temp.save(rick, null, 'Not XML', 'west', 'hello') = not_gpx, 'not XML';
  assert pg_temp.save(rick, null, 'Empty', 'west', '') = not_gpx, 'an empty file';
  assert pg_temp.save(rick, null, 'Cut short', 'west', '<gpx><trk><trkseg><trkpt lat="1" lon="2"/>') = not_gpx,
    'malformed';
  assert pg_temp.save(rick, null, 'Two roots', 'west', '<gpx/><gpx/>') = not_gpx, 'two roots is not one document';
  assert pg_temp.save(rick, null, 'KML', 'west',
    '<kml><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></kml>') = not_gpx, 'well-formed, with points, but not GPX';
  assert pg_temp.save(rick, null, 'Nested', 'west',
    '<doc><gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx></doc>') = not_gpx,
    'GPX inside something else';
  assert pg_temp.save(rick, null, 'Empty track', 'west', '<gpx><trk><trkseg></trkseg></trk></gpx>') = no_track,
    'an empty track';
  assert pg_temp.save(rick, null, 'One point', 'west',
    '<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>') = no_track, 'one point';
  assert pg_temp.save(rick, null, 'Only stops', 'west',
    '<gpx><wpt lat="1" lon="2"/><wpt lat="3" lon="4"/></gpx>') = no_track, 'waypoints aren''t a track';
  assert pg_temp.save(rick, null, 'No file', 'west', null) = no_track, 'a new route needs a file';
  assert not exists (select 1 from routes), 'nothing was written';

  assert pg_temp.save(rick, null, 'Route only', 'west',
    '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte></gpx>') is null, 'route points will do';
  assert pg_temp.save(rick, null, 'Prefixed', 'west',
    '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat=''1'' lon=''2''/>'
    || '<g:trkpt lat=''3'' lon=''4''/></g:trkseg></g:trk></g:gpx>') is null, 'a gpx:-prefixed file';
  -- A leading byte order mark is dropped before the checks, and not kept.
  assert pg_temp.save(rick, null, 'With BOM', 'west', chr(65279) || pg_temp.good_gpx()) is null, 'a file with a BOM';
  assert (select gpx from routes where name = 'With BOM') = pg_temp.good_gpx(), 'kept without it';
  assert pg_temp.save(rick, null, 'Two BOMs', 'west', chr(65279) || chr(65279) || pg_temp.good_gpx()) = not_gpx,
    'only one is dropped';
  assert pg_temp.save(rick, null, 'BOM too big', 'west', chr(65279) || repeat('x', 5242881)) = too_big,
    'a big file with a BOM';
  -- Exactly 5 MB passes.
  assert pg_temp.save(rick, null, 'Just fits', 'west',
    head || repeat(' ', 5242880 - octet_length(head) - 6) || '</gpx>') is null, 'exactly 5 MB';
  assert octet_length((select gpx from routes where name = 'Just fits')) = 5242880, 'all of it was kept';
  assert pg_temp.save(rick, null, 'Just fits with BOM', 'west',
    chr(65279) || head || repeat(' ', 5242880 - octet_length(head) - 6) || '</gpx>') is null,
    'the BOM doesn''t count towards 5 MB';
end $$;

\echo 'A route manager adds a route; everything is kept, and save_route returns its id'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  saved uuid;
  r routes%rowtype;
begin
  assert pg_temp.save(rick, null, '  West loop  ', 'west', pg_temp.good_gpx(), '  Fuel at Bacchus Marsh.  ') is null,
    'Rick adds the West loop';
  select * into r from routes where name = 'West loop';
  assert found, 'the name is trimmed';
  assert r.chapter_id = (select id from chapters where slug = 'west'), 'a West route';
  assert r.notes = 'Fuel at Bacchus Marsh.', 'notes trimmed';
  assert r.gpx = pg_temp.good_gpx(), 'the file as sent';
  assert r.distance_m = 1234 and r.climb_m = 56, 'distance and climb';
  assert r.line = '[[-37.8,144.9],[-37.81,144.91]]' and r.stops = '[{"name":"Servo","lat":-37.8,"lng":144.9}]'
    and r.bounds = '{"minLat":-37.81,"minLng":144.9,"maxLat":-37.8,"maxLng":144.91}', 'the summary';
  assert r.created_by = rick and r.updated_by = rick, 'Rick made it';
  assert r.created_at is not null and r.updated_at is not null and r.archived_at is null, 'the times';
  assert pg_temp.save(rick, null, E'\t\u00a0Tabbed loop\r\n', 'west', pg_temp.good_gpx()) is null, 'a name with tabs';
  assert pg_temp.rid('Tabbed loop') is not null, 'trimmed like the app trims';

  perform set_config('request.jwt.claim.sub', rick::text, true);
  set local role authenticated;
  saved := public.save_route(null, 'Rick returns', null, null, pg_temp.good_gpx(), 10, null, null, null, null);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert saved = pg_temp.rid('Rick returns'), 'the new id comes back';
  select * into r from routes where id = saved;
  assert r.chapter_id is null and r.notes is null and r.climb_m is null, 'whole club, no notes, no climb';
  assert r.line = '[]' and r.stops = '[]' and r.bounds is null, 'an empty summary is kept empty';
end $$;

\echo 'Route managers: that chapter''s board or Ride Committee, any of them for whole-club routes, the NEC for all'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  chair constant uuid := '00000000-0000-0000-0000-0000000000d4';
  tess constant uuid := '00000000-0000-0000-0000-0000000000d7';
  nobody constant text := 'Only the board or ride committee can change routes.';
begin
  assert pg_temp.save(nora, null, 'North hills', 'north', pg_temp.good_gpx()) is null, 'North RC, North route';
  assert pg_temp.save(nora, null, 'Club run', null, pg_temp.good_gpx()) is null, 'North RC, whole-club route';
  assert pg_temp.save(nora, null, 'Nora west', 'west', pg_temp.good_gpx()) = nobody, 'North RC, West route';
  assert pg_temp.save(rick, null, 'Rick north', 'north', pg_temp.good_gpx()) = nobody, 'West committee, North route';
  assert pg_temp.save(tess, null, 'Tess west', 'west', pg_temp.good_gpx()) is null, 'a West Treasurer, West route';
  assert pg_temp.save(chair, null, 'Chair west', 'west', pg_temp.good_gpx()) is null, 'the NEC Chairman, West';
  assert pg_temp.save(chair, null, 'Chair north', 'north', pg_temp.good_gpx()) is null, 'and North';
  assert pg_temp.save(wes, null, 'Wes north', 'north', pg_temp.good_gpx()) is null, 'a sitting President is on the NEC';

  -- Editing: the manager has to manage both the route's chapter and the one it moves to.
  assert pg_temp.save(nora, pg_temp.rid('West loop'), 'West loop', 'west', null) = nobody, 'North RC edits a West route';
  assert pg_temp.save(nora, pg_temp.rid('West loop'), 'West loop', 'north', null) = nobody, 'nor takes it North';
  assert pg_temp.save(rick, pg_temp.rid('North hills'), 'North hills', 'west', null) = nobody, 'nor Rick takes one West';
  assert pg_temp.save(rick, pg_temp.rid('West loop'), 'West loop', 'north', null) = nobody, 'nor sends his North';
  assert pg_temp.save(rick, pg_temp.rid('Club run'), 'Club run', 'west', null) is null, 'whole club to West';
  assert pg_temp.save(nora, pg_temp.rid('Club run'), 'Club run', null, null) = nobody, 'now Nora can''t touch it';
  assert pg_temp.save(rick, pg_temp.rid('Club run'), 'Club run', null, null) is null, 'Rick puts it back';
  assert pg_temp.save(nora, pg_temp.rid('Club run'), 'Club run', null, null) is null, 'and Nora can again';
  assert pg_temp.save(chair, pg_temp.rid('North hills'), 'North hills', 'west', null) is null, 'the NEC moves one';
  assert pg_temp.save(chair, pg_temp.rid('North hills'), 'North hills', 'north', null) is null, 'and back';

  -- The rule itself, for the app's other uses.
  assert pg_temp.value_as(nora, format('select private.manages_chapter_rides(%L)',
    (select id from chapters where slug = 'north'))) = 'true', 'Nora manages North';
  assert pg_temp.value_as(nora, 'select private.manages_chapter_rides(null)') = 'true', 'and the whole club';
  assert pg_temp.value_as(nora, format('select private.manages_chapter_rides(%L)',
    (select id from chapters where slug = 'west'))) = 'false', 'not West';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000d6', 'select private.manages_chapter_rides(null)') = 'false',
    'an FNG manages nothing';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000d5', 'select private.manages_chapter_rides(null)') = 'false',
    'nor an ended seat';
  -- The Melbourne date, which seats start on: the server's current_date can be a day behind it.
  update positions set ended_on = private.club_date() where member_id = rick;
  assert pg_temp.save(rick, null, 'Rick ended', 'west', pg_temp.good_gpx()) = nobody, 'an ended committee seat neither';
  update positions set ended_on = null where member_id = rick;
end $$;

\echo 'Editing: a null file keeps the file and its summary; a new file replaces both'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  tess constant uuid := '00000000-0000-0000-0000-0000000000d7';
  id0 uuid := pg_temp.rid('West loop');
  west uuid := (select id from chapters where slug = 'west');
  new_gpx constant text := '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/><rtept lat="5" lon="6"/></rte></gpx>';
  before routes%rowtype;
  r routes%rowtype;
begin
  update routes set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = id0;
  select * into before from routes where id = id0;
  assert pg_temp.save(tess, id0, 'West loop (long)', 'west', null, 'Now longer.') is null, 'Tess renames it';
  select * into r from routes where id = id0;
  assert r.name = 'West loop (long)' and r.notes = 'Now longer.', 'new name and notes';
  assert r.gpx = before.gpx and r.distance_m = before.distance_m and r.line = before.line and r.stops = before.stops
    and r.bounds = before.bounds and r.climb_m = before.climb_m, 'the file and summary stay';
  assert r.created_by = rick and r.created_at = before.created_at, 'still Rick''s';
  assert r.updated_by = tess and r.updated_at > before.updated_at, 'Tess changed it last';
  assert pg_temp.save(tess, id0, 'West loop (long)', 'west', null, '') is null, 'notes cleared';
  assert (select notes from routes where id = id0) is null, 'blank notes are none';

  assert pg_temp.save(rick, id0, 'West loop (long)', 'west', 'hello') = 'That isn’t a GPX file.', 'a bad new file';
  assert pg_temp.save(rick, id0, 'Renamed anyway', 'west', '<gpx/>') = 'That route has no track in it.', 'an empty one';
  assert (select name from routes where id = id0) = 'West loop (long)', 'a refused edit changes nothing';

  perform set_config('request.jwt.claim.sub', rick::text, true);
  set local role authenticated;
  assert public.save_route(id0, 'West loop (long)', west, null, new_gpx,
    999, null, '[[1,2],[5,6]]', '[]', '{"minLat":1,"minLng":2,"maxLat":5,"maxLng":6}') = id0, 'the same id comes back';
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  select * into r from routes where id = id0;
  assert r.gpx = new_gpx and r.distance_m = 999 and r.climb_m is null and r.line = '[[1,2],[5,6]]' and r.stops = '[]',
    'the new file and its summary';
  assert (select count(*) from routes where name like 'West loop%') = 1, 'still one route';
end $$;

\echo 'Archiving: managers only, hides nothing it already has, and can be done twice'
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  chair constant uuid := '00000000-0000-0000-0000-0000000000d4';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  nobody constant text := 'Only the board or ride committee can change routes.';
  first_archived timestamptz;
begin
  assert pg_temp.archive(fergus, gen_random_uuid()) = 'That route no longer exists.', 'a missing route comes first';
  assert pg_temp.archive(fergus, pg_temp.rid('Tess west')) = nobody, 'an FNG';
  assert pg_temp.archive(nora, pg_temp.rid('Tess west')) = nobody, 'another chapter''s Road Captain';
  assert (select archived_at from routes where name = 'Tess west') is null, 'still there';

  assert pg_temp.pick(rick, 'e1', pg_temp.rid('Tess west')) is null, 'the West breakfast uses it';
  assert pg_temp.archive(rick, pg_temp.rid('Tess west')) is null, 'Rick archives it';
  select archived_at into first_archived from routes where name = 'Tess west';
  assert first_archived is not null, 'archived';
  assert (select updated_by from routes where name = 'Tess west') = rick, 'by Rick';
  assert (select route_id from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1')
    = pg_temp.rid('Tess west'), 'the ride keeps its route';
  assert pg_temp.archive(rick, pg_temp.rid('Tess west')) is null, 'archiving again is fine';
  assert (select archived_at from routes where name = 'Tess west') = first_archived, 'and changes nothing';
  assert pg_temp.archive(chair, pg_temp.rid('Wes north')) is null, 'the NEC archives a North route';

  assert pg_temp.save(rick, pg_temp.rid('Tess west'), 'Tess west (old)', 'west', null) is null,
    'an archived route can still be edited';
  assert (select archived_at from routes where name = 'Tess west (old)') = first_archived, 'and stays archived';
end $$;

\echo 'set_ride_route checks the ride, cancelled, the ride day, who may choose, then the route'
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  nobody constant text := 'Only the board or ride committee can choose this ride’s route.';
  gone constant text := 'That route no longer exists.';
  archived constant text := 'That route has been archived.';
  midnight timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
  over constant text := 'The route can’t change after the ride day.';
begin
  insert into rides (id, source, starts_at, ends_at, all_day, title, category) values
    ('00000000-0000-0000-0000-0000000000e5', 'app', midnight + interval '1 minute', null, false, 'Dawn patrol', 'west'),
    ('00000000-0000-0000-0000-0000000000e6', 'app', midnight - interval '1 minute', null, false, 'Midnight run', 'west'),
    ('00000000-0000-0000-0000-0000000000e7', 'app', midnight, midnight + interval '2 days', true, 'Island weekend', 'club');

  assert pg_temp.pick(fergus, 'ff', gen_random_uuid()) = 'No such ride.', 'a missing ride';
  assert pg_temp.pick(fergus, 'e4', gen_random_uuid()) = 'That ride was cancelled.', 'cancelled comes first';
  assert pg_temp.pick(rick, 'e4', pg_temp.rid('Club run')) = 'That ride was cancelled.', 'even for a manager';
  assert pg_temp.pick(fergus, 'e6', gen_random_uuid()) = over, 'the ride day comes before who may choose';
  assert pg_temp.pick(rick, 'e6', pg_temp.rid('Club run')) = over, 'a ride that started a minute before midnight';
  assert pg_temp.pick(fergus, 'e1', gen_random_uuid()) = nobody, 'who may choose comes before the route';
  assert pg_temp.pick(fergus, 'e1', pg_temp.rid('Tess west (old)')) = nobody, 'and before archived';
  assert pg_temp.pick(fergus, 'e2', null) = nobody, 'an FNG can''t clear one either';
  assert pg_temp.pick(nora, 'e1', pg_temp.rid('Club run')) = nobody, 'another chapter''s Road Captain on a West ride';
  assert pg_temp.pick('00000000-0000-0000-0000-0000000000d5', 'e2', pg_temp.rid('Club run')) = nobody,
    'an ended seat gives no powers';
  assert pg_temp.pick(rick, 'e1', gen_random_uuid()) = gone, 'a missing route';
  assert pg_temp.pick(rick, 'e2', pg_temp.rid('Tess west (old)')) = archived, 'an archived route';
  assert pg_temp.pick(rick, 'e2', pg_temp.rid('Wes north')) = archived, 'another archived one';
  assert not exists (select 1 from ride_routes where ride_id <> '00000000-0000-0000-0000-0000000000e1'), 'nothing was written';

  assert pg_temp.pick(rick, 'e5', pg_temp.rid('Club run')) is null, 'a ride that started this morning';
  assert pg_temp.pick(rick, 'e7', pg_temp.rid('Club run')) is null, 'an all-day ride that started today';
  assert pg_temp.pick(nora, 'e3', pg_temp.rid('North hills')) is null, 'North RC on a North ride';
  assert pg_temp.pick(nora, 'e2', pg_temp.rid('West loop (long)')) is null, 'any manager on a club ride, any route';
  assert pg_temp.pick(nora, 'e9', pg_temp.rid('Club run')) is null, 'and a supported ride';
  assert pg_temp.pick('00000000-0000-0000-0000-0000000000d4', 'e1', pg_temp.rid('Club run')) is null,
    'the NEC Chairman on a West ride';
  assert (select route_id from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1')
    = pg_temp.rid('Club run'), 'a new choice replaces the old one';
  assert (select set_by from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1')
    = '00000000-0000-0000-0000-0000000000d4', 'the Chairman chose it';
  assert (select count(*) from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1') = 1, 'one per ride';

  assert pg_temp.pick(rick, 'e1', null) is null, 'Rick clears it';
  assert (select route_id from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1') is null, 'no route';
  assert (select set_by from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1') = rick, 'Rick cleared it';
  assert pg_temp.pick(rick, 'e1', null) is null, 'clearing again is fine';
  assert pg_temp.pick(rick, 'e1', pg_temp.rid('West loop (long)')) is null, 'and he picks another';

  -- An archived route stays on a ride that already has it, and on the ride day can't be swapped back in.
  insert into ride_routes (ride_id, route_id) values ('00000000-0000-0000-0000-0000000000e6', pg_temp.rid('Club run'));
  assert pg_temp.pick(rick, 'e6', null) = over, 'clearing after the day';
end $$;

\echo 'route_gpx: any approved member reads any route''s file, archived ones too'
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
begin
  assert pg_temp.value_as(fergus, format('select public.route_gpx(%L)', pg_temp.rid('Club run'))) = pg_temp.good_gpx(),
    'an FNG reads it';
  assert pg_temp.value_as(fergus, format('select public.route_gpx(%L)', pg_temp.rid('Tess west (old)')))
    = pg_temp.good_gpx(), 'an archived route still reads';
  assert pg_temp.value_as(fergus, format('select public.route_gpx(%L)', gen_random_uuid()))
    = 'error: That route no longer exists.', 'a missing route';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000d9', format('select public.route_gpx(%L)',
    pg_temp.rid('Club run'))) = 'error: Only approved members can do that.', 'an applicant can''t';
  assert pg_temp.value_as(null, format('select public.route_gpx(%L)', pg_temp.rid('Club run'))) like 'error: %',
    'nor the public';
end $$;

\echo 'Nobody writes routes through the API; approved members read the library, but not the files'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  n_routes bigint := (select count(*) from routes);
  n_links bigint := (select count(*) from ride_routes);
begin
  assert n_routes > 0 and n_links > 0, 'there is something to read';
  assert pg_temp.try_as(rick, format($q$insert into routes (name, gpx) values ('Sneaky', %L)$q$, pg_temp.good_gpx()))
    is not null, 'insert a route';
  assert pg_temp.try_as(rick, $q$update routes set name = 'Mine'$q$) is not null, 'update routes';
  assert pg_temp.try_as(rick, $q$delete from routes$q$) is not null, 'remove routes';
  assert pg_temp.try_as(rick, format($q$insert into ride_routes (ride_id, route_id) values (%L, %L)$q$,
    '00000000-0000-0000-0000-0000000000e9', pg_temp.rid('Club run'))) is not null, 'insert a ride''s route';
  assert pg_temp.try_as(rick, $q$update ride_routes set route_id = null$q$) is not null, 'update ride routes';
  assert pg_temp.try_as(rick, $q$delete from ride_routes$q$) is not null, 'remove ride routes';
  assert pg_temp.try_as(null, $q$delete from ride_routes$q$) is not null, 'anon';
  assert (select count(*) from routes) = n_routes and (select count(*) from ride_routes) = n_links, 'untouched';
  assert not exists (select 1 from routes where name in ('Sneaky', 'Mine')), 'really untouched';

  assert pg_temp.count_as(fergus, 'routes') = n_routes, 'an FNG reads the library';
  assert pg_temp.count_as(fergus, 'ride_routes') = n_links, 'and every ride''s route';
  assert pg_temp.value_as(fergus, $q$select string_agg(name, ',') from routes$q$) not like 'error:%', 'names and all';
  assert pg_temp.value_as(fergus, $q$select count(*) from routes where archived_at is null and distance_m > 0
    and line is not null and stops is not null and created_by is not null$q$) not like 'error:%', 'the summary columns';
  assert pg_temp.value_as(fergus, $q$select max(length(gpx)) from routes$q$) like 'error:%', 'but the file only through route_gpx';
  -- Applicants and strangers can ask, but the policy shows them nothing; the public can't ask at all.
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d9', 'routes') = 0, 'an applicant sees no routes';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d9', 'ride_routes') = 0, 'nor any ride''s route';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000db', 'routes') = 0, 'nor a stranger';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000db', 'ride_routes') = 0, 'nor a stranger, rides';
  assert pg_temp.count_as(null, 'routes') = -1, 'the public has no grant';
  assert pg_temp.count_as(null, 'ride_routes') = -1, 'nor on ride routes';
end $$;

\echo 'The table rules hold even for a direct write: a name of 1 to 80, a file up to 5 MB'
do $$
begin
  begin
    insert into routes (name, gpx) values ('  ', pg_temp.good_gpx());
    assert false, 'a blank name got in';
  exception when check_violation then null;
  end;
  begin
    insert into routes (name, gpx) values (E'\t\n', pg_temp.good_gpx());
    assert false, 'a tab-and-newline name got in';
  exception when check_violation then null;
  end;
  begin
    insert into routes (name, gpx) values (repeat('x', 81), pg_temp.good_gpx());
    assert false, 'a long name got in';
  exception when check_violation then null;
  end;
  begin
    insert into routes (name, gpx) values ('Huge', repeat('x', 5242881));
    assert false, 'a huge file got in';
  exception when check_violation then null;
  end;
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

\echo 'The calendar brings each shown ride''s route, with the crew still there'
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  cal jsonb;
  expected jsonb;
begin
  insert into ride_crew (ride_id, member_id, role) values ('00000000-0000-0000-0000-0000000000e1', rick, 'officer');
  -- e1, e2, e3, e5, e7, e9 have routes; e6 (last night) isn't shown. Clear e9 so a cleared row is there.
  assert pg_temp.pick(rick, 'e9', null) is null, 'clear the supported run';
  cal := pg_temp.calendar_as(fergus);
  assert cal ? 'ride_routes', 'a ride_routes list';
  assert cal ? 'crew' and jsonb_array_length(cal->'crew') = 1, 'the crew is still there';
  assert cal ? 'rides' and cal ? 'rsvps' and cal ? 'synced_at', 'the rest is still there';
  select jsonb_agg(jsonb_build_object('ride_id', ride_id, 'route_id', route_id) order by ride_id) into expected
  from ride_routes where route_id is not null and ride_id <> '00000000-0000-0000-0000-0000000000e6';
  assert cal->'ride_routes' = expected, format('shown rides with a route, in ride order: %s', cal->'ride_routes');
  assert jsonb_array_length(cal->'ride_routes') = 5, 'five of them';
  assert not exists (select 1 from jsonb_array_elements(cal->'ride_routes') x
                     where x->>'ride_id' in ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e9')),
    'not last night''s ride, nor a cleared one';
  assert (select bool_and(x - 'ride_id' - 'route_id' = '{}'::jsonb) from jsonb_array_elements(cal->'ride_routes') x),
    'just the ride and the route';
  assert coalesce(pg_temp.calendar_as('00000000-0000-0000-0000-0000000000d9')->'ride_routes', '[]') = '[]',
    'an applicant gets none';
  assert pg_temp.calendar_as(null) ? 'error', 'the public can''t ask';
end $$;

\echo 'set_ride_route locks the ride the same way as the crew and answers do, so they queue'
create extension if not exists pgrowlocks;
create function pg_temp.ride_locks(ride text) returns text[] language sql as $$
  select l.modes from pgrowlocks('public.rides') l join public.rides r on r.ctid = l.locked_row
  where r.id = ('00000000-0000-0000-0000-0000000000' || ride)::uuid;
$$;
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  locks text[];
begin
  begin
    assert pg_temp.pick(rick, 'e9', pg_temp.rid('Club run')) is null, 'Rick picks a route';
    locks := pg_temp.ride_locks('e9');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert locks = '{"For No Key Update"}', format('set_ride_route locks the ride first, not %s', locks);
  assert (select route_id from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e9') is null,
    'the check changed nothing';
end $$;

\echo 'Removing a member who made or chose a route keeps the route, without their name; a ride''s route goes with the ride'
do $$
declare
  tess constant uuid := '00000000-0000-0000-0000-0000000000d7';
  chair constant uuid := '00000000-0000-0000-0000-0000000000d4';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
begin
  assert (select created_by from routes where name = 'Tess west (old)') = tess, 'Tess made it';
  assert exists (select 1 from routes where updated_by = rick), 'Rick changed some';
  assert pg_temp.pick(chair, 'e9', pg_temp.rid('Club run')) is null, 'the Chairman chooses the supported run''s route';
  delete from members where id = tess;
  assert exists (select 1 from routes where name = 'Tess west (old)' and created_by is null), 'Tess''s route stays, unsigned';
  delete from members where id = chair;
  assert exists (select 1 from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e9'
                 and route_id = pg_temp.rid('Club run') and set_by is null), 'the choice stays, unsigned';
  delete from members where id = rick;
  assert not exists (select 1 from routes where updated_by = rick), 'Rick''s changes stay, unsigned';
  assert exists (select 1 from routes where name = 'West loop (long)'), 'and the routes are all there';

  assert exists (select 1 from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1'), 'the breakfast has a route';
  delete from rides where id = '00000000-0000-0000-0000-0000000000e1';
  assert not exists (select 1 from ride_routes where ride_id = '00000000-0000-0000-0000-0000000000e1'), 'it went with the ride';
  assert exists (select 1 from routes where id = pg_temp.rid('West loop (long)')), 'the route itself stays';
end $$;
