-- Checks the Family chat: one club-wide chat that members and Family accounts share, where Family see
-- nothing else, the club rules for chats and posts, reports, blocks and moderation apply, and Family
-- see only the names of people who've posted there. Run with: npm run test:db
-- See docs/superpowers/specs/2026-11-03-family-chat-design.md.

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'wes@example.com', now()),    -- West Full
  ('00000000-0000-0000-0000-0000000000b2', 'sec@example.com', now()),    -- West Secretary (board)
  ('00000000-0000-0000-0000-0000000000b3', 'nora@example.com', now()),   -- North Full
  ('00000000-0000-0000-0000-0000000000b4', 'kerry@example.com', now()),  -- Family (West)
  ('00000000-0000-0000-0000-0000000000b5', 'jo@example.com', now()),     -- Family (North), not agreed to the rules
  ('00000000-0000-0000-0000-0000000000b6', 'nick@example.com', now()),   -- West Introduced (might join)
  ('00000000-0000-0000-0000-0000000000b7', 'pam@example.com', now()),    -- Family, still pending
  ('00000000-0000-0000-0000-0000000000b8', 'len@example.com', now());    -- West Legacy

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000b1', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'west', 'Sue Secretary', 'Sec', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'north', 'Nora North', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'west', 'Kerry Mercer', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000b5', 'north', 'Jo North', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000b6', 'west', 'Nick Newbie', 'Nick', 'introduced', 'approved'),
  ('00000000-0000-0000-0000-0000000000b7', 'west', 'Pam Pending', null, 'family', 'pending'),
  ('00000000-0000-0000-0000-0000000000b8', 'west', 'Len Legacy', 'Len', 'legacy', 'approved')
) as v(id, chapter, name, road, status, approval)
join chapters c on c.slug = v.chapter;
update members set posting_rules_accepted_on = null where id = '00000000-0000-0000-0000-0000000000b5';

insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000b2', id, 'secretary', private.club_date() from chapters where slug = 'west';

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

\o
\echo 'There is one Family chat'
do $$
begin
  assert (select count(*) from conversations where kind = 'family') = 1, 'one Family chat';
  begin
    insert into conversations (kind) values ('family');
    assert false, 'a second Family chat is refused';
  exception when unique_violation then null;
  end;
end $$;

\echo 'Members (FNG and up, Legacy too, every chapter) and Family read it; Introduced, pending and strangers don’t'
do $$
declare
  fam uuid := pg_temp.chat('family');
  q text := format('select count(*) from public.conversations where id = %L', fam);
begin
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b1', q) = '1', 'West member';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b3', q) = '1', 'North member';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b8', q) = '1', 'Legacy';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b4', q) = '1', 'Family';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b6', q) = '0', 'Introduced';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b7', q) = '0', 'pending Family';
  assert pg_temp.try_as(null, q) like 'permission denied%', 'signed out';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b6', format('select public.mark_chat_read(%L)', fam))
    = 'That chat opens up once you’re an FNG.', 'Introduced are told why';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000b7', format('select public.mark_chat_read(%L)', fam))
    = 'Only approved members can do that.', 'pending are told why';
end $$;

\echo 'Family see the Family chat and no other'
do $$
declare
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
  list jsonb;
begin
  assert pg_temp.value_as(kerry, 'select count(*) from public.conversations') = '1', 'one chat by the table';
  list := pg_temp.value_as(kerry, 'select public.chat_list()')::jsonb;
  assert jsonb_array_length(list) = 1, 'one chat in the list';
  assert list -> 0 ->> 'kind' = 'family', 'and it’s Family';
  assert pg_temp.try_as(kerry, format('select public.mark_chat_read(%L)', pg_temp.chat('club')))
    = 'Family can only use the Family chat.', 'the whole-club chat is closed to them';
  assert pg_temp.try_as(kerry, format('select public.send_message(%L, %L)', pg_temp.chat('club'), 'hi'))
    = 'Family can only use the Family chat.', 'and they can’t post there';
  assert pg_temp.try_as(kerry, format('select public.open_direct_chat(%L)', '00000000-0000-0000-0000-0000000000b1'))
    = 'Only approved members can do that.', 'no private chats';
  -- Members see it in their list alongside the rest.
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000b1', 'select public.chat_list()')::jsonb;
  assert exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'family'), 'members list it';
  assert exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'club'), 'with the whole club';
  list := pg_temp.value_as('00000000-0000-0000-0000-0000000000b6', 'select public.chat_list()')::jsonb;
  assert not exists (select 1 from jsonb_array_elements(list) x where x ->> 'kind' = 'family'), 'Introduced don’t';
