-- Club photos on the public website (website-and-app task 23). The Social Media Officer, a crew
-- they approve, and the NEC put photos from the club's chats (or their phone) on the website. A
-- photo someone else posted waits for that member's OK (a push and a Home card). Same rules and
-- words as src/domain/sitePhotos.ts, in the same order (checked by supabase/tests/site_photos_test.sql).
-- Spec: docs/superpowers/specs/2026-11-02-website-photos-design.md. Needs the chat (message_media),
-- push (private.push_outbox) and storage purge (private.storage_purge) migrations.

-- ---------------------------------------------------------------------------------------------
-- Who

create table public.site_photo_crew (
  member_id uuid primary key references public.members (id) on delete cascade,
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now()
);
create index site_photo_crew_added_by_idx on public.site_photo_crew (added_by);
alter table public.site_photo_crew enable row level security;
revoke all on public.site_photo_crew from public, anon, authenticated;
grant select on public.site_photo_crew to authenticated;
-- Every approved member can see who the crew is (the app offers the right buttons from it).
create policy site_photo_crew_for_members on public.site_photo_crew for select to authenticated
  using (private.is_approved_member());

-- The Social Media Officer (either chapter) or the NEC. Mirrors managesSitePhotoCrew.
create or replace function private.manages_site_photo_crew()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and role = 'social_media_officer'
    )
  );
$$;
revoke all on function private.manages_site_photo_crew() from public, anon;
grant execute on function private.manages_site_photo_crew() to authenticated;

-- The crew manager or someone on the crew. Mirrors isSitePhotoEditor.
create or replace function private.is_site_photo_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_site_photo_crew()
    or (private.is_approved_member() and exists (select 1 from public.site_photo_crew where member_id = auth.uid()));
$$;
revoke all on function private.is_site_photo_editor() from public, anon;
grant execute on function private.is_site_photo_editor() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The list

create type public.site_photo_source as enum ('chat', 'upload');
create type public.site_photo_status as enum ('waiting', 'live', 'declined', 'removed');

create table public.site_photos (
  id uuid primary key default gen_random_uuid(),
  source public.site_photo_source not null,
  -- A chat photo's media row: the photo leaves the list with the message.
  media_id uuid references public.message_media (id) on delete cascade,
  bucket text not null check (bucket in ('chat-media', 'site-media')),
  path text not null,
  width int not null default 0,
  height int not null default 0,
  caption text check (caption is null or length(caption) between 1 and 120),
  -- Whose photo it is: the chat message's author, or the uploader.
  posted_by uuid references public.members (id) on delete set null,
  picked_by uuid references public.members (id) on delete set null,
  picked_at timestamptz not null default now(),
  status public.site_photo_status not null,
  decided_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.members (id) on delete set null,
  check ((source = 'chat') = (media_id is not null)),
  check ((source = 'chat') = (bucket = 'chat-media')),
  check ((removed_at is null) = (status <> 'removed'))
);
-- One ask per chat photo while it stands (a taken-down one can go up again).
create unique index site_photos_media_once on public.site_photos (media_id) where media_id is not null and status <> 'removed';
create index site_photos_posted_by_idx on public.site_photos (posted_by, status);
create index site_photos_picked_by_idx on public.site_photos (picked_by);
create index site_photos_removed_by_idx on public.site_photos (removed_by);
create index site_photos_live_idx on public.site_photos (picked_at desc) where status = 'live';

