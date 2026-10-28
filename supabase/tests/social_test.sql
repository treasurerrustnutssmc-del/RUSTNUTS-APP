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
  -- Its seller can't clear its photos away, though they could an unused upload.
  perform pg_temp.try_as(wendy, format($q$delete from storage.objects where bucket_id = 'swap-media' and name = %L$q$, w || 'b.jpg'));
  assert (select count(*) from storage.objects where name = w || 'b.jpg') = 1, 'a taken-down listing keeps its photos';
  perform pg_temp.try_as(wendy, format($q$delete from storage.objects where bucket_id = 'swap-media' and name = %L$q$, w || 'c.jpg'));
  assert (select count(*) from storage.objects where name = w || 'c.jpg') = 0, 'an unused upload can be cleared';
  -- Its photos still can't go on another listing.
  assert pg_temp.try_as(wendy, pg_temp.listing_sql(null, 'free', 'X', null, '',
    jsonb_build_array(jsonb_build_object('path', w || 'a.jpg')))) = 'That photo didn’t upload properly. Try again.', 'photos stay with it';

  -- A suspended seller's listings are hidden.
  update members set approval = 'approved' where id = sid;
  item := pg_temp.value_as(sid, pg_temp.listing_sql(null, 'swap', 'Jacket', null, '', '[]'))::uuid;
  update members set approval = 'suspended' where id = sid;
  assert pg_temp.count_as(nell, format('listings where id = %L', item)) = 0, 'suspended seller hidden';
end $$;

\echo 'Build threads: the owner posts on a project bike; the poster or the board takes it down'
\o /dev/null
create function pg_temp.build_sql(bike uuid, body text, photos jsonb) returns text language sql as $$
  select format('select public.post_build_update(%L, %L, %L)', bike, body, photos);
