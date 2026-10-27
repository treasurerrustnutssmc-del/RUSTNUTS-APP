-- Attendance rules and Big 4 rides (constitution v4 4.6, 4.12, 5.2–5.4, 5.11, 12.7).
-- Adds: Big 4 designations (NEC, ahead of time), a category on meeting check-ins, and board
-- exemptions from a check-in. The app works out where each member stands from these; nothing here
-- changes anyone's status. The words match src/domain/big4.ts and src/domain/attendance.ts.
-- Spec: docs/superpowers/specs/2026-10-28-attendance-big4-terms-card-design.md

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A separate table, not a column on rides: the calendar sync rewrites ride rows.
create table public.big4_rides (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  chapter_id uuid references public.chapters (id) on delete cascade, -- null: every chapter
  designated_by uuid references public.members (id) on delete set null,
  designated_at timestamptz not null default now()
);

-- Null on a meeting means ordinary (the check-ins opened before this change were monthly meetings).
alter table public.checkin_sessions
  add column meeting_type text check (meeting_type in ('ordinary', 'special', 'event')),
  add constraint checkin_sessions_ride_has_no_meeting_type check (kind = 'meeting' or meeting_type is null);

create table public.attendance_exemptions (
  session_id uuid not null references public.checkin_sessions (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 200),
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index attendance_exemptions_member on public.attendance_exemptions (member_id);

alter table public.big4_rides enable row level security;
alter table public.attendance_exemptions enable row level security;
revoke all on public.big4_rides, public.attendance_exemptions from public, anon, authenticated;
grant select on public.big4_rides, public.attendance_exemptions to authenticated;
grant select (meeting_type) on public.checkin_sessions to authenticated;

create policy big4_rides_read on public.big4_rides for select to authenticated using (private.is_approved_member());
-- An excuse can be personal (health, family): the member and their chapter's board.
create policy attendance_exemptions_read on public.attendance_exemptions for select to authenticated using (
  member_id = auth.uid() or private.is_board_of(private.chapter_of(member_id))
);

-- ---------------------------------------------------------------------------
-- Big 4 rides (5.11, 12.7)
-- ---------------------------------------------------------------------------

-- The NEC (11.2: the Chair and the Chapter Presidents), and the National Secretary who keeps Club records.
create or replace function private.can_designate_big4()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null and role in ('nec_chair', 'nec_secretary', 'president')
  );
$$;

create or replace function public.designate_big4(p_ride uuid, p_chapter uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ride public.rides%rowtype;
begin
  if not private.can_designate_big4() then raise exception 'Only the NEC designates Big 4 rides (5.11).'; end if;
  select * into ride from public.rides where id = p_ride for update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if ride.category::text not in ('club', 'north', 'west') then
    raise exception 'Big 4 rides are Club-only: pick a club, North or West ride.';
  end if;
  if private.club_date(ride.starts_at) <= private.club_date() then
    raise exception 'A Big 4 is designated before the ride, not after (5.11).';
  end if;
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  insert into public.big4_rides (ride_id, chapter_id, designated_by) values (p_ride, p_chapter, auth.uid())
  on conflict (ride_id) do update set chapter_id = excluded.chapter_id, designated_by = excluded.designated_by, designated_at = now();
end;
$$;

create or replace function public.undesignate_big4(p_ride uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  starts timestamptz;
begin
  if not private.can_designate_big4() then raise exception 'Only the NEC designates Big 4 rides (5.11).'; end if;
  select r.starts_at into starts from public.big4_rides b join public.rides r on r.id = b.ride_id where b.ride_id = p_ride for update of b;
  if not found then raise exception 'That ride isn’t a Big 4.'; end if;
  if private.club_date(starts) <= private.club_date() then
    raise exception 'A Big 4 is designated before the ride, not after (5.11).';
  end if;
  delete from public.big4_rides where ride_id = p_ride;
end;
$$;

-- ---------------------------------------------------------------------------
-- Meeting categories (4.6, 5.2): set by whoever runs the check-in, before the meeting is held
-- ---------------------------------------------------------------------------

create or replace function public.set_meeting_type(p_session uuid, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session for update;
  if not found then raise exception 'That check-in no longer exists.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  if s.kind <> 'meeting' then raise exception 'Only a meeting check-in has a kind.'; end if;
  if p_type is null or p_type not in ('ordinary', 'special', 'event') then raise exception 'Pick what kind of meeting it is.'; end if;
  if s.held_on < private.club_date() then raise exception 'A meeting’s kind is set before it’s held (4.6).'; end if;
  update public.checkin_sessions set meeting_type = p_type where id = p_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- Excusing a member from one check-in (4.12, 5.3, 5.11). A reason excuses; none clears it.
-- ---------------------------------------------------------------------------

create or replace function public.set_exemption(p_session uuid, p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  why text := left(nullif(trim(p_reason), ''), 200);
begin
  if not exists (select 1 from public.checkin_sessions where id = p_session) then
    raise exception 'That check-in no longer exists.';
  end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only their chapter’s board can excuse them.'; end if;
  if p_member = me then raise exception 'Someone else on the board has to excuse you.'; end if;
  if why is not null and exists (select 1 from public.attendance where session_id = p_session and member_id = p_member) then
    raise exception 'They checked in, so there’s nothing to excuse.';
  end if;
  if why is null then
    delete from public.attendance_exemptions where session_id = p_session and member_id = p_member;
  else
    insert into public.attendance_exemptions (session_id, member_id, reason, granted_by) values (p_session, p_member, why, me)
    on conflict (session_id, member_id) do update set reason = excluded.reason, granted_by = excluded.granted_by, granted_at = now();
  end if;
end;
$$;

revoke all on function private.can_designate_big4() from public, anon;
grant execute on function private.can_designate_big4() to authenticated;
revoke all on function public.designate_big4(uuid, uuid), public.undesignate_big4(uuid), public.set_meeting_type(uuid, text),
  public.set_exemption(uuid, uuid, text) from public, anon;
grant execute on function public.designate_big4(uuid, uuid), public.undesignate_big4(uuid), public.set_meeting_type(uuid, text),
  public.set_exemption(uuid, uuid, text) to authenticated;
