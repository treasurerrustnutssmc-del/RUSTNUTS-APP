-- Checks "Seen by" on chat messages: chat_seen gives everyone else who reads a chat and when they last
-- saw it (their last look, or their own post since), so a message can say who has seen it.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),   -- West Full, the sender
  ('00000000-0000-0000-0000-0000000000d2', 'sue@example.com', now()),   -- West Full, never opens anything
  ('00000000-0000-0000-0000-0000000000d3', 'nora@example.com', now()),  -- North Full
  ('00000000-0000-0000-0000-0000000000d4', 'cap@example.com', now()),   -- North, has blocked Wes
  ('00000000-0000-0000-0000-0000000000d6', 'len@example.com', now()),   -- West Legacy, answers without opening
  ('00000000-0000-0000-0000-0000000000d7', 'al@example.com', now()),    -- applied, still pending
  ('00000000-0000-0000-0000-0000000000d8', 'kim@example.com', now()),   -- Family
  ('00000000-0000-0000-0000-0000000000d9', 'nick@example.com', now());  -- West Introduced (might join)

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Sue South', 'Sue', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'north', 'Nora North', 'Nora', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'Cal Captain', 'Cap', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d6', 'west', 'Len Legacy', 'Len', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'Al Applicant', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000d8', 'west', 'Kim Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Nick Newbie', 'Nick', 'introduced', 'approved')
) as v(id, chapter, name, road, status, approval)
join chapters c on c.slug = v.chapter;

insert into public.member_blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1');

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

create function pg_temp.chat(k text) returns uuid language sql as $$
  select c.id from public.conversations c left join public.chapters ch on ch.id = c.chapter_id
  where case k when 'club' then c.kind = 'club'
               when 'west' then c.kind = 'chapter' and ch.slug = 'west'
          end;
$$;

-- Who a member's chat_seen lists, by road name (or first name), with "+" for seen and "-" for not.
create function pg_temp.seen_as(who uuid, chat uuid) returns text language plpgsql as $$
begin
  return pg_temp.value_as(who, format($q$
    select coalesce(string_agg(coalesce(m.road_name, split_part(m.full_name, ' ', 1)) || case when s.seen_at is null then '-' else '+' end,
                               ',' order by coalesce(m.road_name, split_part(m.full_name, ' ', 1))), '')
    from public.chat_seen(%L) s join public.members m on m.id = s.member_id
  $q$, chat));
end $$;

\o
\echo 'Everyone else who reads the whole-club chat is listed; nobody has seen it before they open it'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  got text;
begin
  got := pg_temp.seen_as(wes, pg_temp.chat('club'));
  -- Not Wes himself, not Cap (blocked Wes), not Al (pending), not Kim (Family has the Family chat only).
  assert got = 'Len-,Nick-,Nora-,Sue-', got;
end $$;

\o
\echo 'Opening the chat or posting in it counts as having seen it, at that time'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  len constant uuid := '00000000-0000-0000-0000-0000000000d6';
  posted timestamptz;
  read timestamptz;
  seen timestamptz;
