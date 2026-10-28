-- Checks the club chats: who reads which chat and its photos, that nothing is written directly,
-- every chat action's rules (with the app's words), the chat list, unread counts and the photo feeds.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),      -- West Full, Ride Committee
  ('00000000-0000-0000-0000-0000000000d2', 'sec@example.com', now()),      -- West Secretary (board)
  ('00000000-0000-0000-0000-0000000000d3', 'nora@example.com', now()),     -- North Full
  ('00000000-0000-0000-0000-0000000000d4', 'cap@example.com', now()),      -- North Road Captain (board)
  ('00000000-0000-0000-0000-0000000000d5', 'pres@example.com', now()),     -- North President (NEC)
  ('00000000-0000-0000-0000-0000000000d6', 'len@example.com', now()),      -- West Legacy
  ('00000000-0000-0000-0000-0000000000d7', 'applicant@example.com', now()),-- pending
  ('00000000-0000-0000-0000-0000000000d8', 'stranger@example.com', now()), -- signed in, no record
  ('00000000-0000-0000-0000-0000000000d9', 'nick@example.com', now());     -- West Introduced (might join)

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Sue Secretary', 'Sec', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'north', 'Nora North', 'Nora', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'Cal Captain', 'Cap', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d5', 'north', 'Pat President', 'Pres', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d6', 'west', 'Len Legacy', 'Len', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'Al Applicant', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Nick Newbie', 'Nick', 'introduced', 'approved')
) as v(id, chapter, name, road, status, approval)
join chapters c on c.slug = v.chapter;

insert into positions (member_id, chapter_id, role, started_on)
select v.member::uuid, c.id, v.role::position_role, private.club_date()
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000d5', 'north', 'president')
) as v(member, chapter, role)
join chapters c on c.slug = v.chapter;

insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-0000000000e1', 'app', now() + interval '3 days', 'Coffee run', 'west'),
  ('00000000-0000-0000-0000-0000000000e2', 'app', now() - interval '10 days', 'Old run', 'club');
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'going'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'going'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d3', 'no');

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

-- Runs a query as someone and returns its first value as text (errors are raised).
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

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.count_as(uuid, text)
  to anon, authenticated;

-- Handy ids.
create function pg_temp.chat(k text) returns uuid language sql as $$
  select c.id from conversations c left join chapters ch on ch.id = c.chapter_id
  where (k = 'club' and c.kind = 'club')
     or (k = 'nec' and c.kind = 'nec')
     or (k = 'committee' and c.kind = 'committee' and c.committee = 'ride')
     or (k = 'charity' and c.kind = 'committee' and c.committee = 'charity')
     or (c.kind = 'chapter' and ch.slug = k)
     or (c.kind = 'board' and 'board:' || ch.slug = k)
     or (c.kind = 'ride' and c.ride_id::text = k)
$$;
grant execute on function pg_temp.chat(text) to anon, authenticated;

\o
\echo 'The whole-club, NEC, committee, chapter, big table and ride chats make themselves'
do $$
begin
  assert (select count(*) from conversations where kind = 'club') = 1, 'one whole-club chat';
  assert (select count(*) from conversations where kind = 'nec') = 1, 'one NEC chat';
  assert (select count(*) from conversations where kind = 'chapter') = (select count(*) from chapters), 'one per chapter';
  assert (select count(*) from conversations where kind = 'board') = (select count(*) from chapters), 'a big table per chapter';
  assert (select count(*) from conversations where kind = 'committee' and committee = 'ride') = 1, 'the ride committee';
  assert (select count(*) from conversations where kind = 'committee' and committee = 'charity') = 1, 'the charity committee';
  assert (select count(*) from conversations where kind = 'ride') = (select count(*) from rides), 'one per ride';
  insert into chapters (slug, name, area) values ('east', 'East', 'Eastern Melbourne');
  assert (select count(*) from conversations c join chapters ch on ch.id = c.chapter_id where ch.slug = 'east') = 2, 'a new chapter gets a chat and a big table';
  insert into rides (id, source, starts_at, title, category) values
    ('00000000-0000-0000-0000-0000000000e3', 'app', now() + interval '40 days', 'Later run', 'club');
  assert pg_temp.chat('00000000-0000-0000-0000-0000000000e3') is not null, 'a new ride gets one';
end $$;

\echo 'Who reads which chat'
do $$
begin
  -- club, West, ride committee, 3 rides
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d1', 'conversations') = 6, 'West member on the ride committee';
  -- club, North, 3 rides
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d3', 'conversations') = 5, 'North member';
  -- club, North, North big table, ride committee, 3 rides
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d4', 'conversations') = 7, 'North Road Captain';
  -- club, West, West big table, 3 rides
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d2', 'conversations') = 6, 'West Secretary';
  -- club, NEC, 3 chapters, 3 big tables, 2 committees, 3 rides
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d5', 'conversations') = 13, 'the NEC';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d6', 'conversations') = 5, 'Legacy: club, West, rides';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d7', 'conversations') in (0, -1), 'an applicant sees none';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d8', 'conversations') in (0, -1), 'a stranger sees none';
  assert pg_temp.count_as(null, 'conversations') in (0, -1), 'the public sees none';
  assert pg_temp.count_as(null, 'messages') in (0, -1), 'nor messages';
