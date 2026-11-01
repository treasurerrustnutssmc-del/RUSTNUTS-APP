-- Checks rides made in the app: who may make, change and call off rides (save_ride,
-- set_ride_called_off) in the app's words and order (src/domain/newRide.ts), and what the website's
-- public_rides() shows of them.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000007a1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-0000000007a2', 'rc@example.com', now()),    -- West ride committee
  ('00000000-0000-0000-0000-0000000007a3', 'nrc@example.com', now()),   -- North ride committee
  ('00000000-0000-0000-0000-0000000007a4', 'chair@example.com', now()), -- NEC Chairman
  ('00000000-0000-0000-0000-0000000007a5', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000007a6', 'paul@example.com', now());  -- pending

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000007a1', 'west', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-0000000007a2', 'west', 'Rick Committee', 'approved'),
  ('00000000-0000-0000-0000-0000000007a3', 'north', 'Nora Committee', 'approved'),
  ('00000000-0000-0000-0000-0000000007a4', 'north', 'Charlie Chair', 'approved'),
  ('00000000-0000-0000-0000-0000000007a5', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-0000000007a6', 'west', 'Paul Pending', 'pending')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01'
from (values
  ('00000000-0000-0000-0000-0000000007a1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000007a2', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000007a3', 'north', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000007a4', null, 'nec_chair')
) as v(id, slug, role);

insert into rides (id, source, starts_at, ends_at, all_day, title, location, notes, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000ad01', 'feed', now() + interval '7 days', null, false, 'Calendar run', 'Bacchus Marsh', 'From the feed', 'west', null),
  ('00000000-0000-0000-0000-00000000ad02', 'app', now() + interval '10 days', null, false, 'West app run', 'Melton', 'Members only', 'west', null),
  ('00000000-0000-0000-0000-00000000ad03', 'app', now() - interval '3 days', null, false, 'Old app run', null, null, 'club', null),
  ('00000000-0000-0000-0000-00000000ad04', 'app', now() + interval '12 days', null, false, 'Called off run', null, null, 'club', now()),
  ('00000000-0000-0000-0000-00000000ad05', 'app', now() + interval '14 days', null, false, 'Quiet club night', null, 'Not for the site', 'club', null),
  ('00000000-0000-0000-0000-00000000ad06', 'app', now() - interval '1 day', now() + interval '1 day', false, 'Weekend under way', null, null, 'club', null);
update rides set website = false where id = '00000000-0000-0000-0000-00000000ad05';

-- Runs a statement as a signed-in user (anon when who is null) and returns its error, or null.
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

-- A save_ride call. p_id null makes a ride.
create function pg_temp.save_sql(p_id uuid, title text, starts timestamptz, ends timestamptz, all_day boolean,
                                 cat text, place text, notes text, site boolean) returns text language sql as $$
  select format('select public.save_ride(%L::uuid, %L, %L::timestamptz, %L::timestamptz, %L::boolean, %L::ride_category, %L, %L, %L::boolean)',
                p_id, title, starts, ends, all_day, cat, place, notes, site);
$$;

create function pg_temp.off_sql(p_id uuid, off boolean) returns text language sql as $$
  select format('select public.set_ride_called_off(%L::uuid, %L::boolean)', p_id, off);
$$;

create function pg_temp.as_anon(q text) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  set local role anon;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s) t', q) into out;
  reset role;
  return out;
end $$;

\o
\echo 'App rides: making a ride, the refusals in the app''s words and order'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000007a1';
  rc constant uuid := '00000000-0000-0000-0000-0000000007a2';
  nrc constant uuid := '00000000-0000-0000-0000-0000000007a3';
  chair constant uuid := '00000000-0000-0000-0000-0000000007a4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007a5';
  paul constant uuid := '00000000-0000-0000-0000-0000000007a6';
  soon timestamptz := now() + interval '20 days';
  today_start timestamptz := (private.club_date()::timestamp at time zone 'Australia/Melbourne');
  ok text := pg_temp.save_sql(null, 'Spring run', soon, null, false, 'west', 'Bacchus Marsh', '', true);
  r rides%rowtype;
  n int;
begin
  assert pg_temp.try_as(null, ok) like 'permission denied%', 'anon can''t save';
  assert pg_temp.try_as(paul, ok) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, ok) = 'Only the board, ride committee or NEC can make and change rides.', 'no seat';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', soon, null, false, 'north', null, '', true))
    = 'Only that chapter’s board or ride committee can run its rides.', 'West committee can''t make a North ride';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Go', soon, null, false, 'west', null, '', true))
    = 'Give the ride a title (3 to 80 characters).', 'short title';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, repeat('x', 81), soon, null, false, 'west', null, '', true))
    = 'Give the ride a title (3 to 80 characters).', 'long title';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', null, null, false, 'west', null, '', true))
    = 'Pick a start date and time.', 'no start';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', today_start - interval '1 hour', null, false, 'west', null, '', true))
    = 'A ride starts today or later.', 'yesterday';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', soon, soon - interval '1 hour', false, 'west', null, '', true))
    = 'The end comes after the start.', 'end before start';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', soon, soon, false, 'west', null, '', true))
    = 'The end comes after the start.', 'end at start';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', soon, null, false, 'west', repeat('x', 121), '', true))
    = 'Keep the meeting place to 120 characters.', 'long place';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Spring run', soon, null, false, 'west', null, repeat('x', 1001), true))
    = 'Keep the notes to 1,000 characters.', 'long notes';
  assert pg_temp.try_as(wes, 'insert into rides (source, starts_at, title, category) values (''app'', now(), ''x'', ''west'')')
    like 'permission denied%', 'no direct insert';

  assert pg_temp.try_as(rc, pg_temp.save_sql(null, '  Spring run ', soon, null, false, 'west', '  Bacchus Marsh ', ' Bring cash ', true)) is null,
    'West committee makes a West ride';
  select * into r from rides where title = 'Spring run';
  assert r.source = 'app' and r.location = 'Bacchus Marsh' and r.notes = 'Bring cash' and r.website and r.created_by = rc
    and r.updated_by = rc and r.updated_at is not null and r.cancelled_at is null, 'kept clean and marked as made in the app';
  select count(*) into n from conversations where ride_id = r.id;
  assert n = 1, 'the new ride got its chat';
  -- Earlier today (Melbourne) is still today; an all-day ride ending on its start day is fine.
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'Early run', today_start + interval '1 minute', null, false, 'west', null, '', true)) is null, 'earlier today';
  assert pg_temp.try_as(rc, pg_temp.save_sql(null, 'All day', soon, soon, true, 'supported', null, '', false)) is null, 'all day, same day end';
  assert (select website from rides where title = 'All day') = false, 'website switch kept off';
  assert pg_temp.try_as(chair, pg_temp.save_sql(null, 'North run', soon, null, false, 'north', null, '', true)) is null, 'the NEC makes a North ride';
  assert pg_temp.try_as(nrc, pg_temp.save_sql(null, 'North loop', soon, null, false, 'north', null, '', true)) is null, 'North committee makes a North ride';
  assert pg_temp.try_as(wes, pg_temp.save_sql(null, 'Club run', soon, null, false, 'club', null, 'Members only', true)) is null, 'a board seat makes a Club ride';
