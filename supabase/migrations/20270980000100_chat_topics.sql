-- Topics inside board, committee and group chats, part 2 of 2. See
-- docs/superpowers/specs/2026-11-24-chat-topics-design.md. Needs 20270980000000_chat_topics_kind.sql in
-- first (its own run).
--
-- Jeff, 23 Nov 2026: "in board or committee chats, can they be able to make sub chats to better
-- separate and track conversation topics, I liked this from discord". A topic is a chat of its own
-- (kind 'topic') inside a big table, All boards, the NEC chat, a committee chat or a group. Whoever
-- reads that chat reads and posts in its topics and can start one (up to 50 open, names 1 to 40
-- characters). Whoever started a topic, or a board member or the NEC, renames, closes and reopens it.
-- Nobody posts in a closed topic. Moderating, reports, website photos and pushes follow the chat.

alter table public.conversations add column if not exists parent_id uuid references public.conversations (id) on delete cascade;
alter table public.conversations add column if not exists closed_at timestamptz;
alter table public.conversations add column if not exists closed_by uuid references public.members (id) on delete set null;
create index if not exists conversations_parent_idx on public.conversations (parent_id) where parent_id is not null;
create index if not exists conversations_closed_by_idx on public.conversations (closed_by) where closed_by is not null;
alter table public.conversations drop constraint if exists conversations_topic_parent;
alter table public.conversations add constraint conversations_topic_parent
  check ((kind = 'topic') = (parent_id is not null) and (closed_at is null or kind = 'topic'));
-- Groups and topics have names; nothing else does.
alter table public.conversations drop constraint if exists conversations_group_name;
alter table public.conversations add constraint conversations_group_name
  check ((kind in ('group', 'topic')) = (name is not null) and (name is null or char_length(name) between 1 and 40));

