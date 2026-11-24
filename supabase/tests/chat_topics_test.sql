-- Checks topics inside board, All boards, NEC, committee and group chats: anyone who reads the chat
-- starts one, its people are the chat's people, the starter or a board member/NEC renames, closes and
-- reopens it, and nobody posts in a closed one.
-- Run with: npm run test:db. See docs/superpowers/specs/2026-11-24-chat-topics-design.md.

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'pres@example.com', now()),   -- North President (NEC)
  ('00000000-0000-0000-0000-0000000000d2', 'sec@example.com', now()),    -- West Secretary (board)
  ('00000000-0000-0000-0000-0000000000d3', 'rc@example.com', now()),     -- North Road Captain (board, ride committee)
  ('00000000-0000-0000-0000-0000000000d4', 'wes@example.com', now()),    -- West Full
  ('00000000-0000-0000-0000-0000000000d5', 'cc@example.com', now()),     -- West Full, charity committee
  ('00000000-0000-0000-0000-0000000000d6', 'nick@example.com', now()),   -- West Introduced
  ('00000000-0000-0000-0000-0000000000d7', 'kerry@example.com', now()),  -- West Family
  ('00000000-0000-0000-0000-0000000000d8', 'fred@example.com', now()),   -- West FNG
  ('00000000-0000-0000-0000-0000000000d9', 'nora@example.com', now());   -- North Full

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'north', 'Paul President', 'Jiggles', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Sue Secretary', 'Fingers', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'north', 'Ray Captain', 'Dysco', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d5', 'west', 'Cath Charity', 'Cath', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d6', 'west', 'Nick Newbie', 'Nick', 'introduced', 'approved'),
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'Kerry Mercer', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000d8', 'west', 'Fred Fng', 'Fred', 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'north', 'Nora North', null, 'full', 'approved')
) as v(id, chapter, name, road, status, approval)
join chapters c on c.slug = v.chapter;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, c.id, v.role::position_role, private.club_date()
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'north', 'president'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000d3', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000d5', 'west', 'charity_committee')
) as v(id, chapter, role)
join chapters c on c.slug = v.chapter;

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

create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text) to anon, authenticated;

create function pg_temp.chat(k text) returns uuid language sql as $$
  select id from conversations where kind::text = k limit 1
$$;
create function pg_temp.board_of(slug text) returns uuid language sql as $$
  select c.id from conversations c join chapters ch on ch.id = c.chapter_id where c.kind = 'board' and ch.slug = slug
$$;
create function pg_temp.committee(k text) returns uuid language sql as $$
  select id from conversations where kind = 'committee' and committee::text = k
$$;
create function pg_temp.reads(who uuid, chat uuid) returns boolean language sql as $$
  select pg_temp.value_as(who, format('select count(*) from public.conversations where id = %L', chat)) = '1'
$$;
grant execute on function pg_temp.chat(text), pg_temp.board_of(text), pg_temp.committee(text) to anon, authenticated;

\o
\echo 'Anyone in All boards starts a topic; it reads like the chat, for the same people'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000d2';
  b uuid := pg_temp.chat('boards');
  t uuid;
  list jsonb;
  item jsonb;
begin
  t := pg_temp.value_as(sec, format('select public.start_topic(%L, %L)', b, '  Christmas party  '))::uuid;
  assert t is not null, 'Fingers starts a topic';
  assert (select kind::text from conversations where id = t) = 'topic', 'it is a topic';
  assert (select parent_id from conversations where id = t) = b, 'inside All boards';
  assert (select name from conversations where id = t) = 'Christmas party', 'the name is trimmed';
  assert (select created_by from conversations where id = t) = sec, 'Fingers started it';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000d1', t), 'the NEC reads it';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000d3', t), 'North''s board reads it';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000d4', t), 'a member doesn''t';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000d7', t), 'nor Family';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format('select public.mark_chat_read(%L)', t))
    = 'That chat is for board members and the NEC.', 'a member is told why, in the chat''s words';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format('select public.send_message(%L, %L)', t, 'hi'))
    = 'That chat is for board members and the NEC.', 'and can''t post';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000d3', format('select public.send_message(%L, %L)', t, 'Venue booked?'))::uuid is not null,
    'North posts in it';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000d1', 'select public.chat_list()')::jsonb;
  select x into item from jsonb_array_elements(list) x where x ->> 'id' = t::text;
  assert item ->> 'kind' = 'topic', 'the NEC lists it';
  assert item ->> 'parent_id' = b::text, 'with its chat';
  assert item ->> 'name' = 'Christmas party', 'and name';
  assert item ->> 'closed_at' is null, 'open';
  assert (item ->> 'unread')::int = 1, 'one unread for the NEC';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000d4', 'select public.chat_list()')::jsonb;
  assert not exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'topic'), 'a member lists none';
