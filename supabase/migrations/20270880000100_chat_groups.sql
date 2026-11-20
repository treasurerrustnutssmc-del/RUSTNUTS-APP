-- Chat groups and the All boards chat, part 2 of 2. See docs/superpowers/specs/2026-11-20-chat-groups-design.md.
-- Needs 20270880000000_chat_groups_kind.sql in first (its own run).
--
-- All boards: one chat for every chapter's board and the NEC (private.is_any_board), following the seats.
-- Groups: board members and the NEC start them (Jeff, 20 Nov 2026: "Board and NEC only"), name them
-- and pick members FNG and up. Everyone in a group reads, posts and can leave; board members and the
-- NEC in it add people, rename it and take people out. Nobody outside a group sees it, and nobody
-- moderates one: a report goes to the reporter's chapter board, as for private chats.

-- A group's name, and who started it.
alter table public.conversations add column if not exists name text;
alter table public.conversations add column if not exists created_by uuid references public.members (id) on delete set null;
alter table public.conversations drop constraint if exists conversations_group_name;
alter table public.conversations add constraint conversations_group_name
  check ((kind = 'group') = (name is not null) and (name is null or char_length(name) between 1 and 40));

-- The one All boards chat.
create unique index if not exists conversations_one_all_boards on public.conversations (kind) where kind = 'boards';
insert into public.conversations (kind) select 'boards'
where not exists (select 1 from public.conversations where kind = 'boards');

-- Who reads which chat. Otherwise as in 20270870000000_acting_roles.sql.
create or replace function private.chat_problem(p_chat uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
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


-- Nobody moderates a group (like a private chat). Otherwise as in 20261101000100_chat.sql: All
-- boards falls to the last line, so anyone in it moderates it.
create or replace function private.can_moderate(p_chat uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_chat;
  if not found or not private.is_approved_member() then return false; end if;
  if c.kind in ('chapter', 'board') then return private.is_board_of(c.chapter_id); end if;
  if c.kind = 'nec' then return private.is_national(); end if;
  if c.kind in ('direct', 'group') then return false; end if;
  if c.kind = 'committee' and not private.can_read_chat(p_chat) then return false; end if;
  return private.is_any_board();
end;
$$;

-- Whoever moderates the chat, or for a private chat or a group the reporter's chapter board.
create or replace function private.can_act_on_report(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when c.kind in ('direct', 'group') then private.is_board_of(private.chapter_of(r.reporter_id))
                else private.can_moderate(c.id) end
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.id = p_report
  ), false);
$$;

-- The chat list carries a group's name and who started it. Otherwise as in 20270810000100_family_chat.sql.
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


-- Reports carry a group's name, so the board knows which group. Otherwise as in 20270415000700_voice_notes.sql.
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
                                 'committee', c.committee, 'name', c.name)
    ) as x
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.resolved_at is null and private.is_approved_member() and private.can_act_on_report(r.id)
  ) reports;
$$;

-- A chat's name in its notifications. Otherwise as in 20270810000100_family_chat.sql.
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
    else private.short_name(sender)
  end;
$$;

-- Group photos stay in the group. Otherwise as in 20270810000100_family_chat.sql.
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
  select kind::text into chat_kind from public.conversations where id = mm.conversation_id;
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


-- ---------------------------------------------------------------------------------------------
-- Groups.

