-- Rustnuts App, Stage 1: foundations
-- Chapters, members, private details, bikes, emergency contacts and positions,
-- with row-level security so each person only gets what their access level allows:
--   public   : chapter names only
--   pending  : their own application
--   member   : the approved directory, bikes, positions, phones people chose to share
--   board    : plus private details and applicants for their own chapter
--   national : board powers across every chapter (NEC roles and sitting Presidents)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.member_status as enum ('introduced', 'fng', 'full', 'nomad', 'supporter', 'family');
create type public.approval_state as enum ('pending', 'approved', 'declined', 'suspended');
create type public.licence_class as enum ('full_open', 'probationary_open', 'learner');
create type public.position_role as enum (
  'president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
  'officer', 'tail_gunner', 'social_media_officer', 'club_coach',
  'nec_chair', 'nec_secretary', 'nec_auditor'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  area text not null,
  state text not null default 'VIC',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id),
  full_name text not null check (length(trim(full_name)) > 0),
  road_name text,
  status public.member_status not null default 'introduced',
  approval public.approval_state not null default 'pending',
  joined_on date,
  patched_on date,
  fng_started_on date,
  bio text,
  share_phone boolean not null default false,
  applied_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index members_chapter_idx on public.members (chapter_id);

-- Contact and compliance details: the member and their chapter board only.
create table public.member_private (
  member_id uuid primary key references public.members (id) on delete cascade,
  email text,
  phone text,
  licence_class public.licence_class,
  licence_expiry date,
  first_aid_expiry date,
  introduced_by text,
  application_note text,
  updated_at timestamptz not null default now()
);

create table public.bikes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  make text not null,
  model text not null,
  year int check (year between 1885 and 2100),
  nickname text,
  is_project boolean not null default false,
  created_at timestamptz not null default now()
);
create index bikes_member_idx on public.bikes (member_id);

-- Registration details: the member and their chapter board only.
create table public.bike_registrations (
  bike_id uuid primary key references public.bikes (id) on delete cascade,
  rego text,
  rego_expiry date
);

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  name text not null,
  relationship text not null,
  phone text not null,
  created_at timestamptz not null default now()
);
create index emergency_contacts_member_idx on public.emergency_contacts (member_id);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  chapter_id uuid references public.chapters (id), -- null = national role
  role public.position_role not null,
  started_on date not null default current_date,
  ended_on date,
  constraint national_roles_have_no_chapter
    check ((role in ('nec_chair', 'nec_secretary', 'nec_auditor')) = (chapter_id is null)),
  constraint ends_after_start check (ended_on is null or ended_on >= started_on)
);
create index positions_member_idx on public.positions (member_id) where ended_on is null;

-- One sitting holder per board seat per chapter, and per national role.
create unique index one_holder_per_board_seat
  on public.positions (chapter_id, role)
  where ended_on is null
    and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain');
create unique index one_holder_per_national_role
  on public.positions (role)
  where ended_on is null and chapter_id is null;

-- ---------------------------------------------------------------------------
-- Who is asking? (security definer so the checks don't trip over RLS themselves)
-- ---------------------------------------------------------------------------

create or replace function public.is_approved_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = auth.uid() and approval = 'approved');
$$;

create or replace function public.is_national()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_member() and exists (
    select 1 from positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'president')
  );
$$;

