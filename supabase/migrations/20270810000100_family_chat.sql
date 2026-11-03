-- Family chat, part 2 of 2. See docs/superpowers/specs/2026-11-03-family-chat-design.md.
-- One club-wide chat that every member (FNG and up) and every approved Family person shares. Family
-- see this chat and no other. The club rules for chats and posts, reports, blocks and moderation
-- (any board member or the NEC) apply as in the whole-club chat. Mirrored by src/domain/chat.ts.
-- Additive: one row, one index, new and redefined functions. No drops, no data changed.

insert into public.conversations (kind)
select 'family' where not exists (select 1 from public.conversations where kind = 'family');
create unique index if not exists conversations_one_family on public.conversations (kind) where kind = 'family';

-- Who uses the chats at all: an approved member, or an approved Family person (who then only gets
-- the Family chat, by private.chat_problem). Mirrors approvalProblem.
create or replace function private.is_chat_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() or private.is_family();
$$;
revoke all on function private.is_chat_user() from public, anon;

-- Why the caller can't read this chat, or null when they can. Same words as readProblem. Otherwise as
-- in 20270560000000_audit_decisions.sql.
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
    return 'That chat opens up once you’re an FNG.';
  end if;
  if c.kind = 'chapter' then
    if private.chapter_of(auth.uid()) = c.chapter_id or private.is_national() then return null; end if;
    return format('That chat is for %s chapter members.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'board' then
    if private.sees_board_of(c.chapter_id) then return null; end if;
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

-- Otherwise as in 20261101000100_chat.sql: is_chat_user in place of is_approved_member.
create or replace function public.remove_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_chat_user() then raise exception 'Only approved members can do that.'; end if;
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
  if not private.is_chat_user() then raise exception 'Only approved members can do that.'; end if;
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

create or replace function public.report_message(p_message uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m public.messages%rowtype;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  out uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_chat_user() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if m.author_id = auth.uid() then raise exception 'You can’t report your own message.'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Keep the reason under 500 characters.'; end if;

  insert into public.message_reports (message_id, reporter_id, reason, body, media_count)
  values (p_message, auth.uid(), reason, m.body, (select count(*) from public.message_media where message_id = p_message))
  -- Reporting again updates an open report. One that's been dealt with stays dealt with.
  on conflict (message_id, reporter_id) do update
    set reason = excluded.reason
  returning id into out;
  return out;
end;
$$;

create or replace function public.set_block(p_member uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_chat_user() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'That member no longer exists.'; end if;
  if p_member = auth.uid() then raise exception 'You can’t block yourself.'; end if;
  if p_blocked then
    insert into public.member_blocks (blocker_id, blocked_id) values (auth.uid(), p_member) on conflict do nothing;
  else
    delete from public.member_blocks where blocker_id = auth.uid() and blocked_id = p_member;
  end if;
end;
$$;

-- Your chats. Otherwise as in 20270415000700_voice_notes.sql: Family get theirs (the chat rules keep
-- it to the Family chat).
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

-- Family agree to the club rules for chats and posts before their first message, like members.
-- Otherwise as in 20270600000000_member_content_rules.sql.
create or replace function public.accept_posting_rules()
returns date language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  agreed date;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_chat_user() then raise exception 'Only approved members can do that.'; end if;
  update public.members set posting_rules_accepted_on = coalesce(posting_rules_accepted_on, private.club_date()), updated_at = now()
  where id = me
  returning posting_rules_accepted_on into agreed;
  return agreed;
end;
$$;

-- Nobody opens a private chat with a Family person; the words now say where Family do chat.
-- Otherwise as in 20270530000000_family_view.sql.
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
  if target.status = 'family' then raise exception 'Family only use the Family chat, not private chats.'; end if;
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

-- A chat's name as the app shows it (chatTitle). Otherwise as in 20270301000500_chat_push.sql.
create or replace function private.chat_push_title(c public.conversations, sender public.members)
returns text language sql stable security definer set search_path = '' as $$
  select case c.kind::text
    when 'club' then 'Whole club'
    when 'family' then 'Family'
    when 'chapter' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' chapter'
    when 'board' then coalesce((select name from public.chapters where id = c.chapter_id), 'Chapter') || ' big table'
    when 'nec' then 'NEC'
    when 'committee' then case when c.committee = 'charity' then 'Charity committee' else 'Ride committee' end
    when 'ride' then coalesce((select title from public.rides where id = c.ride_id), 'Ride chat')
    else private.short_name(sender)
  end;
$$;

-- For Family: who's who in the Family chat. Everyone who has posted or reacted there, with their road name,
-- first name, chapter and status (as the chat shows it) only. Empty for everyone else (members have the directory).
create or replace function public.family_chat_people()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'road_name', m.road_name, 'first_name', split_part(btrim(m.full_name), ' ', 1),
           'chapter_id', m.chapter_id, 'status', m.status) order by m.id), '[]'::jsonb)
  from public.members m
  where private.is_family()
    and (m.id in (select x.author_id from public.messages x join public.conversations c on c.id = x.conversation_id
                  where c.kind = 'family')
         or m.id in (select r.member_id from public.message_reactions r join public.messages x on x.id = r.message_id
                     join public.conversations c on c.id = x.conversation_id where c.kind = 'family'));
$$;

-- Family chat photos (partners, kids) never go on the public website. Otherwise as in
-- 20270770000000_site_photos.sql.
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

revoke all on function public.remove_message(uuid), public.toggle_reaction(uuid, text), public.report_message(uuid, text),
  public.set_block(uuid, boolean), public.chat_list(), public.accept_posting_rules(), public.family_chat_people()
  from public, anon;
grant execute on function public.remove_message(uuid), public.toggle_reaction(uuid, text), public.report_message(uuid, text),
  public.set_block(uuid, boolean), public.chat_list(), public.accept_posting_rules(), public.family_chat_people()
  to authenticated;
