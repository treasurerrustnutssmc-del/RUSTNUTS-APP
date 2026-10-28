-- Social extras (Stage 7): "Who can help?". Members' skills, and the club's list of trusted
-- mechanics with "I've used them". Everything changes only through set_skills, save_mechanic,
-- archive_mechanic and vouch_mechanic, which apply the same checks with the same words as
-- src/domain/social/help.ts, in the same order. Nothing is ever deleted: skills are one row per
-- member, a workshop taken off the list is archived, and a vouch taken back is switched off.

create type public.help_skill as enum (
  'servicing', 'tyres', 'electrics', 'carbs', 'diagnostics', 'welding', 'paint', 'wheels', 'suspension',
  'trailer', 'tools'
);

-- One row per member who has ever set their skills.
create table public.member_skills (
  member_id uuid primary key references public.members (id) on delete cascade,
  skills public.help_skill[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.mechanics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  suburb text check (char_length(suburb) <= 60),
  phone text check (char_length(phone) <= 30),
  website text check (char_length(website) <= 200 and website ~* '^https?://'),
  speciality text check (char_length(speciality) <= 80),
  notes text check (char_length(notes) <= 500),
  -- Whoever added it may leave; the workshop stays.
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null
);

create table public.mechanic_vouches (
  mechanic_id uuid not null references public.mechanics (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  vouched boolean not null,
  updated_at timestamptz not null default now(),
  primary key (mechanic_id, member_id)
);

-- Approved members read all three (skills and vouches of approved members only); nobody writes
-- through the API.
alter table public.member_skills enable row level security;
alter table public.mechanics enable row level security;
alter table public.mechanic_vouches enable row level security;
revoke all on public.member_skills, public.mechanics, public.mechanic_vouches from public, anon, authenticated;
grant select on public.member_skills, public.mechanics, public.mechanic_vouches to authenticated;
create policy member_skills_for_members on public.member_skills for select to authenticated
  using (
    private.is_approved_member()
    and exists (select 1 from public.members m where m.id = member_id and m.approval = 'approved')
  );
create policy mechanics_for_members on public.mechanics for select to authenticated
  using (private.is_approved_member());
create policy mechanic_vouches_for_members on public.mechanic_vouches for select to authenticated
  using (
    private.is_approved_member()
    and exists (select 1 from public.members m where m.id = member_id and m.approval = 'approved')
  );

-- Sets your skills to this list: each once, in the order given. An empty list clears them.
create or replace function public.set_skills(p_skills text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean public.help_skill[];
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_skills is null or exists (
    select 1 from unnest(p_skills) s
    where s is null or s not in (select unnest(enum_range(null::public.help_skill))::text)
  ) then
    raise exception 'That isn’t one of the skills.';
  end if;
  select coalesce(array_agg(s::public.help_skill order by first_at), '{}') into clean
  from (select s, min(i) as first_at from unnest(p_skills) with ordinality as u(s, i) group by s) once;

  insert into public.member_skills (member_id, skills, updated_at) values (me, clean, now())
  on conflict (member_id) do update set skills = excluded.skills, updated_at = excluded.updated_at;
end;
$$;

-- Who may change a workshop: whoever added it, or the board or NEC (lane B's private.is_any_board).
create or replace function private.can_edit_mechanic(p_added_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (p_added_by = auth.uid() or private.is_any_board());
$$;
revoke all on function private.can_edit_mechanic(uuid) from public, anon, authenticated;

-- Adds a workshop (p_id null) or changes one, returning its id. Texts are trimmed like the app
-- trims them and blanks are stored as none; lengths count characters.
create or replace function public.save_mechanic(
  p_id uuid, p_name text, p_suburb text, p_phone text, p_website text, p_speciality text, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
  c_name text := coalesce(private.trim_like_app(p_name), '');
  c_suburb text := nullif(private.trim_like_app(p_suburb), '');
  c_phone text := nullif(private.trim_like_app(p_phone), '');
  c_website text := nullif(private.trim_like_app(p_website), '');
  c_speciality text := nullif(private.trim_like_app(p_speciality), '');
  c_notes text := nullif(private.trim_like_app(p_notes), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into m from public.mechanics where id = p_id for update;
    if not found then raise exception 'No such workshop.'; end if;
    if not private.can_edit_mechanic(m.added_by) then
      raise exception 'Only whoever added it or the board can change it.';
    end if;
    if m.archived_at is not null then raise exception 'That workshop is off the list.'; end if;
  end if;
  if c_name = '' then raise exception 'Give the workshop a name.'; end if;
  if char_length(c_name) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if char_length(c_suburb) > 60 then raise exception 'Keep the suburb to 60 characters at most.'; end if;
  if char_length(c_phone) > 30 then raise exception 'Keep the phone number to 30 characters at most.'; end if;
  if c_website is not null and c_website !~* '^https?://' then
    raise exception 'Websites start with http:// or https://.';
  end if;
  if char_length(c_website) > 200 then raise exception 'Keep the website to 200 characters at most.'; end if;
  if char_length(c_speciality) > 80 then
    raise exception 'Keep what they’re good at to 80 characters at most.';
  end if;
  if char_length(c_notes) > 500 then raise exception 'Keep the notes to 500 characters at most.'; end if;

  if p_id is null then
    insert into public.mechanics (name, suburb, phone, website, speciality, notes, added_by)
    values (c_name, c_suburb, c_phone, c_website, c_speciality, c_notes, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.mechanics
  set name = c_name, suburb = c_suburb, phone = c_phone, website = c_website, speciality = c_speciality,
      notes = c_notes, updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Takes a workshop off the list. It's kept, archived, with who took it off.
create or replace function public.archive_mechanic(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.mechanics where id = p_id for update;
  if not found then raise exception 'No such workshop.'; end if;
  if not private.can_edit_mechanic(m.added_by) then
    raise exception 'Only whoever added it or the board can change it.';
  end if;
  if m.archived_at is not null then raise exception 'That workshop is already off the list.'; end if;
  update public.mechanics set archived_at = now(), archived_by = me where id = p_id;
end;
$$;

-- "I've used them" on (p_on true) or off, for a listed workshop.
create or replace function public.vouch_mechanic(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.mechanics where id = p_id;
  if not found then raise exception 'No such workshop.'; end if;
  if m.archived_at is not null then raise exception 'That workshop is off the list.'; end if;
  insert into public.mechanic_vouches (mechanic_id, member_id, vouched, updated_at)
  values (p_id, me, coalesce(p_on, false), now())
  on conflict (mechanic_id, member_id) do update set vouched = excluded.vouched, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_skills(text[]),
  public.save_mechanic(uuid, text, text, text, text, text, text),
  public.archive_mechanic(uuid), public.vouch_mechanic(uuid, boolean) from public, anon;
grant execute on function public.set_skills(text[]),
  public.save_mechanic(uuid, text, text, text, text, text, text),
  public.archive_mechanic(uuid), public.vouch_mechanic(uuid, boolean) to authenticated;
