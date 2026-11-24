-- Board files (Jeff, 23 Nov 2026): a folder for every board seat and one for Club info, read by
-- every chapter board member and the NEC, so the club's paperwork belongs to the seat and a new
-- office holder has it on day one. Spec: docs/superpowers/specs/2026-11-24-board-files-design.md.
-- Mirrors src/domain/boardFiles.ts (readsBoardFiles, writesBoardFolder, addBoardFileProblem,
-- removeBoardFileProblem), in the same words. Safe to run twice.

create table if not exists public.board_files (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id),
  role public.position_role,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 120),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  -- A real folder: Club info, a national seat with a folder, or a chapter's board seat.
  constraint board_files_folder check (
    (chapter_id is null and (role is null or role in ('nec_chair', 'nec_secretary')))
    or (chapter_id is not null and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
  )
);
create index if not exists board_files_folder_idx on public.board_files (chapter_id, role);
create index if not exists board_files_added_by_idx on public.board_files (added_by);

alter table public.board_files enable row level security;
revoke all on public.board_files from public, anon, authenticated;
grant select on public.board_files to authenticated;

drop policy if exists board_files_read on public.board_files;
create policy board_files_read on public.board_files for select to authenticated using ((select private.is_any_board()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-files', 'board-files', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who's who for the folders ---------------------------------------------------------------------

-- A folder the club has (isBoardFolder).
create or replace function private.is_board_folder(p_chapter uuid, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(case
    when p_chapter is null then p_role is null or p_role in ('nec_chair', 'nec_secretary')
    else p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
      and exists (select 1 from public.chapters where id = p_chapter)
  end, false);
$$;

-- Adds to and removes from a folder (writesBoardFolder): any reader for Club info; for a seat,
-- whoever does its duties now, or the National Chairman or Secretary.
create or replace function private.board_folder_writer(p_chapter uuid, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_any_board() and (
    p_role is null
    or private.is_nec_officer()
    or exists (select 1 from private.duty_positions
      where member_id = auth.uid() and role::text = p_role and chapter_id is not distinct from p_chapter));
$$;

-- The folder a bucket path is in: `<chapter id or club>/<role or info>/<file>`. Null when it isn't one.
create or replace function private.board_path_folder(p_name text, out chapter_id uuid, out role text, out ok boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  ok := false;
  if array_length(parts, 1) is distinct from 3 or parts[3] = '' then return; end if;
  if parts[1] = 'club' then chapter_id := null;
  elsif parts[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then chapter_id := parts[1]::uuid;
  else return;
  end if;
  role := case when parts[2] = 'info' then null else parts[2] end;
  ok := private.is_board_folder(chapter_id, role);
end;
$$;

create or replace function private.board_path_writer(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.ok and private.board_folder_writer(f.chapter_id, f.role) from private.board_path_folder(p_name) f), false);
$$;

create or replace function private.board_path_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.board_files where path = p_name);
$$;

revoke all on function private.is_board_folder(uuid, text), private.board_folder_writer(uuid, text), private.board_path_folder(text),
  private.board_path_writer(text), private.board_path_in_use(text) from public, anon;
grant execute on function private.is_board_folder(uuid, text), private.board_folder_writer(uuid, text), private.board_path_folder(text),
  private.board_path_writer(text), private.board_path_in_use(text) to authenticated;

drop policy if exists board_files_upload on storage.objects;
drop policy if exists board_files_read on storage.objects;
drop policy if exists board_files_tidy on storage.objects;

create policy board_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'board-files' and private.board_path_writer(name));
create policy board_files_read on storage.objects for select to authenticated
  using (bucket_id = 'board-files' and private.is_any_board());
-- Only a path no file uses: tidying an upload whose add was refused. Removing goes through remove_board_file.
create policy board_files_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'board-files' and private.board_path_writer(name) and not private.board_path_in_use(name));

-- Actions ---------------------------------------------------------------------------------------

-- The sign-in, reader, folder and writer checks, in the app's order and words.
create or replace function private.require_board_folder(p_chapter uuid, p_role text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.members where id = auth.uid() and approval = 'approved') then
    raise exception 'Only approved members can do that.';
  end if;
  if not private.is_any_board() then raise exception 'Board files are for board members and the NEC.'; end if;
  if not private.is_board_folder(p_chapter, p_role) then raise exception 'That folder isn’t one the club has.'; end if;
  if not private.board_folder_writer(p_chapter, p_role) then
    raise exception 'Only whoever holds this seat, or the National Chairman or Secretary, can change this folder.';
  end if;
end;
$$;
revoke all on function private.require_board_folder(uuid, text) from public, anon;
grant execute on function private.require_board_folder(uuid, text) to authenticated;

-- Files the uploaded p_path (under the folder) as p_name. Resolves to the new file's id.
create or replace function public.add_board_file(p_chapter uuid, p_role text, p_path text, p_name text, p_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ending text := lower(substring(coalesce(p_path, '') from '\.([A-Za-z0-9]+)$'));
  v_name text := left(trim(coalesce(p_name, '')), 120);
  v_folder record;
  v_id uuid;
begin
  perform private.require_board_folder(p_chapter, p_role);
  if v_ending is null or v_ending not in ('pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt') then
    raise exception 'Pick a PDF, photo, Word, Excel or text file.';
  end if;
  if p_size is not null and p_size > 20971520 then raise exception 'That file is over 20 MB. Save a smaller copy and try again.'; end if;
  select * into v_folder from private.board_path_folder(p_path);
  if not v_folder.ok or v_folder.chapter_id is distinct from p_chapter or v_folder.role is distinct from p_role
     or not exists (select 1 from storage.objects o where o.bucket_id = 'board-files' and o.name = p_path)
     or exists (select 1 from public.board_files where path = p_path) then
    raise exception 'That file didn’t upload. Try again.';
  end if;
  if v_name = '' then v_name := 'Board file.' || v_ending; end if; -- as boardFileName
  -- A path queued for the purge job (direct calls only; the app makes a fresh one) comes off the queue.
  delete from private.storage_purge where bucket = 'board-files' and path = p_path and done_at is null;
  insert into public.board_files (chapter_id, role, path, name, size_bytes, added_by)
    values (p_chapter, p_role::public.position_role, p_path, v_name, case when p_size is null then null else greatest(p_size, 0) end, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- Takes a file out of its folder; the purge job clears the bytes.
create or replace function public.remove_board_file(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.board_files;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.members where id = auth.uid() and approval = 'approved') then
    raise exception 'Only approved members can do that.';
  end if;
  if not private.is_any_board() then raise exception 'Board files are for board members and the NEC.'; end if;
  select * into f from public.board_files where id = p_id for update;
  if not found then raise exception 'That file isn’t in board files.'; end if;
  perform private.require_board_folder(f.chapter_id, f.role::text);
  delete from public.board_files where id = p_id;
  insert into private.storage_purge (bucket, path) values ('board-files', f.path);
end;
$$;

revoke all on function public.add_board_file(uuid, text, text, text, bigint), public.remove_board_file(uuid) from public, anon;
grant execute on function public.add_board_file(uuid, text, text, text, bigint), public.remove_board_file(uuid) to authenticated;
