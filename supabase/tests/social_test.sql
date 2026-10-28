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

  -- The day rule on fixed dates, leap years included (the same cases as onThisDay.test.ts).
  assert private.is_on_this_day('2025-10-28', '2026-10-28'), 'same day a year back';
  assert not private.is_on_this_day('2026-10-28', '2026-10-28'), 'not this year';
  assert not private.is_on_this_day('2027-10-28', '2026-10-28'), 'never a later year';
  assert not private.is_on_this_day('2025-10-27', '2026-10-28'), 'not the day before';
  assert private.is_on_this_day('2024-02-29', '2027-02-28'), '29 Feb on 28 Feb in a plain year';
  assert private.is_on_this_day('2023-02-28', '2027-02-28'), '28 Feb on 28 Feb';
  assert private.is_on_this_day('2024-02-29', '2028-02-29'), '29 Feb on 29 Feb in a leap year';
  assert not private.is_on_this_day('2024-02-29', '2028-02-28'), 'but not on 28 Feb in a leap year';
  assert private.is_on_this_day('2023-02-28', '2028-02-28'), '28 Feb on 28 Feb in a leap year';
  assert pg_temp.try_as(null, 'select public.photos_on_this_day()') like 'permission denied%', 'anon can''t call it';
end $$;

\o
\echo 'Who can help: members set their own skills; approved members read approved members'' skills'
\o /dev/null
do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  sid constant uuid := '00000000-0000-0000-0000-0000000005a4';
  err text;
begin
  err := pg_temp.try_as(wendy, $q$select public.set_skills(array['tyres', 'electrics', 'tyres'])$q$);
  assert err is null, format('Wendy sets hers, not %s', err);
  assert (select skills from member_skills where member_id = wendy) = array['tyres', 'electrics']::help_skill[],
    'kept once each, in the order given';
  err := pg_temp.try_as(wendy, $q$select public.set_skills(array['welding'])$q$);
  assert err is null and (select skills from member_skills where member_id = wendy) = array['welding']::help_skill[], 'replaced';
  err := pg_temp.try_as(wendy, $q$select public.set_skills(array[]::text[])$q$);
  assert err is null and (select cardinality(skills) from member_skills where member_id = wendy) = 0, 'cleared, row kept';
  err := pg_temp.try_as(nell, $q$select public.set_skills(array['trailer'])$q$);
  assert err is null, format('Nell sets hers, not %s', err);

  assert pg_temp.try_signed_out($q$select public.set_skills(array['tyres'])$q$) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, $q$select public.set_skills(array['nope'])$q$) = 'Only approved members can do that.', 'pending, before the skill check';
  assert pg_temp.try_as(wendy, $q$select public.set_skills(array['tyres', 'nope'])$q$) = 'That isn’t one of the skills.', 'unknown skill';
  assert pg_temp.try_as(wendy, $q$select public.set_skills(null)$q$) = 'That isn’t one of the skills.', 'null list';
  assert pg_temp.try_as(null, $q$select public.set_skills(array['tyres'])$q$) like 'permission denied%', 'anon';

  assert pg_temp.count_as(wendy, 'member_skills') = 2, 'Wendy reads both';
  assert pg_temp.count_as(paul, 'member_skills') = 0, 'pending reads none';
  -- A suspended member's skills are hidden.
  insert into member_skills (member_id, skills) values (sid, array['paint']::help_skill[]);
  assert pg_temp.count_as(wendy, 'member_skills') = 2, 'Sid''s are hidden';
  assert pg_temp.try_as(wendy, format($q$insert into member_skills values (%L, '{}')$q$, paul)) like 'permission denied%', 'no inserts';
  assert pg_temp.try_as(wendy, $q$update member_skills set skills = '{}'$q$) like 'permission denied%', 'no updates';
end $$;

\o
\echo 'Who can help: trusted mechanics, added by anyone approved, changed by whoever added it or the board'
\o /dev/null
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000005c1', 'bea@example.com', now()); -- North Secretary: a board seat
insert into members (id, chapter_id, full_name, status, approval)
select '00000000-0000-0000-0000-0000000005c1', id, 'Bea Board', 'full', 'approved' from chapters where slug = 'north';
insert into positions (member_id, chapter_id, role)
select '00000000-0000-0000-0000-0000000005c1', id, 'secretary' from chapters where slug = 'north';

create function pg_temp.save_sql(id uuid, name text, suburb text, phone text, website text, speciality text, notes text)
returns text language sql as $$
  select format('select public.save_mechanic(%L, %L, %L, %L, %L, %L, %L)', id, name, suburb, phone, website, speciality, notes);
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bea constant uuid := '00000000-0000-0000-0000-0000000005c1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  shop uuid;
  m mechanics%rowtype;
  err text;