end $$;

\echo 'Messages and their words'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  send text := 'select public.send_message(%L, %L, %L::jsonb, %L)';
  hello uuid;
begin
  hello := pg_temp.value_as(wes, format(send, pg_temp.chat('club'), 'G''day all', '[]', null))::uuid;
  assert hello is not null, 'sent';
  assert (select body from messages where id = hello) = 'G''day all', 'kept as typed';
  assert pg_temp.value_as(wes, format(send, pg_temp.chat('club'), '  trimmed  ', '[]', null))::uuid is not null, 'trimmed';
  assert exists (select 1 from messages where body = 'trimmed'), 'ends trimmed';
  assert pg_temp.try_as(nora, format(send, pg_temp.chat('club'), 'Morning', '[]', hello)) is null, 'a reply';
  assert (select reply_to_id from messages where body = 'Morning') = hello, 'linked to the earlier one';

  assert pg_temp.try_as(nora, format(send, pg_temp.chat('west'), 'hi', '[]', null)) = 'That chat is for West chapter members.', 'other chapter';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), '   ', '[]', null)) = 'Write something or add a photo.', 'empty';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), repeat('x', 4001), '[]', null)) = 'Keep it under 4,000 characters.', 'long';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), repeat('x', 4000), '[]', null)) is null, '4,000 is fine';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), 'x', (select jsonb_agg(jsonb_build_object('path', 'p' || i)) from generate_series(1, 11) i), null))
    = 'Up to 10 photos or videos at a time.', 'eleven photos';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('west'), 'x', '[]', hello)) = 'No such message.', 'a reply from another chat';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', format(send, pg_temp.chat('club'), 'x', '[]', null))
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d8', format(send, pg_temp.chat('club'), 'x', '[]', null))
    = 'Only approved members can do that.', 'stranger';
  assert pg_temp.try_as(wes, format(send, '00000000-0000-0000-0000-0000000000ff', 'x', '[]', null)) = 'No such chat.', 'no chat';
  assert pg_temp.try_as(null, format(send, pg_temp.chat('club'), 'x', '[]', null)) is not null, 'the public can''t';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('committee'), 'Route for Sunday?', '[]', null)) is null, 'ride committee';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format(send, pg_temp.chat('committee'), 'x', '[]', null))
    = 'That chat is for the ride committee.', 'a secretary isn''t on it';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('charity'), 'x', '[]', null)) = 'That chat is for the charity committee.', 'charity committee';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('board:west'), 'x', '[]', null)) = 'That chat is for the West board.', 'big table';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format(send, pg_temp.chat('board:west'), 'Agenda?', '[]', null)) is null, 'the board';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format(send, pg_temp.chat('board:west'), 'x', '[]', null))
    = 'That chat is for the West board.', 'not the other chapter''s board';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format(send, pg_temp.chat('nec'), 'x', '[]', null)) = 'That chat is for the NEC.', 'NEC';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d5', format(send, pg_temp.chat('nec'), 'Chairs, meeting?', '[]', null)) is null, 'a President';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), '', jsonb_build_array(jsonb_build_object('path', 'https://media2.giphy.com/media/v1.Y2lk/abc123/giphy.gif?cid=1a2b&rid=giphy.gif&ct=g', 'kind', 'gif', 'width', 220, 'height', 160)), null)) is null, 'a GIF';
  assert pg_temp.try_as(wes, format(send, pg_temp.chat('club'), '', jsonb_build_array(jsonb_build_object('path', 'https://evil.example/x.gif', 'kind', 'gif')), null))
    = 'That photo didn’t upload properly. Try again.', 'only GIPHY GIFs';
end $$;

\echo 'Nothing is written straight into the chat tables'
do $$
declare wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
begin
  assert pg_temp.try_as(wes, format($q$insert into messages (conversation_id, author_id, body) values (%L, %L, 'sneaky')$q$, pg_temp.chat('club'), wes)) is not null, 'insert message';
  assert pg_temp.try_as(wes, $q$update messages set body = 'edited'$q$) is not null, 'update message';
  assert pg_temp.try_as(wes, $q$delete from messages$q$) is not null, 'delete message';
  assert pg_temp.try_as(wes, $q$insert into conversations (kind) values ('club')$q$) is not null, 'make a chat';
  assert pg_temp.try_as(wes, $q$update conversations set pinned_message_id = null$q$) is not null, 'unpin directly';
  assert pg_temp.try_as(wes, format($q$insert into conversation_members values (%L, %L)$q$, pg_temp.chat('west'), wes)) is not null, 'join a chat';
  assert pg_temp.try_as(wes, $q$insert into message_reactions (message_id, member_id, emoji) select id, member_id, '🍺' from (select id, author_id as member_id from messages limit 1) m$q$) is not null, 'react directly';
  assert pg_temp.try_as(wes, format($q$insert into chat_reads values (%L, %L, now())$q$, pg_temp.chat('club'), wes)) is not null, 'mark read directly';
  assert pg_temp.try_as(wes, format($q$insert into member_blocks (blocker_id, blocked_id) values (%L, %L)$q$, wes, '00000000-0000-0000-0000-0000000000d3')) is not null, 'block directly';
  assert pg_temp.count_as(wes, 'message_reports') = -1, 'reports only through the actions';
  assert (select count(*) from messages where body = 'sneaky') = 0, 'nothing got in';