-- Who reads which chat. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function private.chat_problem(p_chat uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  -- A topic is read by whoever reads its chat, with the chat's words.
  select * into c from public.conversations where id = p_chat;
  if found and c.kind = 'topic' then return private.chat_problem(c.parent_id); end if;
  -- Family get the Family chat and nothing else.
  if private.is_family() then
    select * into c from public.conversations where id = p_chat;
    if not found then return 'No such chat.'; end if;
    if c.kind = 'family' then return null; end if;
    return 'Family can only use the Family chat.';
  end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into c from public.conversations where id = p_chat;
  if not found then return 'No such chat.'; end if;
  -- Someone who might join gets the whole-club and ride chats only, until they're an FNG.
  if c.kind not in ('club', 'ride')
     and (select status from public.members where id = auth.uid()) = 'introduced' then
    if c.kind = 'direct' then return 'Private chats open up once you’re an FNG.'; end if;
    if c.kind = 'chapter' then return 'Chapter chats open up once you’re an FNG.'; end if;
    if c.kind = 'group' then return 'Group chats open up once you’re an FNG.'; end if;
    return 'That chat opens up once you’re an FNG.';
  end if;
  if c.kind = 'chapter' then
    if private.chapter_of(auth.uid()) = c.chapter_id or private.sees_every_chapter() then return null; end if;
    return format('That chat is for %s chapter members.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'board' then
    if private.sees_board_of(c.chapter_id) then return null; end if;
    return format('That chat is for the %s board.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'boards' then
    if private.is_any_board() then return null; end if;
    return 'That chat is for board members and the NEC.';
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
  elsif c.kind = 'group' then
    if exists (select 1 from public.conversation_members where conversation_id = p_chat and member_id = auth.uid()) then
      return null;
    end if;
    return 'That’s a private group.';
  end if;
  return null;
end;
$$;

-- Whoever moderates a topic's chat moderates the topic. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function private.can_moderate(p_chat uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_chat;
  if not found or not private.is_approved_member() then return false; end if;
  if c.kind = 'topic' then return private.can_moderate(c.parent_id); end if;
  if c.kind in ('chapter', 'board') then return private.is_board_of(c.chapter_id); end if;
  if c.kind = 'nec' then return private.is_national(); end if;
  if c.kind in ('direct', 'group') then return false; end if;
  if c.kind = 'committee' and not private.can_read_chat(p_chat) then return false; end if;
  return private.is_any_board();
end;
$$;

-- A report in a topic goes where one in its chat would. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function private.can_act_on_report(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when coalesce(p.kind, c.kind) in ('direct', 'group') then private.is_board_of(private.chapter_of(r.reporter_id))
                else private.can_moderate(c.id) end
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    left join public.conversations p on p.id = c.parent_id
    where r.id = p_report
  ), false);
$$;

-- The chat list carries a topic's chat and whether it's closed. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function public.chat_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := private.club_date();
begin
  if not private.is_chat_user() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(item)
    from (
      select jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id, 'committee', c.committee,
        'name', c.name, 'created_by', c.created_by,
        'parent_id', c.parent_id, 'closed_at', c.closed_at, 'closed_by', c.closed_by,
        'pinned_message_id', c.pinned_message_id,
        'member_ids', coalesce((select jsonb_agg(cm.member_id) from public.conversation_members cm where cm.conversation_id = c.id), '[]'::jsonb),
        'ride', (select private.ride_json(r) from public.rides r where r.id = c.ride_id),
        'last', (
          select jsonb_build_object('id', m.id, 'author_id', m.author_id, 'body', m.body, 'created_at', m.created_at,
                                    'removed', m.removed_at is not null,
                                    'media_count', (select count(*) from public.message_media mm where mm.message_id = m.id),
                                    'voice', m.removed_at is null and exists (
                                      select 1 from public.message_media mm where mm.message_id = m.id and mm.kind::text = 'voice'))
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

-- Reports carry a topic's chat. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function public.chat_reports()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'created_at', r.created_at, 'reporter_id', r.reporter_id,
      'message', jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'author_id', m.author_id,
                                    'body', r.body, 'media_count', r.media_count, 'created_at', m.created_at,
                                    'voice', (select jsonb_build_object('path', mm.path, 'duration_ms', mm.duration_ms)
                                              from public.message_media mm where mm.message_id = m.id and mm.kind::text = 'voice')),
      'chat', jsonb_build_object('id', c.id, 'kind', c.kind, 'chapter_id', c.chapter_id, 'ride_id', c.ride_id,
                                 'committee', c.committee, 'name', c.name,
                                 'parent_id', c.parent_id)
    ) as x
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_report(r.id)
  ) reports;
$$;

-- A topic's notifications are titled with its chat and its name. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function private.chat_push_title(c public.conversations, sender public.members)
returns text language sql stable security definer set search_path = '' as $$
  select case c.kind::text
    when 'club' then 'Whole club'
    when 'family' then 'Family'
    when 'chapter' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' chapter'
    when 'board' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' big table'
    when 'boards' then 'All boards'
    when 'nec' then 'NEC'
    when 'committee' then case when c.committee = 'charity' then 'Charity committee' else 'Ride committee' end
    when 'ride' then coalesce((select title from public.rides where id = c.ride_id), 'Ride chat')
    when 'group' then coalesce(c.name, 'Group chat')
    when 'topic' then coalesce((select private.chat_push_title(p, sender) from public.conversations p where p.id = c.parent_id), 'Chat')
                      || ' › ' || coalesce(c.name, 'Topic')
    else private.short_name(sender)
  end;
$$;

-- A topic's message reaches its chat's people (a group topic, the group's). Otherwise as in
-- 20270950000000_chat_push_stack.sql.
create or replace function private.push_chat_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
  -- Whose people hear it: the chat itself, or a topic's chat.
  g public.conversations%rowtype;
  sender public.members%rowtype;
  t text;
  b text;
  who uuid;
  stack jsonb;
  n int;
begin
  begin
    if new.removed_at is not null then return null; end if;
    select * into c from public.conversations where id = new.conversation_id;
    g := c;
    if c.kind = 'topic' then select * into g from public.conversations where id = c.parent_id; end if;
    select * into sender from public.members where id = new.author_id;
    t := private.chat_push_title(c, sender);
    b := private.chat_push_body(new, c, sender);
    for who in
      select distinct d.member_id from public.push_devices d
      where d.member_id <> new.author_id
        and (g.kind not in ('direct', 'group') or exists (
          select 1 from public.conversation_members cm where cm.conversation_id = g.id and cm.member_id = d.member_id))
        and not private.blocked_between(new.author_id, d.member_id)
        and coalesce((select p.chat_messages from public.notification_prefs p where p.member_id = d.member_id), true)
    loop
      begin
        if private.member_can_read_chat(who, c.id) then
          begin
            stack := private.chat_push_stack(who, new, c);
            n := coalesce((stack->>'count')::int, 0);
          exception when others then
            -- No stack is no reason to miss the message: it goes on its own, as before.
            raise warning 'chat notification stack for message % to % not worked out: %', new.id, who, sqlerrm;
            n := 0;
          end;
          insert into private.push_outbox (member_id, dedupe_key, title, body, data)
          values (who, 'chat:' || new.id,
            case when n > 1 then t || ' · ' || n || ' new messages' else t end,
            case when n > 1 then stack->>'lines' else b end,
            jsonb_build_object('kind', 'chat', 'chatId', c.id, 'line', b))
          on conflict (member_id, dedupe_key) do nothing;
        end if;
      exception when others then
        -- One member's problem doesn't cost everyone else the notification.
        raise warning 'chat notification for message % to % not written: %', new.id, who, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'chat notification for message % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- A group topic's photos stay in the group. Otherwise as in 20270880000100_chat_groups.sql.
create or replace function public.pick_site_photo(p_media uuid, p_caption text, p_consent boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mm public.message_media%rowtype;
  m public.messages%rowtype;
  chat_kind text;
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  select * into mm from public.message_media where id = p_media;
  if found then select * into m from public.messages where id = mm.message_id; end if;
  if not found or m.removed_at is not null or not private.can_read_chat(mm.conversation_id) then
    raise exception 'No such photo.';
  end if;
  if mm.kind <> 'photo' then raise exception 'Only photos go on the website, not videos or GIFs.'; end if;
  -- A topic's photos go by its chat's kind.
  select coalesce(p.kind, c.kind)::text into chat_kind
  from public.conversations c left join public.conversations p on p.id = c.parent_id
  where c.id = mm.conversation_id;
  if chat_kind = 'direct' then raise exception 'Photos from private chats stay private.'; end if;
  if chat_kind = 'group' then raise exception 'Photos from group chats stay private.'; end if;
  -- Partners' and kids' photos stay in the club.
  if chat_kind = 'family' then raise exception 'Photos from the Family chat stay off the website.'; end if;
  if exists (select 1 from public.site_photos where media_id = p_media and status <> 'removed') then
    raise exception 'That photo is already on the list.';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Tick that everyone in the photo is happy to be on the website.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;

  insert into public.site_photos (source, media_id, bucket, path, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('chat', p_media, 'chat-media', mm.path, mm.width, mm.height, v_caption, m.author_id, me, 'live', now())
  returning id into new_id;
  return new_id;
end;
$$;

-- Nobody posts in a closed topic. A trigger, so send_message isn't copied; it runs before the club
-- rules check (posting_rules_messages), as the app checks them.
create or replace function private.refuse_closed_topic()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conversations where id = new.conversation_id and kind = 'topic' and closed_at is not null) then
    raise exception 'This topic is closed. Reopen it to post.';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_closed_topic() from public, anon, authenticated;
drop trigger if exists closed_topic_messages on public.messages;
create trigger closed_topic_messages before insert on public.messages
  for each row execute function private.refuse_closed_topic();

-- ---------------------------------------------------------------------------------------------
-- Topics.

-- A topic's name as it's kept: trimmed like the app, 1 to 40 characters (an emoji is one).
create or replace function private.topic_name(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := private.trim_like_app(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'Give the topic a name.'; end if;
  if char_length(v) > 40 then raise exception 'Keep the name to 40 characters.'; end if;
  return v;
end;
$$;

-- A topic the caller can read and run (they started it, or they're on a board or the NEC), or why not.
create or replace function private.my_topic(p_chat uuid)
returns public.conversations language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into c from public.conversations where id = p_chat;
  if found and c.kind <> 'topic' then raise exception 'That’s not a topic.'; end if;
  perform private.raise_chat_problem(p_chat);
  if c.created_by is distinct from auth.uid() and not private.is_any_board() then
    raise exception 'Only whoever started the topic, or a board member or the NEC, can do that.';
  end if;
  return c;
end;
$$;

create or replace function public.start_topic(p_chat uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.conversations%rowtype;
  v_name text;
  topic uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  perform private.raise_chat_problem(p_chat);
  -- One topic at a time per chat, so two people starting at once can't take it past 50.
  select * into c from public.conversations where id = p_chat for update;
  if c.kind not in ('board', 'boards', 'nec', 'committee', 'group') then
    raise exception 'Topics are for board, committee and group chats.';
  end if;
  v_name := private.topic_name(p_name);
  if (select count(*) from public.conversations where parent_id = p_chat and closed_at is null) >= 50 then
    raise exception 'This chat has 50 open topics. Close one first.';
  end if;
  insert into public.conversations (kind, parent_id, name, created_by) values ('topic', p_chat, v_name, me) returning id into topic;
  return topic;
end;
$$;

create or replace function public.rename_topic(p_chat uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  perform private.my_topic(p_chat);
  v_name := private.topic_name(p_name);
  update public.conversations set name = v_name where id = p_chat;
end;
$$;

create or replace function public.close_topic(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype := private.my_topic(p_chat);
begin
  if c.closed_at is not null then raise exception 'That topic is already closed.'; end if;
  update public.conversations set closed_at = now(), closed_by = auth.uid() where id = p_chat;
end;
$$;

create or replace function public.reopen_topic(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations%rowtype := private.my_topic(p_chat);
begin
  if c.closed_at is null then raise exception 'That topic is already open.'; end if;
  -- One open-topic count at a time, as for start_topic.
  perform 1 from public.conversations where id = c.parent_id for update;
  if (select count(*) from public.conversations where parent_id = c.parent_id and closed_at is null) >= 50 then
    raise exception 'This chat has 50 open topics. Close one first.';
  end if;
  update public.conversations set closed_at = null, closed_by = null where id = p_chat;
end;
$$;

revoke all on function private.topic_name(text), private.my_topic(uuid) from public, anon, authenticated;
revoke all on function public.start_topic(uuid, text), public.rename_topic(uuid, text), public.close_topic(uuid),
  public.reopen_topic(uuid), public.chat_reports(), public.chat_list(), public.pick_site_photo(uuid, text, boolean) from public, anon;
grant execute on function public.start_topic(uuid, text), public.rename_topic(uuid, text), public.close_topic(uuid),
  public.reopen_topic(uuid), public.chat_reports(), public.chat_list(), public.pick_site_photo(uuid, text, boolean) to authenticated;
