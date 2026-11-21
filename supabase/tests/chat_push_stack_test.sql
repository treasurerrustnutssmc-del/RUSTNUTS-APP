-- Checks that chat notifications stack like Messenger: one per chat on the phone, so each new one carries
-- the reader's unread lines for that chat (the latest five, oldest first) and a count in the title.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),   -- West Full, the sender
  ('00000000-0000-0000-0000-0000000000d2', 'sue@example.com', now()),   -- West Secretary (board)
  ('00000000-0000-0000-0000-0000000000d3', 'nora@example.com', now()),  -- North Full
  ('00000000-0000-0000-0000-0000000000d4', 'cap@example.com', now()),   -- North, has blocked Wes
  ('00000000-0000-0000-0000-0000000000d5', 'pres@example.com', now()),  -- North President, no phone saved
  ('00000000-0000-0000-0000-0000000000d6', 'len@example.com', now()),   -- West, chat notifications off
  ('00000000-0000-0000-0000-0000000000d7', 'al@example.com', now()),    -- applied, still pending
  ('00000000-0000-0000-0000-0000000000d9', 'nick@example.com', now());  -- West Introduced (might join)

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes West', 'Wes', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Sue Secretary', null, 'full', 'approved'),
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
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000d5', 'north', 'president')
) as v(member, chapter, role)
join chapters c on c.slug = v.chapter;

insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-0000000000e1', 'app', now() + interval '3 days', 'Coffee run', 'west');

insert into public.member_blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1');