end $$;

\echo 'Photos: upload into a chat you can post to, attach once, and read only what you can see'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  west uuid := pg_temp.chat('west');
  club uuid := pg_temp.chat('club');
  upload text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$;
  send text := 'select public.send_message(%L, %L, %L::jsonb, null)';
  m uuid;
begin
  assert pg_temp.try_as(wes, format(upload, west || '/a.jpg', wes, wes)) is null, 'upload into your chapter chat';
  assert pg_temp.try_as(wes, format(upload, west || '/poster.jpg', wes, wes)) is null, 'and a still';
  assert pg_temp.try_as(wes, format(upload, west || '/v.mp4', wes, wes)) is null, 'and a video';
  assert pg_temp.try_as(nora, format(upload, west || '/n.jpg', nora, nora)) is not null, 'not into another chapter''s';
  assert pg_temp.try_as(nora, format(upload, 'not-a-chat/n.jpg', nora, nora)) is not null, 'not outside a chat';
  assert pg_temp.try_as(nora, format(upload, club || '/n.jpg', nora, nora)) is null, 'Nora into the club chat';
  assert pg_temp.count_as(wes, 'storage.objects') = 3, 'your own unsent uploads are yours to see';
  assert pg_temp.count_as(nora, $q$storage.objects where name like '%/a.jpg'$q$) = 0, 'not someone else''s unsent';

  m := pg_temp.value_as(wes, format(send, west, '',
    jsonb_build_array(
      jsonb_build_object('path', west || '/a.jpg', 'kind', 'photo', 'width', 2048, 'height', 1536),
      jsonb_build_object('path', west || '/v.mp4', 'kind', 'video', 'posterPath', west || '/poster.jpg', 'width', 1080, 'height', 1920, 'durationMs', 12000))))::uuid;
  assert (select count(*) from message_media where message_id = m) = 2, 'a photo-only message';
  assert (select array_agg(kind::text order by position) from message_media where message_id = m) = '{photo,video}', 'in order';

  assert pg_temp.try_as(wes, format(send, west, 'again', jsonb_build_array(jsonb_build_object('path', west || '/a.jpg', 'kind', 'photo'))))
    = 'That photo didn’t upload properly. Try again.', 'a file goes in once';
  assert pg_temp.try_as(wes, format(send, west, 'theirs', jsonb_build_array(jsonb_build_object('path', club || '/n.jpg', 'kind', 'photo'))))
    = 'That photo didn’t upload properly. Try again.', 'not another chat''s folder';
  assert pg_temp.try_as(wes, format(send, club, 'theirs', jsonb_build_array(jsonb_build_object('path', club || '/n.jpg', 'kind', 'photo'))))
    = 'That photo didn’t upload properly. Try again.', 'not someone else''s upload';
  assert pg_temp.try_as(wes, format(send, club, 'ghost', jsonb_build_array(jsonb_build_object('path', club || '/ghost.jpg', 'kind', 'photo'))))
    = 'That photo didn’t upload properly. Try again.', 'not a file that isn''t there';
  assert pg_temp.try_as(nora, format(send, club, 'pdf', jsonb_build_array(jsonb_build_object('path', club || '/n.jpg', 'kind', 'pdf'))))
    = 'That photo didn’t upload properly. Try again.', 'photos and videos only';

  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d6', $q$storage.objects where name like '%/a.jpg'$q$) = 1, 'a West member sees it';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d5', $q$storage.objects where name like '%/poster.jpg'$q$) = 1, 'the NEC sees it';
  assert pg_temp.count_as(nora, $q$storage.objects where name like '%/a.jpg'$q$) = 0, 'North doesn''t';
  assert pg_temp.count_as(nora, format('message_media where message_id = %L', m)) = 0, 'nor its details';
  assert pg_temp.try_as(wes, format($q$delete from storage.objects where name = %L$q$, west || '/a.jpg')) is null, 'deleting a sent file does nothing';
  assert (select count(*) from storage.objects where name = west || '/a.jpg') = 1, 'a sent file can''t be deleted';
end $$;

\echo 'Odd uploads: phones send fractions, GIFs repeat, a file goes in once'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  club uuid := pg_temp.chat('club');
  upload text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$;
  send text := 'select public.send_message(%L, %L, %L::jsonb, null)';
  gif jsonb := jsonb_build_object('path', 'https://media.giphy.com/media/xyz/giphy.gif', 'kind', 'gif', 'width', 200, 'height', 150);
  m uuid;
