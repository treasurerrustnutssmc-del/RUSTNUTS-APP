-- The club gallery: members add photos and videos straight to Photos (not through a chat), filed
-- under a ride or "Club life", and can tick "OK for the website" so the Social Media Officer, their
-- crew or the NEC can approve them onto the public website. Photos and ride walls now show these
-- beside the chat photos. Same rules and words as src/domain/gallery.ts, in the same order
-- (checked by supabase/tests/gallery_test.sql).
-- Spec: docs/superpowers/specs/2026-11-23-club-gallery-design.md. Needs 20270970000000_gallery_kind.sql,
-- the chat, website photos (site_photos) and storage purge migrations.

-- ---------------------------------------------------------------------------------------------
-- The list

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.members (id) on delete set null,
  ride_id uuid references public.rides (id) on delete set null,
  kind public.chat_media_kind not null check (kind in ('photo', 'video')),
  -- In the chat-media bucket, under gallery/<uploader id>/.
  path text not null unique,
  poster_path text,
  width int not null default 0,
  height int not null default 0,
  duration_ms int,
  caption text check (caption is null or length(caption) between 1 and 120),
  website_ok boolean not null default false,
  website_declined_at timestamptz,
  website_declined_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.members (id) on delete set null
);
create index gallery_items_feed_idx on public.gallery_items (created_at desc, id desc) where removed_at is null;
create index gallery_items_ride_idx on public.gallery_items (ride_id) where removed_at is null;
create index gallery_items_uploaded_by_idx on public.gallery_items (uploaded_by);
create index gallery_items_removed_by_idx on public.gallery_items (removed_by);
create index gallery_items_declined_by_idx on public.gallery_items (website_declined_by);
create index gallery_items_waiting_idx on public.gallery_items (created_at) where website_ok and website_declined_at is null and removed_at is null;
-- Read only through the functions below.
alter table public.gallery_items enable row level security;
revoke all on public.gallery_items from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Files: the chat-media bucket, gallery/<member id>/<file>. Every approved member reads them; each
-- member uploads only into their own folder.

create policy gallery_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and split_part(name, '/', 1) = 'gallery'
              and split_part(name, '/', 2) = (select auth.uid())::text and (select private.is_approved_member()));
create policy gallery_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and split_part(name, '/', 1) = 'gallery' and (select private.is_approved_member()));
-- An upload that never made it onto the list can be cleared by whoever uploaded it. Storage policies
-- run as the member, who can't read gallery_items, so the check is a definer helper (a policy that
-- errors breaks every bucket's deletes).
create or replace function private.gallery_file_listed(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gallery_items g where g.path = p_name or g.poster_path = p_name);
$$;
revoke all on function private.gallery_file_listed(text) from public, anon;
grant execute on function private.gallery_file_listed(text) to authenticated;
create policy gallery_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and split_part(name, '/', 1) = 'gallery'
         and split_part(name, '/', 2) = (select auth.uid())::text
         and not private.gallery_file_listed(name));

-- ---------------------------------------------------------------------------------------------
-- The website list can hold gallery photos and videos.

