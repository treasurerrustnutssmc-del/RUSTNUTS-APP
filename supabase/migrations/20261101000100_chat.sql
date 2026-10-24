-- Club chats, photos and ride walls (Stage 3). See docs/superpowers/specs/2026-10-24-chat-and-photos-design.md.
-- Members read through row-level security and write only through the actions below, which apply the
-- same rules with the same words as the app (src/domain/chat.ts).

create type public.chat_kind as enum ('club', 'chapter', 'board', 'nec', 'committee', 'ride', 'direct');
create type public.chat_committee as enum ('ride', 'charity');
create type public.chat_media_kind as enum ('photo', 'video', 'gif');
create type public.report_outcome as enum ('removed', 'dismissed');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_kind not null,
  chapter_id uuid references public.chapters (id) on delete cascade,
  ride_id uuid references public.rides (id) on delete cascade,
  committee public.chat_committee,
  -- Private chats: the pair's two ids, smaller first, so each pair has one chat.
  direct_key text unique,
  pinned_message_id uuid,
  created_at timestamptz not null default now(),
  check ((kind in ('chapter', 'board')) = (chapter_id is not null)),
  check ((kind = 'ride') = (ride_id is not null)),
  check ((kind = 'committee') = (committee is not null)),
  check ((kind = 'direct') = (direct_key is not null))
);
create unique index conversations_one_club_one_nec on public.conversations (kind) where kind in ('club', 'nec');
create unique index conversations_one_per_chapter on public.conversations (chapter_id) where kind = 'chapter';
create unique index conversations_one_big_table_per_chapter on public.conversations (chapter_id) where kind = 'board';
create unique index conversations_one_per_ride on public.conversations (ride_id) where kind = 'ride';
create unique index conversations_one_per_committee on public.conversations (committee) where kind = 'committee';

-- Only private chats list their people; everyone else's membership follows from the rules.
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  primary key (conversation_id, member_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  body text,
  reply_to_id uuid references public.messages (id) on delete set null,
  -- clock_timestamp, so messages sent in one go still keep their order.
  created_at timestamptz not null default clock_timestamp(),
  -- Bumped by reactions, pins and removal, so the app hears every change through one table.
  updated_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid references public.members (id) on delete set null
);
create index messages_by_chat on public.messages (conversation_id, created_at desc);
alter table public.conversations
  add constraint conversations_pinned_fk foreign key (pinned_message_id) references public.messages (id) on delete set null;

create table public.message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  kind public.chat_media_kind not null,
  path text not null unique,
  poster_path text unique,
  width int not null default 0,
  height int not null default 0,
  duration_ms int,
  position int not null default 0
);
create index message_media_by_message on public.message_media (message_id);

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, member_id, emoji)
);

create table public.chat_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (conversation_id, member_id)
);

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references public.members (id) on delete cascade,
  reason text,
  -- What was said, kept for whoever deals with the report (removal blanks the message itself).
  body text,
  media_count int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.members (id) on delete set null,
  outcome public.report_outcome,
  unique (message_id, reporter_id)
);

