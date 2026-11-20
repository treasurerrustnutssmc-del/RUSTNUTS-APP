-- Checks the All boards chat (every chapter's board and the NEC, following the seats) and group chats
-- (members FNG and up start them, name them and pick the people; only the people in a group see it).
-- Run with: npm run test:db. See docs/superpowers/specs/2026-11-20-chat-groups-design.md.

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'pres@example.com', now()),   -- North President (NEC)
  ('00000000-0000-0000-0000-0000000000c2', 'sec@example.com', now()),    -- West Secretary (board)
  ('00000000-0000-0000-0000-0000000000c3', 'rc@example.com', now()),     -- North Road Captain (board)
  ('00000000-0000-0000-0000-0000000000c4', 'wes@example.com', now()),    -- West Full
  ('00000000-0000-0000-0000-0000000000c5', 'nora@example.com', now()),   -- North Full
  ('00000000-0000-0000-0000-0000000000c6', 'nick@example.com', now()),   -- West Introduced
  ('00000000-0000-0000-0000-0000000000c7', 'kerry@example.com', now()),  -- West Family
  ('00000000-0000-0000-0000-0000000000c8', 'fred@example.com', now()),   -- West FNG
  ('00000000-0000-0000-0000-0000000000c9', 'bob@example.com', now()),    -- West Full, Wes blocked him
  ('00000000-0000-0000-0000-0000000000ca', 'pat@example.com', now());    -- West Full, still pending

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'north', 'Paul President', 'Jiggles', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Sue Secretary', 'Fingers', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c3', 'north', 'Ray Captain', 'Dysco', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c4', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'Nora North', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c6', 'west', 'Nick Newbie', 'Nick', 'introduced', 'approved'),
  ('00000000-0000-0000-0000-0000000000c7', 'west', 'Kerry Mercer', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000c8', 'west', 'Fred Fng', 'Fred', 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000c9', 'west', 'Bob Blocked', 'Bob', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000ca', 'west', 'Pat Pending', 'Pat', 'full', 'pending')
) as v(id, chapter, name, road, status, approval)
join chapters c on c.slug = v.chapter;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, c.id, v.role::position_role, private.club_date()
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'north', 'president'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000c3', 'north', 'road_captain')
) as v(id, chapter, role)
join chapters c on c.slug = v.chapter;

insert into member_blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c9');  -- Wes blocked Bob

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
grant execute on function pg_temp.chat(text) to anon, authenticated;

-- Can this person open the chat? (mark_chat_read runs the same rules as reading.)
create function pg_temp.reads(who uuid, chat uuid) returns boolean language sql as $$
  select pg_temp.value_as(who, format('select count(*) from public.conversations where id = %L', chat)) = '1'
$$;

\o
\echo 'There is one All boards chat'
do $$
begin
  assert (select count(*) from conversations where kind = 'boards') = 1, 'one All boards chat';
  begin
    insert into conversations (kind) values ('boards');
    assert false, 'a second All boards chat is refused';
  exception when unique_violation then null;
  end;
end $$;

\echo 'Every chapter''s board and the NEC read All boards; members, Introduced, Family and pending don''t'
do $$
declare
  b uuid := pg_temp.chat('boards');
  list jsonb;
begin
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000c1', b), 'North President (NEC)';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000c2', b), 'West Secretary';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000c3', b), 'North Road Captain';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c4', b), 'West Full';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c6', b), 'Introduced';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c7', b), 'Family';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000ca', b), 'pending';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c4', format('select public.mark_chat_read(%L)', b))
    = 'That chat is for board members and the NEC.', 'a member is told why';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c4', format('select public.send_message(%L, %L)', b, 'hi'))
    = 'That chat is for board members and the NEC.', 'and can''t post';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000c2', 'select public.chat_list()')::jsonb;
  assert exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'boards'), 'a board member lists it';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000c4', 'select public.chat_list()')::jsonb;
  assert not exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'boards'), 'a member doesn''t';