end $$;

\echo 'Topics go in board, NEC, committee and group chats, not the whole-club, chapter, ride or private ones'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000d2';
  pres uuid := '00000000-0000-0000-0000-0000000000d1';
  q text := 'select public.start_topic(%L, %L)';
  g uuid;
  t uuid;
begin
  assert pg_temp.try_as(sec, format(q, pg_temp.board_of('west'), 'Raffle')) is null, 'West''s big table';
  assert pg_temp.try_as(pres, format(q, pg_temp.chat('nec'), 'Constitution')) is null, 'the NEC chat';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d5', format(q, pg_temp.committee('charity'), 'Toy run')) is null,
    'a charity committee member who isn''t on a board, in the charity committee chat';
  assert pg_temp.try_as(sec, format(q, pg_temp.chat('club'), 'x')) = 'Topics are for board, committee and group chats.', 'not the whole club';
  assert pg_temp.try_as(sec, format(q, (select id from conversations c where kind = 'chapter' and chapter_id = (select id from chapters where slug = 'west')), 'x'))
    = 'Topics are for board, committee and group chats.', 'not a chapter chat';
  g := pg_temp.value_as(sec, format('select public.create_group_chat(%L, %L::uuid[])', 'Big 4 crew',
    '{00000000-0000-0000-0000-0000000000d8,00000000-0000-0000-0000-0000000000d4}'))::uuid;
  t := pg_temp.value_as('00000000-0000-0000-0000-0000000000d8', format(q, g, 'Esky roster'))::uuid;
  assert t is not null, 'an FNG in a group starts a topic in it';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000d4', t), 'Wes, in the group, reads it';
  assert not pg_temp.reads(pres, t), 'the NEC, not in the group, doesn''t';
  assert pg_temp.try_as(pres, format(q, g, 'x')) = 'That’s a private group.', 'nor starts one there';
  assert pg_temp.try_as(sec, format(q, t, 'x')) = 'Topics are for board, committee and group chats.', 'no topics in topics';
  -- Out of the group, out of its topics.
  perform pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format('select public.leave_group(%L)', g));
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000d4', t), 'leaving the group leaves its topics';
end $$;

\echo 'A topic''s name, who can start one and how many can be open, in the app''s words'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000d2';
  b uuid := pg_temp.board_of('west');
  q text := 'select public.start_topic(%L, %L)';
  i int;
begin
  assert pg_temp.try_as(null, format(q, b, 'x')) like 'permission denied%', 'signed out';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format(q, b, 'x')) = 'That chat is for the West board.', 'a member';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d6', format(q, b, 'x')) = 'That chat opens up once you’re an FNG.', 'Introduced';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', format(q, b, 'x')) = 'Family can only use the Family chat.', 'Family';
  assert pg_temp.try_as(sec, format(q, gen_random_uuid(), 'x')) = 'No such chat.', 'no chat';
  assert pg_temp.try_as(sec, format(q, b, '   ')) = 'Give the topic a name.', 'no name';
  assert pg_temp.try_as(sec, format(q, b, repeat('a', 41))) = 'Keep the name to 40 characters.', 'too long';
  assert pg_temp.try_as(sec, format(q, b, repeat('🏍', 40))) is null, 'an emoji counts as one';
  -- 2 open in West's big table so far (Raffle and the emojis): up to 50.
  for i in 1..48 loop
    perform pg_temp.value_as(sec, format(q, b, 'Topic ' || i));
  end loop;
  assert pg_temp.try_as(sec, format(q, b, 'One too many')) = 'This chat has 50 open topics. Close one first.', 'at most 50 open';
  update conversations set closed_at = now() where parent_id = b and name = 'Topic 1';
  assert pg_temp.try_as(sec, format(q, b, 'One more')) is null, 'closing one makes room';
end $$;