alter table public.site_photos add column gallery_id uuid references public.gallery_items (id) on delete cascade;
alter table public.site_photos add column kind text not null default 'photo' check (kind in ('photo', 'video'));
alter table public.site_photos add column poster_path text;
-- A website video's public addresses on the club's Cloudflare storage, set by the site-video-copy
-- function. A video shows on the website only once it has them.
alter table public.site_photos add column video_url text;
alter table public.site_photos add column poster_url text;
create index site_photos_gallery_idx on public.site_photos (gallery_id);
create unique index site_photos_gallery_once on public.site_photos (gallery_id) where gallery_id is not null;
do $$
declare c record;
begin
  -- The old rule "only chat photos sit in chat-media" becomes "chat and gallery ones do".
  for c in
    select conname from pg_constraint
    where conrelid = 'public.site_photos'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%bucket%chat-media%'
  loop
    execute format('alter table public.site_photos drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.site_photos add constraint site_photos_bucket_by_source
  check ((source in ('chat', 'gallery')) = (bucket = 'chat-media'));
alter table public.site_photos add constraint site_photos_gallery_source
  check ((source = 'gallery') = (gallery_id is not null));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Adds photos and videos already uploaded into the member's gallery folder. p_items is a list of
-- {kind, path, poster_path, width, height, duration_ms}. Gives how many went in.
create or replace function public.add_gallery_items(p_ride uuid, p_caption text, p_website_ok boolean, p_consent boolean, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  n int := case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end;
  it jsonb;
  folder text := 'gallery/' || coalesce(me::text, '') || '/';
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if n < 1 then raise exception 'Pick at least one photo or video.'; end if;
  if n > 10 then raise exception 'Up to 10 photos or videos at a time.'; end if;
  if p_ride is not null and not exists (select 1 from public.rides where id = p_ride) then raise exception 'No such ride.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;
  if coalesce(p_website_ok, false) and not coalesce(p_consent, false) then
    raise exception 'Tick that everyone in them is happy to be on the website.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it->>'kind', '') not in ('photo', 'video')
       or coalesce(it->>'path', '') not like folder || '%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = it->>'path')
       or exists (select 1 from public.gallery_items g where g.path = it->>'path')
       or (it->>'poster_path' is not null and (
             it->>'kind' <> 'video' or it->>'poster_path' not like folder || '%'
             or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = it->>'poster_path')))
    then
      raise exception 'That file didn’t upload properly. Try again.';
    end if;
  end loop;
  insert into public.gallery_items (uploaded_by, ride_id, kind, path, poster_path, width, height, duration_ms, caption, website_ok)
  select me, p_ride, (x.e->>'kind')::public.chat_media_kind, x.e->>'path', x.e->>'poster_path',
         greatest(coalesce((x.e->>'width')::int, 0), 0), greatest(coalesce((x.e->>'height')::int, 0), 0),
         case when x.e->>'kind' = 'video' then nullif(greatest(coalesce((x.e->>'duration_ms')::int, 0), 0), 0) end,
         v_caption, coalesce(p_website_ok, false)
  from jsonb_array_elements(p_items) with ordinality as x(e, i)
  order by x.i;
  return n;
end;
$$;

-- Takes one down: the member who added it, or the website photo crew. The files are queued for the
-- storage purge and it leaves the website too.
create or replace function public.remove_gallery_item(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.gallery_items%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into g from public.gallery_items where id = p_id for update;
  if not found then raise exception 'No such photo or video.'; end if;
  if g.uploaded_by is distinct from me and not private.is_site_photo_editor() then
    raise exception 'Only the member who added it or the website photo crew can take it down.';
  end if;
  if g.removed_at is not null then raise exception 'That has already been taken down.'; end if;
  update public.gallery_items set removed_at = now(), removed_by = me where id = p_id;
  update public.site_photos set status = 'removed', removed_at = now(), removed_by = me
  where gallery_id = p_id and status <> 'removed';
  insert into private.storage_purge (bucket, path, member_id)
  select 'chat-media', f, g.uploaded_by from unnest(array[g.path, g.poster_path]) f where f is not null;
end;
$$;

-- An editor puts a ticked one on the website, live at once (the uploader gets the usual heads-up).
create or replace function public.approve_gallery_for_site(p_id uuid, p_caption text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.gallery_items%rowtype;
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  select * into g from public.gallery_items where id = p_id for update;
  if not found or g.removed_at is not null then raise exception 'No such photo or video.'; end if;
  if not g.website_ok or g.website_declined_at is not null or exists (select 1 from public.site_photos where gallery_id = p_id) then
    raise exception 'That one isn’t waiting for the website any more.';
  end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;
  insert into public.site_photos (source, gallery_id, bucket, path, poster_path, kind, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('gallery', p_id, 'chat-media', g.path, g.poster_path, g.kind::text, g.width, g.height, coalesce(v_caption, g.caption),
          g.uploaded_by, me, 'live', now())
  returning id into new_id;
  return new_id;
end;
$$;

-- An editor says not this one: it stays in the gallery, off the website.
create or replace function public.decline_gallery_for_site(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.gallery_items%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  select * into g from public.gallery_items where id = p_id for update;
  if not found or g.removed_at is not null then raise exception 'No such photo or video.'; end if;
  if not g.website_ok or g.website_declined_at is not null or exists (select 1 from public.site_photos where gallery_id = p_id) then
    raise exception 'That one isn’t waiting for the website any more.';
  end if;
  update public.gallery_items set website_declined_at = now(), website_declined_by = me where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reading

-- One gallery item, shaped like private.media_json (no message or chat) plus its own bits.
create or replace function private.gallery_json(g public.gallery_items)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', g.id, 'message_id', null, 'conversation_id', null, 'kind', g.kind, 'path', g.path,
                            'poster_path', g.poster_path, 'width', g.width, 'height', g.height, 'duration_ms', g.duration_ms,
                            'position', 0, 'author_id', g.uploaded_by, 'created_at', g.created_at,
                            'gallery', true, 'ride_id', g.ride_id, 'caption', g.caption);
$$;
revoke all on function private.gallery_json(public.gallery_items) from public, anon, authenticated;

-- Photos and videos from the group chats you can read (never private ones) and the gallery,
-- newest first, whole chat messages at a time until about p_limit items, older than p_before.
create or replace function public.club_photos(p_before timestamptz, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    with groups as (
      select m.id, m.created_at, false as gallery,
             (select count(*) from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video')) as n
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind <> 'direct' and m.removed_at is null
        and (p_before is null or m.created_at < p_before)
        and exists (select 1 from public.message_media mm where mm.message_id = m.id and mm.kind in ('photo', 'video'))
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        and private.can_read_chat(c.id)
      union all
      select g.id, g.created_at, true, 1
      from public.gallery_items g
      where g.removed_at is null and (p_before is null or g.created_at < p_before)
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = g.uploaded_by)
    ),
    running as (
      select groups.*, sum(n) over (order by created_at desc, id desc) - n as before_this from groups
    ),
    kept as (
      select * from running where before_this < least(greatest(coalesce(p_limit, 60), 1), 200)
    ),
    items as (
      select private.media_json(mm, m) as j, m.created_at, m.id as gid, mm.position
      from kept k
      join public.messages m on m.id = k.id and not k.gallery
      join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      union all
      select private.gallery_json(g), g.created_at, g.id, 0
      from kept k join public.gallery_items g on g.id = k.id and k.gallery
    )
    select jsonb_agg(j order by created_at desc, gid desc, position) from items
  ), '[]'::jsonb);
end;
$$;

-- Rides with photos or videos (from their chat or the gallery), newest ride first, each with its
-- newest item as a cover. chat_id is null for a ride with no chat.
create or replace function public.ride_walls()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not private.is_approved_member() then return '[]'::jsonb; end if;
  return coalesce((
    with items as (
      select c.ride_id, private.media_json(mm, m) as j, m.created_at, mm.position
      from public.conversations c
      join public.messages m on m.conversation_id = c.id and m.removed_at is null
      join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
      where c.kind = 'ride' and c.ride_id is not null
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
      union all
      select g.ride_id, private.gallery_json(g), g.created_at, 0
      from public.gallery_items g
      where g.ride_id is not null and g.removed_at is null
        and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = g.uploaded_by)
    )
    select jsonb_agg(wall order by starts_at desc)
    from (
      select r.starts_at, jsonb_build_object(
        'ride', private.ride_json(r),
        'chat_id', (select c.id from public.conversations c where c.kind = 'ride' and c.ride_id = r.id limit 1),
        'count', count(*),
        'cover', (array_agg(i.j order by i.created_at desc, i.position))[1]
      ) as wall
      from items i join public.rides r on r.id = i.ride_id
      group by r.id
    ) walls
  ), '[]'::jsonb);
end;
$$;

-- One ride's wall: the ride, its chat (or null) and every photo and video, newest first.
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
      select jsonb_agg(j order by created_at desc, position)
      from (
        select private.media_json(mm, m) as j, m.created_at, mm.position
        from public.messages m join public.message_media mm on mm.message_id = m.id and mm.kind in ('photo', 'video')
        where m.conversation_id = chat and m.removed_at is null
          and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = m.author_id)
        union all
        select private.gallery_json(g), g.created_at, 0
        from public.gallery_items g
        where g.ride_id = p_ride and g.removed_at is null
          and not exists (select 1 from public.member_blocks b where b.blocker_id = me and b.blocked_id = g.uploaded_by)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- What waits for the website: ticked, not declined, never on the list. Editors only, oldest first.
create or replace function public.gallery_for_site()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_site_photo_editor() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.gallery_json(g) || jsonb_build_object('website_ok', true) order by g.created_at, g.id)
    from public.gallery_items g
    where g.website_ok and g.website_declined_at is null and g.removed_at is null
      and not exists (select 1 from public.site_photos p where p.gallery_id = g.id)
  ), '[]'::jsonb);
