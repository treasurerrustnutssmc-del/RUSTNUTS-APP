-- Checks chat notifications: who each new chat message reaches (the chat's own readers with a phone
-- saved, never the sender, nobody blocked, nobody who switched chat off or has the chat open), the
-- words on it, and the chat setting. Run with: npm run test:db

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
\echo 'A whole-club message reaches the readers with a phone saved, except the sender, anyone blocked, and anyone who switched chat off'
\o /dev/null
do $$
declare
  msg uuid;
  o private.push_outbox%rowtype;
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d6', 'select public.save_notification_prefs(true, true, false, true, true, false)') is null,
    'Len switches chat notifications off';
  msg := pg_temp.send(pg_temp.chat('club'), 'Who’s up for a ride Sunday?');
  assert pg_temp.reached(msg) = 'Nick,Nora,Sue', pg_temp.reached(msg);
  select * into o from private.push_outbox where dedupe_key = 'chat:' || msg and member_id = '00000000-0000-0000-0000-0000000000d3';
  assert o.title = 'Whole club', o.title;
  assert o.body = 'Wes: Who’s up for a ride Sunday?', o.body;
  assert o.data = jsonb_build_object('kind', 'chat', 'chatId', pg_temp.chat('club')), o.data::text;
  assert o.status = 'held', 'held while push is switched off, like every other push';
end $$;

\o
\echo 'A chapter chat reaches only that chapter (and the NEC), and not someone who might join'
\o /dev/null
do $$
declare msg uuid;
begin
  msg := pg_temp.send(pg_temp.chat('west'), 'Meeting moved to 7');
  assert pg_temp.reached(msg) = 'Sue', pg_temp.reached(msg);
  assert (select title from private.push_outbox where dedupe_key = 'chat:' || msg) = 'West chapter';
end $$;

\o
\echo 'A ride chat is called after the ride'
\o /dev/null
do $$
declare msg uuid;
begin
  msg := pg_temp.send(pg_temp.chat('ride'), 'Fuel at Ravenhall first');
  assert (select title from private.push_outbox where dedupe_key = 'chat:' || msg limit 1) = 'Coffee run';
end $$;

\o
\echo 'A private chat reaches only the other person, titled with the sender''s name'
\o /dev/null
do $$
declare
  dm uuid := pg_temp.value_as('00000000-0000-0000-0000-0000000000d1',
    format('select public.open_direct_chat(%L)', '00000000-0000-0000-0000-0000000000d3'))::uuid;
  msg uuid;
begin
  msg := pg_temp.send(dm, 'psst');
  assert pg_temp.reached(msg) = 'Nora', pg_temp.reached(msg);
  assert (select title || '|' || body from private.push_outbox where dedupe_key = 'chat:' || msg) = 'Wes|psst';
end $$;

\o
\echo 'Someone with the chat open in the last minute isn''t buzzed for every reply'
\o /dev/null
do $$
declare msg uuid;
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d2', format('select public.mark_chat_read(%L)', pg_temp.chat('club'))) is null;
  msg := pg_temp.send(pg_temp.chat('club'), 'Sunday it is');
  assert pg_temp.reached(msg) = 'Nick,Nora', pg_temp.reached(msg);
  update public.chat_reads set read_at = now() - interval '5 minutes' where member_id = '00000000-0000-0000-0000-0000000000d2';
  msg := pg_temp.send(pg_temp.chat('club'), 'Bring a jacket');
  assert pg_temp.reached(msg) = 'Nick,Nora,Sue', 'five minutes later they hear it again';
end $$;

\o
\echo 'Long messages are cut short; photos and GIFs say what was sent'
\o /dev/null
do $$
declare msg uuid;
begin
  msg := pg_temp.send(pg_temp.chat('club'), repeat('vroom ', 60));
  assert (select char_length(body) from private.push_outbox where dedupe_key = 'chat:' || msg limit 1) = 140;
  assert (select body like 'Wes: vroom vroom%…' from private.push_outbox where dedupe_key = 'chat:' || msg limit 1);
  msg := pg_temp.send(pg_temp.chat('club'), '', '[{"kind": "gif", "path": "https://media.giphy.com/media/abc/giphy.gif"}]');
  assert (select body from private.push_outbox where dedupe_key = 'chat:' || msg limit 1) = 'Wes sent a GIF',
    (select body from private.push_outbox where dedupe_key = 'chat:' || msg limit 1);
  msg := pg_temp.send(pg_temp.chat('club'), 'Look', '[{"kind": "gif", "path": "https://media.giphy.com/media/abc/giphy.gif"}]');
  assert (select body from private.push_outbox where dedupe_key = 'chat:' || msg limit 1) = 'Wes: Look', 'words win over the GIF';
  -- A voice note (sent on its own; written directly here, as the recording's storage checks aren't the point).
  insert into public.messages (id, conversation_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000f9', pg_temp.chat('club'), '00000000-0000-0000-0000-0000000000d1', null);
  insert into public.message_media (message_id, conversation_id, kind, path, duration_ms)
  values ('00000000-0000-0000-0000-0000000000f9', pg_temp.chat('club'), 'voice', pg_temp.chat('club') || '/note.m4a', 4000);
  set constraints all immediate;
  set constraints all deferred;
  assert (select body from private.push_outbox where dedupe_key = 'chat:00000000-0000-0000-0000-0000000000f9' limit 1) = 'Wes sent a voice note',
    (select body from private.push_outbox where dedupe_key = 'chat:00000000-0000-0000-0000-0000000000f9' limit 1);
end $$;

\o
\echo 'Working out who hears it never changes who is signed in'
\o /dev/null
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  perform public.send_message(pg_temp.chat('club'), 'still me?', '[]', null);
  set constraints all immediate;
  set constraints all deferred;
  assert auth.uid() = '00000000-0000-0000-0000-0000000000d1', 'still Wes';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

\o
\echo 'The chat setting: on by default, saved with the rest, left alone by older app builds'
\o /dev/null
do $$
declare
  sue constant uuid := '00000000-0000-0000-0000-0000000000d2';
begin
  assert pg_temp.try_as(sue, 'select public.save_notification_prefs(true, true, false, true)') is null, 'a four-setting save';
  assert (select chat_messages from public.notification_prefs where member_id = sue), 'on unless switched off';
  assert pg_temp.try_as(sue, 'select public.save_notification_prefs(true, true, false, true, true, false)') is null;
  assert not (select chat_messages from public.notification_prefs where member_id = sue), 'switched off';
  assert pg_temp.try_as(sue, 'select public.save_notification_prefs(true, false, false, true, false)') is null, 'a five-setting save';
  assert (select not chat_messages and not ride_changes and not rev_sound from public.notification_prefs where member_id = sue),
    'an older build saves its settings and leaves chat as it was';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000d7', 'select public.save_notification_prefs(true, true, false, true, true, true)')
    = 'Only approved members can do that.';
  assert pg_temp.try_as(null, 'select public.save_notification_prefs(true, true, false, true, true, true)') is not null, 'signed out can''t';
end $$;

\o
\echo 'CHAT PUSH CHECKS PASSED'
