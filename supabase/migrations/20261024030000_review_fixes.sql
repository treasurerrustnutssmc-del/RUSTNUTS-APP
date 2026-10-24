-- Fixes from the independent review of Stage 1 (24 Oct 2026).
--
-- 1. Positions change only through two checked actions, appoint_position and end_position.
--    Nobody appoints or ends their own position, a chapter seat only goes to a member of that
--    chapter, a President is seated or unseated only by the National Chairman, Secretary or Auditor,
--    only the National Chairman hands out or ends the other national roles, the Chairman's own
--    seat changes after the vote (recorded by the admin), an ended term stays ended, and every
--    change records who made it.
-- 2. Dates the server writes follow the club's clock in Melbourne, not UTC.
-- 3. Joining with a bike, saving a bike with its rego, and saving a profile each happen in one step,
--    and removing or editing something that isn't yours says so instead of quietly doing nothing.
-- 4. Tidy-ups: explicit table rights, an empty search_path on every function, unused functions removed.

-- ---------------------------------------------------------------------------
-- The club's clock
-- ---------------------------------------------------------------------------

create or replace function private.club_date(at_time timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select (at_time at time zone 'Australia/Melbourne')::date;
$$;

-- Oldest motorcycle ever made, to next year's models. The app checks the same range.
create or replace function private.check_bike_year(p_year int)
returns void language plpgsql stable set search_path = '' as $$
declare
  latest int := extract(year from private.club_date())::int + 1;
begin
  if p_year is not null and (p_year < 1885 or p_year > latest) then
    raise exception 'Check the year: 1885 to %.', latest;
  end if;
end;
$$;

-- Written out in full (not via club_date) so admin tools with the service key can rely on them too.
alter table public.members alter column applied_on set default ((now() at time zone 'Australia/Melbourne')::date);
alter table public.positions alter column started_on set default ((now() at time zone 'Australia/Melbourne')::date);

-- The bike rules hold however a bike is written, not just through save_bike.
create or replace function private.check_bike()
returns trigger language plpgsql set search_path = '' as $$
begin
  if nullif(trim(new.make), '') is null or nullif(trim(new.model), '') is null then
    raise exception 'Add the make and model.';
  end if;
  perform private.check_bike_year(new.year);
  return new;
end;
$$;

create trigger bikes_check before insert or update on public.bikes
  for each row execute function private.check_bike();

-- Same for emergency contacts: a blank contact would hide the board's "no emergency contact" alert.
create or replace function private.check_contact()
returns trigger language plpgsql set search_path = '' as $$
begin
  if nullif(trim(new.name), '') is null or nullif(trim(new.phone), '') is null then
    raise exception 'Add their name and number.';
  end if;
  return new;
end;
$$;

create trigger emergency_contacts_check before insert or update on public.emergency_contacts
  for each row execute function private.check_contact();

-- ---------------------------------------------------------------------------
-- "Who is asking?" helpers, now with an empty search_path
-- ---------------------------------------------------------------------------

create or replace function private.is_approved_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved');
$$;

create or replace function private.is_national()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'president')
  );
$$;

-- National Chairman, Secretary or Auditor. Sitting Presidents are on the NEC but are not officers.
create or replace function private.is_nec_officer()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'nec_auditor')
  );
$$;

-- The sitting National Chairman: the only one who hands out or ends the other national roles.
create or replace function private.is_chairman()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and role = 'nec_chair'
  );
$$;

create or replace function private.is_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