begin
  perform pg_temp.try_as(wes, format(upload, club || '/iphone.mov', wes, wes));
  perform pg_temp.try_as(wes, format(upload, club || '/iphone.jpg', wes, wes));
  m := pg_temp.value_as(wes, format(send, club, '', jsonb_build_array(jsonb_build_object(
    'path', club || '/iphone.mov', 'kind', 'video', 'posterPath', club || '/iphone.jpg',
    'width', 1079.5, 'height', 1920.2, 'durationMs', 12345.666))))::uuid;
  assert (select duration_ms from message_media where message_id = m) = 12346, 'an iPhone video length, rounded';
  assert (select width from message_media where message_id = m) = 1080, 'and its size';
  perform pg_temp.try_as(wes, format('select public.remove_message(%L)', m));  -- out of the photo feed checks below

  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(gif, gif))) is null, 'the same GIF twice in one message';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(gif))) is null, 'and again later';

  perform pg_temp.try_as(wes, format(upload, club || '/twice.jpg', wes, wes));
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(
    jsonb_build_object('path', club || '/twice.jpg', 'kind', 'photo'), jsonb_build_object('path', club || '/twice.jpg', 'kind', 'photo'))))
    = 'That photo didn’t upload properly. Try again.', 'one file twice in one message';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(
    jsonb_build_object('path', club || '/twice.jpg', 'kind', 'video', 'posterPath', club || '/twice.jpg'))))
    = 'That photo didn’t upload properly. Try again.', 'a video can''t be its own still';
end $$;

\echo 'Signed-in members only reach the helpers the access rules need'
do $$
begin
  assert has_function_privilege('authenticated', 'private.can_read_chat(uuid)', 'execute'), 'the read rule';
  assert not has_function_privilege('authenticated', 'private.remove_message_now(uuid, uuid)', 'execute'), 'not removing without checks';
  assert not has_function_privilege('authenticated', 'private.add_roster_position(uuid, uuid, public.position_role)', 'execute'), 'the roster''s second lock stays';
end $$;

\echo 'Removing: your own, or as a moderator of that chat'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  sec constant uuid := '00000000-0000-0000-0000-0000000000d2';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  cap constant uuid := '00000000-0000-0000-0000-0000000000d4';
  pres constant uuid := '00000000-0000-0000-0000-0000000000d5';
  send text := 'select public.send_message(%L, %L, ''[]''::jsonb, null)';
  remove text := 'select public.remove_message(%L)';
  a uuid; b uuid; c uuid; d uuid; photo uuid;
begin
  a := pg_temp.value_as(wes, format(send, pg_temp.chat('west'), 'one'))::uuid;
  b := pg_temp.value_as(wes, format(send, pg_temp.chat('west'), 'two'))::uuid;
  c := pg_temp.value_as(nora, format(send, pg_temp.chat('club'), 'three'))::uuid;
  d := pg_temp.value_as(nora, format(send, pg_temp.chat('club'), 'four'))::uuid;
  perform pg_temp.value_as(sec, format('select public.toggle_reaction(%L, %L)', a, '🔥'));

  assert pg_temp.try_as(nora, format(remove, c)) is null, 'your own';
  assert pg_temp.try_as(wes, format(remove, d)) = 'You can only remove your own messages.', 'someone else''s';
  assert pg_temp.try_as(cap, format(remove, a)) = 'That chat is for West chapter members.', 'the other chapter''s board';
  assert pg_temp.try_as(sec, format(remove, a)) is null, 'the chapter''s board';
  assert pg_temp.try_as(pres, format(remove, b)) is null, 'the NEC';
  assert pg_temp.try_as(sec, format(remove, d)) is null, 'any board member, in the whole-club chat';
  assert pg_temp.try_as(sec, format(remove, d)) = 'That message was removed.', 'twice';
  assert pg_temp.try_as(sec, format(remove, '00000000-0000-0000-0000-0000000000ff')) = 'No such message.', 'missing';
  assert (select body is null and removed_at is not null and removed_by = sec from messages where id = a), 'its words are gone';
  assert not exists (select 1 from message_reactions where message_id = a), 'and its reactions';

  select m.id into photo from messages m join message_media mm on mm.message_id = m.id where mm.kind = 'photo' limit 1;
  assert pg_temp.try_as(wes, format(remove, photo)) is null, 'a photo message';
  assert pg_temp.count_as(wes, format('message_media where message_id = %L', photo)) = 0, 'its photos'' details are hidden';
  assert pg_temp.count_as(wes, $q$storage.objects where bucket_id = 'chat-media' and name like '%/a.jpg'$q$) = 0, 'and the files, even from the poster';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d6', $q$storage.objects where name like '%/v.mp4'$q$) = 0, 'and everyone else';
end $$;

\echo 'Reactions come from the set, one each, on messages still there'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  react text := 'select public.toggle_reaction(%L, %L)';
  m uuid := pg_temp.value_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'beers?'))::uuid;
  stamp timestamptz := (select updated_at from messages where id = m);
begin
  assert pg_temp.try_as(wes, format(react, m, '🍺')) is null, 'on';
  assert (select count(*) from message_reactions where message_id = m) = 1, 'one';
  assert (select updated_at from messages where id = m) >= stamp, 'the message is touched so phones hear about it';
  assert pg_temp.try_as(wes, format(react, m, '🍺')) is null, 'tap again';
  assert (select count(*) from message_reactions where message_id = m) = 0, 'off again';
  assert pg_temp.try_as(wes, format(react, m, '🙂')) = 'Pick one of the reactions.', 'not in the set';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d4', format(react, pg_temp.value_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('west'), 'west only')), '🔥'))
    = 'That chat is for West chapter members.', 'a chat you can''t read';
  assert pg_temp.try_as(wes, format(react, (select id from messages where removed_at is not null limit 1), '🔥')) = 'That message was removed.', 'removed';