alter table public.site_photos enable row level security;
revoke all on public.site_photos from public, anon, authenticated;
grant select on public.site_photos to authenticated;
-- Editors see the whole list; everyone sees the photos that are theirs (asks and live ones).
create policy site_photos_for_editors_and_posters on public.site_photos for select to authenticated
  using ((select private.is_site_photo_editor()) or posted_by = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Uploads from the phone: a private bucket, each editor's own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy site_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and split_part(name, '/', 1) = auth.uid()::text and private.is_site_photo_editor());
create policy site_media_read on storage.objects for select to authenticated
  using (bucket_id = 'site-media' and (split_part(name, '/', 1) = auth.uid()::text or private.is_site_photo_editor()));
-- An upload that never made it onto the list can be cleared by whoever uploaded it.
create policy site_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and split_part(name, '/', 1) = auth.uid()::text
         and not exists (select 1 from public.site_photos p where p.bucket = 'site-media' and p.path = name));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Puts a chat photo on the list. The editor's own photo goes live; someone else's waits for them.
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
  if exists (select 1 from public.site_photos where media_id = p_media and status <> 'removed') then
    raise exception 'That photo is already on the list.';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Tick that everyone in the photo is happy to be on the website.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;

  insert into public.site_photos (source, media_id, bucket, path, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('chat', p_media, 'chat-media', mm.path, mm.width, mm.height, v_caption, m.author_id, me,
          case when m.author_id = me then 'live' else 'waiting' end::public.site_photo_status,
          case when m.author_id = me then now() else null end)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.pick_site_photo(uuid, text, boolean) from public, anon;
grant execute on function public.pick_site_photo(uuid, text, boolean) to authenticated;

-- Puts a photo from the editor's phone on the list (already uploaded into their site-media folder).
create or replace function public.upload_site_photo(p_path text, p_width int, p_height int, p_caption text, p_consent boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Tick that everyone in the photo is happy to be on the website.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> me::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'site-media' and o.name = p_path) then
    raise exception 'That photo didn’t upload properly. Try again.';
  end if;
  insert into public.site_photos (source, bucket, path, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('upload', 'site-media', p_path, greatest(coalesce(p_width, 0), 0), greatest(coalesce(p_height, 0), 0), v_caption, me, me, 'live', now())
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.upload_site_photo(text, int, int, text, boolean) from public, anon;
grant execute on function public.upload_site_photo(text, int, int, text, boolean) to authenticated;

-- The poster's answer to "Photo for the website?".
create or replace function public.answer_site_photo(p_id uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.site_photos%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into p from public.site_photos where id = p_id for update;
  if not found then raise exception 'No such photo.'; end if;
  if p.posted_by is distinct from me then raise exception 'Only the member who posted the photo can answer.'; end if;
  if p.status <> 'waiting' then raise exception 'That one has already been answered.'; end if;
  update public.site_photos
  set status = case when coalesce(p_yes, false) then 'live' else 'declined' end::public.site_photo_status, decided_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.answer_site_photo(uuid, boolean) from public, anon;
grant execute on function public.answer_site_photo(uuid, boolean) to authenticated;

-- Takes a photo off the website: any editor, or the member whose photo it is.
create or replace function public.remove_site_photo(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.site_photos%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into p from public.site_photos where id = p_id for update;
  if not found then raise exception 'No such photo.'; end if;
  if not private.is_site_photo_editor() and p.posted_by is distinct from me then
    raise exception 'Only the website photo crew or the member who posted it can take it down.';
  end if;
  if p.status = 'removed' then raise exception 'That photo has already been taken down.'; end if;
  update public.site_photos set status = 'removed', removed_at = now(), removed_by = me where id = p_id;
end;
$$;
revoke all on function public.remove_site_photo(uuid) from public, anon;
grant execute on function public.remove_site_photo(uuid) to authenticated;

-- Puts a member on the crew (p_on) or takes them off.
create or replace function public.set_site_photo_crew(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t public.members%rowtype;
  on_crew boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.manages_site_photo_crew() then
    raise exception 'Only the Social Media Officer or the NEC can change the website photo crew.';
  end if;
  select * into t from public.members where id = p_member;
  if not found or t.approval <> 'approved' then raise exception 'Only approved members can join the crew.'; end if;
  on_crew := exists (select 1 from public.site_photo_crew where member_id = p_member);
  if coalesce(p_on, false) then
    if t.on_hiatus then raise exception 'Members on hiatus can’t join the crew.'; end if;
    if on_crew then raise exception 'They’re already on the crew.'; end if;
    insert into public.site_photo_crew (member_id, added_by) values (p_member, me);
  else
    if not on_crew then raise exception 'They’re not on the crew.'; end if;
    delete from public.site_photo_crew where member_id = p_member;
  end if;
end;
$$;
revoke all on function public.set_site_photo_crew(uuid, boolean) from public, anon;
grant execute on function public.set_site_photo_crew(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading

-- The app's list: editors get every row, everyone else the rows that are theirs (row-level
-- security does the narrowing). Live first, then waiting, declined and taken down; newest pick first.
create or replace function public.list_site_photos()
returns setof public.site_photos
language sql stable security invoker set search_path = '' as $$
  select * from public.site_photos
  order by case status when 'live' then 0 when 'waiting' then 1 when 'declined' then 2 else 3 end, picked_at desc, id;
$$;
revoke all on function public.list_site_photos() from public, anon;
grant execute on function public.list_site_photos() to authenticated;

-- The website's feed: the newest 60 live photos, by when the photo was posted (the chat message's
-- time, or the upload's). Nothing personal. Mirrors publicSitePhotos in src/domain/sitePhotos.ts.
create or replace function public.public_site_photos()
returns table (id uuid, bucket text, path text, width int, height int, caption text, taken_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.bucket, p.path, p.width, p.height, p.caption,
         coalesce((select m.created_at from public.message_media mm join public.messages m on m.id = mm.message_id where mm.id = p.media_id), p.picked_at) as taken_at
  from public.site_photos p
  where p.status = 'live'
  order by taken_at desc, p.id
  limit 60;
$$;
revoke all on function public.public_site_photos() from public;
grant execute on function public.public_site_photos() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- A chat message that is removed (the app's remove_message keeps the row and sets removed_at)
-- takes its photos off the website at the same time. A deleted message cascades on its own.

create or replace function private.site_photos_message_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.site_photos p set status = 'removed', removed_at = now(), removed_by = new.removed_by
  where p.status <> 'removed'
    and p.media_id in (select mm.id from public.message_media mm where mm.message_id = new.id);
  return null;
end;
$$;
revoke all on function private.site_photos_message_removed() from public, anon, authenticated;
create trigger site_photos_message_removed after update of removed_at on public.messages
  for each row when (old.removed_at is null and new.removed_at is not null)
  execute function private.site_photos_message_removed();

-- ---------------------------------------------------------------------------------------------
-- The ask: a push to the poster when their photo is picked by someone else.

create or replace function private.push_site_photo_ask()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  picker public.members%rowtype;
begin
  begin
    if new.status <> 'waiting' or new.posted_by is null or new.picked_by is null then return null; end if;
    select * into picker from public.members where id = new.picked_by;
    if exists (select 1 from public.push_devices d where d.member_id = new.posted_by) then
      insert into private.push_outbox (member_id, dedupe_key, title, body, data)
      values (new.posted_by, 'site-photo:' || new.id, 'Photo for the website?',
              private.short_name(picker) || ' wants to put one of your photos on the club website. Open the app to say yes or no.',
              jsonb_build_object('kind', 'site_photo', 'id', new.id))
      on conflict (member_id, dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'website photo ask % not written: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.push_site_photo_ask() from public, anon, authenticated;
create trigger site_photos_push_ask after insert on public.site_photos
  for each row execute function private.push_site_photo_ask();

-- ---------------------------------------------------------------------------------------------
-- A member who deletes their account: forget_member starts by deleting their member_private row,
-- so that is the hook. Their photos leave the list (chat ones also go with their messages), their
-- uploads are queued for the storage purge, and they are no longer named as the picker.

create or replace function private.forget_site_photos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Every file in their site-media folder, listed or not (an upload whose listing failed is still theirs).
  insert into private.storage_purge (bucket, path, member_id)
  select 'site-media', o.name, old.member_id from storage.objects o
  where o.bucket_id = 'site-media' and split_part(o.name, '/', 1) = old.member_id::text;
  delete from public.site_photos where posted_by = old.member_id;
  update public.site_photos set picked_by = null where picked_by = old.member_id;
  delete from public.site_photo_crew where member_id = old.member_id;
  return null;
end;
$$;
revoke all on function private.forget_site_photos() from public, anon, authenticated;
create trigger member_private_forget_site_photos after delete on public.member_private
  for each row execute function private.forget_site_photos();