-- Board members of any chapter and the NEC run groups (the same people as All boards).
create or replace function private.raise_not_group_runner(p_doing text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_any_board() then
    raise exception 'Only board members and the NEC can %.', p_doing;
  end if;
end;
$$;

-- A group's name as it's kept: trimmed like the app, 1 to 40 characters (an emoji is one).
create or replace function private.group_name(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := private.trim_like_app(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'Give the group a name.'; end if;
  if char_length(v) > 40 then raise exception 'Keep the name to 40 characters.'; end if;
  return v;
end;
$$;

-- Puts people in a group, after checking each can be in one and isn't blocked by (or blocking) whoever
-- adds them. People already in it are left as they are. At most 100 in a group.
create or replace function private.put_in_group(p_chat uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  who uuid;
  t public.members%rowtype;
begin
  foreach who in array coalesce(p_members, '{}') loop
    if who = me then continue; end if;
    select * into t from public.members where id = who;
    if not found then raise exception 'That member no longer exists.'; end if;
    if t.approval <> 'approved' then raise exception '% isn’t an approved member.', private.short_name(t); end if;
    if t.status = 'family' then raise exception 'Family only use the Family chat, not groups.'; end if;
    if t.status = 'introduced' then raise exception '% can’t join groups until they’re an FNG.', private.short_name(t); end if;
    if private.blocked_between(me, who) then raise exception 'You can’t add %.', private.short_name(t); end if;
  end loop;
  insert into public.conversation_members (conversation_id, member_id)
  select p_chat, x from unnest(coalesce(p_members, '{}')) x
  on conflict do nothing;
  if (select count(*) from public.conversation_members where conversation_id = p_chat) > 100 then
    raise exception 'A group can have up to 100 people.';
  end if;
end;
$$;

-- A group the caller is in, or why not.
create or replace function private.my_group(p_chat uuid)
returns public.conversations language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into c from public.conversations where id = p_chat;
  if found and c.kind <> 'group' then raise exception 'That’s not a group chat.'; end if;
  perform private.raise_chat_problem(p_chat);
  return c;
end;
$$;

create or replace function public.create_group_chat(p_name text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_name text;
  chat uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform private.raise_not_group_runner('start groups');
  v_name := private.group_name(p_name);
  if not exists (select 1 from unnest(coalesce(p_members, '{}')) x where x <> me) then
    raise exception 'Add at least one other person.';
  end if;
  if (select count(distinct x) from unnest(p_members) x where x <> me) + 1 > 100 then
    raise exception 'A group can have up to 100 people.';
  end if;
  insert into public.conversations (kind, name, created_by) values ('group', v_name, me) returning id into chat;
  insert into public.conversation_members (conversation_id, member_id) values (chat, me);
  perform private.put_in_group(chat, p_members);
  return chat;
end;
$$;

create or replace function public.add_to_group(p_chat uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.my_group(p_chat);
  perform private.raise_not_group_runner('add people');
  perform private.put_in_group(p_chat, p_members);
end;
$$;

create or replace function public.rename_group(p_chat uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  perform private.my_group(p_chat);
  perform private.raise_not_group_runner('rename a group');
  v_name := private.group_name(p_name);
  update public.conversations set name = v_name where id = p_chat;
end;
$$;

create or replace function public.remove_from_group(p_chat uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.my_group(p_chat);
  perform private.raise_not_group_runner('take people out');
  if p_member = auth.uid() then raise exception 'Use Leave group to leave.'; end if;
  delete from public.conversation_members where conversation_id = p_chat and member_id = p_member;
  if not found then raise exception 'They’re not in that group.'; end if;
end;
$$;

create or replace function public.leave_group(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.my_group(p_chat);
  delete from public.conversation_members where conversation_id = p_chat and member_id = auth.uid();
end;
$$;

revoke all on function private.raise_not_group_runner(text), private.group_name(text), private.put_in_group(uuid, uuid[]),
  private.my_group(uuid) from public, anon, authenticated;
revoke all on function public.create_group_chat(text, uuid[]), public.add_to_group(uuid, uuid[]), public.rename_group(uuid, text),
  public.remove_from_group(uuid, uuid), public.leave_group(uuid), public.chat_reports(), public.chat_list(),
  public.pick_site_photo(uuid, text, boolean) from public, anon;
grant execute on function public.create_group_chat(text, uuid[]), public.add_to_group(uuid, uuid[]), public.rename_group(uuid, text),
  public.remove_from_group(uuid, uuid), public.leave_group(uuid), public.chat_reports(), public.chat_list(),
  public.pick_site_photo(uuid, text, boolean) to authenticated;