end $$;

\echo 'Private chats: two people, one chat each pair'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  open_dm text := 'select public.open_direct_chat(%L)';
  dm uuid := pg_temp.value_as(wes, format(open_dm, nora))::uuid;
begin
  assert pg_temp.value_as(wes, format(open_dm, nora))::uuid = dm, 'the same chat again';
  assert pg_temp.value_as(nora, format(open_dm, wes))::uuid = dm, 'from either side';
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', dm, 'psst')) is null, 'send';
  assert pg_temp.count_as(nora, format('messages where conversation_id = %L', dm)) = 1, 'Nora reads it';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d5', format('messages where conversation_id = %L', dm)) = 0, 'not even the NEC';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d5', format('select public.send_message(%L, %L, ''[]''::jsonb, null)', dm, 'hi'))
    = 'That’s a private chat.', 'nor posts in it';
  assert pg_temp.try_as(wes, format(open_dm, wes)) = 'You can’t message yourself.', 'yourself';
  assert pg_temp.try_as(wes, format(open_dm, '00000000-0000-0000-0000-0000000000d7')) = 'They’re not an approved member.', 'an applicant';
  assert pg_temp.try_as(wes, format(open_dm, '00000000-0000-0000-0000-0000000000ff')) = 'That member no longer exists.', 'nobody';
  assert pg_temp.try_as(wes, format('select public.remove_message(%L)', (select id from messages where body = 'psst'))) is null, 'remove your own';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format('select public.pin_message(%L, null)', dm))
    = 'That’s a private chat.', 'no pins from outside';
end $$;

\echo 'Someone who might join: the whole-club and ride chats only'
do $$
declare
  nick constant uuid := '00000000-0000-0000-0000-0000000000d9';
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  send text := 'select public.send_message(%L, %L, ''[]''::jsonb, null)';
begin
  assert pg_temp.count_as(nick, 'conversations') = pg_temp.count_as('00000000-0000-0000-0000-0000000000d6', 'conversations') - 1,
    'what a Legacy member sees, less the chapter chat';
  assert pg_temp.try_as(nick, format(send, pg_temp.chat('club'), 'g''day all')) is null, 'says hello to the club';
  assert pg_temp.try_as(nick, format(send, pg_temp.chat('00000000-0000-0000-0000-0000000000e1'), 'see you there')) is null, 'and on a ride';
  assert pg_temp.try_as(nick, format(send, pg_temp.chat('west'), 'hi')) = 'Chapter chats open up once you’re an FNG.', 'not the chapter';
  assert pg_temp.try_as(nick, format('select public.open_direct_chat(%L)', wes)) = 'Private chats open up once you’re an FNG.', 'no private chats';
  assert pg_temp.try_as(wes, format('select public.open_direct_chat(%L)', nick))
    = 'They can’t get private messages until they’re an FNG.', 'either way';
end $$;

\echo 'Blocks: private to the blocker, and they close the private chat both ways'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  dm uuid := pg_temp.value_as(wes, format('select public.open_direct_chat(%L)', nora))::uuid;
begin
  assert pg_temp.try_as(nora, format('select public.set_block(%L, true)', wes)) is null, 'block';
  assert pg_temp.try_as(nora, format('select public.set_block(%L, true)', wes)) is null, 'twice is fine';
  assert pg_temp.count_as(nora, 'member_blocks') = 1, 'Nora sees her block';
  assert pg_temp.count_as(wes, 'member_blocks') = 0, 'Wes doesn''t';
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', dm, 'oi')) = 'You can’t message them.', 'blocked';
  assert pg_temp.try_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', dm, 'oi')) = 'You can’t message them.', 'blocker too';
  assert pg_temp.try_as(wes, format('select public.open_direct_chat(%L)', nora)) = 'You can’t message them.', 'no fresh chat either';
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'group is fine')) is null, 'group chats carry on';
  assert pg_temp.try_as(nora, format('select public.set_block(%L, true)', nora)) = 'You can’t block yourself.', 'yourself';
  assert pg_temp.try_as(nora, format('select public.set_block(%L, false)', wes)) is null, 'unblock';
  assert pg_temp.try_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', dm, 'sorry')) is null, 'open again';
  perform pg_temp.value_as(nora, format('select public.set_block(%L, true)', wes));
end $$;

\echo 'Pins: moderators only, one per chat'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000d2';
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  pin text := 'select public.pin_message(%L, %L)';
  m uuid := pg_temp.value_as(sec, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('west'), 'Meeting Sunday 10 am'))::uuid;
begin
  assert pg_temp.try_as(sec, format(pin, pg_temp.chat('west'), m)) is null, 'pinned';
  assert (select pinned_message_id from conversations where id = pg_temp.chat('west')) = m, 'there';
  assert pg_temp.try_as(wes, format(pin, pg_temp.chat('west'), m)) = 'Only moderators can pin messages.', 'not a moderator';
  assert pg_temp.try_as(sec, format(pin, pg_temp.chat('club'), m)) = 'No such message.', 'a message from another chat';
  assert pg_temp.try_as(sec, format(pin, pg_temp.chat('west'), (select id from messages where removed_at is not null and conversation_id = pg_temp.chat('west') limit 1)))
    = 'That message was removed.', 'removed';
  assert pg_temp.try_as(sec, format('select public.remove_message(%L)', m)) is null, 'remove the pinned message';
  assert (select pinned_message_id from conversations where id = pg_temp.chat('west')) is null, 'removing it takes the pin down';
  assert pg_temp.try_as(sec, format(pin, pg_temp.chat('west'), null)) is null, 'unpin';