begin
  shop := pg_temp.value_as(wendy, pg_temp.save_sql(null, '  Bob’s Bikes ', ' Sunshine ', '', ' https://bobs.example ', ' ', ' Fair '))::uuid;
  select * into m from mechanics where id = shop;
  assert m.name = 'Bob’s Bikes' and m.suburb = 'Sunshine' and m.phone is null and m.website = 'https://bobs.example'
    and m.speciality is null and m.notes = 'Fair' and m.added_by = wendy and m.archived_at is null, 'trimmed, blanks as none';

  -- The refusals, in order.
  assert pg_temp.try_signed_out(pg_temp.save_sql(null, 'X', '', '', '', '', '')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.save_sql(shop, '', '', '', '', '', '')) = 'Only approved members can do that.', 'pending first';
  assert pg_temp.try_as(wendy, pg_temp.save_sql('00000000-0000-0000-0000-000000000000', 'X', '', '', '', '', '')) = 'No such workshop.', 'gone';
  assert pg_temp.try_as(nell, pg_temp.save_sql(shop, '', '', '', '', '', '')) = 'Only whoever added it or the board can change it.', 'not hers';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, ' ', '', '', '', '', '')) = 'Give the workshop a name.', 'no name';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, repeat('x', 81), '', '', '', '', '')) = 'Keep the name to 80 characters at most.', 'long name';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, repeat('🔧', 80), '', '', '', '', '')) is null, '80 emoji are 80 characters';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', repeat('x', 61), '', '', '', '')) = 'Keep the suburb to 60 characters at most.', 'suburb';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', repeat('1', 31), '', '', '')) = 'Keep the phone number to 30 characters at most.', 'phone';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', '', 'bobs.example', '', '')) = 'Websites start with http:// or https://.', 'website scheme';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', '', 'HTTP://bobs.example', '', '')) is null, 'any case';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', '', 'https://' || repeat('x', 193), '', '')) = 'Keep the website to 200 characters at most.', 'website length';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', '', '', repeat('x', 81), '')) = 'Keep what they’re good at to 80 characters at most.', 'speciality';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(null, 'X', '', '', '', '', repeat('x', 501))) = 'Keep the notes to 500 characters at most.', 'notes';

  -- The board changes anyone's.
  err := pg_temp.try_as(bea, pg_temp.save_sql(shop, 'Bob’s Bikes and Bits', '', '', '', 'Old Japanese', ''));
  assert err is null, format('the board edits, not %s', err);
  assert (select name = 'Bob’s Bikes and Bits' and speciality = 'Old Japanese' and added_by = wendy from mechanics where id = shop), 'changed, still Wendy''s';

  -- "I've used them".
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, true)', shop)) is null, 'Nell vouches';
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, true)', shop)) is null, 'twice is fine';
  assert (select count(*) from mechanic_vouches where mechanic_id = shop and vouched) = 1, 'one vouch';
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, false)', shop)) is null, 'takes it back';
  assert (select count(*) from mechanic_vouches where mechanic_id = shop and vouched) = 0, 'none now';
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, true)', shop)) is null, 'vouches again';
  assert pg_temp.try_as(paul, format('select public.vouch_mechanic(%L, true)', shop)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, true)', '00000000-0000-0000-0000-000000000000')) = 'No such workshop.', 'gone';

  -- Taking it off the list.
  assert pg_temp.try_as(nell, format('select public.archive_mechanic(%L)', shop)) = 'Only whoever added it or the board can change it.', 'not hers';
  assert pg_temp.try_as(wendy, format('select public.archive_mechanic(%L)', shop)) is null, 'Wendy takes it off';
  assert (select archived_at is not null from mechanics where id = shop), 'archived';
  assert pg_temp.try_as(bea, format('select public.archive_mechanic(%L)', shop)) = 'That workshop is already off the list.', 'twice';
  assert pg_temp.try_as(wendy, pg_temp.save_sql(shop, 'X', '', '', '', '', '')) = 'That workshop is off the list.', 'no edits after';
  assert pg_temp.try_as(nell, format('select public.vouch_mechanic(%L, true)', shop)) = 'That workshop is off the list.', 'no vouches after';

  -- Reading and writing directly.
  assert pg_temp.count_as(nell, 'mechanics') >= 1 and pg_temp.count_as(nell, 'mechanic_vouches') = 1, 'approved members read';
  assert pg_temp.count_as(paul, 'mechanics') = 0 and pg_temp.count_as(paul, 'mechanic_vouches') = 0, 'pending reads none';
  assert pg_temp.count_as(null, 'mechanics') = -1, 'anon reads nothing';
  assert pg_temp.try_as(wendy, $q$insert into mechanics (name) values ('Sneaky')$q$) like 'permission denied%', 'no inserts';
  assert pg_temp.try_as(wendy, $q$update mechanics set name = 'x'$q$) like 'permission denied%', 'no updates';
  assert pg_temp.try_as(wendy, $q$update mechanic_vouches set vouched = true$q$) like 'permission denied%', 'no vouch updates';