end $$;

\o
\echo 'App rides: changing a ride, only an app ride before it is over, by someone who runs the old and new category'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000007a1';
  rc constant uuid := '00000000-0000-0000-0000-0000000007a2';
  nrc constant uuid := '00000000-0000-0000-0000-0000000007a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000007a5';
  feed constant uuid := '00000000-0000-0000-0000-00000000ad01';
  west constant uuid := '00000000-0000-0000-0000-00000000ad02';
  old constant uuid := '00000000-0000-0000-0000-00000000ad03';
  off constant uuid := '00000000-0000-0000-0000-00000000ad04';
  running constant uuid := '00000000-0000-0000-0000-00000000ad06';
  gone constant uuid := '00000000-0000-0000-0000-000000000000';
  soon timestamptz := now() + interval '20 days';
  r rides%rowtype;
begin
  assert pg_temp.try_as(wes, pg_temp.save_sql(gone, 'West app run', soon, null, false, 'west', null, '', true)) = 'No such ride.', 'gone';
  assert pg_temp.try_as(wes, pg_temp.save_sql(feed, 'Calendar run', soon, null, false, 'west', null, '', true))
    = 'This ride comes from the club calendar; change it there.', 'a calendar ride';
  assert pg_temp.try_as(wes, pg_temp.save_sql(old, 'Old app run', soon, null, false, 'club', null, '', true))
    = 'That ride is history; it can’t change now.', 'over';
  assert pg_temp.try_as(nell, pg_temp.save_sql(west, 'West app run', soon, null, false, 'west', null, '', true))
    = 'Only the board, ride committee or NEC can make and change rides.', 'no seat';
  assert pg_temp.try_as(rc, pg_temp.save_sql(west, 'West app run', soon, null, false, 'north', null, '', true))
    = 'Only that chapter’s board or ride committee can run its rides.', 'West committee can''t move it to North';
  assert pg_temp.try_as(nrc, pg_temp.save_sql(west, 'West app run', soon, null, false, 'north', null, '', true))
    = 'Only that chapter’s board or ride committee can run its rides.', 'North committee can''t touch a West ride';
  assert pg_temp.try_as(wes, pg_temp.save_sql(west, 'West app run', now() - interval '2 days', null, false, 'west', null, '', true))
    = 'A ride starts today or later.', 'a change can''t move the start before today';
  assert pg_temp.try_as(rc, pg_temp.save_sql(west, 'West app run moved', soon, soon + interval '3 hours', false, 'club', 'Melton', 'New notes', false)) is null,
    'West committee moves its ride to Club';
  select * into r from rides where id = west;
  assert r.title = 'West app run moved' and r.category = 'club' and r.ends_at = soon + interval '3 hours' and r.notes = 'New notes'
    and r.website = false and r.updated_by = rc and r.created_by is null, 'the change landed';
  assert pg_temp.try_as(wes, pg_temp.save_sql(off, 'Called off run', soon, null, false, 'club', null, '', true)) is null, 'a called-off app ride can still change';
  -- A ride under way keeps its start and can still change; moving its start to yesterday can't.
  assert pg_temp.try_as(wes, pg_temp.save_sql(running, 'Weekend under way, day two', (select starts_at from rides where id = running),
    (select ends_at from rides where id = running), false, 'club', null, '', true)) is null, 'a ride under way can change';
  assert pg_temp.try_as(wes, pg_temp.save_sql(running, 'Weekend under way', now() - interval '2 days',
    (select ends_at from rides where id = running), false, 'club', null, '', true)) = 'A ride starts today or later.', 'but not move its start back';
  assert pg_temp.try_as(wes, format('select public.save_ride(null, %L, %L::timestamptz, null, false, null, null, null, true)', 'No colour', soon))
    = 'Pick a chapter or colour.', 'no category';
  assert pg_temp.try_as(wes, 'update rides set title = ''x'' where id = ''' || west || '''') like 'permission denied%', 'no direct update';
end $$;

\o
\echo 'App rides: calling off and putting back'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000007a1';
  rc constant uuid := '00000000-0000-0000-0000-0000000007a2';
  nrc constant uuid := '00000000-0000-0000-0000-0000000007a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000007a5';
  paul constant uuid := '00000000-0000-0000-0000-0000000007a6';
  feed constant uuid := '00000000-0000-0000-0000-00000000ad01';
  west constant uuid := '00000000-0000-0000-0000-00000000ad02';
  old constant uuid := '00000000-0000-0000-0000-00000000ad03';
  off constant uuid := '00000000-0000-0000-0000-00000000ad04';
  gone constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  assert pg_temp.try_as(null, pg_temp.off_sql(west, true)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, pg_temp.off_sql(west, true)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wes, pg_temp.off_sql(gone, true)) = 'No such ride.', 'gone';
  assert pg_temp.try_as(wes, pg_temp.off_sql(feed, true)) = 'This ride comes from the club calendar; change it there.', 'calendar';
  assert pg_temp.try_as(wes, pg_temp.off_sql(old, true)) = 'That ride is history; it can’t change now.', 'started';
  assert pg_temp.try_as(nell, pg_temp.off_sql(west, true)) = 'Only the board, ride committee or NEC can make and change rides.', 'no seat';
  -- The West ride was moved to Club above, so North's committee may run it now; a plain seat still can't.
  assert pg_temp.try_as(nrc, pg_temp.off_sql(west, false)) = 'That ride isn’t called off.', 'not off';
  assert pg_temp.try_as(rc, pg_temp.off_sql(west, true)) is null, 'called off';
  assert (select cancelled_at from rides where id = west) is not null, 'cancelled_at set';
  assert pg_temp.try_as(rc, pg_temp.off_sql(west, true)) = 'That ride is already called off.', 'already off';
  assert pg_temp.try_as(wes, format('select public.set_ride_called_off(%L::uuid, null)', off)) = 'That ride isn’t called off.', 'a null switch does nothing';
  assert pg_temp.try_as(wes, pg_temp.off_sql(off, false)) is null, 'put back on';
  assert (select cancelled_at from rides where id = off) is null, 'cancelled_at cleared';
end $$;

\o
\echo 'App rides: the website lists the ones with the switch on, without their notes'
\o /dev/null
do $$
declare
  rows jsonb := pg_temp.as_anon('select * from public.public_rides()');
  titles text := (select string_agg(x ->> 'title', ',' order by x ->> 'title') from jsonb_array_elements(rows) x);
  west jsonb := (select x from jsonb_array_elements(rows) x where x ->> 'title' = 'West app run moved');
  cal jsonb := (select x from jsonb_array_elements(rows) x where x ->> 'title' = 'Calendar run');
begin
  assert rows::text not like '%Quiet club night%', 'switch off: not listed, got ' || titles;
  assert rows::text not like '%Members only%' and rows::text not like '%Bring cash%' and rows::text not like '%New notes%',
    'app ride notes stay with members: ' || rows::text;
  -- The moved West ride had its switch turned off before it was called off, and the all-day ride was saved with it off.
  assert west is null and titles not like '%All day%', 'switch off: not listed even when called off: ' || titles;
  assert cal ->> 'notes' = 'From the feed', 'calendar rides keep their notes';
  assert titles like '%Spring run%' and titles like '%North run%' and titles like '%Club run%' and titles like '%Called off run%',
    'app rides with the switch on are listed (the one put back on too): ' || titles;
  assert (select x ->> 'location' from jsonb_array_elements(rows) x where x ->> 'title' = 'Spring run') = 'Bacchus Marsh', 'the meeting place shows';
  assert not (rows -> 0 ? 'website') and not (rows -> 0 ? 'created_by') and not (rows -> 0 ? 'updated_by'), 'no new columns leak';
end $$;

\echo app_rides: ok