$$;
create function pg_temp.upload_build(who uuid, name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('build-media', name, who, who::text);
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bea constant uuid := '00000000-0000-0000-0000-0000000005c1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  w text := '00000000-0000-0000-0000-0000000005b1/';
  project uuid;
  road uuid;
  nells uuid;
  upd uuid;
  u build_updates%rowtype;
  err text;
begin
  insert into bikes (member_id, make, model, year, is_project) values (wendy, 'Honda', 'CB750', 1978, true) returning id into project;
  insert into bikes (member_id, make, model, is_project) values (wendy, 'Triumph', 'Bonneville', false) returning id into road;
  insert into bikes (member_id, make, model, is_project) values (nell, 'BSA', 'A65', true) returning id into nells;
  perform pg_temp.upload_build(wendy, w || 'a.jpg');
  perform pg_temp.upload_build(wendy, w || 'b.jpg');
  perform pg_temp.upload_build(nell, '00000000-0000-0000-0000-0000000005b2/n.jpg');

  upd := pg_temp.value_as(wendy, pg_temp.build_sql(project, '  Carbs off. ', jsonb_build_array(jsonb_build_object('path', w || 'a.jpg', 'width', 640.6, 'height', 480))))::uuid;
  select * into u from build_updates where id = upd;
  assert u.body = 'Carbs off.' and u.author_id = wendy and u.bike_id = project
    and u.photos = jsonb_build_array(jsonb_build_object('path', w || 'a.jpg', 'width', 641, 'height', 480)), format('posted: %s', row_to_json(u));
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, '', jsonb_build_array(jsonb_build_object('path', w || 'b.jpg')))) is null, 'a photo alone';

  -- The refusals, in order.
  assert pg_temp.try_signed_out(pg_temp.build_sql(project, 'x', '[]')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.build_sql(project, 'x', '[]')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wendy, pg_temp.build_sql('00000000-0000-0000-0000-000000000000', 'x', '[]')) = 'No such bike.', 'no bike';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(nells, 'x', '[]')) = 'Only the bike’s owner can post on its build.', 'not hers';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(road, 'x', '[]')) = 'Build threads are for project bikes. Mark it as a project in your garage first.', 'not a project';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, '  ', '[]')) = 'Write something or add a photo.', 'empty';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, repeat('x', 2001), '[]')) = 'Keep it to 2,000 characters at most.', 'long';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, repeat('🔧', 2000), '[]')) is null, '2,000 emoji are 2,000 characters';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, 'x',
    (select jsonb_agg(jsonb_build_object('path', w || i || '.jpg')) from generate_series(1, 5) i))) = 'Up to 4 photos.', 'five photos';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, 'x', jsonb_build_array(jsonb_build_object('path', w || 'never.jpg')))) = 'That photo didn’t upload properly. Try again.', 'not uploaded';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, 'x', jsonb_build_array(jsonb_build_object('path', '00000000-0000-0000-0000-0000000005b2/n.jpg')))) = 'That photo didn’t upload properly. Try again.', 'Nell''s photo';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, 'x', jsonb_build_array(jsonb_build_object('path', w || 'a.jpg')))) = 'That photo didn’t upload properly. Try again.', 'already posted';

  -- Reading.
  assert pg_temp.count_as(nell, 'build_updates') = 3, 'Nell reads all three';
  assert pg_temp.count_as(nell, format($q$storage.objects where name = %L$q$, w || 'a.jpg')) = 1, 'and the photo';
  assert pg_temp.count_as(paul, 'build_updates') = 0, 'pending reads none';
  assert pg_temp.count_as(null, 'build_updates') = -1, 'anon reads nothing';
  assert pg_temp.try_as(wendy, $q$update build_updates set body = 'x'$q$) like 'permission denied%', 'no updates';
  assert pg_temp.try_as(wendy, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('build-media', %L, auth.uid(), auth.uid()::text)$q$,
    '00000000-0000-0000-0000-0000000005b2/sneaky.jpg')) is not null, 'not into Nell''s folder';

  -- Taking down.
  assert pg_temp.try_as(nell, format('select public.take_down_build_update(%L)', upd)) = 'Only whoever posted it or the board can take it down.', 'not Nell';
  assert pg_temp.try_as(bea, format('select public.take_down_build_update(%L)', upd)) is null, 'the board';
  assert (select taken_down_by = bea from build_updates where id = upd), 'kept, with who';
  assert pg_temp.try_as(wendy, format('select public.take_down_build_update(%L)', upd)) = 'That update has already been taken down.', 'twice';
  assert pg_temp.try_as(wendy, format('select public.take_down_build_update(%L)', '00000000-0000-0000-0000-000000000000')) = 'No such update.', 'gone';
  assert pg_temp.count_as(nell, 'build_updates') = 2, 'hidden once down';
  assert pg_temp.count_as(nell, format($q$storage.objects where name = %L$q$, w || 'a.jpg')) = 0, 'and its photo';
  perform pg_temp.try_as(wendy, format($q$delete from storage.objects where bucket_id = 'build-media' and name = %L$q$, w || 'a.jpg'));
  assert (select count(*) from storage.objects where bucket_id = 'build-media' and name = w || 'a.jpg') = 1, 'its photo is kept';

  -- A bike that stops being a project keeps its thread, but takes no more posts.
  update bikes set is_project = false where id = project;
  assert pg_temp.count_as(nell, 'build_updates') = 2, 'still readable';
  assert pg_temp.try_as(wendy, pg_temp.build_sql(project, 'x', '[]')) = 'Build threads are for project bikes. Mark it as a project in your garage first.', 'no more posts';

  -- Removing the bike keeps its updates (and the board's take-down) and their photos.
  delete from bikes where id = project;
  assert (select count(*) from build_updates where author_id = wendy and bike_id is null) = 3, 'updates kept';
  assert (select taken_down_by = bea from build_updates where id = upd), 'take-down kept';
  perform pg_temp.try_as(wendy, format($q$delete from storage.objects where bucket_id = 'build-media' and name = %L$q$, w || 'a.jpg'));
  assert (select count(*) from storage.objects where bucket_id = 'build-media' and name = w || 'a.jpg') = 1, 'photo still kept';
end $$;

\o
\echo 'History: the board keeps the timeline and honours; approved members read them'
\o /dev/null
create function pg_temp.entry_sql(id uuid, happened text, prec text, title text, story text)
returns text language sql as $$
  select format('select public.save_history_entry(%L, %L, %L, %L, %L)', id, happened, prec, title, story);
$$;
create function pg_temp.honour_sql(id uuid, member uuid, name text, honour text, yr int, note text)
returns text language sql as $$
  select format('select public.save_honour(%L, %L, %L, %L, %L, %L)', id, member, name, honour, yr, note);
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bea constant uuid := '00000000-0000-0000-0000-0000000005c1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  this_year int := extract(year from private.club_date())::int;
  tomorrow text := to_char(private.club_date() + 1, 'YYYY-MM-DD');
  e uuid;
  h uuid;
  r club_history%rowtype;
  o club_honours%rowtype;
begin
  e := pg_temp.value_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'day', '  First ride ', '  ' ))::uuid;
  select * into r from club_history where id = e;
  assert r.happened_on = '2019-05-11' and r.precision = 'day' and r.title = 'First ride' and r.story is null
    and r.added_by = bea, format('saved: %s', row_to_json(r));
  assert pg_temp.value_as(bea, pg_temp.entry_sql(e, '2019-05-01', 'month', 'First ride', 'Out to Daylesford.')) = e::text, 'changed';
  select * into r from club_history where id = e;
  assert r.precision = 'month' and r.story = 'Out to Daylesford.', 'with the change';

  -- Timeline refusals, in order.
  assert pg_temp.try_signed_out(pg_temp.entry_sql(null, '2019-05-11', 'day', 'x', '')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.entry_sql(null, '2019-05-11', 'day', 'x', '')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wendy, pg_temp.entry_sql(null, '2019-05-11', 'day', 'x', '')) = 'Only the board can keep the club’s history.', 'not the board';
  assert pg_temp.try_as(bea, pg_temp.entry_sql('00000000-0000-0000-0000-000000000000', '2019-05-11', 'day', 'x', '')) = 'No such entry.', 'gone';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-02-30', 'day', 'x', '')) = 'Pick a date.', 'not a real date';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '', 'day', 'x', '')) = 'Pick a date.', 'no date';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, tomorrow, 'day', 'x', '')) = 'Pick a date.', 'tomorrow';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'week', 'x', '')) = 'Pick a date.', 'precision';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, 'x', 'day', '', '')) = 'Pick a date.', 'the date before the title';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'day', '  ', '')) = 'Give it a title.', 'no title';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'day', repeat('x', 81), '')) = 'Keep the title to 80 characters at most.', 'long title';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'day', repeat('🏍', 80), '')) is null, '80 emoji are 80 characters';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(null, '2019-05-11', 'day', 'x', repeat('s', 1001))) = 'Keep the story to 1,000 characters at most.', 'long story';

  -- Reading.
  assert pg_temp.count_as(nell, 'club_history') = 2, 'approved members read it';
  assert pg_temp.count_as(paul, 'club_history') = 0, 'pending reads none';
  assert pg_temp.count_as(null, 'club_history') = -1, 'anon reads nothing';
  assert pg_temp.try_as(bea, $q$update club_history set title = 'x'$q$) like 'permission denied%', 'no writing directly';
  assert pg_temp.try_as(bea, $q$insert into club_honours (honour, year, name) values ('x', 2020, 'y')$q$) like 'permission denied%', 'no inserting directly';

  -- Taking an entry off.
  assert pg_temp.try_as(wendy, format('select public.archive_history_entry(%L)', e)) = 'Only the board can keep the club’s history.', 'not Wendy';
  assert pg_temp.try_as(bea, format('select public.archive_history_entry(%L)', e)) is null, 'the board';
  assert (select archived_by = bea from club_history where id = e), 'kept, with who';
  assert pg_temp.try_as(bea, format('select public.archive_history_entry(%L)', e)) = 'That entry has already been taken off.', 'twice';
  assert pg_temp.try_as(bea, pg_temp.entry_sql(e, '2019-05-11', 'day', 'x', '')) = 'That entry has been taken off.', 'no changing it';
  assert pg_temp.try_as(bea, format('select public.archive_history_entry(%L)', '00000000-0000-0000-0000-000000000000')) = 'No such entry.', 'gone';
  assert pg_temp.count_as(nell, 'club_history') = 1, 'hidden once off';

  -- Honours.
  h := pg_temp.value_as(bea, pg_temp.honour_sql(null, nell, '', ' Life member ', 2024, ' '))::uuid;
  select * into o from club_honours where id = h;
  assert o.member_id = nell and o.name is null and o.honour = 'Life member' and o.year = 2024 and o.note is null
    and o.added_by = bea, format('honour: %s', row_to_json(o));
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, null, ' Old Mate ', 'Rider of the year', this_year, 'Most kays')) is null, 'a typed name, this year';
  assert pg_temp.try_signed_out(pg_temp.honour_sql(null, nell, '', 'x', 2024, '')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.honour_sql(null, nell, '', 'x', 2024, '')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wendy, pg_temp.honour_sql(null, nell, '', 'x', 2024, '')) = 'Only the board can keep the club’s history.', 'not the board';
  assert pg_temp.try_as(bea, pg_temp.honour_sql('00000000-0000-0000-0000-000000000000', nell, '', 'x', 2024, '')) = 'No such honour.', 'gone';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, null, '  ', 'x', 2024, '')) = 'Pick a member or type a name.', 'nobody';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, 'Also', 'x', 2024, '')) = 'Pick a member or type a name.', 'both';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, '00000000-0000-0000-0000-000000000000', '', 'x', 2024, '')) = 'No such member.', 'no such member';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, null, repeat('n', 81), 'x', 2024, '')) = 'Keep the name to 80 characters at most.', 'long name';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', ' ', 2024, '')) = 'Name the honour.', 'no honour';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', repeat('h', 61), 2024, '')) = 'Keep the honour to 60 characters at most.', 'long honour';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', 'x', 2018, '')) = 'Pick a year from 2019 on.', 'too early';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', 'x', this_year + 1, '')) = 'Pick a year from 2019 on.', 'next year';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', 'x', null, '')) = 'Pick a year from 2019 on.', 'no year';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(null, nell, '', 'x', 2024, repeat('n', 301))) = 'Keep the note to 300 characters at most.', 'long note';
  assert pg_temp.count_as(nell, 'club_honours') = 2, 'approved members read honours';
  assert pg_temp.count_as(paul, 'club_honours') = 0, 'pending reads none';

  assert pg_temp.try_as(wendy, format('select public.archive_honour(%L)', h)) = 'Only the board can keep the club’s history.', 'not Wendy';
  assert pg_temp.try_as(bea, format('select public.archive_honour(%L)', h)) is null, 'the board takes it off';
  assert (select archived_by = bea from club_honours where id = h), 'kept, with who';
  assert pg_temp.try_as(bea, format('select public.archive_honour(%L)', h)) = 'That honour has already been taken off.', 'twice';
  assert pg_temp.try_as(bea, pg_temp.honour_sql(h, nell, '', 'x', 2024, '')) = 'That honour has been taken off.', 'no changing it';
  assert pg_temp.count_as(nell, 'club_honours') = 1, 'hidden once off';