end $$;

\echo 'Anyone in All boards posts there and tidies it'
do $$
declare
  b uuid := pg_temp.chat('boards');
  m uuid;
begin
  m := pg_temp.value_as('00000000-0000-0000-0000-0000000000c2', format('select public.send_message(%L, %L)', b, 'Both boards, Sunday?'))::uuid;
  assert m is not null, 'West posts';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000c3', format('select public.send_message(%L, %L)', b, 'North''s in'))::uuid is not null, 'North posts';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c3', format('select public.pin_message(%L, %L)', b, m)) is null, 'North pins West''s message';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c3', format('select public.remove_message(%L)', m)) is null, 'and can remove it';
  assert (select removed_at is not null from messages where id = m), 'it is removed';
end $$;

\echo 'All boards follows the seats'
do $$
declare
  b uuid := pg_temp.chat('boards');
begin
  delete from positions where member_id = '00000000-0000-0000-0000-0000000000c3';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c3', b), 'off the board, out of the chat';
  insert into positions (member_id, chapter_id, role, started_on)
  select '00000000-0000-0000-0000-0000000000c4', id, 'treasurer', private.club_date() from chapters where slug = 'west';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000c4', b), 'onto the board, into the chat';
  delete from positions where member_id = '00000000-0000-0000-0000-0000000000c4';
  insert into positions (member_id, chapter_id, role, started_on)
  select '00000000-0000-0000-0000-0000000000c3', id, 'road_captain', private.club_date() from chapters where slug = 'north';
end $$;

\echo 'Board members and the NEC start a group with a name and people; it lists for the people in it only'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  g uuid;
  list jsonb;
  item jsonb;
begin
  g := pg_temp.value_as(sec, format('select public.create_group_chat(%L, %L::uuid[])', '  Big 4 crew  ',
    '{00000000-0000-0000-0000-0000000000c4,00000000-0000-0000-0000-0000000000c5,00000000-0000-0000-0000-0000000000c8}'))::uuid;
  assert g is not null, 'Fingers (West board) starts a group';
  assert (select name from conversations where id = g) = 'Big 4 crew', 'the name is trimmed';
  assert (select created_by from conversations where id = g) = sec, 'Fingers started it';
  assert (select count(*) from conversation_members where conversation_id = g) = 4, 'Fingers and the three picked';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000c5', 'select public.chat_list()')::jsonb;
  select x into item from jsonb_array_elements(list) x where x ->> 'id' = g::text;
  assert item ->> 'kind' = 'group', 'Nora lists it as a group';
  assert item ->> 'name' = 'Big 4 crew', 'with its name';
  assert item ->> 'created_by' = sec::text, 'and who started it';
  assert jsonb_array_length(item -> 'member_ids') = 4, 'and its people';
  assert pg_temp.reads('00000000-0000-0000-0000-0000000000c8', g), 'an FNG in it reads it';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c3', g), 'a board member not in it doesn''t';
  assert not pg_temp.reads('00000000-0000-0000-0000-0000000000c1', g), 'nor the NEC';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c1', format('select public.mark_chat_read(%L)', g))
    = 'That’s a private group.', 'and they''re told why';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000c8', format('select public.send_message(%L, %L)', g, 'Who''s bringing the esky?'))::uuid is not null,
    'an FNG posts in it';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000c1', format('select public.create_group_chat(%L, %L::uuid[])', 'NEC and mates',
    '{00000000-0000-0000-0000-0000000000c4}'))::uuid is not null, 'the NEC starts one too';
end $$;

\echo 'Who can start a group, its name and who can be added, in the app''s words'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  q text := 'select public.create_group_chat(%L, %L::uuid[])';
  nora text := '{00000000-0000-0000-0000-0000000000c5}';