\echo 'The starter, or a board member or the NEC, renames, closes and reopens a topic'
do $$
declare
  cath uuid := '00000000-0000-0000-0000-0000000000d5';
  rc uuid := '00000000-0000-0000-0000-0000000000d3';
  c uuid := pg_temp.committee('charity');
  ride uuid := pg_temp.committee('ride');
  t uuid;
  t2 uuid;
begin
  -- Cath (charity committee, no board seat) and the NEC read the charity chat.
  t := (select id from conversations where parent_id = c and name = 'Toy run');
  assert pg_temp.try_as(cath, format('select public.rename_topic(%L, %L)', t, ' Toy run 2026 ')) is null, 'the starter renames it';
  assert (select name from conversations where id = t) = 'Toy run 2026', 'trimmed';
  assert pg_temp.try_as(cath, format('select public.rename_topic(%L, %L)', t, '')) = 'Give the topic a name.', 'not to nothing';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d1', format('select public.close_topic(%L)', t)) is null, 'the NEC closes it';
  assert (select closed_at is not null and closed_by = '00000000-0000-0000-0000-0000000000d1' from conversations where id = t), 'closed, by the NEC';
  assert pg_temp.try_as(cath, format('select public.send_message(%L, %L)', t, 'one more thing'))
    = 'This topic is closed. Reopen it to post.', 'nobody posts in a closed topic';
  assert pg_temp.reads(cath, t), 'but it still reads';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d1', format('select public.close_topic(%L)', t)) = 'That topic is already closed.', 'closing twice';
  assert pg_temp.try_as(cath, format('select public.reopen_topic(%L)', t)) is null, 'the starter reopens it';
  assert (select closed_at is null and closed_by is null from conversations where id = t), 'open again';
  assert pg_temp.try_as(cath, format('select public.reopen_topic(%L)', t)) = 'That topic is already open.', 'reopening twice';
  assert pg_temp.value_as(cath, format('select public.send_message(%L, %L)', t, 'Back on'))::uuid is not null, 'and posts again';

  -- In the ride committee chat, a topic Dysco started: another ride committee member who isn't on a
  -- board can't close it. Nora gets a seat on the ride committee for this.
  insert into positions (member_id, chapter_id, role, started_on)
  select '00000000-0000-0000-0000-0000000000d9', id, 'ride_committee', private.club_date() from chapters where slug = 'north';
  t2 := pg_temp.value_as(rc, format('select public.start_topic(%L, %L)', ride, 'Route recce'))::uuid;
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d9', format('select public.close_topic(%L)', t2))
    = 'Only whoever started the topic, or a board member or the NEC, can do that.', 'a committee member who didn''t start it';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d9', format('select public.rename_topic(%L, %L)', t2, 'x'))
    = 'Only whoever started the topic, or a board member or the NEC, can do that.', 'nor rename it';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format('select public.close_topic(%L)', t2))
    = 'That chat is for the ride committee.', 'someone outside the chat is told why';
  assert pg_temp.try_as(rc, format('select public.close_topic(%L)', pg_temp.committee('ride'))) = 'That’s not a topic.', 'only topics close';
end $$;

\echo 'Moderating, reports and website photos in a topic follow its chat'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000d2';
  b uuid := pg_temp.board_of('west');
  t uuid := (select id from conversations where parent_id = pg_temp.board_of('west') and name = 'Raffle');
  m uuid;
  g uuid := (select id from conversations where kind = 'group' and name = 'Big 4 crew');
  gt uuid := (select id from conversations where parent_id = (select id from conversations where kind = 'group' and name = 'Big 4 crew'));
