-- Voice notes in chat (Stage 7, PR 8). See docs/superpowers/specs/2026-10-27-social-extras-design.md.
-- A voice note is a recording in the chat-media bucket that goes in a message on its own, up to two
-- minutes. The app applies the same rules with the same words (src/domain/chat.ts, postProblem).
-- Additive: a new media kind, two more file types for the bucket, and the chat functions replaced
-- in place. The new kind is only named inside function bodies (as text), so this runs in one go.

alter type public.chat_media_kind add value if not exists 'voice';

-- The chat-media bucket also takes voice notes: AAC (phones and Safari) and WebM (Chrome, Firefox).
update storage.buckets
set allowed_mime_types = allowed_mime_types
  || array(select t from unnest(array['audio/mp4', 'audio/webm']) t where not (t = any (allowed_mime_types)))
where id = 'chat-media';

-- ---------------------------------------------------------------------------------------------
-- Sending: the same as before, plus the voice note rules.

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
  -- A voice note goes on its own, and has a length (from the recorder) of up to two minutes.
  item := (select value from jsonb_array_elements(media) where jsonb_typeof(value) = 'object' and value->>'kind' = 'voice' limit 1);
  if item is not null then
    if body <> '' or n > 1 then raise exception 'A voice note goes on its own.'; end if;
    if jsonb_typeof(item->'durationMs') is distinct from 'number' or (item->>'durationMs')::numeric <= 0 then
      raise exception 'That voice note didn’t record properly. Try again.';
    end if;
    if (item->>'durationMs')::numeric > 120000 then raise exception 'Voice notes can be up to 2 minutes.'; end if;
  end if;

  -- Each file: the right kind, in this chat's folder, uploaded by the sender, not used before. A GIF
  -- is GIPHY's own https address instead. A voice note is an .m4a or .webm recording with no still.
  for item in select value from jsonb_array_elements(media) loop
    if item->>'kind' = 'gif' then
      if coalesce(item->>'path', '') !~ '^https://(media[0-9]?|i)\.giphy\.com/[A-Za-z0-9_./?&=%-]+$' or item ? 'posterPath' and item->>'posterPath' is not null then
        raise exception 'That photo didn’t upload properly. Try again.';
      end if;
      continue;
    end if;
    select coalesce(item->>'kind', '') not in ('photo', 'video', 'voice')
        or item->>'kind' = 'voice' and (coalesce(item->>'path', '') !~ '\.(m4a|webm)$' or item->>'posterPath' is not null)
        or exists (
             select 1 from jsonb_array_elements_text(
               jsonb_build_array(item->'path') || case when item ? 'posterPath' and item->>'posterPath' is not null
                                                       then jsonb_build_array(item->'posterPath') else '[]'::jsonb end) p
             where p is null
                or split_part(p, '/', 1) <> p_chat::text
                or not exists (select 1 from storage.objects o
                               where o.bucket_id = 'chat-media' and o.name = p and o.owner_id = me::text)
                or exists (select 1 from public.message_media mm where mm.path = p or mm.poster_path = p))
        -- and no file twice in this message, a video's still included
        or (select count(*) from jsonb_array_elements(media) sib
            where sib->>'kind' <> 'gif'
              and (sib->>'path' in (item->>'path', item->>'posterPath') or sib->>'posterPath' in (item->>'path', item->>'posterPath')))
           > 1
        or item->>'path' = item->>'posterPath'
      into bad;
    if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  end loop;

  insert into public.messages (conversation_id, author_id, body, reply_to_id)
  values (p_chat, me, nullif(body, ''), p_reply_to)
  returning id into msg;

  for item in select value from jsonb_array_elements(media) loop
    insert into public.message_media (message_id, conversation_id, kind, path, poster_path, width, height, duration_ms, position)
    values (msg, p_chat, (item->>'kind')::public.chat_media_kind, item->>'path', item->>'posterPath',
            -- Phones can report sizes and lengths with fractions (an iPhone video's length always does).
            coalesce(round((item->>'width')::numeric)::int, 0), coalesce(round((item->>'height')::numeric)::int, 0),
            round((item->>'durationMs')::numeric)::int, pos);
    pos := pos + 1;
  end loop;

  -- Your own message means you've seen the chat up to here.
  insert into public.chat_reads (conversation_id, member_id, read_at) values (p_chat, me, clock_timestamp())
  on conflict (conversation_id, member_id) do update set read_at = excluded.read_at;
  return msg;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The chat list: the newest message also says whether it's a voice note, so the list can say so.

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

-- ---------------------------------------------------------------------------------------------
-- The photo feeds take only photos and videos (they took everything but GIFs), so voice notes stay
-- in their chats: Photos, ride walls and On this day.

create or replace function public.club_photos(p_before timestamptz, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    with msgs as (
      select m.id, m.created_at,
             (select count(*) from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video')) as n
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and (p_before is null or m.created_at < p_before)
        and exists (select 1 from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video'))
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
    ),
    running as (
      select msgs.*, sum(n) over (order by created_at desc, id desc) - n as before_this from msgs
    )
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from running r
    join public.messages m on m.id = r.id
    join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
    where r.before_this < least(greatest(coalesce(p_limit, 60), 1), 200)
  ), '[]'::jsonb);
end;
$$;

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
      join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      where c.kind = 'ride'
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      group by c.id, r.*
    ) walls
  ), '[]'::jsonb);
end;
$$;

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
      from public.messages m join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      where m.conversation_id = chat and m.removed_at is null
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.photos_on_this_day()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := private.club_date();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.media_json(mm, m) order by m.created_at desc, m.id desc, mm.position)
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and private.is_on_this_day(private.club_date(m.created_at), today)
        and exists (select 1 from public.message_media x where x.message_id = m.id and x.kind in ('photo', 'video'))
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
      order by m.created_at desc
      limit 60
    ) m
    join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
  ), '[]'::jsonb);
end;
$$;
