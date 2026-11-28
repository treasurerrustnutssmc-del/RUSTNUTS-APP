-- Checks chat tags (2026-11-28-chat-tags-design.md): @name or @everyone sends the tagged member a
-- notification of its own (data.kind 'tag'), even with chat notifications off, unless Tags is off.
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


create function pg_temp.row_for(msg uuid, who uuid) returns private.push_outbox language sql as $$
  select o from private.push_outbox o where o.dedupe_key = 'chat:' || msg and o.member_id = who;
$$;

create function pg_temp.kind_for(msg uuid, who uuid) returns text language sql as $$
  select coalesce((select o.data->>'kind' from private.push_outbox o where o.dedupe_key = 'chat:' || msg and o.member_id = who), 'none');
$$;

create function pg_temp.send(chat uuid, body text) returns uuid language plpgsql as $$
begin
  return pg_temp.send_as('00000000-0000-0000-0000-0000000000d1', chat, body);
end $$;

\o
\echo 'A tag is @ and the whole name, any case, not run into more letters, and not inside an email address'
\o /dev/null
do $$
begin
  assert private.tags_name('@nora you coming?', 'Nora');
  assert private.tags_name('Sunday @NORA.', 'Nora');
  assert private.tags_name('(@Nora)', 'Nora');
  assert private.tags_name('hey @Big Dave', 'Big Dave');
  assert not private.tags_name('hey @Big Dave', 'Dave');
  assert not private.tags_name('@Noras bike', 'Nora');
  assert not private.tags_name('wes@nora.com', 'Nora');
  assert not private.tags_name('Nora, you coming?', 'Nora');
  assert not private.tags_name(null, 'Nora');
  assert not private.tags_name('@', '');
  assert not private.tags_name('@x', null);
end $$;

\o
\echo 'A tagged member gets a notification of their own, titled with who tagged them; the others get the ordinary one'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  sue constant uuid := '00000000-0000-0000-0000-0000000000d2';
  msg uuid;
  o private.push_outbox;
begin
  msg := pg_temp.send(pg_temp.chat('club'), '@nora you coming Sunday?');
  o := pg_temp.row_for(msg, nora);
  assert o.title = 'Wes tagged you · Whole club', o.title;
  assert o.body = 'Wes: @nora you coming Sunday?', o.body;
  assert o.data = jsonb_build_object('kind', 'tag', 'chatId', pg_temp.chat('club'), 'line', 'Wes: @nora you coming Sunday?'), o.data::text;
  assert pg_temp.kind_for(msg, sue) = 'chat', pg_temp.kind_for(msg, sue);
  -- Sue has no road name: her first name is her tag.
  msg := pg_temp.send(pg_temp.chat('club'), 'Thanks @Sue');
  assert pg_temp.kind_for(msg, sue) = 'tag';
  assert pg_temp.kind_for(msg, nora) = 'chat';
  -- Not a tag: run into more letters.
  msg := pg_temp.send(pg_temp.chat('club'), '@Noras bike is here');
  assert pg_temp.kind_for(msg, nora) = 'chat';
end $$;

\o
\echo '@everyone tags everyone who hears the chat, but never the sender or anyone blocked'
\o /dev/null
do $$
declare
  msg uuid;
begin
  msg := pg_temp.send(pg_temp.chat('club'), 'Ride''s on @everyone');
  assert (select string_agg(distinct o.data->>'kind', ',') from private.push_outbox o where o.dedupe_key = 'chat:' || msg) = 'tag';
  assert (select o.title from private.push_outbox o where o.dedupe_key = 'chat:' || msg and o.member_id = '00000000-0000-0000-0000-0000000000d3')
    = 'Wes tagged everyone · Whole club';
  assert pg_temp.kind_for(msg, '00000000-0000-0000-0000-0000000000d1') = 'none', 'not the sender';
  assert pg_temp.kind_for(msg, '00000000-0000-0000-0000-0000000000d4') = 'none', 'Cap blocked Wes';
  -- Tagged by name and by everyone: "you".
  msg := pg_temp.send(pg_temp.chat('club'), '@everyone and @Nora especially');
  assert (pg_temp.row_for(msg, '00000000-0000-0000-0000-0000000000d3')).title = 'Wes tagged you · Whole club';
end $$;

\o
\echo 'With chat notifications off a tag still comes; with Tags off it doesn''t, and an ordinary one comes instead if chat is on'
\o /dev/null
do $$
declare
  len constant uuid := '00000000-0000-0000-0000-0000000000d6';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  msg uuid;
begin
  assert pg_temp.try_as(len, 'select public.save_notification_prefs(true, true, true, true, true, false, true)') is null;
  msg := pg_temp.send(pg_temp.chat('club'), 'Just chatting');
  assert pg_temp.kind_for(msg, len) = 'none';
  msg := pg_temp.send(pg_temp.chat('club'), '@Len you there?');
  assert pg_temp.kind_for(msg, len) = 'tag';
  assert pg_temp.try_as(len, 'select public.save_notification_prefs(true, true, true, true, true, false, false)') is null;
  assert (select chat_tags from public.notification_prefs where member_id = len) = false;
  msg := pg_temp.send(pg_temp.chat('club'), '@Len you there?');
  assert pg_temp.kind_for(msg, len) = 'none';
  assert pg_temp.try_as(nora, 'select public.save_notification_prefs(true, true, true, true, true, true, false)') is null;
  msg := pg_temp.send(pg_temp.chat('club'), '@Nora you there?');
  assert pg_temp.kind_for(msg, nora) = 'chat';
  assert pg_temp.try_as(nora, 'select public.save_notification_prefs(true, true, true, true, true, true, true)') is null;
  -- The six-setting save (app builds from before tags) leaves Tags as it was.
  assert pg_temp.try_as(len, 'select public.save_notification_prefs(true, true, true, true, true, true)') is null;
  assert (select chat_tags from public.notification_prefs where member_id = len) = false;
end $$;

\o
\echo 'Tagging someone who can''t read the chat tells them nothing'
\o /dev/null
do $$
declare
  nick constant uuid := '00000000-0000-0000-0000-0000000000d9';
  msg uuid;
begin
  -- Nick is Introduced: the West chapter chat opens up once he's an FNG.
  msg := pg_temp.send(pg_temp.chat('west'), '@Nick welcome');
  assert pg_temp.kind_for(msg, nick) = 'none';
end $$;

\o
\echo 'In a private chat the tag is titled with the sender alone'
\o /dev/null
do $$
declare
  nora constant uuid := '00000000-0000-0000-0000-0000000000d3';
  dm uuid := pg_temp.value_as('00000000-0000-0000-0000-0000000000d1',
    format('select public.open_direct_chat(%L)', nora))::uuid;
  msg uuid;
begin
  msg := pg_temp.send(dm, '@Nora ring me');
  assert (pg_temp.row_for(msg, nora)).title = 'Wes tagged you', (pg_temp.row_for(msg, nora)).title;
  assert (pg_temp.row_for(msg, nora)).body = '@Nora ring me';
end $$;

\o
\echo 'CHAT TAG CHECKS PASSED'
