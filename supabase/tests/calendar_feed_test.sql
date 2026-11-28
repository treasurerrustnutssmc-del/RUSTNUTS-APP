-- Checks the personal ride calendar: each approved member's private link (my_calendar_link,
-- new_calendar_link) and what calendar_feed hands the calendar-feed server function for a link.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000009c1', 'wes@example.com', now()),   -- Full, answers rides
  ('00000000-0000-0000-0000-0000000009c2', 'sue@example.com', now()),   -- Full, other answers
  ('00000000-0000-0000-0000-0000000009c3', 'paul@example.com', now());  -- pending

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000009c1', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-0000000009c2', 'Sue South', 'approved'),
  ('00000000-0000-0000-0000-0000000009c3', 'Paul Pending', 'pending')
) as v(id, name, approval)
cross join (select id from chapters where slug = 'west') c;

insert into rides (id, source, starts_at, ends_at, all_day, title, location, notes, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000c901', 'app', now() + interval '3 days', null, false, 'Going run', 'Pub', 'Bring cash', 'club', null),
  ('00000000-0000-0000-0000-00000000c902', 'app', now() + interval '4 days', null, false, 'Maybe run', null, null, 'club', null),
  ('00000000-0000-0000-0000-00000000c903', 'app', now() + interval '5 days', null, false, 'Called off', null, null, 'west', now()),
  ('00000000-0000-0000-0000-00000000c904', 'app', now() - interval '30 days', null, false, 'Last month', null, null, 'club', null),
  ('00000000-0000-0000-0000-00000000c905', 'app', now() - interval '90 days', null, false, 'Long ago', null, null, 'club', null),
  ('00000000-0000-0000-0000-00000000c906', 'app', now() + interval '6 days', null, false, 'Leg two', null, null, 'club', null);

insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009c1', 'going'),
  ('00000000-0000-0000-0000-00000000c902', '00000000-0000-0000-0000-0000000009c1', 'maybe'),
  ('00000000-0000-0000-0000-00000000c903', '00000000-0000-0000-0000-0000000009c1', 'going'),
  ('00000000-0000-0000-0000-00000000c904', '00000000-0000-0000-0000-0000000009c1', 'going'),
  ('00000000-0000-0000-0000-00000000c905', '00000000-0000-0000-0000-0000000009c1', 'going'),
  ('00000000-0000-0000-0000-00000000c906', '00000000-0000-0000-0000-0000000009c1', 'going'),
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009c2', 'no'),
  ('00000000-0000-0000-0000-00000000c902', '00000000-0000-0000-0000-0000000009c2', 'going');

insert into ride_legs (ride_id, trip_id, leg_no) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000aaaa', 1),
  ('00000000-0000-0000-0000-00000000c906', '00000000-0000-0000-0000-00000000aaaa', 2);

create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt into out;
  exception when others then
    out := 'ERROR: ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.feed(token text) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  set local role service_role;
  out := public.calendar_feed(token);
  reset role;
  return out;
end $$;

\o
\echo 'Personal ride calendar: links for approved members only, and only Going rides in the feed'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000009c1';
  sue constant uuid := '00000000-0000-0000-0000-0000000009c2';
  paul constant uuid := '00000000-0000-0000-0000-0000000009c3';
  t1 text;
  t2 text;
  f jsonb;
  titles text;
begin
  -- Who may have a link.
  assert pg_temp.value_as(null, 'select public.my_calendar_link()') like 'ERROR: permission denied%', 'anon cannot ask for a link';
  assert pg_temp.value_as(paul, 'select public.my_calendar_link()') = 'ERROR: Only approved members can do that.', 'pending cannot have a link';
  assert pg_temp.value_as(paul, 'select public.new_calendar_link()') = 'ERROR: Only approved members can do that.', 'pending cannot make a link';

  t1 := pg_temp.value_as(wes, 'select public.my_calendar_link()');
  assert t1 ~ '^[0-9a-f]{64}$', 'a link is 64 hex characters: ' || coalesce(t1, 'null');
  assert pg_temp.value_as(wes, 'select public.my_calendar_link()') = t1, 'asking again gives the same link';
  assert pg_temp.value_as(sue, 'select public.my_calendar_link()') <> t1, 'each member has their own link';

  -- Nobody but the server function reads a feed, and nobody reads the links table.
  assert pg_temp.value_as(wes, format('select public.calendar_feed(%L)::text', t1)) like 'ERROR: permission denied%', 'members cannot read a feed';
  assert pg_temp.value_as(null, format('select public.calendar_feed(%L)::text', t1)) like 'ERROR: permission denied%', 'anon cannot read a feed';
  assert pg_temp.value_as(wes, 'select count(*)::text from private.calendar_links') like 'ERROR: permission denied%', 'the links stay private';

  -- What the feed holds: Going rides only, called-off ones too, back 60 days, with legs.
  f := pg_temp.feed(t1);
  select string_agg(x->>'title', ',' order by x->>'starts_at') into titles from jsonb_array_elements(f) x;
  assert titles = 'Last month,Going run,Called off,Leg two', 'feed rides: ' || coalesce(titles, 'none');
  assert (select x->>'cancelled_at' from jsonb_array_elements(f) x where x->>'title' = 'Called off') is not null, 'called off is marked';
  assert (select x->>'notes' from jsonb_array_elements(f) x where x->>'title' = 'Going run') = 'Bring cash', 'notes come through';
  assert (select x->>'location' from jsonb_array_elements(f) x where x->>'title' = 'Going run') = 'Pub', 'location comes through';
  assert (select (x->>'leg_no')::int * 10 + (x->>'leg_count')::int from jsonb_array_elements(f) x where x->>'title' = 'Leg two') = 22, 'leg 2 of 2';
  assert (select x->'leg_no' from jsonb_array_elements(f) x where x->>'title' = 'Called off') = 'null'::jsonb, 'no leg, no number';

  -- Pulling out takes the ride off.
  update rsvps set answer = 'no' where ride_id = '00000000-0000-0000-0000-00000000c906' and member_id = wes;
  select string_agg(x->>'title', ',' order by x->>'starts_at') into titles from jsonb_array_elements(pg_temp.feed(t1)) x;
  assert titles = 'Last month,Going run,Called off', 'after pulling out: ' || coalesce(titles, 'none');

  -- Unknown or bad tokens: null. A new link stops the old one.
  assert pg_temp.feed(repeat('0', 64)) is null, 'unknown token is null';
  assert pg_temp.feed('') is null, 'empty token is null';
  t2 := pg_temp.value_as(wes, 'select public.new_calendar_link()');
  assert t2 ~ '^[0-9a-f]{64}$' and t2 <> t1, 'a new link is different';
  assert pg_temp.feed(t1) is null, 'the old link stops';
  assert jsonb_array_length(pg_temp.feed(t2)) = 3, 'the new link works';
  assert pg_temp.value_as(wes, 'select public.my_calendar_link()') = t2, 'my link is the new one';

  -- A club-calendar ride moved by the sync (a new row at the new start, the old one called off) follows
  -- the move; another week's ride from the same repeating calendar entry is not pulled in.
  insert into private.ride_feeds (id, url) values ('00000000-0000-0000-0000-00000000fee1', 'https://example.com/a.ics');
  insert into rides (id, source, feed_id, external_uid, starts_at, title, category, cancelled_at) values
    ('00000000-0000-0000-0000-00000000c911', 'feed', '00000000-0000-0000-0000-00000000fee1', 'weekly@x', now() + interval '10 days', 'Thursday run', 'club', now()),
    ('00000000-0000-0000-0000-00000000c912', 'feed', '00000000-0000-0000-0000-00000000fee1', 'weekly@x', now() + interval '10 days 2 hours', 'Thursday run moved', 'club', null),
    ('00000000-0000-0000-0000-00000000c913', 'feed', '00000000-0000-0000-0000-00000000fee1', 'weekly@x', now() + interval '17 days', 'Thursday run next week', 'club', null),
    ('00000000-0000-0000-0000-00000000c914', 'feed', '00000000-0000-0000-0000-00000000fee1', 'gone@x', now() + interval '12 days', 'Called off for good', 'club', now());
  insert into rsvps (ride_id, member_id, answer) values
    ('00000000-0000-0000-0000-00000000c911', wes, 'going'),
    ('00000000-0000-0000-0000-00000000c914', wes, 'going');
  select string_agg(x->>'title' || coalesce(':' || left(x->>'cancelled_at', 1), ''), ',' order by x->>'starts_at') into titles
  from jsonb_array_elements(pg_temp.feed(t2)) x where x->>'title' like '%Thursday%' or x->>'title' like 'Called off for%';
  assert titles = 'Thursday run moved,Called off for good:2', 'moved ride follows: ' || coalesce(titles, 'none');
  -- Also answered Going on the moved one: listed once.
  insert into rsvps (ride_id, member_id, answer) values ('00000000-0000-0000-0000-00000000c912', wes, 'going');
  assert (select count(*) from jsonb_array_elements(pg_temp.feed(t2)) x where x->>'title' = 'Thursday run moved') = 1, 'listed once';

  -- Someone moved to Family keeps the link but it empties, as Family can't see rides.
  update members set status = 'family' where id = wes;
  assert pg_temp.feed(t2) = '[]'::jsonb, 'Family: an empty calendar';
  update members set status = 'full' where id = wes;

  -- Someone no longer approved keeps the link but it empties.
  update members set approval = 'pending' where id = wes;
  assert pg_temp.feed(t2) = '[]'::jsonb, 'no longer approved: an empty calendar';
  update members set approval = 'approved' where id = wes;

  -- Deleting the member deletes the link.
  delete from rsvps where member_id = sue;
  t1 := pg_temp.value_as(sue, 'select public.my_calendar_link()');
  delete from members where id = sue;
  assert pg_temp.feed(t1) is null, 'a deleted member''s link is gone';
end $$;
\o
\echo 'Personal ride calendar checks passed'
