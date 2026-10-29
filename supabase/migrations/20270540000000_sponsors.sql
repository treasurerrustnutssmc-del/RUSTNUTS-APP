-- The club's sponsors: a logo, a short blurb, a link and any deal for members. Any board seat or
-- the NEC looks after the list (private.is_any_board). Anyone with the app sees the sponsors
-- (public.list_sponsors); the member deals are for approved members only. Everything changes
-- only through save_sponsor and archive_sponsor, which apply the same checks with the same words as
-- src/domain/sponsors.ts, in the same order. Nothing is ever deleted: a sponsor taken off is
-- archived, with who took it off.

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  blurb text check (char_length(blurb) between 1 and 300),
  url text check (char_length(url) <= 300 and url ~* '^https?://'),
  -- What members get, like "10% off tyres, show your card".
  deal text check (char_length(deal) between 1 and 200),
  -- A file in the sponsor-logos bucket.
  logo_path text,
  -- null: the whole club.
  chapter_id uuid references public.chapters (id),
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null
);

-- Approved members read what hasn't been taken off; the board reads the lot, so an edit to a
-- sponsor someone else took off gets the right words. Nobody writes through the API.
alter table public.sponsors enable row level security;
revoke all on public.sponsors from public, anon, authenticated;
grant select on public.sponsors to authenticated;
create policy sponsors_for_members on public.sponsors for select to authenticated
  using (private.is_approved_member() and archived_at is null);
-- Policies run as the caller, who can't call private.is_any_board, so this asks for them.
create or replace function private.is_sponsor_keeper()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_any_board();
$$;
revoke all on function private.is_sponsor_keeper() from public, anon;
grant execute on function private.is_sponsor_keeper() to authenticated;
create policy sponsors_for_board on public.sponsors for select to authenticated
  using (private.is_sponsor_keeper());

-- Everyone's view of the list, signed out included: the deal only for approved members, and
-- sponsors taken off only for the board. The same as sponsorsSeenBy in src/domain/sponsors.ts.
create or replace function public.list_sponsors()
returns table (id uuid, name text, blurb text, url text, deal text, logo_path text, chapter_id uuid,
               added_by uuid, archived_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.blurb, s.url,
         case when private.is_approved_member() then s.deal end,
         s.logo_path, s.chapter_id, s.added_by, s.archived_at
  from public.sponsors s
  where s.archived_at is null or private.is_any_board()
  order by s.name;
$$;
revoke all on function public.list_sponsors() from public;
grant execute on function public.list_sponsors() to anon, authenticated;

-- Logos: a private bucket. Anyone with the app reads the logos of sponsors on the list; the board
-- reads them all and uploads into their own folder (`<member id>/...`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.can_upload_sponsor_logo(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 1) = auth.uid()::text and private.is_any_board();
$$;
revoke all on function private.can_upload_sponsor_logo(text) from public, anon;
grant execute on function private.can_upload_sponsor_logo(text) to authenticated;

create policy sponsor_logos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and private.can_upload_sponsor_logo(name));
create or replace function private.can_read_sponsor_logo(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_any_board() or exists (
    select 1 from public.sponsors where logo_path = p_name and archived_at is null
  );
$$;
revoke all on function private.can_read_sponsor_logo(text) from public;
grant execute on function private.can_read_sponsor_logo(text) to anon, authenticated;

-- Whether any sponsor uses a file, taken-off ones included (they're kept, logo and all).
create or replace function private.sponsor_logo_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sponsors where logo_path = p_name);
$$;
revoke all on function private.sponsor_logo_in_use(text) from public, anon;
grant execute on function private.sponsor_logo_in_use(text) to authenticated;

create policy sponsor_logos_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'sponsor-logos' and private.can_read_sponsor_logo(name));
-- An upload whose save failed can be cleared away by whoever uploaded it; a logo in use stays.
create policy sponsor_logos_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and owner_id = auth.uid()::text and not private.sponsor_logo_in_use(name));

-- ---------------------------------------------------------------------------------------------
-- Actions

-- The checks every sponsor action starts with.
create or replace function private.check_sponsor_keeper()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can look after the club’s sponsors.'; end if;
end;
$$;
revoke all on function private.check_sponsor_keeper() from public, anon, authenticated;

-- Adds a sponsor (p_id null) or changes one, returning its id. A logo is one the caller uploaded,
-- or the one already on the sponsor.
create or replace function public.save_sponsor(
  p_id uuid, p_name text, p_blurb text, p_url text, p_deal text, p_logo_path text, p_chapter uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.sponsors%rowtype;
  c_name text := coalesce(private.trim_like_app(p_name), '');
  c_blurb text := nullif(private.trim_like_app(p_blurb), '');
  c_url text := nullif(private.trim_like_app(p_url), '');
  c_deal text := nullif(private.trim_like_app(p_deal), '');
  new_id uuid;
begin
  perform private.check_sponsor_keeper();
  if p_id is not null then
    select * into s from public.sponsors where id = p_id for update;
    if not found then raise exception 'No such sponsor.'; end if;
    if s.archived_at is not null then raise exception 'That sponsor has been taken off.'; end if;
  end if;
  if c_name = '' then raise exception 'Name the sponsor.'; end if;
  if char_length(c_name) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if char_length(c_blurb) > 300 then raise exception 'Keep the blurb to 300 characters at most.'; end if;
  if c_url is not null and c_url !~* '^https?://' then
    raise exception 'Websites start with http:// or https://.';
  end if;
  if char_length(c_url) > 300 then raise exception 'Keep the website to 300 characters at most.'; end if;
  if char_length(c_deal) > 200 then raise exception 'Keep the member deal to 200 characters at most.'; end if;
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  if p_logo_path is not null and p_logo_path is distinct from s.logo_path and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'sponsor-logos' and o.name = p_logo_path and o.owner_id = me::text
  ) then
    raise exception 'That logo didn’t upload. Try again.';
  end if;

  if p_id is null then
    insert into public.sponsors (name, blurb, url, deal, logo_path, chapter_id, added_by)
    values (c_name, c_blurb, c_url, c_deal, p_logo_path, p_chapter, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.sponsors
  set name = c_name, blurb = c_blurb, url = c_url, deal = c_deal, logo_path = p_logo_path,
      chapter_id = p_chapter, updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Takes a sponsor off. It's kept, archived, with who took it off.
create or replace function public.archive_sponsor(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sponsors%rowtype;
begin
  perform private.check_sponsor_keeper();
  select * into s from public.sponsors where id = p_id for update;
  if not found then raise exception 'No such sponsor.'; end if;
  if s.archived_at is not null then raise exception 'That sponsor has already been taken off.'; end if;
  update public.sponsors set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$$;

revoke all on function
  public.save_sponsor(uuid, text, text, text, text, text, uuid), public.archive_sponsor(uuid)
from public, anon;
grant execute on function
  public.save_sponsor(uuid, text, text, text, text, text, uuid), public.archive_sponsor(uuid)
to authenticated;
