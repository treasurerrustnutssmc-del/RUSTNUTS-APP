-- "I'm here" check-in (Jeff, 21 Nov 2026: no QR scan, a notice to the ride leader to confirm).
-- A rider taps I'm here on the day: at a ride the check-in opens itself if nobody has opened it, and
-- the ride's leaders get a push to confirm them. Whoever runs the check-in, or the ride's Road
-- Captain, Tail Gunner or ATG (not an Officer spot, which anyone can take on the day), taps Confirm
-- (attended, ticked off by them) or Not here. Nobody confirms themselves: those who run the
-- check-in go straight in (as they could with the code), the crew waits for someone else. The code
-- and QR stay as a backup. Same rules and words as
-- src/domain/attendance.ts (askCheckInProblem, checkinAsk, answerCheckinProblem, canConfirmCheckin).

create table public.checkin_requests (
  session_id uuid not null references public.checkin_sessions (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  asked_at timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index checkin_requests_member on public.checkin_requests (member_id);

-- Whoever runs the check-in, and on a ride its Road Captain, Tail Gunner and ATG (not Family). Mirrors canConfirmCheckin.
create or replace function private.can_confirm_checkin(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.checkin_sessions s where s.id = p_session and private.can_run_checkin(s.chapter_id))
    or (private.is_approved_member() and exists (
      select 1 from public.checkin_sessions s
      join public.ride_crew c on c.ride_id = s.ride_id
      where s.id = p_session and s.kind = 'ride' and c.member_id = auth.uid()
        and c.role in ('road_captain', 'tail_gunner', 'assistant_tail_gunner')));
$$;

alter table public.checkin_requests enable row level security;
revoke all on public.checkin_requests from public, anon, authenticated;
grant select on public.checkin_requests to authenticated;
-- Your own, and the ones you can confirm.
create policy checkin_requests_read on public.checkin_requests for select to authenticated using (
  member_id = (select auth.uid()) or private.can_confirm_checkin(session_id)
);

-- Who hears that someone is waiting: the ride's crew, and those who run it and are there (going,
-- opened it, or already checked in). If that's nobody, everyone who runs it.
create or replace function private.checkin_leaders(p_session uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with s as (select * from public.checkin_sessions where id = p_session),
  ok as (select id from public.members where approval = 'approved' and status <> 'family'),
  runners as (
    select h.member_id from private.held_positions h, s
    where h.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
      and (s.chapter_id is null or h.chapter_id = s.chapter_id)
    union
    select d.member_id from private.duty_positions d, s
    where s.chapter_id is null and d.role in ('nec_chair', 'nec_secretary', 'president')
  ),
  near as (
    select c.member_id from public.ride_crew c, s
    where s.kind = 'ride' and c.ride_id = s.ride_id and c.role in ('road_captain', 'tail_gunner', 'assistant_tail_gunner')
    union
    select r.member_id from runners r, s
    where r.member_id = s.opened_by
       or exists (select 1 from public.rsvps v where v.ride_id = s.ride_id and v.member_id = r.member_id and v.answer = 'going')
       or exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = r.member_id)
  ),
  near_ok as (select member_id from near where member_id in (select id from ok))
  select member_id from near_ok
  union
  select member_id from runners where member_id in (select id from ok) and not exists (select 1 from near_ok);
$$;

-- I'm here. At a ride (p_ride) or an open check-in (p_session). Returns the check-in.
create or replace function public.ask_check_in(p_ride uuid, p_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rides%rowtype;
  s public.checkin_sessions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.can_check_in() then raise exception 'Only members and applicants can check in.'; end if;
  if p_ride is not null then
    select * into r from public.rides where id = p_ride;
    if not found then raise exception 'No such ride.'; end if;
    if r.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
    select * into s from public.checkin_sessions where ride_id = p_ride;
    if not found then
      if private.club_date(r.starts_at) <> private.club_date() then raise exception 'You can only check in on the day.'; end if;
      -- Nobody opened it: it opens itself (opened_by stays empty).
      insert into public.checkin_sessions (kind, chapter_id, ride_id, title, held_on, code)
      values ('ride',
              case when r.category in ('north', 'west') then (select id from public.chapters where slug = r.category::text) end,
              r.id, r.title, private.club_date(r.starts_at), private.new_checkin_code())
      on conflict (ride_id) do nothing;
      select * into s from public.checkin_sessions where ride_id = p_ride;
    end if;
  else
    select * into s from public.checkin_sessions where id = p_session;
    if not found then raise exception 'That check-in no longer exists.'; end if;
  end if;
  if s.closed_at is not null then raise exception 'That check-in has closed.'; end if;
  if s.held_on <> private.club_date() then raise exception 'You can only check in on the day.'; end if;

  if exists (select 1 from public.attendance where session_id = s.id and member_id = me) then return s.id; end if;
  if private.can_run_checkin(s.chapter_id) then
    insert into public.attendance (session_id, member_id) values (s.id, me) on conflict do nothing;
  else
    insert into public.checkin_requests (session_id, member_id)
    select s.id, me where not exists (select 1 from public.attendance where session_id = s.id and member_id = me)
    on conflict do nothing;
  end if;
  return s.id;
end;
$$;

-- Confirm (p_here) or turn down someone waiting.
create or replace function public.answer_check_in(p_session uuid, p_member uuid, p_here boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.checkin_sessions%rowtype;
  target public.members%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session;
  if not found then raise exception 'That check-in no longer exists.'; end if;
  if not private.can_confirm_checkin(p_session) then raise exception 'Only the ride crew or the board can confirm check-ins.'; end if;
  if p_member = auth.uid() then raise exception 'Someone else has to confirm you.'; end if;
  if s.closed_at is not null then raise exception 'That check-in has closed.'; end if;
  select * into target from public.members where id = p_member;
  if not found or not ((target.approval = 'approved' and target.status <> 'family')
                       or (target.approval = 'pending' and target.status = 'introduced')) then
    raise exception 'They can’t be checked in.';
  end if;
  delete from public.checkin_requests where session_id = p_session and member_id = p_member;
  if not found then raise exception 'They’re not waiting to be confirmed.'; end if;
  if p_here then
    insert into public.attendance (session_id, member_id, marked_by) values (p_session, p_member, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;

-- The leaders hear about each ask: "Cobra is here", tap to confirm.
create or replace function private.push_checkin_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
  what text := (select title from public.checkin_sessions where id = new.session_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select l, 'checkin:' || new.session_id || ':' || new.member_id || ':' || extract(epoch from new.asked_at)::bigint,
    who || ' is here', 'Tap to confirm them at ' || what,
    jsonb_build_object('kind', 'checkin', 'sessionId', new.session_id)
  from private.checkin_leaders(new.session_id) l
  where l <> new.member_id
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;
create trigger checkin_requests_push after insert on public.checkin_requests
  for each row execute function private.push_checkin_request();

-- However someone ends up checked in (code, a tick, a confirm), they're no longer waiting.
create or replace function private.clear_checkin_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.checkin_requests where session_id = new.session_id and member_id = new.member_id;
  return new;
end;
$$;
create trigger attendance_clears_request after insert on public.attendance
  for each row execute function private.clear_checkin_request();

-- Closing a check-in ends any wait.
create or replace function private.clear_checkin_requests_on_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.checkin_requests where session_id = new.id;
  end if;
  return new;
end;
$$;
create trigger checkin_close_clears_requests after update of closed_at on public.checkin_sessions
  for each row execute function private.clear_checkin_requests_on_close();

revoke all on function private.clear_checkin_requests_on_close() from public, anon, authenticated;
revoke all on function private.can_confirm_checkin(uuid), private.checkin_leaders(uuid),
  private.push_checkin_request(), private.clear_checkin_request() from public, anon, authenticated;
grant execute on function private.can_confirm_checkin(uuid) to authenticated; -- the read policy calls it
revoke all on function public.ask_check_in(uuid, uuid), public.answer_check_in(uuid, uuid, boolean) from public, anon;
grant execute on function public.ask_check_in(uuid, uuid), public.answer_check_in(uuid, uuid, boolean) to authenticated;
