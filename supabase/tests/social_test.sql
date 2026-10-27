-- Checks the social extras (Stage 7): shared birthdays and set_birthday, with the refusals in the
-- same words and order as src/domain/social/shoutouts.ts, who can read them, and that nothing is
-- writable directly through the API.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000005a1', 'fran@example.com', now()),   -- Full
  ('00000000-0000-0000-0000-0000000005a2', 'fergus@example.com', now()), -- FNG
  ('00000000-0000-0000-0000-0000000005a3', 'paul@example.com', now()),   -- pending
  ('00000000-0000-0000-0000-0000000005a4', 'sid@example.com', now()),    -- suspended
  ('00000000-0000-0000-0000-0000000005a5', 'stranger@example.com', now()); -- signed in, no record

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000005a1', 'west', 'Fran Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000005a2', 'north', 'Fergus FNG', 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000005a3', 'west', 'Paul Pending', 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000005a4', 'west', 'Sid Suspended', 'full', 'suspended')
) as v(id, slug, name, status, approval)
join chapters c on c.slug = v.slug;

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

\o
\echo 'Birthdays: approved members share theirs, day and month only, and can take it off'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000005a2';
  err text;
  b member_birthdays%rowtype;
begin
  err := pg_temp.try_as(fran, 'select public.set_birthday(3, 7)');
  assert err is null, format('Fran shares hers, not %s', err);
  select * into b from member_birthdays where member_id = fran;
  assert b.month = 3 and b.day = 7 and b.set_at is not null, 'kept as 7 March';

  err := pg_temp.try_as(fran, 'select public.set_birthday(12, 25)');
  assert err is null, format('and changes it, not %s', err);
  assert (select month = 12 and day = 25 from member_birthdays where member_id = fran), 'now 25 December';
  assert (select count(*) from member_birthdays where member_id = fran) = 1, 'still one row';

  err := pg_temp.try_as(fergus, 'select public.set_birthday(2, 29)');
  assert err is null, format('an FNG can, and the leap day is fine, not %s', err);

  err := pg_temp.try_as(fran, 'select public.set_birthday(null, null)');
  assert err is null, format('takes it off, not %s', err);
  assert (select month is null and day is null from member_birthdays where member_id = fran), 'kept as not shared';
end $$;

\o
\echo 'Birthdays: the refusals, in the app''s words and order'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  sid constant uuid := '00000000-0000-0000-0000-0000000005a4';
  stranger constant uuid := '00000000-0000-0000-0000-0000000005a5';
  err text;
begin
  err := pg_temp.try_signed_out('select public.set_birthday(1, 1)');
  assert err = 'Sign in first.', format('signed out: %s', err);
  err := pg_temp.try_as(null, 'select public.set_birthday(1, 1)');
  assert err like 'permission denied%', format('anon can''t call it: %s', err);
  foreach err in array array[
    pg_temp.try_as(paul, 'select public.set_birthday(1, 1)'),
    pg_temp.try_as(sid, 'select public.set_birthday(1, 1)'),
    pg_temp.try_as(stranger, 'select public.set_birthday(1, 1)'),
    -- approval comes before the day checks
    pg_temp.try_as(paul, 'select public.set_birthday(13, 1)')
  ] loop
    assert err = 'Only approved members can do that.', format('not approved: %s', err);
  end loop;
  err := pg_temp.try_as(fran, 'select public.set_birthday(3, null)');
  assert err = 'Pick a day and a month.', format('month only: %s', err);
  err := pg_temp.try_as(fran, 'select public.set_birthday(null, 3)');
  assert err = 'Pick a day and a month.', format('day only: %s', err);
  foreach err in array array[
    pg_temp.try_as(fran, 'select public.set_birthday(13, 1)'),
    pg_temp.try_as(fran, 'select public.set_birthday(0, 1)'),
    pg_temp.try_as(fran, 'select public.set_birthday(4, 31)'),
    pg_temp.try_as(fran, 'select public.set_birthday(2, 30)'),
    pg_temp.try_as(fran, 'select public.set_birthday(1, 0)')
  ] loop
    assert err = 'That day isn’t in that month.', format('bad day: %s', err);
  end loop;
end $$;

\o
\echo 'Birthdays: approved members read them; nobody writes the table directly'
\o /dev/null
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000005a1';
  fergus constant uuid := '00000000-0000-0000-0000-0000000005a2';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  sid constant uuid := '00000000-0000-0000-0000-0000000005a4';
  err text;
begin
  assert pg_temp.count_as(fran, 'member_birthdays') = 2, 'Fran reads both rows';
  assert pg_temp.count_as(fergus, 'member_birthdays') = 2, 'so does Fergus';
  assert pg_temp.count_as(paul, 'member_birthdays') = 0, 'pending reads none';
  assert pg_temp.count_as(sid, 'member_birthdays') = 0, 'suspended reads none';
  -- A member who's suspended keeps their row, hidden from everyone.
  update members set approval = 'suspended' where id = fergus;
  assert pg_temp.count_as(fran, 'member_birthdays') = 1, 'a suspended member''s birthday is hidden';
  update members set approval = 'approved' where id = fergus;
  assert pg_temp.count_as(null, 'member_birthdays') = -1, 'anon can''t read the table at all';

  err := pg_temp.try_as(fran, format('insert into member_birthdays (member_id, month, day) values (%L, 1, 1)', paul));
  assert err like 'permission denied%', format('no inserts: %s', err);
  err := pg_temp.try_as(fran, 'update member_birthdays set month = 1');
  assert err like 'permission denied%', format('no updates: %s', err);
  err := pg_temp.try_as(fran, 'delete from member_birthdays');
  assert err like 'permission denied%', format('no deletes: %s', err);