end;
$$;

-- The website's feed: the newest 60 live photos, and videos once they're on the club's Cloudflare
-- storage, with their album (the ride, or none for Club life). Nothing personal.
drop function if exists public.public_site_photos();
create function public.public_site_photos()
returns table (id uuid, bucket text, path text, width int, height int, caption text, taken_at timestamptz,
               kind text, video_url text, poster_url text, poster_path text, album text, album_date date)
language sql stable security definer set search_path = '' as $$
  select p.id, p.bucket, p.path, p.width, p.height, p.caption,
         coalesce(
           (select m.created_at from public.message_media mm join public.messages m on m.id = mm.message_id where mm.id = p.media_id),
           (select g.created_at from public.gallery_items g where g.id = p.gallery_id),
           p.picked_at) as taken_at,
         p.kind, p.video_url, p.poster_url, p.poster_path,
         r.title as album, (r.starts_at at time zone 'Australia/Melbourne')::date as album_date
  from public.site_photos p
  left join public.gallery_items g on g.id = p.gallery_id
  left join public.message_media mm on mm.id = p.media_id
  left join public.conversations c on c.id = mm.conversation_id and c.kind = 'ride'
  left join public.rides r on r.id = coalesce(g.ride_id, c.ride_id)
  where p.status = 'live' and (p.kind = 'photo' or p.video_url is not null)
  order by taken_at desc, p.id
  limit 60;