create or replace function private.chapter_of(target_member uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select chapter_id from public.members where id = target_member;
$$;

create or replace function private.is_approved(target_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = target_member and approval = 'approved');
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
-- Admin tools (service key) write bikes too, so they need the bike checks.
grant usage on schema private to service_role;
grant execute on function private.check_bike_year(int), private.club_date(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Positions: only through the two actions below
-- ---------------------------------------------------------------------------

alter table public.positions
  add column appointed_by uuid references public.members (id) on delete set null,
  add column ended_by uuid references public.members (id) on delete set null;

-- The same person can't hold the same open role twice (two Officer seats, say).
create unique index one_open_role_per_member
  on public.positions (member_id, chapter_id, role)
  where ended_on is null;

revoke insert, update, delete on public.positions from authenticated;
revoke update (ended_on) on public.positions from authenticated;
alter policy positions_insert on public.positions to authenticated with check (false);
alter policy positions_update on public.positions to authenticated using (false) with check (false);

create or replace function public.appoint_position(p_member uuid, p_chapter uuid, p_role public.position_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  is_national_role boolean := p_role in ('nec_chair', 'nec_secretary', 'nec_auditor');
  seat uuid;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_member = me then raise exception 'You can’t appoint yourself.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;

  seat := case when is_national_role then null else p_chapter end;
  if is_national_role then
    if p_role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman hands out national roles.'; end if;
  else
    if seat is null or seat <> target.chapter_id then raise exception 'They’re not a member of that chapter.'; end if;
    if p_role = 'president' then
      if not private.is_nec_officer() then
        raise exception 'Only the National Chairman, Secretary or Auditor can seat a President.';
      end if;
    elsif not private.is_board_of(seat) then
      raise exception 'Only that chapter’s board can appoint here.';
    end if;
  end if;

  if exists (
    select 1 from public.positions
    where member_id = p_member and role = p_role and chapter_id is not distinct from seat and ended_on is null
  ) then
    raise exception 'They already hold that role.';
  end if;
  if (is_national_role or p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
    and exists (
      select 1 from public.positions where role = p_role and chapter_id is not distinct from seat and ended_on is null
    ) then
    raise exception 'That seat is taken. End the current term first.';
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.end_position(p_position uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pos public.positions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into pos from public.positions where id = p_position for update;
  if not found then raise exception 'That position no longer exists.'; end if;
  if pos.ended_on is not null then raise exception 'That term has already ended.'; end if;
  if pos.member_id = me then raise exception 'You can’t end your own term.'; end if;

  if pos.chapter_id is null then
    if pos.role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman can end a national role.'; end if;
  elsif pos.role = 'president' then
    if not private.is_nec_officer() then
      raise exception 'Only the National Chairman, Secretary or Auditor can end a President’s term.';
    end if;
  elsif not private.is_board_of(pos.chapter_id) then
    raise exception 'Only that chapter’s board can end this term.';
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), pos.started_on), ended_by = me
  where id = p_position;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining, approving and status changes
-- ---------------------------------------------------------------------------

-- Replaces submit_application: the optional bike is saved in the same step, so a refused
-- bike never leaves half an application behind.
create or replace function public.apply_to_join(
  p_chapter uuid,
  p_full_name text,
  p_road_name text default null,
  p_phone text default null,
  p_introduced_by text default null,
  p_note text default null,
  p_status public.member_status default 'introduced',
  p_bike_make text default null,
  p_bike_model text default null,
  p_bike_year int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  bike_make text := nullif(trim(p_bike_make), '');
  bike_model text := nullif(trim(p_bike_model), '');
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.members where id = me) then raise exception 'You have already applied.'; end if;
  if p_status not in ('introduced', 'supporter', 'family') then
    raise exception 'New applications start as Introduced, Supporter or Family.';
  end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Add your name.'; end if;
  if not exists (select 1 from public.chapters where id = p_chapter) then raise exception 'Pick a chapter.'; end if;
  if (bike_make is null) <> (bike_model is null) then
    raise exception 'Add the bike’s make and model, or leave both blank.';
  end if;
  if bike_make is null and p_bike_year is not null then
    raise exception 'Add the bike’s make and model too, or clear the year.';
  end if;
  if bike_make is not null then perform private.check_bike_year(p_bike_year); end if;

  insert into public.members (id, chapter_id, full_name, road_name, status, approval, applied_on)
  values (me, p_chapter, trim(p_full_name), nullif(trim(p_road_name), ''), p_status, 'pending', private.club_date());

  insert into public.member_private (member_id, email, phone, introduced_by, application_note)
  values (
    me,
    (select email from auth.users where id = me),
    nullif(trim(p_phone), ''),
    nullif(trim(p_introduced_by), ''),
    nullif(trim(p_note), '')
  );

  if bike_make is not null then
    insert into public.bikes (member_id, make, model, year) values (me, bike_make, bike_model, p_bike_year);
  end if;
end;
$$;

create or replace function public.approve_member(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;

  update public.members set
    approval = 'approved',
    status = p_status,
    joined_on = coalesce(joined_on, today),
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.decline_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can decline this applicant.'; end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  update public.members set approval = 'declined', updated_at = now() where id = p_member;
end;
$$;

create or replace function public.set_member_status(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such member.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can change this member’s status.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;

  update public.members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;


create or replace function public.shared_phones()
returns table (member_id uuid, phone text)
language sql stable security definer set search_path = '' as $$
  select mp.member_id, mp.phone
  from public.member_private mp
  join public.members m on m.id = mp.member_id
  where mp.phone is not null
    and (
      mp.member_id = auth.uid()
      or private.is_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and private.is_approved_member())
    );
$$;

-- ---------------------------------------------------------------------------
-- A member's own records, each saved in one step. These run as the member, so
-- row-level security still decides what they can touch.
-- ---------------------------------------------------------------------------

create or replace function public.save_profile(
  p_full_name text,
  p_road_name text,
  p_bio text,
  p_share_phone boolean,
  p_with_private boolean default false,
  p_email text default null,
  p_phone text default null,
  p_licence_class public.licence_class default null,
  p_licence_expiry date default null,
  p_first_aid_expiry date default null
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Your name can’t be blank.'; end if;
  update public.members set
    full_name = trim(p_full_name),
    road_name = nullif(trim(p_road_name), ''),
    bio = nullif(trim(p_bio), ''),
    share_phone = coalesce(p_share_phone, false)
  where id = auth.uid();
  if not found then raise exception 'Apply to join first.'; end if;
  if p_with_private then
    update public.member_private set
      email = nullif(trim(p_email), ''),
      phone = nullif(trim(p_phone), ''),
      licence_class = p_licence_class,
      licence_expiry = p_licence_expiry,
      first_aid_expiry = p_first_aid_expiry
    where member_id = auth.uid();
    if not found then
      raise exception 'Your contact and licence record is missing. Ask your chapter board to sort it out.';
    end if;
  end if;
end;
$$;

create or replace function public.save_bike(
  p_bike uuid,
  p_make text,
  p_model text,
  p_year int,
  p_nickname text,
  p_is_project boolean,
  p_rego text,
  p_rego_expiry date
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  saved uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_make), '') is null or nullif(trim(p_model), '') is null then
    raise exception 'Add the make and model.';
  end if;
  perform private.check_bike_year(p_year);

  if p_bike is null then
    insert into public.bikes (member_id, make, model, year, nickname, is_project)
    values (auth.uid(), trim(p_make), trim(p_model), p_year, nullif(trim(p_nickname), ''), coalesce(p_is_project, false))
    returning id into saved;
  else
    update public.bikes set
      make = trim(p_make),
      model = trim(p_model),
      year = p_year,
      nickname = nullif(trim(p_nickname), ''),
      is_project = coalesce(p_is_project, false)
    where id = p_bike and member_id = auth.uid()
    returning id into saved;
    if saved is null then raise exception 'You can only edit your own bikes.'; end if;
  end if;

  insert into public.bike_registrations (bike_id, rego, rego_expiry)
  values (saved, nullif(upper(trim(p_rego)), ''), p_rego_expiry)
  on conflict (bike_id) do update set rego = excluded.rego, rego_expiry = excluded.rego_expiry;
  return saved;
end;
$$;

create or replace function public.remove_bike(p_bike uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.bikes where id = p_bike and member_id = auth.uid();
  if not found then raise exception 'You can only remove your own bikes.'; end if;
end;
$$;

create or replace function public.save_contact(p_contact uuid, p_name text, p_relationship text, p_phone text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  saved uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception 'Add their name and number.';
  end if;
  if p_contact is null then
    insert into public.emergency_contacts (member_id, name, relationship, phone)
    values (auth.uid(), trim(p_name), coalesce(trim(p_relationship), ''), trim(p_phone))
    returning id into saved;
  else
    update public.emergency_contacts set
      name = trim(p_name),
      relationship = coalesce(trim(p_relationship), ''),
      phone = trim(p_phone)
    where id = p_contact and member_id = auth.uid()
    returning id into saved;
    if saved is null then raise exception 'You can only edit your own contacts.'; end if;
  end if;
  return saved;
end;
$$;

create or replace function public.remove_contact(p_contact uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.emergency_contacts where id = p_contact and member_id = auth.uid();
  if not found then raise exception 'You can only remove your own contacts.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rights: exactly what the app needs, nothing left over from the defaults
-- ---------------------------------------------------------------------------

revoke all on public.bikes, public.bike_registrations, public.emergency_contacts, public.chapters from authenticated;
grant select, insert, update, delete on public.bikes, public.bike_registrations, public.emergency_contacts to authenticated;
grant select on public.chapters to authenticated;

revoke all on function
  public.appoint_position(uuid, uuid, public.position_role),
  public.end_position(uuid),
  public.apply_to_join(uuid, text, text, text, text, text, public.member_status, text, text, int),
  public.save_profile(text, text, text, boolean, boolean, text, text, public.licence_class, date, date),
  public.save_bike(uuid, text, text, int, text, boolean, text, date),
  public.remove_bike(uuid),
  public.save_contact(uuid, text, text, text),
  public.remove_contact(uuid)
from public, anon;
grant execute on function
  public.appoint_position(uuid, uuid, public.position_role),
  public.end_position(uuid),
  public.apply_to_join(uuid, text, text, text, text, text, public.member_status, text, text, int),
  public.save_profile(text, text, text, boolean, boolean, text, text, public.licence_class, date, date),
  public.save_bike(uuid, text, text, int, text, boolean, text, date),
  public.remove_bike(uuid),
  public.save_contact(uuid, text, text, text),
  public.remove_contact(uuid)
to authenticated;

-- Replaced or no longer used.
drop function if exists public.submit_application(uuid, text, text, text, text, text, public.member_status);
drop function if exists public.member_phone(uuid); -- replaced by shared_phones()
drop policy if exists chapters_manage on public.chapters; -- chapters are read-only to the app
drop function if exists public.is_board_of(uuid);
drop function if exists public.is_national();
drop function if exists public.is_approved_member();
drop function if exists public.chapter_of(uuid);
drop function if exists public.is_approved(uuid);