end $$;

\echo 'Reports go to whoever can act on them'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  sec constant uuid := '00000000-0000-0000-0000-0000000000d2';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  cap constant uuid := '00000000-0000-0000-0000-0000000000d4';
  report text := 'select public.report_message(%L, %L)';
  club_msg uuid := pg_temp.value_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'rude thing'))::uuid;
  mine uuid := pg_temp.value_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'my thing'))::uuid;
  dm_msg uuid;
  r uuid;
begin
  perform pg_temp.value_as(nora, format('select public.set_block(%L, false)', wes));
  dm_msg := pg_temp.value_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)',
    pg_temp.value_as(nora, format('select public.open_direct_chat(%L)', wes)), 'nasty dm'))::uuid;

  assert pg_temp.try_as(wes, format(report, club_msg, 'Not on')) is null, 'report';
  assert pg_temp.try_as(wes, format(report, club_msg, 'Still not on')) is null, 'again just updates it';
  assert (select count(*) from message_reports where message_id = club_msg) = 1, 'one report per person';
  assert pg_temp.try_as(wes, format(report, mine, '')) = 'You can’t report your own message.', 'your own';
  assert pg_temp.try_as(wes, format(report, club_msg, repeat('x', 501))) = 'Keep the reason under 500 characters.', 'long reason';
  assert pg_temp.try_as(wes, format(report, dm_msg, '')) is null, 'a private message';

  assert pg_temp.value_as(sec, 'select jsonb_array_length(public.chat_reports())')::int = 2, 'Wes''s chapter board sees both';
  assert pg_temp.value_as(cap, 'select jsonb_array_length(public.chat_reports())')::int = 1, 'North''s board: the whole-club one only';
  assert pg_temp.value_as(wes, 'select jsonb_array_length(public.chat_reports())')::int = 0, 'a member sees none';
  assert pg_temp.value_as(sec, $q$select public.chat_reports()->0->'message'->>'body'$q$) is not null, 'with what was said';

  r := (select id from message_reports where message_id = dm_msg);
  assert pg_temp.try_as(wes, format('select public.resolve_report(%L, true)', r)) = 'Only moderators can do that.', 'not a moderator';
  assert pg_temp.try_as(cap, format('select public.resolve_report(%L, true)', r)) = 'Only moderators can do that.', 'not the other chapter';
  assert pg_temp.try_as(sec, format('select public.resolve_report(%L, true)', r)) is null, 'removed by the board';
  assert (select removed_at is not null from messages where id = dm_msg), 'gone';
  assert pg_temp.try_as(sec, format('select public.resolve_report(%L, false)', r)) = 'That report was already dealt with.', 'once';
  assert pg_temp.try_as(cap, format('select public.resolve_report(%L, false)', (select id from message_reports where message_id = club_msg))) is null, 'dismissed';
  assert (select removed_at is null from messages where id = club_msg), 'kept';
  assert pg_temp.try_as(wes, format(report, club_msg, 'Still not on, I said')) is null, 'reporting again';
  assert (select resolved_at is not null from message_reports where message_id = club_msg), 'doesn''t reopen a dealt-with report';
  assert pg_temp.try_as(sec, format('select public.resolve_report(%L, false)', '00000000-0000-0000-0000-0000000000ff')) = 'No such report.', 'missing';
end $$;

-- Reads chat_list() as someone.
create function pg_temp.list_as(who uuid) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select public.chat_list() into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;
grant execute on function pg_temp.list_as(uuid) to authenticated;

\echo 'The chat list: your chats, ride chats in their window, last message and unread count'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  said text := pg_temp.value_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'anyone up?'));
  list jsonb := pg_temp.list_as(wes);
  rides text[] := array(select c->'ride'->>'title' from jsonb_array_elements(list) c where c->>'kind' = 'ride');
  club jsonb := (select c from jsonb_array_elements(list) c where c->>'kind' = 'club');
begin
  assert rides = '{Coffee run}', 'the upcoming ride you''re going to, not last fortnight''s or one you haven''t answered';
  assert (select count(*) from jsonb_array_elements(list) c where c->>'kind' = 'direct') = 1, 'your private chat';
  assert (select count(*) from jsonb_array_elements(list) c where c->>'kind' = 'committee') = 1, 'the ride committee';
  assert (club->>'unread')::int > 0, 'unread from others';
  assert club->'last'->>'body' = 'anyone up?', 'the last message';
  assert (select count(*) from jsonb_array_elements(pg_temp.list_as(nora)) c where c->>'kind' = 'ride') = 0, 'Nora said no';
  assert pg_temp.try_as(wes, format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null, 'mark read';
  assert ((select c from jsonb_array_elements(pg_temp.list_as(wes)) c where c->>'kind' = 'club')->>'unread')::int = 0, 'nothing unread';
  perform pg_temp.value_as(nora, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'still up'));
  assert ((select c from jsonb_array_elements(pg_temp.list_as(wes)) c where c->>'kind' = 'club')->>'unread')::int = 1, 'one new';
  perform pg_temp.value_as(wes, format('select public.send_message(%L, %L, ''[]''::jsonb, null)', pg_temp.chat('club'), 'yep'));
  assert ((select c from jsonb_array_elements(pg_temp.list_as(wes)) c where c->>'kind' = 'club')->>'unread')::int = 0, 'writing counts as reading';
  assert pg_temp.try_as(nora, format('select public.mark_chat_read(%L)', pg_temp.chat('west'))) = 'That chat is for West chapter members.', 'not a chat you can''t read';