begin
  perform pg_temp.try_as(nora, format('select public.mark_chat_read(%L)', pg_temp.chat('club')));
  perform pg_temp.value_as(len, format('select public.send_message(%L, %L, %L::jsonb, null)', pg_temp.chat('club'), 'On my way', '[]'));
  assert pg_temp.seen_as(wes, pg_temp.chat('club')) = 'Len+,Nick-,Nora+,Sue-', pg_temp.seen_as(wes, pg_temp.chat('club'));

  select read_at into read from public.chat_reads where member_id = nora and conversation_id = pg_temp.chat('club');
  seen := pg_temp.value_as(wes, format('select seen_at from public.chat_seen(%L) where member_id = %L', pg_temp.chat('club'), nora))::timestamptz;
  assert seen = read, format('%s vs %s', seen, read);

  select max(created_at) into posted from public.messages where author_id = len and conversation_id = pg_temp.chat('club');
  seen := pg_temp.value_as(wes, format('select seen_at from public.chat_seen(%L) where member_id = %L', pg_temp.chat('club'), len))::timestamptz;
  -- Sending marks the chat read for the sender too, a moment after the message.
  assert seen >= posted, format('%s vs %s', seen, posted);

  -- Whichever is later wins: a newer look beats an older post.
  perform pg_temp.try_as(len, format('select public.mark_chat_read(%L)', pg_temp.chat('club')));
  select read_at into read from public.chat_reads where member_id = len and conversation_id = pg_temp.chat('club');
  seen := pg_temp.value_as(wes, format('select seen_at from public.chat_seen(%L) where member_id = %L', pg_temp.chat('club'), len))::timestamptz;
  assert seen = read and read >= posted, format('%s vs %s', seen, read);
end $$;

\o
\echo 'A chapter chat lists its own chapter only, and not an Introduced member'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  got text;
begin
  got := pg_temp.seen_as(wes, pg_temp.chat('west'));
  assert got = 'Len-,Sue-', got;
end $$;

\o
\echo 'A private chat lists just the other person; whoever blocked or was blocked is left out both ways'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  cap constant uuid := '00000000-0000-0000-0000-0000000000d4';
  dm uuid;
  got text;
begin
  dm := pg_temp.value_as(wes, format('select public.open_direct_chat(%L)', nora))::uuid;
  got := pg_temp.seen_as(wes, dm);
  assert got = 'Nora-', got;
  got := pg_temp.seen_as(nora, dm);
  assert got = 'Wes-', got;
  -- Cap blocked Wes: Wes isn't on Cap's list either.
  got := pg_temp.seen_as(cap, pg_temp.chat('club'));
  assert got = 'Len+,Nick-,Nora+,Sue-', got;
end $$;

\o
\echo 'Only people who read the chat can ask'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  al constant uuid := '00000000-0000-0000-0000-0000000000d7';
  kim constant uuid := '00000000-0000-0000-0000-0000000000d8';
  nick constant uuid := '00000000-0000-0000-0000-0000000000d9';
  err text;
begin
  err := pg_temp.try_as(nora, format('select * from public.chat_seen(%L)', pg_temp.chat('west')));
  assert err = 'That chat is for West chapter members.', err;
  err := pg_temp.try_as(al, format('select * from public.chat_seen(%L)', pg_temp.chat('club')));
  assert err = 'Only approved members can do that.', err;
  err := pg_temp.try_as(kim, format('select * from public.chat_seen(%L)', pg_temp.chat('club')));
  assert err = 'Family can only use the Family chat.', err;
  err := pg_temp.try_as(nick, format('select * from public.chat_seen(%L)', pg_temp.chat('west')));
  assert err = 'Chapter chats open up once you’re an FNG.', err;
  err := pg_temp.try_as(null, format('select * from public.chat_seen(%L)', pg_temp.chat('club')));
  assert err like 'permission denied%', err;
end $$;

\o
\echo 'Asking leaves the asker signed in as themselves (the check signs in as each reader in turn)'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  still boolean;
begin
  perform set_config('request.jwt.claim.sub', wes::text, true);
  set local role authenticated;
  select bool_and(auth.uid() = wes) into still from public.chat_seen(pg_temp.chat('club'));
  assert still, 'auth.uid() changed while the rows were made';
  assert current_setting('request.jwt.claim.sub', true) = wes::text, current_setting('request.jwt.claim.sub', true);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

\o
\echo 'Other people''s last looks stay private: chat_reads still shows each member only their own'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  n int;
begin
  n := pg_temp.value_as(wes, 'select count(*) from public.chat_reads where member_id <> auth.uid()')::int;
  assert n = 0, n::text;
end $$;

\o
\echo 'CHAT SEEN CHECKS PASSED'