end $$;

\echo 'Swap and sell: listings with photos, changed by the seller, taken down by the seller or the board'
\o /dev/null
create function pg_temp.listing_sql(id uuid, kind text, title text, price numeric, details text, photos jsonb)
returns text language sql as $$
  select format('select public.save_listing(%L, %L, %L, %L, %L, %L)', id, kind, title, price, details, photos);
$$;
create function pg_temp.upload_swap(who uuid, name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('swap-media', name, who, who::text);
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bea constant uuid := '00000000-0000-0000-0000-0000000005c1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  sid constant uuid := '00000000-0000-0000-0000-0000000005a4';
  w text := '00000000-0000-0000-0000-0000000005b1/';
  item uuid;
  l listings%rowtype;
  err text;
begin
  perform pg_temp.upload_swap(wendy, w || 'a.jpg');
  perform pg_temp.upload_swap(wendy, w || 'b.jpg');
  perform pg_temp.upload_swap(nell, '00000000-0000-0000-0000-0000000005b2/n.jpg');

  item := pg_temp.value_as(wendy, pg_temp.listing_sql(null, 'sell', '  Panniers ', 150, '  ',
    jsonb_build_array(jsonb_build_object('path', w || 'a.jpg', 'width', 800.4, 'height', 600, 'extra', 'x'))))::uuid;
  select * into l from listings where id = item;
  assert l.title = 'Panniers' and l.price_dollars = 150 and l.details is null and l.seller_id = wendy
    and l.photos = jsonb_build_array(jsonb_build_object('path', w || 'a.jpg', 'width', 800, 'height', 600))
    and l.sold_at is null and l.taken_down_at is null, format('trimmed, kept: %s', row_to_json(l));

  -- Only sales carry a price.
  err := pg_temp.value_as(wendy, pg_temp.listing_sql(null, 'wanted', 'Left mirror', 40, '', '[]'));
  assert (select price_dollars is null from listings where id = err::uuid), 'a price on a wanted is ignored';

  -- The refusals, in order.
  assert pg_temp.try_signed_out(pg_temp.listing_sql(null, 'sell', 'X', 1, '', '[]')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.listing_sql(item, 'x', '', null, '', '[]')) = 'Only approved members can do that.', 'pending first';
  assert pg_temp.try_as(sid, pg_temp.listing_sql(null, 'sell', 'X', 1, '', '[]')) = 'Only approved members can do that.', 'suspended';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql('00000000-0000-0000-0000-000000000000', 'sell', 'X', 1, '', '[]')) = 'No such listing.', 'gone';
  assert pg_temp.try_as(nell, pg_temp.listing_sql(item, 'x', '', null, '', '[]')) = 'Only whoever listed it can change it.', 'not hers';
  assert pg_temp.try_as(bea, pg_temp.listing_sql(item, 'sell', 'X', 1, '', '[]')) = 'Only whoever listed it can change it.', 'not even the board';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'raffle', '', null, '', '[]')) = 'Pick what kind of listing it is.', 'kind';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, null, 'X', 1, '', '[]')) = 'Pick what kind of listing it is.', 'no kind';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', ' ', null, '', '[]')) = 'Give it a title.', 'title';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', repeat('x', 81), 1, '', '[]')) = 'Keep the title to 80 characters at most.', 'long title';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', repeat('🏍', 80), 1, '', '[]')) is null, '80 emoji are 80 characters';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', 'X', null, '', '[]')) = 'Put a price on it, in whole dollars.', 'no price';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', 'X', 0, '', '[]')) = 'Put a price on it, in whole dollars.', 'zero';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', 'X', 12.5, '', '[]')) = 'Put a price on it, in whole dollars.', 'cents';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', 'X', 100001, '', '[]')) = 'Put a price on it, in whole dollars.', 'too dear';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'sell', 'X', 100000, '', '[]')) is null, 'the top price';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, repeat('d', 1001), '[]')) = 'Keep the details to 1,000 characters at most.', 'details';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    (select jsonb_agg(jsonb_build_object('path', w || i || '.jpg')) from generate_series(1, 7) i))) = 'Up to 6 photos.', 'seven photos';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '', '{}')) = 'That photo didn’t upload properly. Try again.', 'not a list';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', w || 'never.jpg')))) = 'That photo didn’t upload properly. Try again.', 'not uploaded';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', '00000000-0000-0000-0000-0000000005b2/n.jpg')))) = 'That photo didn’t upload properly. Try again.', 'someone else''s';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', w || 'a.jpg')))) = 'That photo didn’t upload properly. Try again.', 'on another listing';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', w || 'b.jpg'), jsonb_build_object('path', w || 'b.jpg')))) = 'That photo didn’t upload properly. Try again.', 'twice';

  -- Changing it, keeping its own photo and adding one.
  err := pg_temp.try_as(wendy, pg_temp.listing_sql(item, 'sell', 'Panniers, pair', 120, 'Fit a Bonneville',
    jsonb_build_array(jsonb_build_object('path', w || 'a.jpg'), jsonb_build_object('path', w || 'b.jpg'))));
  assert err is null, format('Wendy changes hers, not %s', err);
  assert (select title = 'Panniers, pair' and price_dollars = 120 and jsonb_array_length(photos) = 2 from listings where id = item), 'changed';

  -- Sold and back on.
  assert pg_temp.try_as(nell, format('select public.mark_listing_sold(%L, true)', item)) = 'Only whoever listed it can change it.', 'not hers to sell';
  assert pg_temp.try_as(wendy, format('select public.mark_listing_sold(%L, true)', item)) is null, 'sold';
  assert (select sold_at is not null from listings where id = item), 'marked sold';
  assert pg_temp.try_as(wendy, format('select public.mark_listing_sold(%L, false)', item)) is null, 'back on';
  assert (select sold_at is null from listings where id = item), 'back on sale';

  -- Reading: approved members see it and its photos; the pending don't; nobody writes directly.
  assert pg_temp.count_as(nell, format('listings where id = %L', item)) = 1, 'Nell sees it';
  assert pg_temp.count_as(nell, format($q$storage.objects where name = %L$q$, w || 'b.jpg')) = 1, 'and its photo';
  assert pg_temp.count_as(paul, 'listings') = 0, 'pending sees none';
  assert pg_temp.count_as(null, 'listings') = -1, 'anon sees nothing';
  assert pg_temp.try_as(wendy, format($q$update listings set price_dollars = 1 where id = %L$q$, item)) like 'permission denied%', 'no updates';
  assert pg_temp.try_as(wendy, $q$insert into listings (seller_id, kind, title) values (auth.uid(), 'free', 'x')$q$) like 'permission denied%', 'no inserts';
  -- Uploads go only into your own folder.
  assert pg_temp.try_as(wendy, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('swap-media', %L, auth.uid(), auth.uid()::text)$q$,
    '00000000-0000-0000-0000-0000000005b2/sneaky.jpg')) is not null, 'not into Nell''s folder';
  assert pg_temp.try_as(wendy, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('swap-media', %L, auth.uid(), auth.uid()::text)$q$,
    w || 'c.jpg')) is null, 'into her own';
  -- Someone else's unused upload stays private.
  assert pg_temp.count_as(nell, format($q$storage.objects where name = %L$q$, w || 'c.jpg')) = 0, 'unused uploads are private';

  -- Taking it down.
  assert pg_temp.try_as(nell, format('select public.take_down_listing(%L)', item)) = 'Only whoever listed it or the board can take it down.', 'not Nell';
  assert pg_temp.try_as(bea, format('select public.take_down_listing(%L)', item)) is null, 'the board takes it down';
  assert (select taken_down_at is not null and taken_down_by = bea from listings where id = item), 'kept, with who';
  assert pg_temp.try_as(wendy, format('select public.take_down_listing(%L)', item)) = 'That listing has already been taken down.', 'twice';
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(item, 'sell', 'X', 1, '', '[]')) = 'That listing has been taken down.', 'no edits after';
  assert pg_temp.try_as(wendy, format('select public.mark_listing_sold(%L, true)', item)) = 'That listing has been taken down.', 'no selling after';
  assert pg_temp.count_as(nell, format('listings where id = %L', item)) = 0, 'hidden once down';
  assert pg_temp.count_as(nell, format($q$storage.objects where name = %L$q$, w || 'b.jpg')) = 0, 'and its photos';
  -- Its photos still can't go on another listing.
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', w || 'a.jpg')))) = 'That photo didn’t upload properly. Try again.', 'photos stay with it';

  -- A suspended seller's listings are hidden.
  update members set approval = 'approved' where id = sid;
  item := pg_temp.value_as(sid, pg_temp.listing_sql(null, 'swap', 'Jacket', null, '', '[]'))::uuid;
  update members set approval = 'suspended' where id = sid;
  assert pg_temp.count_as(nell, format('listings where id = %L', item)) = 0, 'suspended seller hidden';
end $$;

\o
\echo 'All social checks passed'