begin
  assert pg_temp.try_as(null, format(q, 'x', nora)) like 'permission denied%', 'signed out';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c4', format(q, 'x', nora)) = 'Only board members and the NEC can start groups.', 'a member';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c8', format(q, 'x', nora)) = 'Only board members and the NEC can start groups.', 'an FNG';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c6', format(q, 'x', nora)) = 'Only board members and the NEC can start groups.', 'Introduced';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c7', format(q, 'x', nora)) = 'Only approved members can do that.', 'Family';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000ca', format(q, 'x', nora)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(sec, format(q, '   ', nora)) = 'Give the group a name.', 'no name';
  assert pg_temp.try_as(sec, format(q, repeat('a', 41), nora)) = 'Keep the name to 40 characters.', 'too long';
  assert pg_temp.try_as(sec, format(q, repeat('🏍', 40), nora)) is null, 'an emoji counts as one';
  assert pg_temp.try_as(sec, format(q, 'x', '{}')) = 'Add at least one other person.', 'nobody';
  assert pg_temp.try_as(sec, format(q, 'x', '{' || sec || '}')) = 'Add at least one other person.', 'only yourself';
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000c6}')) = 'Nick can’t join groups until they’re an FNG.', 'an Introduced';
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000c7}')) = 'Family only use the Family chat, not groups.', 'Family';
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000ca}')) = 'Pat isn’t an approved member.', 'pending';
  insert into member_blocks (blocker_id, blocked_id) values (sec, '00000000-0000-0000-0000-0000000000c9');
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000c9}')) = 'You can’t add Bob.', 'someone Fingers blocked';
  delete from member_blocks where blocker_id = sec;
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000c4,00000000-0000-0000-0000-0000000000c9}')) is null,
    'a block between two others doesn''t stop the starter';
  assert pg_temp.try_as(sec, format(q, 'x', '{00000000-0000-0000-0000-0000000000ff}')) = 'That member no longer exists.', 'nobody by that id';
  assert pg_temp.try_as(sec, format(q, 'x', (select array_agg(gen_random_uuid())::text from generate_series(1, 100)))) = 'A group can have up to 100 people.', 'too many';
end $$;

\echo 'Board members in a group add people, rename it and take people out; anyone leaves'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  wes uuid := '00000000-0000-0000-0000-0000000000c4';
  nora uuid := '00000000-0000-0000-0000-0000000000c5';
  fred uuid := '00000000-0000-0000-0000-0000000000c8';
  rc uuid := '00000000-0000-0000-0000-0000000000c3';
  g uuid := (select id from conversations where name = 'Big 4 crew');