end $$;

\o
\echo 'Birthdays: the table refuses a day that isn''t in its month, and goes with its member'
\o /dev/null
do $$
declare
  fergus constant uuid := '00000000-0000-0000-0000-0000000005a2';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
begin
  begin
    insert into member_birthdays (member_id, month, day) values (paul, 4, 31);
    assert false, '31 April went in';
  exception when check_violation then null;
  end;
  begin
    insert into member_birthdays (member_id, month, day) values (paul, 4, null);
    assert false, 'a month with no day went in';
  exception when check_violation then null;
  end;
  delete from members where id = fergus;
  assert not exists (select 1 from member_birthdays where member_id = fergus), 'gone with Fergus';
end $$;

\o
\echo 'On this day: photos from today''s date in earlier years, by club_photos'' rules'
\o /dev/null
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000005b1', 'wendy@example.com', now()), -- West Full
  ('00000000-0000-0000-0000-0000000005b2', 'nell@example.com', now()),  -- North Full
  ('00000000-0000-0000-0000-0000000005b3', 'bo@example.com', now());    -- West Full, blocked by Wendy
insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', 'approved'
from (values
  ('00000000-0000-0000-0000-0000000005b1', 'west', 'Wendy West'),
  ('00000000-0000-0000-0000-0000000005b2', 'north', 'Nell North'),
  ('00000000-0000-0000-0000-0000000005b3', 'west', 'Bo Blocked')
) as v(id, slug, name)
join chapters c on c.slug = v.slug;
insert into member_blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b3');

-- A message with one picture (or GIF), posted at noon Melbourne time on a date.
create function pg_temp.posted(chat uuid, author uuid, on_day date, kind text, path text, removed boolean default false)
returns void language sql as $$
  with m as (
    insert into messages (conversation_id, author_id, body, created_at, removed_at)
    values (chat, author, null, (on_day + time '12:00') at time zone 'Australia/Melbourne', case when removed then now() end)
    returning id
  )
  insert into message_media (message_id, conversation_id, kind, path, width, height)
  select m.id, chat, kind::chat_media_kind, path, 100, 100 from m;
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bo constant uuid := '00000000-0000-0000-0000-0000000005b3';
  t constant date := private.club_date();
  -- 4 and 8 years back, so a leap day today still has a leap day to look back on.
  four constant date := (t - interval '4 years')::date;
  eight constant date := (t - interval '8 years')::date;
  club uuid := (select id from conversations where kind = 'club');
  west uuid := (select id from conversations where kind = 'chapter' and chapter_id = (select id from chapters where slug = 'west'));
  direct uuid;
begin
  insert into conversations (kind, direct_key) values ('direct', 'pair') returning id into direct;
  insert into conversation_members values (direct, wendy), (direct, nell);
  perform pg_temp.posted(club, nell, four, 'photo', 'club-four.jpg');
  perform pg_temp.posted(club, nell, four, 'gif', 'https://media.giphy.com/media/x/giphy.gif');
  perform pg_temp.posted(west, wendy, eight, 'video', 'west-eight.mp4');
  perform pg_temp.posted(club, nell, t, 'photo', 'club-today.jpg');
  perform pg_temp.posted(club, nell, four - 1, 'photo', 'club-day-before.jpg');
  perform pg_temp.posted(club, nell, four, 'photo', 'club-removed.jpg', true);
  perform pg_temp.posted(direct, nell, four, 'photo', 'direct.jpg');
  perform pg_temp.posted(club, bo, four, 'photo', 'club-bo.jpg');
end $$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  feed jsonb;
  paths text[];
begin
  feed := pg_temp.value_as(wendy, 'select public.photos_on_this_day()')::jsonb;
  select array_agg(x->>'path' order by ord) into paths from jsonb_array_elements(feed) with ordinality as e(x, ord);
  assert paths = array['club-four.jpg', 'west-eight.mp4'],
    format('Wendy sees the club photo and her chapter''s video, newest first, nothing else: %s', paths);
  assert feed->0 ? 'author_id' and feed->0 ? 'conversation_id' and feed->0 ? 'created_at' and feed->0 ? 'kind',
    'each item has club_photos'' shape';

  feed := pg_temp.value_as(nell, 'select public.photos_on_this_day()')::jsonb;
  select array_agg(x->>'path' order by ord) into paths from jsonb_array_elements(feed) with ordinality as e(x, ord);
  assert paths = array['club-four.jpg', 'club-bo.jpg'] or paths = array['club-bo.jpg', 'club-four.jpg'],
    format('Nell (North) doesn''t see West''s chat, and hasn''t blocked Bo: %s', paths);

  assert pg_temp.value_as(paul, 'select public.photos_on_this_day()') = '[]', 'a pending applicant gets nothing';
  assert pg_temp.try_as(null, 'select public.photos_on_this_day()') like 'permission denied%', 'anon can''t call it';
end $$;

\o
\echo 'All social checks passed'