begin
  -- Wes joins West's board for this, so there's someone else's message to tidy.
  insert into positions (member_id, chapter_id, role, started_on)
  select '00000000-0000-0000-0000-0000000000d4', id, 'treasurer', private.club_date() from chapters where slug = 'west';
  m := pg_temp.value_as('00000000-0000-0000-0000-0000000000d4', format('select public.send_message(%L, %L)', t, 'Prizes?'))::uuid;
  assert pg_temp.try_as(sec, format('select public.pin_message(%L, %L)', t, m)) is null, 'West''s board pins in the topic';
  assert pg_temp.try_as(sec, format('select public.remove_message(%L)', m)) is null, 'and removes someone''s message';
  -- A message in a group topic, reported: it goes to the reporter's chapter board, like the group's.
  m := pg_temp.value_as('00000000-0000-0000-0000-0000000000d8', format('select public.send_message(%L, %L)', gt, 'Rude words'))::uuid;
  perform pg_temp.value_as(sec, format('select public.add_to_group(%L, %L::uuid[])', g, '{00000000-0000-0000-0000-0000000000d9}'));
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d9', format('select public.report_message(%L, %L)', m, 'rude')) is null, 'Nora reports it';
  assert jsonb_array_length(pg_temp.value_as('00000000-0000-0000-0000-0000000000d1', 'select public.chat_reports()')::jsonb) = 1,
    'North''s President (Nora''s chapter board) sees it';
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.chat_reports()')::jsonb) = 0, 'West''s board doesn''t';
  assert not private.can_moderate(gt), 'nobody moderates a group topic';
  delete from positions where member_id = '00000000-0000-0000-0000-0000000000d4';
end $$;

\echo 'A topic''s push is titled with its chat and name, and reaches the chat''s people'
-- Pushes are written when the message is saved for good (a deferred trigger), so the messages go in
-- one block and the checks come in the next.
create temp table sent (what text primary key, id uuid);
grant all on sent to authenticated;
do $$
begin
  insert into push_devices (member_id, token, platform)
  select id, 'ExponentPushToken[' || id || ']', 'android' from members where id::text like '00000000-0000-0000-0000-0000000000d%';
  insert into sent values ('boards', pg_temp.value_as('00000000-0000-0000-0000-0000000000d2', format('select public.send_message(%L, %L)',
    (select id from conversations where parent_id = pg_temp.chat('boards') and name = 'Christmas party'), 'Pub or park?'))::uuid);
  insert into sent values ('group', pg_temp.value_as('00000000-0000-0000-0000-0000000000d2', format('select public.send_message(%L, %L)',
    (select id from conversations where parent_id = (select id from conversations where kind = 'group' and name = 'Big 4 crew')), 'Esky''s full'))::uuid);
end $$;
do $$
declare
  t uuid := (select id from conversations where parent_id = pg_temp.chat('boards') and name = 'Christmas party');
  m uuid := (select id from sent where what = 'boards');
  gm uuid := (select id from sent where what = 'group');
begin
  assert (select title from private.push_outbox where dedupe_key = 'chat:' || m and member_id = '00000000-0000-0000-0000-0000000000d3')
    like 'All boards › Christmas party%', 'titled All boards › Christmas party';
  assert (select data ->> 'chatId' from private.push_outbox where dedupe_key = 'chat:' || m and member_id = '00000000-0000-0000-0000-0000000000d3')
    = t::text, 'and opens the topic';
  assert not exists (select 1 from private.push_outbox where dedupe_key = 'chat:' || m and member_id = '00000000-0000-0000-0000-0000000000d4'),
    'a member who can''t read it gets nothing';
  assert exists (select 1 from private.push_outbox where dedupe_key = 'chat:' || gm and member_id = '00000000-0000-0000-0000-0000000000d8'
    and title like 'Big 4 crew › Esky roster%'), 'Fred, in the group, hears the group topic';
  assert not exists (select 1 from private.push_outbox where dedupe_key = 'chat:' || gm and member_id = '00000000-0000-0000-0000-0000000000d1'),
    'the NEC, not in the group, doesn''t';
end $$;

\echo 'Group topic photos stay off the website'
do $$
declare
  gt uuid := (select id from conversations where parent_id = (select id from conversations where kind = 'group' and name = 'Big 4 crew'));
  m uuid;
  mm uuid;
begin
  insert into messages (conversation_id, author_id, body) values (gt, '00000000-0000-0000-0000-0000000000d8', null) returning id into m;
  insert into message_media (message_id, conversation_id, kind, path, width, height, position)
  values (m, gt, 'photo', gt || '/x.jpg', 10, 10, 0) returning id into mm;
  -- Fingers is in the group and on the website photo crew, but it's still a group's photo.
  insert into site_photo_crew (member_id) values ('00000000-0000-0000-0000-0000000000d2');
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format('select public.pick_site_photo(%L, %L, true)', mm, 'x'))
    = 'Photos from group chats stay private.', 'refused';
end $$;

\echo 'ALL CHAT TOPICS CHECKS PASSED'