create table public.member_blocks (
  blocker_id uuid not null references public.members (id) on delete cascade,
  blocked_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------------------------------
-- The chats that make themselves: the whole club, the NEC, the ride and charity committees, a chat
-- and a big table (board) per chapter, and one per ride (the calendar sync adds rides, so a trigger
-- keeps up).

insert into public.conversations (kind) values ('club'), ('nec');
insert into public.conversations (kind, committee) values ('committee', 'ride'), ('committee', 'charity');
insert into public.conversations (kind, chapter_id) select 'chapter', id from public.chapters;
insert into public.conversations (kind, chapter_id) select 'board', id from public.chapters;
insert into public.conversations (kind, ride_id) select 'ride', id from public.rides;

create or replace function private.chapter_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.conversations (kind, chapter_id) values ('chapter', new.id), ('board', new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger chapters_get_a_chat after insert on public.chapters
  for each row execute function private.chapter_chat();

create or replace function private.ride_chat_for_new_ride()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.conversations (kind, ride_id) values ('ride', new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger rides_get_a_chat after insert on public.rides
  for each row execute function private.ride_chat_for_new_ride();

-- ---------------------------------------------------------------------------------------------
-- Who's asking

/** Holds a board seat in any chapter, or sits on the NEC. */
create or replace function private.is_any_board()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

-- Holds a seat on that committee: Road Captains and the Ride Committee, or the Charity Committee.
create or replace function private.is_on_committee(p_committee public.chat_committee)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and case p_committee when 'ride' then role in ('ride_committee', 'road_captain')
                           else role = 'charity_committee' end
  );
$$;

-- Why the caller can't read this chat, or null when they can. Same words as readProblem.
create or replace function private.chat_problem(p_chat uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into c from public.conversations where id = p_chat;
  if not found then return 'No such chat.'; end if;
  -- Someone who might join gets the whole-club and ride chats only, until they're an FNG.
  if c.kind not in ('club', 'ride')
     and (select status from public.members where id = auth.uid()) = 'introduced' then
    if c.kind = 'direct' then return 'Private chats open up once you’re an FNG.'; end if;
    if c.kind = 'chapter' then return 'Chapter chats open up once you’re an FNG.'; end if;
    return 'That chat opens up once you’re an FNG.';
  end if;
  if c.kind = 'chapter' then
    if private.chapter_of(auth.uid()) = c.chapter_id or private.is_national() then return null; end if;
    return format('That chat is for %s chapter members.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'board' then
    if private.is_board_of(c.chapter_id) then return null; end if;
    return format('That chat is for the %s board.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'nec' then
    if private.is_national() then return null; end if;
    return 'That chat is for the NEC.';
  elsif c.kind = 'committee' then
    if private.is_on_committee(c.committee) or private.is_national() then return null; end if;
    return format('That chat is for the %s committee.', c.committee);
  elsif c.kind = 'direct' then
    if exists (select 1 from public.conversation_members where conversation_id = p_chat and member_id = auth.uid()) then
      return null;
    end if;
    return 'That’s a private chat.';
  end if;
  return null;
end;
$$;

create or replace function private.can_read_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.chat_problem(p_chat) is null;
$$;

-- A chapter's board in its chat and big table; the NEC in its own chat; any board member or the NEC
-- in the whole-club, ride and committee chats (committees only if they're in it); nobody in a
-- private chat. Same as canModerate.
create or replace function private.can_moderate(p_chat uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_chat;
  if not found or not private.is_approved_member() then return false; end if;
  if c.kind in ('chapter', 'board') then return private.is_board_of(c.chapter_id); end if;
  if c.kind = 'nec' then return private.is_national(); end if;
  if c.kind = 'direct' then return false; end if;
  if c.kind = 'committee' and not private.can_read_chat(p_chat) then return false; end if;
  return private.is_any_board();
end;
$$;

-- Whoever moderates the chat, or for a private chat the reporter's chapter board (and the NEC).
create or replace function private.can_act_on_report(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when c.kind = 'direct' then private.is_board_of(private.chapter_of(r.reporter_id))
                else private.can_moderate(c.id) end
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.id = p_report
  ), false);
$$;

create or replace function private.blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- A file in chat-media: readable when it belongs to a message you can read that hasn't been removed,
-- when it's on a message reported to you, or when it's your own upload that isn't attached yet.
create or replace function private.can_read_chat_file(p_name text, p_owner text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    exists (
      select 1 from public.message_media mm join public.messages m on m.id = mm.message_id
      where (mm.path = p_name or mm.poster_path = p_name) and m.removed_at is null
        and private.can_read_chat(mm.conversation_id)
    )
    or exists (
      select 1 from public.message_media mm join public.message_reports r on r.message_id = mm.message_id
      where (mm.path = p_name or mm.poster_path = p_name) and r.resolved_at is null
        and private.can_act_on_report(r.id)
    )
    or (
      p_owner = auth.uid()::text
      and not exists (select 1 from public.message_media mm where mm.path = p_name or mm.poster_path = p_name)
    );
$$;

-- Uploads go into a folder named after a chat you can read.
create or replace function private.can_upload_chat_file(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return private.can_read_chat(folder::uuid);
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_media enable row level security;
alter table public.message_reactions enable row level security;
alter table public.chat_reads enable row level security;
alter table public.message_reports enable row level security;
alter table public.member_blocks enable row level security;

revoke all on public.conversations, public.conversation_members, public.messages, public.message_media,
  public.message_reactions, public.chat_reads, public.message_reports, public.member_blocks
  from public, anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages, public.message_media,
  public.message_reactions, public.chat_reads, public.member_blocks to authenticated;

create policy conversations_read on public.conversations for select to authenticated
  using (private.can_read_chat(id));
create policy conversation_members_read on public.conversation_members for select to authenticated
  using (private.can_read_chat(conversation_id));
create policy messages_read on public.messages for select to authenticated
  using (private.can_read_chat(conversation_id));
create policy message_media_read on public.message_media for select to authenticated
  using (private.can_read_chat(conversation_id)
         and exists (select 1 from public.messages m where m.id = message_id and m.removed_at is null));
create policy message_reactions_read on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and private.can_read_chat(m.conversation_id)));
create policy chat_reads_own on public.chat_reads for select to authenticated
  using (member_id = auth.uid());
create policy member_blocks_own on public.member_blocks for select to authenticated
  using (blocker_id = auth.uid());

-- Live updates: phones listen to new and changed messages (row-level security still applies).
alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------------------------
-- Files

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create policy chat_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and private.can_upload_chat_file(name));
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and private.can_read_chat_file(name, owner_id));
-- An upload that never got sent can be cleared away by whoever uploaded it.
create policy chat_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and owner_id = auth.uid()::text
         and not exists (select 1 from public.message_media mm where mm.path = name or mm.poster_path = name));

-- ---------------------------------------------------------------------------------------------
-- Actions

create or replace function private.raise_chat_problem(p_chat uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  problem text := private.chat_problem(p_chat);
begin
  if problem is not null then raise exception '%', problem; end if;
end;
$$;

-- Sends a message: words, photos and videos (already uploaded into the chat's folder), and
-- optionally the earlier message it answers. Media items: {path, kind, posterPath, width, height,
-- durationMs}. Returns the new message's id.
create or replace function public.send_message(p_chat uuid, p_body text, p_media jsonb default '[]', p_reply_to uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.conversations%rowtype;
  body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  media jsonb := coalesce(p_media, '[]'::jsonb);
  n int;
  other uuid;
  item jsonb;
  bad boolean;
  msg uuid;
  pos int := 0;
begin
  perform private.raise_chat_problem(p_chat);
  select * into c from public.conversations where id = p_chat;
  if c.kind = 'direct' then
    select member_id into other from public.conversation_members where conversation_id = p_chat and member_id <> me;
    if other is not null and private.blocked_between(me, other) then raise exception 'You can’t message them.'; end if;
  end if;
  if p_reply_to is not null
     and not exists (select 1 from public.messages where id = p_reply_to and conversation_id = p_chat) then
    raise exception 'No such message.';
  end if;
  if jsonb_typeof(media) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  n := jsonb_array_length(media);
  if body = '' and n = 0 then raise exception 'Write something or add a photo.'; end if;
  if char_length(body) > 4000 then raise exception 'Keep it under 4,000 characters.'; end if;
  if n > 10 then raise exception 'Up to 10 photos or videos at a time.'; end if;

  -- Each file: the right kind, in this chat's folder, uploaded by the sender, not used before. A GIF
  -- is GIPHY's own https address instead.
  for item in select value from jsonb_array_elements(media) loop
    if item->>'kind' = 'gif' then
      if coalesce(item->>'path', '') !~ '^https://(media[0-9]?|i)\.giphy\.com/[A-Za-z0-9_./?&=%-]+$' or item ? 'posterPath' and item->>'posterPath' is not null then
        raise exception 'That photo didn’t upload properly. Try again.';
      end if;
      continue;
    end if;
    select coalesce(item->>'kind', '') not in ('photo', 'video')
        or exists (
             select 1 from jsonb_array_elements_text(
               jsonb_build_array(item->'path') || case when item ? 'posterPath' and item->>'posterPath' is not null
                                                       then jsonb_build_array(item->'posterPath') else '[]'::jsonb end) p
             where p is null
                or split_part(p, '/', 1) <> p_chat::text
                or not exists (select 1 from storage.objects o
                               where o.bucket_id = 'chat-media' and o.name = p and o.owner_id = me::text)
                or exists (select 1 from public.message_media mm where mm.path = p or mm.poster_path = p))
      into bad;
    if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  end loop;

  insert into public.messages (conversation_id, author_id, body, reply_to_id)
  values (p_chat, me, nullif(body, ''), p_reply_to)
  returning id into msg;

  for item in select value from jsonb_array_elements(media) loop
    insert into public.message_media (message_id, conversation_id, kind, path, poster_path, width, height, duration_ms, position)
    values (msg, p_chat, (item->>'kind')::public.chat_media_kind, item->>'path', item->>'posterPath',
            coalesce((item->>'width')::int, 0), coalesce((item->>'height')::int, 0), (item->>'durationMs')::int, pos);
    pos := pos + 1;
  end loop;

  -- Your own message means you've seen the chat up to here.
  insert into public.chat_reads (conversation_id, member_id, read_at) values (p_chat, me, clock_timestamp())
  on conflict (conversation_id, member_id) do update set read_at = excluded.read_at;
  return msg;
end;
$$;

-- Blanks a message, takes away its reactions and pin, and closes its reports as removed.
create or replace function private.remove_message_now(p_message uuid, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set body = null, removed_at = now(), removed_by = p_by, updated_at = clock_timestamp()
  where id = p_message;
  delete from public.message_reactions where message_id = p_message;
  update public.conversations set pinned_message_id = null where pinned_message_id = p_message;
  update public.message_reports set resolved_at = now(), resolved_by = p_by, outcome = 'removed'
  where message_id = p_message and resolved_at is null;
end;
$$;

create or replace function public.remove_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if m.author_id <> auth.uid() and not private.can_moderate(m.conversation_id) then
    raise exception 'You can only remove your own messages.';
  end if;
  perform private.remove_message_now(p_message, auth.uid());
end;
$$;

create or replace function public.toggle_reaction(p_message uuid, p_emoji text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if p_emoji is null or p_emoji not in ('👍', '❤️', '😂', '🔥', '🍺', '😮') then raise exception 'Pick one of the reactions.'; end if;

  delete from public.message_reactions where message_id = p_message and member_id = auth.uid() and emoji = p_emoji;
  if not found then
    insert into public.message_reactions (message_id, member_id, emoji) values (p_message, auth.uid(), p_emoji);
  end if;
  update public.messages set updated_at = clock_timestamp() where id = p_message;
end;
$$;

-- Pins a message to the top of its chat, or with no message takes the pin down.
create or replace function public.pin_message(p_chat uuid, p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
  was uuid;
begin
  perform private.raise_chat_problem(p_chat);
  if not private.can_moderate(p_chat) then raise exception 'Only moderators can pin messages.'; end if;
  if p_message is not null then
    select * into m from public.messages where id = p_message and conversation_id = p_chat;
    if not found then raise exception 'No such message.'; end if;
    if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  end if;
  select pinned_message_id into was from public.conversations where id = p_chat;
  update public.conversations set pinned_message_id = p_message where id = p_chat;
  update public.messages set updated_at = clock_timestamp() where id in (was, p_message);
end;
$$;

create or replace function public.report_message(p_message uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  out uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if m.author_id = auth.uid() then raise exception 'You can’t report your own message.'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;

  insert into public.message_reports (message_id, reporter_id, reason, body, media_count)
  values (p_message, auth.uid(), reason, m.body, (select count(*) from public.message_media where message_id = p_message))
  on conflict (message_id, reporter_id) do update
    set reason = excluded.reason, created_at = now(), resolved_at = null, resolved_by = null, outcome = null
  returning id into out;
  return out;
end;
$$;

-- Deals with a report: remove the message, or dismiss the report. Either way every open report on
-- that message is closed.
create or replace function public.resolve_report(p_report uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.message_reports%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.message_reports where id = p_report;
  if not found then raise exception 'No such report.'; end if;
  if not private.can_act_on_report(p_report) then raise exception 'Only moderators can do that.'; end if;
  if r.resolved_at is not null then raise exception 'That report was already dealt with.'; end if;
  if p_remove then
    perform private.remove_message_now(r.message_id, auth.uid());
  else
    update public.message_reports set resolved_at = now(), resolved_by = auth.uid(), outcome = 'dismissed'
    where message_id = r.message_id and resolved_at is null;
  end if;
end;
$$;

-- Open reports the caller can act on, newest first, with what was said.
create or replace function public.chat_reports()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'created_at', r.created_at, 'reporter_id', r.reporter_id,
      'message', jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'author_id', m.author_id,
                                    'body', r.body, 'media_count', r.media_count, 'created_at', m.created_at),
      'chat', jsonb_build_object('id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id,
                                 'committee', c.committee)
    ) as x
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_report(r.id)
  ) reports;
$$;

create or replace function public.set_block(p_member uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'That member no longer exists.'; end if;
  if p_member = auth.uid() then raise exception 'You can’t block yourself.'; end if;
  if p_blocked then
    insert into public.member_blocks (blocker_id, blocked_id) values (auth.uid(), p_member) on conflict do nothing;
  else
    delete from public.member_blocks where blocker_id = auth.uid() and blocked_id = p_member;
  end if;
end;
$$;

-- The private chat between the caller and another member, made the first time. Returns its id.
create or replace function public.open_direct_chat(p_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  pair text;
  chat uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if p_member = me then raise exception 'You can’t message yourself.'; end if;
  if target.approval <> 'approved' then raise exception 'They’re not an approved member.'; end if;
  if (select status from public.members where id = me) = 'introduced' then
    raise exception 'Private chats open up once you’re an FNG.';
  end if;
  if target.status = 'introduced' then raise exception 'They can’t get private messages until they’re an FNG.'; end if;
  if private.blocked_between(me, p_member) then raise exception 'You can’t message them.'; end if;

  pair := least(me::text, p_member::text) || ':' || greatest(me::text, p_member::text);
  select id into chat from public.conversations where direct_key = pair;
  if chat is null then
    insert into public.conversations (kind, direct_key) values ('direct', pair)
    on conflict (direct_key) do nothing
    returning id into chat;
    if chat is null then
      select id into chat from public.conversations where direct_key = pair;
    else
      insert into public.conversation_members (conversation_id, member_id) values (chat, me), (chat, p_member);
    end if;
  end if;
  return chat;
end;
$$;

-- A ride's chat, for any approved member. Returns its id.
create or replace function public.ride_chat(p_ride uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  chat uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.rides where id = p_ride) then raise exception 'No such ride.'; end if;
  insert into public.conversations (kind, ride_id) values ('ride', p_ride) on conflict do nothing;
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  return chat;
end;
$$;

create or replace function public.mark_chat_read(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.raise_chat_problem(p_chat);
  insert into public.chat_reads (conversation_id, member_id, read_at) values (p_chat, auth.uid(), clock_timestamp())
  on conflict (conversation_id, member_id) do update set read_at = excluded.read_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reads that need more than one table

create or replace function private.ride_json(r public.rides)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                            'all_day', r.all_day, 'location', r.location, 'notes', r.notes,
                            'category', r.category, 'cancelled_at', r.cancelled_at);
$$;

-- The Melbourne date a ride's last day falls on (an all-day end is the midnight after). Same as lastDay.
create or replace function private.ride_last_day(r public.rides)
returns date language sql stable as $$
  select case
    when r.ends_at is null then (r.starts_at at time zone 'Australia/Melbourne')::date
    when r.all_day then ((r.ends_at - interval '1 millisecond') at time zone 'Australia/Melbourne')::date
    else (r.ends_at at time zone 'Australia/Melbourne')::date
  end;
$$;

-- Your chats: the whole club, your chapter (every chapter for the NEC), the ride committee if
-- you're on it, ride chats from 7 days before to 3 days after a ride you said Going or Maybe to,
-- and your private chats. Each with its last message (not from someone you've blocked) and how many
-- messages from others came in since you last read it.
create or replace function public.chat_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := private.club_date();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(item)
    from (
      select jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id, 'committee', c.committee,
        'pinned_message_id', c.pinned_message_id,
        'member_ids', coalesce((select jsonb_agg(cm.member_id) from public.conversation_members cm where cm.conversation_id = c.id), '[]'::jsonb),
        'ride', (select private.ride_json(r) from public.rides r where r.id = c.ride_id),
        'last', (
          select jsonb_build_object('id', m.id, 'author_id', m.author_id, 'body', m.body, 'created_at', m.created_at,
                                    'removed', m.removed_at is not null,
                                    'media_count', (select count(*) from public.message_media mm where mm.message_id = m.id))
          from public.messages m
          where m.conversation_id = c.id
            and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
          order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from public.messages m
          where m.conversation_id = c.id and m.author_id <> me and m.removed_at is null
            -- Writing in a chat counts as having read everything before it.
            and m.created_at > greatest(
              coalesce((select read_at from public.chat_reads cr where cr.conversation_id = c.id and cr.member_id = me), '-infinity'),
              coalesce((select max(o.created_at) from public.messages o where o.conversation_id = c.id and o.author_id = me), '-infinity'))
            and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        )
      ) as item
      from public.conversations c
      left join public.rides r on r.id = c.ride_id
      where private.can_read_chat(c.id)
        and (c.kind <> 'ride' or (
          exists (select 1 from public.rsvps a where a.ride_id = r.id and a.member_id = me and a.answer in ('going', 'maybe'))
          and (r.starts_at at time zone 'Australia/Melbourne')::date - 7 <= today
          and private.ride_last_day(r) + 3 >= today
        ))
    ) listed
  ), '[]'::jsonb);
end;
$$;

-- One photo or video, as the feeds hand it over.
create or replace function private.media_json(mm public.message_media, m public.messages)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', mm.id, 'message_id', mm.message_id, 'conversation_id', mm.conversation_id,
                            'kind', mm.kind, 'path', mm.path, 'poster_path', mm.poster_path, 'width', mm.width,
                            'height', mm.height, 'duration_ms', mm.duration_ms, 'position', mm.position,
                            'author_id', m.author_id, 'created_at', m.created_at);
$$;

-- Photos and videos from the group chats you can read (never private ones), newest first, whole
-- messages at a time until about p_limit items, from messages older than p_before.
create or replace function public.club_photos(p_before timestamptz, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    with msgs as (
      select m.id, m.created_at,
             (select count(*) from public.message_media mm where mm.message_id = m.id and mm.kind <> 'gif') as n
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and (p_before is null or m.created_at < p_before)
        and exists (select 1 from public.message_media mm where mm.message_id = m.id and mm.kind <> 'gif')
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
    ),
    running as (
      select msgs.*, sum(n) over (order by created_at desc, id desc) - n as before_this from msgs
    )
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from running r
    join public.messages m on m.id = r.id
    join public.message_media mm on mm.message_id = m.id and mm.kind <> 'gif'
    where r.before_this < least(greatest(coalesce(p_limit, 60), 1), 200)
  ), '[]'::jsonb);
end;
$$;

-- Rides with photos or videos on their wall, newest ride first, each with its newest item as a cover.
create or replace function public.ride_walls()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(wall order by (wall->'ride'->>'starts_at')::timestamptz desc)
    from (
      select jsonb_build_object(
        'ride', private.ride_json(r),
        'chat_id', c.id,
        'count', count(*),
        'cover', (array_agg(private.media_json(mm, m) order by m.created_at desc, mm.position))[1]
      ) as wall
      from public.conversations c
      join public.rides r on r.id = c.ride_id
      join public.messages m on m.conversation_id = c.id and m.removed_at is null
      join public.message_media mm on mm.message_id = m.id and mm.kind <> 'gif'
      where c.kind = 'ride'
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      group by c.id, r.*
    ) walls
  ), '[]'::jsonb);
end;
$$;

-- One ride's wall: the ride, its chat and every photo and video, newest first.
create or replace function public.ride_wall(p_ride uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rides%rowtype;
  chat uuid;
begin
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'No such ride.'; end if;
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  return jsonb_build_object(
    'ride', private.ride_json(r),
    'chat_id', chat,
    'media', coalesce((
      select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, mm.position)
      from public.messages m join public.message_media mm on mm.message_id = m.id and mm.kind <> 'gif'
      where m.conversation_id = chat and m.removed_at is null
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function
  public.send_message(uuid, text, jsonb, uuid), public.remove_message(uuid), public.toggle_reaction(uuid, text),
  public.pin_message(uuid, uuid), public.report_message(uuid, text), public.resolve_report(uuid, boolean),
  public.chat_reports(), public.set_block(uuid, boolean), public.open_direct_chat(uuid), public.ride_chat(uuid),
  public.mark_chat_read(uuid), public.chat_list(), public.club_photos(timestamptz, int), public.ride_walls(),
  public.ride_wall(uuid)
  from public, anon;
grant execute on function
  public.send_message(uuid, text, jsonb, uuid), public.remove_message(uuid), public.toggle_reaction(uuid, text),
  public.pin_message(uuid, uuid), public.report_message(uuid, text), public.resolve_report(uuid, boolean),
  public.chat_reports(), public.set_block(uuid, boolean), public.open_direct_chat(uuid), public.ride_chat(uuid),
  public.mark_chat_read(uuid), public.chat_list(), public.club_photos(timestamptz, int), public.ride_walls(),
  public.ride_wall(uuid)
  to authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