end $$;

\echo 'Family and members post, reply and react there; Family agree to the club rules first'
do $$
declare
  fam uuid := pg_temp.chat('family');
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
  jo uuid := '00000000-0000-0000-0000-0000000000b5';
  wes uuid := '00000000-0000-0000-0000-0000000000b1';
  m1 uuid;
  m2 uuid;
begin
  m1 := pg_temp.value_as(wes, format('select public.send_message(%L, %L)', fam, 'BBQ Sunday, bring the kids'))::uuid;
  assert m1 is not null, 'a member posts';
  m2 := pg_temp.value_as(kerry, format('select public.send_message(%L, %L, %L::jsonb, %L)', fam, 'We’ll bring salad', '[]', m1))::uuid;
  assert m2 is not null, 'Family post a reply';
  assert pg_temp.try_as(kerry, format('select public.toggle_reaction(%L, %L)', m1, '👍')) is null, 'Family react';
  assert pg_temp.try_as(kerry, format('select public.mark_chat_read(%L)', fam)) is null, 'Family mark it read';

  assert pg_temp.try_as(jo, format('select public.send_message(%L, %L)', fam, 'hello'))
    = 'Agree to the club rules for chats and posts first.', 'not agreed: refused';
  assert pg_temp.try_as(jo, 'select public.accept_posting_rules()') is null, 'Family can agree';
  assert (select posting_rules_accepted_on from members where id = jo) is not null;
  assert pg_temp.try_as(jo, format('select public.send_message(%L, %L)', fam, 'hello')) is null, 'then post';
  assert pg_temp.value_as(kerry, format('select count(*) from public.messages where conversation_id = %L', fam)) = '3', 'Family read every message';
end $$;

\echo 'Family remove only their own; the board moderates; Family never moderate'
do $$
declare
  fam uuid := pg_temp.chat('family');
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
  wes uuid := '00000000-0000-0000-0000-0000000000b1';
  sec uuid := '00000000-0000-0000-0000-0000000000b2';
  mine uuid;
  his uuid;
begin
  mine := pg_temp.value_as(kerry, format('select public.send_message(%L, %L)', fam, 'oops'))::uuid;
  his := pg_temp.value_as(wes, format('select public.send_message(%L, %L)', fam, 'anyone got a trailer?'))::uuid;
  assert pg_temp.try_as(kerry, format('select public.remove_message(%L)', mine)) is null, 'their own';
  assert pg_temp.try_as(kerry, format('select public.remove_message(%L)', his)) = 'You can only remove your own messages.', 'not his';
  assert pg_temp.try_as(kerry, format('select public.pin_message(%L, %L)', fam, his)) = 'Only moderators can pin messages.', 'no pins';
  assert pg_temp.try_as(wes, format('select public.pin_message(%L, %L)', fam, his)) = 'Only moderators can pin messages.', 'plain members don’t pin';
  assert pg_temp.try_as(sec, format('select public.pin_message(%L, %L)', fam, his)) is null, 'the board pins';
end $$;

\echo 'Family report and block; the board deals with the report'
do $$
declare
  fam uuid := pg_temp.chat('family');
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
  nora uuid := '00000000-0000-0000-0000-0000000000b3';
  sec uuid := '00000000-0000-0000-0000-0000000000b2';
  bad uuid;
  rep uuid;
begin
  bad := pg_temp.value_as(nora, format('select public.send_message(%L, %L)', fam, 'something rude'))::uuid;
  rep := pg_temp.value_as(kerry, format('select public.report_message(%L, %L)', bad, 'Not for the kids'))::uuid;
  assert rep is not null, 'Family report';
  assert (pg_temp.value_as(kerry, 'select public.my_open_reports()')::jsonb) @> jsonb_build_array(jsonb_build_object('kind', 'message', 'target_id', bad)), 'and see their report';
  assert pg_temp.value_as(kerry, 'select public.chat_reports()') = '[]', 'but no report queue';
  assert (pg_temp.value_as(sec, 'select public.chat_reports()')::jsonb) @> jsonb_build_array(jsonb_build_object('id', rep)), 'the board sees it';
  assert pg_temp.try_as(kerry, format('select public.resolve_report(%L, true)', rep)) = 'Only approved members can do that.', 'Family can’t act on it';

  assert pg_temp.try_as(kerry, format('select public.set_block(%L, true)', nora)) is null, 'Family block';
  assert pg_temp.value_as(kerry, 'select count(*) from public.member_blocks') = '1', 'and see their block';
  assert not exists (
    select 1 from jsonb_array_elements(pg_temp.value_as(kerry, 'select public.chat_list()')::jsonb) x
    where x -> 'last' ->> 'author_id' = nora::text), 'a blocked author’s message isn’t their last';

  assert pg_temp.try_as(sec, format('select public.resolve_report(%L, true)', rep)) is null, 'the board removes it';
  assert (select removed_at from messages where id = bad) is not null;