begin
  assert pg_temp.try_as(nora, format('select public.add_to_group(%L, %L::uuid[])', g, '{' || rc || '}'))
    = 'Only board members and the NEC can add people.', 'a member in it can''t add people';
  assert pg_temp.try_as(rc, format('select public.add_to_group(%L, %L::uuid[])', g, '{' || rc || '}'))
    = 'That’s a private group.', 'a board member outside can''t add themselves';
  assert pg_temp.try_as(sec, format('select public.add_to_group(%L, %L::uuid[])', g, '{' || rc || '}')) is null, 'Fingers adds Dysco';
  assert pg_temp.reads(rc, g), 'Dysco is in';
  assert pg_temp.try_as(rc, format('select public.add_to_group(%L, %L::uuid[])', g, '{' || rc || '}')) is null, 'adding someone already in is fine';
  assert (select count(*) from conversation_members where conversation_id = g) = 5, 'and changes nothing';
  assert pg_temp.try_as(rc, format('select public.add_to_group(%L, %L::uuid[])', g, '{00000000-0000-0000-0000-0000000000c6}'))
    = 'Nick can’t join groups until they’re an FNG.', 'adding follows the same rules';
  assert pg_temp.try_as(sec, format('select public.add_to_group(%L, %L::uuid[])', pg_temp.chat('club'), '{' || rc || '}'))
    = 'That’s not a group chat.', 'only groups take people';
  assert pg_temp.try_as(nora, format('select public.rename_group(%L, %L)', g, 'Mine now')) = 'Only board members and the NEC can rename a group.', 'Nora can''t rename it';
  assert pg_temp.try_as(rc, format('select public.rename_group(%L, %L)', g, 'Big 4 or bust')) is null, 'Dysco renames it';
  assert (select name from conversations where id = g) = 'Big 4 or bust', 'renamed';
  assert pg_temp.try_as(rc, format('select public.rename_group(%L, %L)', g, '')) = 'Give the group a name.', 'not to nothing';
  assert pg_temp.try_as(nora, format('select public.remove_from_group(%L, %L)', g, wes))
    = 'Only board members and the NEC can take people out.', 'Nora can''t take people out';
  assert pg_temp.try_as(sec, format('select public.remove_from_group(%L, %L)', g, sec)) = 'Use Leave group to leave.', 'not yourself';
  assert pg_temp.try_as(rc, format('select public.remove_from_group(%L, %L)', g, wes)) is null, 'Dysco takes Wes out';
  assert not pg_temp.reads(wes, g), 'Wes is out';
  assert pg_temp.try_as(rc, format('select public.remove_from_group(%L, %L)', g, wes)) = 'They’re not in that group.', 'only once';
  assert pg_temp.try_as(fred, format('select public.leave_group(%L)', g)) is null, 'Fred leaves';
  assert not pg_temp.reads(fred, g), 'Fred is out';
  assert pg_temp.try_as(fred, format('select public.leave_group(%L)', g)) = 'That’s a private group.', 'he can''t leave twice';
  assert pg_temp.try_as(sec, format('select public.leave_group(%L)', pg_temp.chat('club'))) = 'That’s not a group chat.', 'nobody leaves the whole club';
end $$;

\echo 'Nobody moderates a group: reports go to the reporter''s chapter board'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000c2';
  nora uuid := '00000000-0000-0000-0000-0000000000c5';
  g uuid := (select id from conversations where name = 'Big 4 or bust');
  m uuid;
begin
  m := pg_temp.value_as(sec, format('select public.send_message(%L, %L)', g, 'Something rude'))::uuid;
  assert pg_temp.try_as(sec, format('select public.pin_message(%L, %L)', g, m)) = 'Only moderators can pin messages.', 'no pins';
  assert pg_temp.try_as(nora, format('select public.remove_message(%L)', m)) = 'You can only remove your own messages.', 'Nora can''t remove Fingers''s';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000c3', format('select public.remove_message(%L)', m))
    = 'You can only remove your own messages.', 'nor can a board member in it';
  assert pg_temp.try_as(nora, format('select public.report_message(%L, %L)', m, 'rude')) is null, 'Nora reports it';
  assert jsonb_array_length(pg_temp.value_as('00000000-0000-0000-0000-0000000000c1', 'select public.chat_reports()')::jsonb) = 1,
    'North''s board (Nora''s chapter) sees the report';
  assert jsonb_array_length(pg_temp.value_as(sec, 'select public.chat_reports()')::jsonb) = 0,
    'West''s board doesn''t';
end $$;

\echo 'Group photos stay off the website; pushes carry the group''s name'
do $$
begin
  assert private.chat_push_title((select c from conversations c where kind = 'boards'), (select m from members m limit 1)) = 'All boards', 'All boards';
  assert private.chat_push_title((select c from conversations c where name = 'Big 4 or bust'), (select m from members m limit 1)) = 'Big 4 or bust', 'a group';
  assert position('Photos from group chats stay private.' in pg_get_functiondef('public.pick_site_photo(uuid, text, boolean)'::regprocedure)) > 0,
    'the website photo pick refuses group photos';
end $$;

\echo 'Groups hold a name and only groups do'
do $$
begin
  begin
    insert into conversations (kind) values ('group');
    assert false, 'a group needs a name';
  exception when check_violation then null;
  end;
  begin
    insert into conversations (kind, name) values ('club', 'x');
    assert false, 'other chats have none';
  exception when check_violation then null;
  end;
end $$;

\echo 'CHAT GROUP CHECKS PASSED'