$$;
revoke all on function public.public_site_photos() from public;
grant execute on function public.public_site_photos() to anon, authenticated;

revoke all on function
  public.add_gallery_items(uuid, text, boolean, boolean, jsonb), public.remove_gallery_item(uuid),
  public.approve_gallery_for_site(uuid, text), public.decline_gallery_for_site(uuid), public.gallery_for_site(),
  public.club_photos(timestamptz, int), public.ride_walls(), public.ride_wall(uuid)
  from public, anon;
grant execute on function
  public.add_gallery_items(uuid, text, boolean, boolean, jsonb), public.remove_gallery_item(uuid),
  public.approve_gallery_for_site(uuid, text), public.decline_gallery_for_site(uuid), public.gallery_for_site(),
  public.club_photos(timestamptz, int), public.ride_walls(), public.ride_wall(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A member who deletes their account: their gallery files are queued for the storage purge (listed
-- or not) and their items leave the gallery and the website.

create or replace function private.forget_gallery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_purge (bucket, path, member_id)
  select 'chat-media', o.name, old.member_id from storage.objects o
  where o.bucket_id = 'chat-media' and split_part(o.name, '/', 1) = 'gallery' and split_part(o.name, '/', 2) = old.member_id::text;
  delete from public.gallery_items where uploaded_by = old.member_id;
  update public.gallery_items set removed_by = null where removed_by = old.member_id;
  update public.gallery_items set website_declined_by = null where website_declined_by = old.member_id;
  return null;
end;
$$;
revoke all on function private.forget_gallery() from public, anon, authenticated;
create trigger member_private_forget_gallery after delete on public.member_private
  for each row execute function private.forget_gallery();