-- Everyone but the president has a phone saved (an applicant can't be saved, but make sure anyway).
insert into public.push_devices (token, member_id, platform)
select 'ExponentPushToken[' || id || ']', id, 'android' from public.members
where id <> '00000000-0000-0000-0000-0000000000d5';

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
               when 'ride' then c.kind = 'ride' and c.ride_id = '00000000-0000-0000-0000-0000000000e1'
          end;
$$;

create function pg_temp.send_as(who uuid, chat uuid, body text) returns uuid language plpgsql as $$
declare msg uuid;
begin
  msg := pg_temp.value_as(who, format('select public.send_message(%L, %L, %L::jsonb, null)', chat, body, '[]'))::uuid;
  set constraints all immediate;
  set constraints all deferred;
  return msg;
end $$;

-- What a member's notification for a message says: title, then body.
create function pg_temp.said(msg uuid, who uuid) returns text language sql as $$
  select o.title || '|' || o.body from private.push_outbox o where o.dedupe_key = 'chat:' || msg and o.member_id = who;
$$;

-- Sends as Wes and lets the notifications go out (they're written when the message is saved for good).
create function pg_temp.send(chat uuid, body text, media jsonb default '[]') returns uuid language plpgsql as $$
declare msg uuid;
begin
  msg := pg_temp.value_as('00000000-0000-0000-0000-0000000000d1',
    format('select public.send_message(%L, %L, %L::jsonb, null)', chat, body, media))::uuid;
  set constraints all immediate;
  set constraints all deferred;
  return msg;
end $$;

create function pg_temp.reached(msg uuid) returns text language sql as $$
  select coalesce(string_agg(m.road_name_or, ',' order by m.road_name_or), '')
  from private.push_outbox o
  cross join lateral (select coalesce(x.road_name, split_part(x.full_name, ' ', 1)) as road_name_or
                      from public.members x where x.id = o.member_id) m
  where o.dedupe_key = 'chat:' || msg;
$$;

\o
\echo 'The first unread message is on its own: the chat''s name and the line, with the line kept for the app''s banner'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  msg uuid;
  o private.push_outbox%rowtype;
begin
  msg := pg_temp.send(pg_temp.chat('club'), 'Who’s up for a ride Sunday?');
  select * into o from private.push_outbox where dedupe_key = 'chat:' || msg and member_id = nora;
  assert o.title = 'Whole club', o.title;
  assert o.body = 'Wes: Who’s up for a ride Sunday?', o.body;
  assert o.data = jsonb_build_object('kind', 'chat', 'chatId', pg_temp.chat('club'), 'line', 'Wes: Who’s up for a ride Sunday?'), o.data::text;
end $$;

\o
\echo 'More unread messages stack into the one notification: a count in the title, every line in the body'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  sue constant uuid := '00000000-0000-0000-0000-0000000000d2';
  msg uuid;
begin
  perform pg_temp.send_as(sue, pg_temp.chat('club'), 'Me');
  msg := pg_temp.send(pg_temp.chat('club'), 'Meet at the servo');
  assert pg_temp.said(msg, nora) = E'Whole club · 3 new messages|Wes: Who’s up for a ride Sunday?\nSue: Me\nWes: Meet at the servo',
    pg_temp.said(msg, nora);
  assert (select data->>'line' from private.push_outbox where dedupe_key = 'chat:' || msg and member_id = nora) = 'Wes: Meet at the servo';
  -- Sue posted one of them herself, so hers counts only what came after.
  assert pg_temp.said(msg, sue) = 'Whole club|Wes: Meet at the servo', pg_temp.said(msg, sue);
end $$;

\o
\echo 'Reading the chat starts the stack again'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  msg uuid;
begin
  assert pg_temp.try_as(nora, format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null;
  msg := pg_temp.send(pg_temp.chat('club'), 'Leaving at 9');
  assert pg_temp.said(msg, nora) = 'Whole club|Wes: Leaving at 9', pg_temp.said(msg, nora);
end $$;

\o
\echo 'Past five unread, the body keeps the latest five and the title still counts them all'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  msg uuid;
begin
  for i in 1..6 loop msg := pg_temp.send(pg_temp.chat('club'), 'msg ' || i); end loop;
  assert pg_temp.said(msg, nora) = E'Whole club · 7 new messages|Wes: msg 2\nWes: msg 3\nWes: msg 4\nWes: msg 5\nWes: msg 6',
    pg_temp.said(msg, nora);
end $$;

\o
\echo 'Removed messages, people they''ve blocked, and anything over a day old stay out of the stack'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  sue constant uuid := '00000000-0000-0000-0000-0000000000d2';
  gone uuid;
  msg uuid;
begin
  assert pg_temp.try_as(nora, format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null;
  gone := pg_temp.send(pg_temp.chat('club'), 'oops wrong chat');
  update public.messages set removed_at = now() where id = gone;
  insert into public.member_blocks (blocker_id, blocked_id) values (nora, sue);
  perform pg_temp.send_as(sue, pg_temp.chat('club'), 'can Nora see this?');
  msg := pg_temp.send(pg_temp.chat('club'), 'Fuel stop at Ballan');
  assert pg_temp.said(msg, nora) = 'Whole club|Wes: Fuel stop at Ballan', pg_temp.said(msg, nora);
  delete from public.member_blocks where blocker_id = nora and blocked_id = sue;

  -- A member who never opens the chat: only the last day counts.
  update public.chat_reads set read_at = now() - interval '3 days' where member_id = nora;
  update public.messages set created_at = now() - interval '2 days'
  where conversation_id = pg_temp.chat('club') and created_at > now() - interval '1 hour';
  msg := pg_temp.send(pg_temp.chat('club'), 'Anyone still about?');
  assert pg_temp.said(msg, nora) = 'Whole club|Wes: Anyone still about?', pg_temp.said(msg, nora);
end $$;

\o
\echo 'A private chat stacks too, titled with the sender and without names on the lines'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  dm uuid := pg_temp.value_as('00000000-0000-0000-0000-0000000000d1',
    format('select public.open_direct_chat(%L)', nora))::uuid;
  msg uuid;
begin
  perform pg_temp.send(dm, 'psst');
  msg := pg_temp.send(dm, 'you there?');
  assert pg_temp.said(msg, nora) = E'Wes · 2 new messages|psst\nyou there?', pg_temp.said(msg, nora);
  -- Replying counts as reading: the next one is on its own.
  perform pg_temp.send_as(nora, dm, 'yep');
  msg := pg_temp.send(dm, 'good');
  assert pg_temp.said(msg, nora) = 'Wes|good', pg_temp.said(msg, nora);
end $$;

\o
\echo 'Each chat has its own stack'
\o /dev/null
do $$
declare
  sue constant uuid := '00000000-0000-0000-0000-0000000000d2';
  msg uuid;
begin
  assert pg_temp.try_as(sue, format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null;
  assert pg_temp.try_as(sue, format('select public.mark_chat_read(%L)', pg_temp.chat('west'))) is null;
  perform pg_temp.send(pg_temp.chat('club'), 'club one');
  msg := pg_temp.send(pg_temp.chat('west'), 'west one');
  assert pg_temp.said(msg, sue) = 'West chapter|Wes: west one', pg_temp.said(msg, sue);
end $$;

\o
\echo 'A stack of long emoji lines stays small enough for a phone push, keeping the newest lines'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  msg uuid;
  o private.push_outbox%rowtype;
begin
  assert pg_temp.try_as(nora, format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null;
  for i in 1..5 loop msg := pg_temp.send(pg_temp.chat('club'), i || repeat('🏍', 200)); end loop;
  select * into o from private.push_outbox where dedupe_key = 'chat:' || msg and member_id = nora;
  assert o.title = 'Whole club · 5 new messages', o.title;
  assert octet_length(o.body) <= 1500, octet_length(o.body)::text;
  assert o.body like '%Wes: 5%', 'the newest line stays';
  assert o.body not like 'Wes: 1%', 'the oldest goes first';
end $$;

\o
\echo 'CHAT PUSH STACK CHECKS PASSED'