end $$;

\o
\echo 'Bragging rights: the board opens awards, members nominate and vote, counts only once closed'
\o /dev/null
create function pg_temp.open_sql(kind text, title text, yr int, noms text, votes text)
returns text language sql as $$
  select format('select public.open_award(%L, %L, %L, %L, %L)', kind, title, yr, noms, votes);
$$;
create function pg_temp.nom_sql(award uuid, ride uuid, title text, photo jsonb, story text, reason text)
returns text language sql as $$
  select format('select public.nominate(%L, %L, %L, %L, %L, %L)', award, ride, title, photo, story, reason);
$$;
create function pg_temp.upload_brag(who uuid, name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('brag-media', name, who, who::text);
$$;

do $$
declare
  wendy constant uuid := '00000000-0000-0000-0000-0000000005b1';
  nell constant uuid := '00000000-0000-0000-0000-0000000005b2';
  bea constant uuid := '00000000-0000-0000-0000-0000000005c1';
  paul constant uuid := '00000000-0000-0000-0000-0000000005a3';
  w constant text := '00000000-0000-0000-0000-0000000005b1/';
  d date := private.club_date();
  yr int := extract(year from private.club_date())::int;
  ridden uuid := gen_random_uuid();
  ahead uuid := gen_random_uuid();
  last_year uuid := gen_random_uuid();
  called_off uuid := gen_random_uuid();
  rides_award uuid;
  photos_award uuid;
  stories_award uuid;
  voting uuid;
  closed uuid;
  n1 uuid;
  n2 uuid;
  v1 uuid;
  v2 uuid;
  c1 uuid;
begin
  -- Noon Melbourne on each day, so the date is the same whatever the server's zone.
  insert into rides (id, source, starts_at, title, category, cancelled_at) values
    (ridden, 'app', ((d - 1)::timestamp + interval '12 hours') at time zone 'Australia/Melbourne', 'Yesterday''s run', 'club', null),
    (ahead, 'app', ((d + 3)::timestamp + interval '12 hours') at time zone 'Australia/Melbourne', 'Coming up', 'club', null),
    (last_year, 'app', ((make_date(yr - 1, 6, 1))::timestamp + interval '12 hours') at time zone 'Australia/Melbourne', 'Last year', 'club', null),
    (called_off, 'app', ((d - 2)::timestamp + interval '12 hours') at time zone 'Australia/Melbourne', 'Rained out', 'club', now());

  -- Opening.
  rides_award := pg_temp.value_as(bea, pg_temp.open_sql('ride', '  Ride of the year ', yr, d::text, (d + 7)::text))::uuid;
  assert (select title = 'Ride of the year' and opened_by = bea from brag_awards where id = rides_award), 'opened, trimmed';
  photos_award := pg_temp.value_as(bea, pg_temp.open_sql('photo', 'Best photo', yr, (d + 1)::text, (d + 7)::text))::uuid;
  stories_award := pg_temp.value_as(bea, pg_temp.open_sql('story', 'Best breakdown', yr, (d + 1)::text, (d + 7)::text))::uuid;
  assert pg_temp.try_signed_out(pg_temp.open_sql('ride', 'x', yr, d::text, (d + 1)::text)) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.open_sql('ride', 'x', yr, d::text, (d + 1)::text)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(wendy, pg_temp.open_sql('ride', 'x', yr, d::text, (d + 1)::text)) = 'Only the board can run awards.', 'not the board';
  assert pg_temp.try_as(bea, pg_temp.open_sql('song', 'x', yr, d::text, (d + 1)::text)) = 'Pick what the award is for.', 'kind';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', ' ', yr, d::text, (d + 1)::text)) = 'Give the award a name.', 'name';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', repeat('x', 61), yr, d::text, (d + 1)::text)) = 'Keep the name to 60 characters at most.', 'long name';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', repeat('🏆', 60), yr, d::text, (d + 1)::text)) is null, '60 emoji';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', 'x', 2018, d::text, (d + 1)::text)) = 'Pick a year from 2019 on.', 'too early';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', 'x', yr + 1, d::text, (d + 1)::text)) = 'Pick a year from 2019 on.', 'next year';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', 'x', yr, (d - 1)::text, (d + 1)::text)) = 'Nominations close first, then voting, both from today on.', 'past';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', 'x', yr, d::text, d::text)) = 'Nominations close first, then voting, both from today on.', 'same day';
  assert pg_temp.try_as(bea, pg_temp.open_sql('ride', 'x', yr, '2026-02-30', '2099-01-01')) = 'Nominations close first, then voting, both from today on.', 'not real';

  -- Nominating a ride.
  n1 := pg_temp.value_as(wendy, pg_temp.nom_sql(rides_award, ridden, 'ignored', null, 'ignored', '  Best day out '))::uuid;
  assert (select ride_id = ridden and title is null and story is null and reason = 'Best day out' and nominated_by = wendy
          from brag_nominations where id = n1), 'a ride, only what a ride uses';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, ridden, '', null, '', '')) = 'That ride is already nominated.', 'once';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, null, '', null, '', '')) = 'Pick a ride.', 'no ride';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, ahead, '', null, '', '')) = 'Pick a ride from that year that’s been ridden.', 'not yet ridden';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, last_year, '', null, '', '')) = 'Pick a ride from that year that’s been ridden.', 'last year';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, called_off, '', null, '', '')) = 'Pick a ride from that year that’s been ridden.', 'cancelled';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, gen_random_uuid(), '', null, '', '')) = 'Pick a ride from that year that’s been ridden.', 'no such ride';
  assert pg_temp.try_signed_out(pg_temp.nom_sql(rides_award, ridden, '', null, '', '')) = 'Sign in first.', 'signed out';
  assert pg_temp.try_as(paul, pg_temp.nom_sql(rides_award, ridden, '', null, '', '')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(gen_random_uuid(), ridden, '', null, '', '')) = 'No such award.', 'no award';

  -- Stories, and the three-each limit.
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, 'Ballan', null, '  ', '')) = 'Tell the story.', 'no story';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, ' ', null, 'x', '')) = 'Give it a title.', 'no title';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, repeat('t', 81), null, 'x', '')) = 'Keep the title to 80 characters at most.', 'long title';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, 't', null, repeat('s', 1001), '')) = 'Keep the story to 1,000 characters at most.', 'long story';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, 't', null, 's', repeat('r', 301))) = 'Keep the reason to 300 characters at most.', 'long reason';
  n2 := pg_temp.value_as(nell, pg_temp.nom_sql(stories_award, null, 'One', null, 'Chain snapped.', ''))::uuid;
  perform pg_temp.value_as(nell, pg_temp.nom_sql(stories_award, null, 'Two', null, 'x', ''));
  perform pg_temp.value_as(nell, pg_temp.nom_sql(stories_award, null, 'Three', null, 'x', ''));
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, 'Four', null, 'x', '')) = 'Three nominations each per award.', 'four';

  -- Withdrawing.
  assert pg_temp.try_as(wendy, format('select public.withdraw_nomination(%L)', n2)) = 'Only whoever nominated it or the board can withdraw it.', 'not Wendy';
  assert pg_temp.try_as(bea, format('select public.withdraw_nomination(%L)', n2)) is null, 'the board';
  assert (select withdrawn_by = bea from brag_nominations where id = n2), 'kept, with who';
  assert pg_temp.try_as(nell, format('select public.withdraw_nomination(%L)', n2)) = 'That nomination has already been withdrawn.', 'twice';
  assert pg_temp.try_as(nell, format('select public.withdraw_nomination(%L)', gen_random_uuid())) = 'No such nomination.', 'gone';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(stories_award, null, 'Four', null, 'x', '')) is null, 'room again once withdrawn';

  -- Photos.
  perform pg_temp.upload_brag(wendy, w || 'sunset.jpg');
  assert pg_temp.try_as(wendy, pg_temp.nom_sql(photos_award, null, 'Sunset', null, '', '')) = 'Add a photo.', 'no photo';
  assert pg_temp.try_as(wendy, pg_temp.nom_sql(photos_award, null, 'Sunset', jsonb_build_object('path', w || 'never.jpg'), '', '')) = 'That photo didn’t upload properly. Try again.', 'not uploaded';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(photos_award, null, 'Sunset', jsonb_build_object('path', w || 'sunset.jpg'), '', '')) = 'That photo didn’t upload properly. Try again.', 'Wendy''s photo';
  assert pg_temp.try_as(wendy, pg_temp.nom_sql(photos_award, null, 'Sunset', jsonb_build_object('path', w || 'sunset.jpg', 'width', 800.4, 'height', 600), '', '')) is null, 'a photo';
  assert (select photo = jsonb_build_object('path', w || 'sunset.jpg', 'width', 800, 'height', 600) from brag_nominations where award_id = photos_award), 'path and size';
  assert pg_temp.try_as(wendy, pg_temp.nom_sql(photos_award, null, 'Again', jsonb_build_object('path', w || 'sunset.jpg'), '', '')) = 'That photo didn’t upload properly. Try again.', 'already used';
  assert pg_temp.count_as(nell, format($q$storage.objects where bucket_id = 'brag-media' and name = %L$q$, w || 'sunset.jpg')) = 1, 'Nell sees the photo';
  assert pg_temp.count_as(paul, format($q$storage.objects where bucket_id = 'brag-media' and name = %L$q$, w || 'sunset.jpg')) = 0, 'pending doesn''t';

  -- Voting: an award that's past nominations, made directly.
  insert into brag_awards (kind, title, year, nominations_close, voting_close, opened_by) values ('story', 'Voting now', yr, d - 1, d + 5, bea) returning id into voting;
  insert into brag_nominations (award_id, nominated_by, title, story) values (voting, wendy, 'W', 'w') returning id into v1;
  insert into brag_nominations (award_id, nominated_by, title, story) values (voting, nell, 'N', 'n') returning id into v2;
  assert pg_temp.try_as(nell, pg_temp.nom_sql(voting, null, 't', null, 's', '')) = 'Nominations are closed.', 'nominations closed';
  assert pg_temp.try_as(wendy, format('select public.withdraw_nomination(%L)', v1)) = 'Nominations are closed.', 'no withdrawing now';
  assert pg_temp.try_as(wendy, format('select public.cast_brag_vote(%L)', v1)) = 'You can’t vote for your own nomination.', 'own';
  assert pg_temp.try_as(wendy, format('select public.cast_brag_vote(%L)', v2)) is null, 'a vote';
  assert pg_temp.try_as(bea, format('select public.cast_brag_vote(%L)', v1)) is null, 'bea votes Wendy';
  assert pg_temp.try_as(bea, format('select public.cast_brag_vote(%L)', v2)) is null, 'and changes her mind';
  assert (select count(*) from brag_votes where award_id = voting) = 2, 'one vote each';
  assert pg_temp.try_as(nell, format('select public.cast_brag_vote(%L)', n1)) = 'Voting isn’t open.', 'still nominating';
  assert pg_temp.try_as(paul, format('select public.cast_brag_vote(%L)', v2)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, format('select public.cast_brag_vote(%L)', gen_random_uuid())) = 'No such nomination.', 'gone';
  assert pg_temp.count_as(nell, 'brag_votes') = 0, 'Nell hasn''t voted, so sees no votes';
  assert pg_temp.count_as(wendy, 'brag_votes') = 1, 'Wendy sees only her own';
  assert pg_temp.value_as(nell, 'select count(*) from public.brag_tallies()') = '0', 'no counts while voting';

  -- Closed: counts for everyone approved.
  insert into brag_awards (kind, title, year, nominations_close, voting_close, opened_by) values ('story', 'Done', yr, d - 5, d - 1, bea) returning id into closed;
  insert into brag_nominations (award_id, nominated_by, title, story) values (closed, nell, 'C', 'c') returning id into c1;
  insert into brag_votes (award_id, member_id, nomination_id) values (closed, wendy, c1), (closed, bea, c1);
  assert pg_temp.try_as(wendy, format('select public.cast_brag_vote(%L)', c1)) = 'Voting isn’t open.', 'closed';
  assert pg_temp.value_as(nell, format('select votes from public.brag_tallies() where nomination_id = %L', c1)) = '2', 'two votes';
  assert pg_temp.value_as(paul, 'select count(*) from public.brag_tallies()') = '0', 'pending sees no counts';

  -- Reading and writing.
  assert pg_temp.count_as(nell, 'brag_awards') = 6, 'every award (with the 60-emoji one)';
  assert pg_temp.count_as(paul, 'brag_nominations') = 0, 'pending reads none';
  assert pg_temp.count_as(null, 'brag_awards') = -1, 'anon reads nothing';
  assert pg_temp.try_as(bea, $q$update brag_awards set title = 'x'$q$) like 'permission denied%', 'no writing directly';
  assert pg_temp.try_as(wendy, $q$insert into brag_votes (award_id, member_id, nomination_id) select award_id, auth.uid(), id from brag_nominations limit 1$q$) like 'permission denied%', 'no stuffing the box';

  -- Taking an award off.
  assert pg_temp.try_as(wendy, format('select public.archive_award(%L)', rides_award)) = 'Only the board can run awards.', 'not Wendy';
  assert pg_temp.try_as(bea, format('select public.archive_award(%L)', rides_award)) is null, 'the board';
  assert pg_temp.try_as(bea, format('select public.archive_award(%L)', rides_award)) = 'That award has already been taken off.', 'twice';
  assert pg_temp.try_as(bea, format('select public.archive_award(%L)', gen_random_uuid())) = 'No such award.', 'gone';
  assert pg_temp.try_as(nell, pg_temp.nom_sql(rides_award, ridden, '', null, '', '')) = 'That award has been taken off.', 'no nominating';
  assert pg_temp.try_as(wendy, format('select public.withdraw_nomination(%L)', n1)) = 'That award has been taken off.', 'no withdrawing';
  assert pg_temp.count_as(nell, format('brag_nominations where award_id = %L', rides_award)) = 0, 'its nominations hidden';
end $$;

\o
\echo 'All social checks passed'