end $$;

\echo 'Family see the names of people who posted in the Family chat, and nothing more about them'
do $$
declare
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
  people jsonb := pg_temp.value_as(kerry, 'select public.family_chat_people()')::jsonb;
begin
  -- Wes, Kerry, Jo and Nora posted. Sec only pinned, Len and Nick said nothing (yet).
  assert jsonb_array_length(people) = 4, people::text;
  assert people @> '[{"id": "00000000-0000-0000-0000-0000000000b1", "road_name": "Wes", "first_name": "Wes"}]', 'road name and first name';
  assert people @> '[{"id": "00000000-0000-0000-0000-0000000000b3", "road_name": null, "first_name": "Nora"}]', 'a first name only';
  assert not exists (select 1 from jsonb_array_elements(people) p where p ? 'full_name' or p ? 'phone' or p ? 'email'), 'no full names or contact details';
  assert not (people @> '[{"id": "00000000-0000-0000-0000-0000000000b2"}]'), 'not someone who never posted there';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b1', 'select public.family_chat_people()') = '[]', 'members use the directory';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000b7', 'select public.family_chat_people()') = '[]', 'pending get nothing';
  assert pg_temp.value_as(kerry, 'select count(*) from public.members') = '1', 'the directory stays shut to Family';
end $$;

\echo 'Someone who only reacted still has a name for Family'
do $$
declare
  len uuid := '00000000-0000-0000-0000-0000000000b8';
  first_msg uuid := (select m.id from messages m join conversations c on c.id = m.conversation_id
                     where c.kind = 'family' and m.removed_at is null order by m.created_at limit 1);
begin
  assert pg_temp.try_as(len, format('select public.toggle_reaction(%L, %L)', first_msg, '🍺')) is null, 'Len reacts';
  assert (pg_temp.value_as('00000000-0000-0000-0000-0000000000b4', 'select public.family_chat_people()')::jsonb)
    @> '[{"id": "00000000-0000-0000-0000-0000000000b8", "road_name": "Len"}]', 'and Family see his name';
end $$;

\echo 'Family chat photos stay off the club website'
do $$
declare
  sec uuid := '00000000-0000-0000-0000-0000000000b2';
  msg uuid := pg_temp.value_as('00000000-0000-0000-0000-0000000000b1', format('select public.send_message(%L, %L)', pg_temp.chat('family'), 'the kids at the BBQ'))::uuid;
  photo uuid;
begin
  insert into positions (member_id, chapter_id, role, started_on)
  select sec, id, 'social_media_officer', private.club_date() from chapters where slug = 'west';
  insert into message_media (message_id, conversation_id, kind, path, width, height)
  values (msg, pg_temp.chat('family'), 'photo', pg_temp.chat('family') || '/kids.jpg', 800, 600) returning id into photo;
  assert pg_temp.try_as(sec, format('select public.pick_site_photo(%L, null, true)', photo))
    = 'Photos from the Family chat stay off the website.', 'refused';
end $$;

\echo 'Pushes call it Family and reach Family with a phone saved'
do $$
declare
  fam public.conversations%rowtype;
begin
  select * into fam from conversations where kind = 'family';
  assert private.chat_push_title(fam, (select m from members m where id = '00000000-0000-0000-0000-0000000000b1')) = 'Family';
  assert private.member_can_read_chat('00000000-0000-0000-0000-0000000000b4', fam.id), 'Family can get its notifications';
  assert not private.member_can_read_chat('00000000-0000-0000-0000-0000000000b4', pg_temp.chat('club')), 'but not the whole club’s';
end $$;

\echo 'Suspending a Family person shuts them out at once'
do $$
declare
  kerry uuid := '00000000-0000-0000-0000-0000000000b4';
begin
  update members set approval = 'suspended' where id = kerry;
  assert pg_temp.value_as(kerry, 'select count(*) from public.conversations') = '0', 'no chat';
  assert pg_temp.value_as(kerry, 'select public.chat_list()') = '[]', 'empty list';
  assert pg_temp.try_as(kerry, format('select public.send_message(%L, %L)', pg_temp.chat('family'), 'hi'))
    = 'Only approved members can do that.', 'no posting';
end $$;

\echo 'Family chat checks passed'