end $$;

\echo 'Ride chats: there for every member, from the ride'
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
begin
  assert pg_temp.value_as(nora, $q$select public.ride_chat('00000000-0000-0000-0000-0000000000e1')$q$)::uuid
    = pg_temp.chat('00000000-0000-0000-0000-0000000000e1'), 'Nora opens it from the ride';
  assert pg_temp.try_as(nora, $q$select public.ride_chat('00000000-0000-0000-0000-0000000000ff')$q$) = 'No such ride.', 'no ride';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', $q$select public.ride_chat('00000000-0000-0000-0000-0000000000e1')$q$)
    = 'Only approved members can do that.', 'applicant';
end $$;

\echo 'Photo feeds: never private chats, never removed messages, never someone you blocked'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  ride_chat uuid := pg_temp.chat('00000000-0000-0000-0000-0000000000e2');
  dm uuid := pg_temp.value_as(wes, format('select public.open_direct_chat(%L)', nora))::uuid;
  upload text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$;
  send text := 'select public.send_message(%L, '''', %L::jsonb, null)';
  feed jsonb;
begin
  perform pg_temp.try_as(wes, format(upload, ride_chat || '/r1.jpg', wes, wes));
  perform pg_temp.try_as(wes, format(upload, ride_chat || '/r2.jpg', wes, wes));
  perform pg_temp.try_as(wes, format(upload, dm || '/secret.jpg', wes, wes));
  perform pg_temp.try_as(nora, format(upload, ride_chat || '/nora.jpg', nora, nora));
  perform pg_temp.value_as(wes, format(send, ride_chat, jsonb_build_array(jsonb_build_object('path', ride_chat || '/r1.jpg', 'kind', 'photo', 'width', 10, 'height', 10))));
  perform pg_temp.value_as(wes, format(send, ride_chat, jsonb_build_array(jsonb_build_object('path', ride_chat || '/r2.jpg', 'kind', 'photo', 'width', 10, 'height', 10))));
  perform pg_temp.value_as(wes, format(send, dm, jsonb_build_array(jsonb_build_object('path', dm || '/secret.jpg', 'kind', 'photo', 'width', 10, 'height', 10))));
  perform pg_temp.value_as(nora, format(send, ride_chat, jsonb_build_array(jsonb_build_object('path', ride_chat || '/nora.jpg', 'kind', 'photo', 'width', 10, 'height', 10))));

  feed := pg_temp.value_as(wes, 'select public.club_photos(null, 50)')::jsonb;
  assert jsonb_array_length(feed) = 3, 'the ride photos';
  assert not exists (select 1 from jsonb_array_elements(feed) f where f->>'path' like '%secret%'), 'not the private one';
  assert (feed->0->>'path') like '%nora.jpg', 'newest first';
  assert jsonb_array_length(pg_temp.value_as(wes, format('select public.club_photos(%L, 50)', feed->0->>'created_at'))::jsonb) = 2, 'older ones by page';

  perform pg_temp.value_as(wes, format('select public.set_block(%L, true)', nora));
  assert jsonb_array_length(pg_temp.value_as(wes, 'select public.club_photos(null, 50)')::jsonb) = 2, 'not someone you blocked';
  perform pg_temp.value_as(wes, format('select public.set_block(%L, false)', nora));

  assert pg_temp.value_as(wes, $q$select public.ride_walls()->0->'ride'->>'title'$q$) = 'Old run', 'a ride wall';
  assert pg_temp.value_as(wes, $q$select (public.ride_walls()->0->>'count')$q$)::int = 3, 'with its count';
  assert pg_temp.value_as(wes, $q$select jsonb_array_length(public.ride_wall('00000000-0000-0000-0000-0000000000e2')->'media')$q$)::int = 3, 'and its photos';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000d7', 'select public.club_photos(null, 50)') = '[]', 'an applicant gets nothing';
end $$;

\echo 'Link previews: members read what is kept, only the Edge Function keeps them'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
begin
  assert pg_temp.value_as(wes, $q$select public.link_preview('https://example.com/')::text$q$) = '{"found": false}', 'nothing kept yet';
  assert pg_temp.try_as(wes, $q$select public.save_link_preview('https://example.com/', '{"title": "x"}')$q$) is not null, 'members can''t keep one';
  set local role service_role;
  perform public.save_link_preview('https://example.com/', '{"title": "Example"}');
  reset role;
  assert pg_temp.value_as(wes, $q$select public.link_preview('https://example.com/')->'preview'->>'title'$q$) = 'Example', 'kept';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', $q$select public.link_preview('https://example.com/')$q$)
    = 'Only approved members can do that.', 'not for applicants';
  update private.link_previews set fetched_at = now() - interval '8 days';
  assert pg_temp.value_as(wes, $q$select public.link_preview('https://example.com/')->>'found'$q$) = 'false', 'a week on, fetched again';
end $$;

\echo 'Voice notes: on their own, up to two minutes, an .m4a or .webm file, never in the photo feeds'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  club uuid := pg_temp.chat('club');
  wall uuid := pg_temp.chat('00000000-0000-0000-0000-0000000000e2');
  upload text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$;
  send text := 'select public.send_message(%L, %L, %L::jsonb, null)';
  voice jsonb;
  photos int;
  walled int;
  m uuid;
begin
  assert (select allowed_mime_types @> array['audio/mp4', 'audio/webm'] from storage.buckets where id = 'chat-media'), 'the bucket takes recordings';
  assert (select cardinality(allowed_mime_types) from storage.buckets where id = 'chat-media') = 7, 'added once, the photo and video types kept';
  perform pg_temp.try_as(wes, format(upload, club || '/' || f, wes, wes))
  from unnest(array['v1.m4a', 'v2.webm', 'v3.ogg', 'v4.m4a', 'v5.m4a', 'p.jpg', 'still.jpg']) f;
  perform pg_temp.try_as(wes, format(upload, wall || '/w.m4a', wes, wes));
  photos := jsonb_array_length(pg_temp.value_as(wes, 'select public.club_photos(null, 200)')::jsonb);
  walled := pg_temp.value_as(wes, $q$select jsonb_array_length(public.ride_wall('00000000-0000-0000-0000-0000000000e2')->'media')$q$)::int;

  voice := jsonb_build_object('path', club || '/v1.m4a', 'kind', 'voice', 'durationMs', 8400.4);
  assert pg_temp.try_as(wes, format(send, club, 'listen', jsonb_build_array(voice))) = 'A voice note goes on its own.', 'no words with it';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice, jsonb_build_object('path', club || '/p.jpg', 'kind', 'photo'))))
    = 'A voice note goes on its own.', 'no photos with it';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice - 'durationMs'))) = 'That voice note didn’t record properly. Try again.', 'it has a length';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || '{"durationMs": 0}'))) = 'That voice note didn’t record properly. Try again.', 'more than none';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || '{"durationMs": "long"}'))) = 'That voice note didn’t record properly. Try again.', 'a number';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || '{"durationMs": 120001}'))) = 'Voice notes can be up to 2 minutes.', 'two minutes at most';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || jsonb_build_object('path', club || '/v3.ogg'))))
    = 'That photo didn’t upload properly. Try again.', 'an .m4a or .webm file';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || jsonb_build_object('posterPath', club || '/still.jpg'))))
    = 'That photo didn’t upload properly. Try again.', 'no still';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || jsonb_build_object('path', club || '/ghost.m4a'))))
    = 'That photo didn’t upload properly. Try again.', 'a file that''s there';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', format(send, club, '', jsonb_build_array(voice))) = 'Only approved members can do that.', 'members only';

  m := pg_temp.value_as(wes, format(send, club, '  ', jsonb_build_array(voice)))::uuid;
  assert (select kind::text || ' ' || duration_ms from message_media where message_id = m) = 'voice 8400', 'sent, its length kept';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice))) = 'That photo didn’t upload properly. Try again.', 'a recording goes in once';
  assert pg_temp.try_as(wes, format(send, club, '', jsonb_build_array(voice || jsonb_build_object('path', club || '/v2.webm', 'durationMs', 120000)))) is null, 'a WebM of two minutes exactly';
  assert pg_temp.value_as(wes, $q$select f->'last'->>'voice' from jsonb_array_elements(public.chat_list()) f where f->>'kind' = 'club'$q$) = 'true', 'the list says so';
  perform pg_temp.value_as(wes, format(send, club, 'words again', '[]'));
  assert pg_temp.value_as(wes, $q$select f->'last'->>'voice' from jsonb_array_elements(public.chat_list()) f where f->>'kind' = 'club'$q$) = 'false', 'and not for words';

  perform pg_temp.value_as(wes, format(send, wall, '', jsonb_build_array(jsonb_build_object('path', wall || '/w.m4a', 'kind', 'voice', 'durationMs', 3000))));
  assert jsonb_array_length(pg_temp.value_as(wes, 'select public.club_photos(null, 200)')::jsonb) = photos, 'not in Photos';
  assert pg_temp.value_as(wes, $q$select jsonb_array_length(public.ride_wall('00000000-0000-0000-0000-0000000000e2')->'media')$q$)::int = walled, 'not on the ride wall';
  assert not exists (select 1 from jsonb_array_elements(pg_temp.value_as(wes, 'select public.ride_walls()')::jsonb) w
                     where w->'cover'->>'kind' = 'voice'), 'never a cover';

  -- One from a year ago today, as if it had been sent then.
  update messages set created_at = now() - interval '1 year' where id = m;
  assert not exists (select 1 from jsonb_array_elements(pg_temp.value_as(wes, 'select public.photos_on_this_day()')::jsonb) f where f->>'kind' = 'voice'),
    'not in On this day';
end $$;
