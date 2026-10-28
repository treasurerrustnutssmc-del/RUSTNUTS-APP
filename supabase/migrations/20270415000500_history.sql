-- Social extras (Stage 7): the club's history and hall of fame. The board keeps a timeline of what
-- happened when, and honours (life members, awards). Founders and past office holders come from
-- public.positions, so nothing here repeats them. Everything changes only through
-- save_history_entry, archive_history_entry, save_honour and archive_honour, which apply the same
-- checks with the same words as src/domain/social/history.ts, in the same order. Nothing is ever
-- deleted: an entry or honour taken off is archived, with who took it off.

-- How exactly a date is known: shown as 09/03/2019, March 2019 or 2019.
create type public.history_precision as enum ('day', 'month', 'year');

create table public.club_history (
  id uuid primary key default gen_random_uuid(),
  happened_on date not null,
  precision public.history_precision not null default 'day',
  title text not null check (char_length(title) between 1 and 80),
  story text check (char_length(story) between 1 and 1000),
  -- Whoever added it may leave; the entry stays.
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null
);
create index club_history_on on public.club_history (happened_on);

create table public.club_honours (
  id uuid primary key default gen_random_uuid(),
  -- A member in the app, or a name typed in for someone who isn't. Exactly one.
  member_id uuid references public.members (id) on delete set null,
  name text check (char_length(name) between 1 and 80),
  honour text not null check (char_length(honour) between 1 and 60),
  year int not null check (year >= 2019),
  note text check (char_length(note) between 1 and 300),
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null
);

-- Approved members read what hasn't been taken off; nobody writes through the API.
alter table public.club_history enable row level security;
alter table public.club_honours enable row level security;
revoke all on public.club_history, public.club_honours from public, anon, authenticated;
grant select on public.club_history, public.club_honours to authenticated;
create policy club_history_for_members on public.club_history for select to authenticated
  using (private.is_approved_member() and archived_at is null);
create policy club_honours_for_members on public.club_honours for select to authenticated
  using (private.is_approved_member() and archived_at is null);

-- ---------------------------------------------------------------------------------------------
-- Actions

-- The checks every keeper action starts with.
create or replace function private.check_history_keeper()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can keep the club’s history.'; end if;
end;
$$;
revoke all on function private.check_history_keeper() from public, anon, authenticated;

-- Adds a timeline entry (p_id null) or changes one, returning its id. The date and precision come
-- as text so a date that isn't real gets the app's words rather than a cast error.
create or replace function public.save_history_entry(
  p_id uuid, p_happened_on text, p_precision text, p_title text, p_story text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  e public.club_history%rowtype;
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_story text := nullif(private.trim_like_app(p_story), '');
  c_on date;
  new_id uuid;
begin
  perform private.check_history_keeper();
  if p_id is not null then
    select * into e from public.club_history where id = p_id for update;
    if not found then raise exception 'No such entry.'; end if;
    if e.archived_at is not null then raise exception 'That entry has been taken off.'; end if;
  end if;
  if p_happened_on is null or p_happened_on !~ '^\d{4}-\d{2}-\d{2}$'
     or p_precision is null or p_precision not in ('day', 'month', 'year') then
    raise exception 'Pick a date.';
  end if;
  begin
    c_on := p_happened_on::date;
  exception when others then
    raise exception 'Pick a date.';
  end;
  -- A cast that rolls a date over (it shouldn't) would come back different.
  if to_char(c_on, 'YYYY-MM-DD') <> p_happened_on or c_on > private.club_date() then
    raise exception 'Pick a date.';
  end if;
  if c_title = '' then raise exception 'Give it a title.'; end if;
  if char_length(c_title) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if char_length(c_story) > 1000 then raise exception 'Keep the story to 1,000 characters at most.'; end if;

  if p_id is null then
    insert into public.club_history (happened_on, precision, title, story, added_by)
    values (c_on, p_precision::public.history_precision, c_title, c_story, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.club_history
  set happened_on = c_on, precision = p_precision::public.history_precision, title = c_title,
      story = c_story, updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Takes a timeline entry off. It's kept, archived, with who took it off.
create or replace function public.archive_history_entry(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.club_history%rowtype;
begin
  perform private.check_history_keeper();
  select * into e from public.club_history where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if e.archived_at is not null then raise exception 'That entry has already been taken off.'; end if;
  update public.club_history set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$$;

-- Adds an honour (p_id null) or changes one, returning its id. It names a member (p_member) or
-- someone typed in (p_name), never both.
create or replace function public.save_honour(
  p_id uuid, p_member uuid, p_name text, p_honour text, p_year int, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  h public.club_honours%rowtype;
  c_name text := nullif(private.trim_like_app(p_name), '');
  c_honour text := coalesce(private.trim_like_app(p_honour), '');
  c_note text := nullif(private.trim_like_app(p_note), '');
  new_id uuid;
begin
  perform private.check_history_keeper();
  if p_id is not null then
    select * into h from public.club_honours where id = p_id for update;
    if not found then raise exception 'No such honour.'; end if;
    if h.archived_at is not null then raise exception 'That honour has been taken off.'; end if;
  end if;
  if (p_member is null) = (c_name is null) then raise exception 'Pick a member or type a name.'; end if;
  if p_member is not null and not exists (select 1 from public.members where id = p_member) then
    raise exception 'No such member.';
  end if;
  if char_length(c_name) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if c_honour = '' then raise exception 'Name the honour.'; end if;
  if char_length(c_honour) > 60 then raise exception 'Keep the honour to 60 characters at most.'; end if;
  if p_year is null or p_year < 2019 or p_year > extract(year from private.club_date())::int then
    raise exception 'Pick a year from 2019 on.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  if p_id is null then
    insert into public.club_honours (member_id, name, honour, year, note, added_by)
    values (p_member, c_name, c_honour, p_year, c_note, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.club_honours
  set member_id = p_member, name = c_name, honour = c_honour, year = p_year, note = c_note, updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Takes an honour off. It's kept, archived, with who took it off.
create or replace function public.archive_honour(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.club_honours%rowtype;
begin
  perform private.check_history_keeper();
  select * into h from public.club_honours where id = p_id for update;
  if not found then raise exception 'No such honour.'; end if;
  if h.archived_at is not null then raise exception 'That honour has already been taken off.'; end if;
  update public.club_honours set archived_at = now(), archived_by = auth.uid() where id = p_id;
end;
$$;

revoke all on function
  public.save_history_entry(uuid, text, text, text, text), public.archive_history_entry(uuid),
  public.save_honour(uuid, uuid, text, text, int, text), public.archive_honour(uuid)
from public, anon;
grant execute on function
  public.save_history_entry(uuid, text, text, text, text), public.archive_history_entry(uuid),
  public.save_honour(uuid, uuid, text, text, int, text), public.archive_honour(uuid)
to authenticated;
