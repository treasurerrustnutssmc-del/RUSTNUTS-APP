-- Social extras (Stage 7): garage build threads. The owner of a project bike posts updates (words
-- and up to four photos) on its build. Updates change only through post_build_update and
-- take_down_build_update, which apply the same checks with the same words as
-- src/domain/social/builds.ts, in the same order. Nothing is ever deleted: an update taken down keeps
-- its row, with who took it down.

create table public.build_updates (
  id uuid primary key default gen_random_uuid(),
  -- A bike removed from a garage leaves its updates (and who took any down) behind, hidden.
  bike_id uuid references public.bikes (id) on delete set null,
  author_id uuid not null references public.members (id) on delete cascade,
  body text check (char_length(body) between 1 and 2000),
  -- [{path, width, height}]. Paths are in the poster's build-media folder.
  photos jsonb not null default '[]' check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 4),
  posted_at timestamptz not null default now(),
  taken_down_at timestamptz,
  taken_down_by uuid references public.members (id) on delete set null,
  constraint build_updates_not_empty check (body is not null or jsonb_array_length(photos) > 0)
);
create index build_updates_bike on public.build_updates (bike_id, posted_at desc);

-- Approved members read what's up from approved owners; nobody writes through the API.
alter table public.build_updates enable row level security;
revoke all on public.build_updates from public, anon, authenticated;
grant select on public.build_updates to authenticated;
create policy build_updates_for_members on public.build_updates for select to authenticated
  using (private.is_approved_member() and taken_down_at is null and private.is_approved(author_id));

-- ---------------------------------------------------------------------------------------------
-- Photos: a private bucket, like swap-media. Approved members upload into their own folder and
-- read the photos of updates they can see, plus their own uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('build-media', 'build-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_read_build_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.build_updates u
      where u.taken_down_at is null and private.is_approved(u.author_id)
        and u.photos @> jsonb_build_array(jsonb_build_object('path', p_name))
    )
  );
$$;

-- Whether a file is on any update, taken-down ones included (the caller can't see those).
create or replace function private.build_file_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.build_updates u where u.photos @> jsonb_build_array(jsonb_build_object('path', p_name)));
$$;
revoke all on function private.can_read_build_file(text), private.build_file_in_use(text) from public, anon;
grant execute on function private.can_read_build_file(text), private.build_file_in_use(text) to authenticated;

create policy build_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'build-media' and split_part(name, '/', 1) = auth.uid()::text and private.is_approved_member());
create policy build_media_read on storage.objects for select to authenticated
  using (bucket_id = 'build-media' and private.can_read_build_file(name));
-- An upload that never made it onto an update can be cleared away by whoever uploaded it. A photo
-- on an update stays, even once it's taken down.
create policy build_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'build-media' and owner_id = auth.uid()::text and not private.build_file_in_use(name));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Posts an update on your project bike's build, returning its id. Words are trimmed like the app
-- trims them. Photos: [{path, width, height}], up to four, each already uploaded by you into your
-- own folder, on no other update, and not twice.
create or replace function public.post_build_update(p_bike uuid, p_body text, p_photos jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  b public.bikes%rowtype;
  c_body text := nullif(private.trim_like_app(p_body), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  bad boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into b from public.bikes where id = p_bike;
  if not found then raise exception 'No such bike.'; end if;
  if b.member_id <> me then raise exception 'Only the bike’s owner can post on its build.'; end if;
  if not b.is_project then
    raise exception 'Build threads are for project bikes. Mark it as a project in your garage first.';
  end if;
  if jsonb_typeof(v_photos) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  if c_body is null and jsonb_array_length(v_photos) = 0 then raise exception 'Write something or add a photo.'; end if;
  if char_length(c_body) > 2000 then raise exception 'Keep it to 2,000 characters at most.'; end if;
  if jsonb_array_length(v_photos) > 4 then raise exception 'Up to 4 photos.'; end if;

  select exists (
    select 1 from jsonb_array_elements(v_photos) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'path') is distinct from 'string'
       or split_part(item->>'path', '/', 1) <> me::text
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'build-media' and o.name = item->>'path' and o.owner_id = me::text)
       or private.build_file_in_use(item->>'path')
       or (select count(*) from jsonb_array_elements(v_photos) sib where sib->>'path' = item->>'path') > 1
  ) into bad;
  if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  -- Kept as just the path and size.
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', item->>'path',
           'width', case when jsonb_typeof(item->'width') = 'number' then round((item->>'width')::numeric) end,
           'height', case when jsonb_typeof(item->'height') = 'number' then round((item->>'height')::numeric) end)
         order by i), '[]')
  into v_photos from jsonb_array_elements(v_photos) with ordinality as e(item, i);

  insert into public.build_updates (bike_id, author_id, body, photos)
  values (p_bike, me, c_body, v_photos)
  returning id into new_id;
  return new_id;
end;
$$;

-- Takes an update down: whoever posted it, or the board or NEC. It's kept, with who took it down.
create or replace function public.take_down_build_update(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  u public.build_updates%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into u from public.build_updates where id = p_id for update;
  if not found then raise exception 'No such update.'; end if;
  if u.author_id <> me and not private.is_any_board() then
    raise exception 'Only whoever posted it or the board can take it down.';
  end if;
  if u.taken_down_at is not null then raise exception 'That update has already been taken down.'; end if;
  update public.build_updates set taken_down_at = now(), taken_down_by = me where id = p_id;
end;
$$;

revoke all on function public.post_build_update(uuid, text, jsonb), public.take_down_build_update(uuid) from public, anon;
grant execute on function public.post_build_update(uuid, text, jsonb), public.take_down_build_update(uuid) to authenticated;