create or replace function public.is_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_member() and (
    public.is_national() or exists (
      select 1 from positions
      where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

create or replace function public.chapter_of(target_member uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select chapter_id from members where id = target_member;
$$;

create or replace function public.is_approved(target_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = target_member and approval = 'approved');
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.chapters enable row level security;
alter table public.members enable row level security;
alter table public.member_private enable row level security;
alter table public.bikes enable row level security;
alter table public.bike_registrations enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.positions enable row level security;

-- Chapters: anyone can read; national manages.
create policy chapters_read on public.chapters for select to anon, authenticated using (true);
create policy chapters_manage on public.chapters for all to authenticated
  using (public.is_national()) with check (public.is_national());

-- Members: self; approved members see approved members; board sees their chapter's applicants.
create policy members_read on public.members for select to authenticated using (
  id = auth.uid()
  or (approval = 'approved' and public.is_approved_member())
  or public.is_board_of(chapter_id)
);
-- Members edit their own name, road name, bio and sharing only (column grants below).
create policy members_update_self on public.members for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Private details: self and chapter board.
create policy private_read on public.member_private for select to authenticated using (
  member_id = auth.uid() or public.is_board_of(public.chapter_of(member_id))
);
create policy private_update_self on public.member_private for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- Bikes: approved members see approved members' bikes; everyone manages their own.
create policy bikes_read on public.bikes for select to authenticated using (
  member_id = auth.uid()
  or (public.is_approved(member_id) and public.is_approved_member())
  or public.is_board_of(public.chapter_of(member_id))
);
create policy bikes_write_own on public.bikes for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- Regos: owner and chapter board.
create policy regos_read on public.bike_registrations for select to authenticated using (
  exists (
    select 1 from public.bikes b
    where b.id = bike_id
      and (b.member_id = auth.uid() or public.is_board_of(public.chapter_of(b.member_id)))
  )
);
create policy regos_write_own on public.bike_registrations for all to authenticated
  using (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = auth.uid()))
  with check (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = auth.uid()));

-- Emergency contacts: owner and chapter board.
create policy emergency_read on public.emergency_contacts for select to authenticated using (
  member_id = auth.uid() or public.is_board_of(public.chapter_of(member_id))
);
create policy emergency_write_own on public.emergency_contacts for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- Positions: approved members can see who holds what. Chapter board sets chapter roles,
-- the NEC sets national roles. Positions are ended, never deleted, so history is kept.
create policy positions_read on public.positions for select to authenticated using (
  member_id = auth.uid() or public.is_approved_member()
);
create policy positions_insert on public.positions for insert to authenticated with check (
  public.is_approved(member_id)
  and case when chapter_id is null then public.is_national() else public.is_board_of(chapter_id) end
);
create policy positions_update on public.positions for update to authenticated
  using (case when chapter_id is null then public.is_national() else public.is_board_of(chapter_id) end)
  with check (case when chapter_id is null then public.is_national() else public.is_board_of(chapter_id) end);

-- Column-level limits on top of RLS: members can never edit their own status or approval.
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
grant update (full_name, road_name, bio, share_phone) on public.members to authenticated;

revoke all on public.member_private from anon, authenticated;
grant select on public.member_private to authenticated;
grant update (email, phone, licence_class, licence_expiry, first_aid_expiry) on public.member_private to authenticated;

revoke all on public.positions from anon, authenticated;
grant select, insert on public.positions to authenticated;
grant update (ended_on) on public.positions to authenticated;

revoke all on public.chapters from anon;
grant select on public.chapters to anon;

revoke all on public.bikes, public.bike_registrations, public.emergency_contacts from anon;

-- ---------------------------------------------------------------------------
-- Actions (run with elevated rights, each checks permission itself)
-- ---------------------------------------------------------------------------

-- A signed-in person asks to join a chapter. Lands as pending for that chapter's board.
create or replace function public.submit_application(
  p_chapter uuid,
  p_full_name text,
  p_road_name text default null,
  p_phone text default null,
  p_introduced_by text default null,
  p_note text default null,
  p_status public.member_status default 'introduced'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from members where id = auth.uid()) then
    raise exception 'You have already applied';
  end if;
  if p_status not in ('introduced', 'supporter', 'family') then
    raise exception 'New applications start as Introduced, Supporter or Family';
  end if;

  insert into members (id, chapter_id, full_name, road_name, status, approval, applied_on)
  values (auth.uid(), p_chapter, trim(p_full_name), nullif(trim(p_road_name), ''), p_status, 'pending', current_date);

  insert into member_private (member_id, email, phone, introduced_by, application_note)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    nullif(trim(p_phone), ''),
    nullif(trim(p_introduced_by), ''),
    nullif(trim(p_note), '')
  );
end;
$$;

-- Board approves an applicant into the app with a starting status.
create or replace function public.approve_member(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such applicant'; end if;
  if not public.is_board_of(target.chapter_id) then
    raise exception 'Only the % board can approve this applicant', (select name from chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person is not waiting for approval'; end if;

  update members set
    approval = 'approved',
    status = p_status,
    joined_on = coalesce(joined_on, current_date),
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, current_date) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, current_date) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.decline_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such applicant'; end if;
  if not public.is_board_of(target.chapter_id) then raise exception 'Not your chapter'; end if;
  if target.approval <> 'pending' then raise exception 'This person is not waiting for approval'; end if;
  update members set approval = 'declined', updated_at = now() where id = p_member;
end;
$$;

-- Board changes a member's status. Nobody changes their own.
create or replace function public.set_member_status(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  if p_member = auth.uid() then raise exception 'You can''t change your own status'; end if;
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such member'; end if;
  if not public.is_board_of(target.chapter_id) then raise exception 'Not your chapter'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first'; end if;

  update members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, current_date) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, current_date) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

-- A member's phone number, if the caller is allowed to see it.
create or replace function public.member_phone(p_member uuid)
returns text language sql stable security definer set search_path = public as $$
  select mp.phone
  from member_private mp join members m on m.id = mp.member_id
  where mp.member_id = p_member
    and (
      p_member = auth.uid()
      or public.is_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and public.is_approved_member())
    );
$$;

revoke all on function public.submit_application, public.approve_member, public.decline_member,
  public.set_member_status, public.member_phone from public, anon;
grant execute on function public.submit_application, public.approve_member, public.decline_member,
  public.set_member_status, public.member_phone to authenticated;

-- ---------------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------------

insert into public.chapters (slug, name, area, state) values
  ('west', 'West', 'Western Melbourne', 'VIC'),
  ('north', 'North', 'Northern Melbourne', 'VIC');
