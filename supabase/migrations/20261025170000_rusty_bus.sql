-- The Rusty Bus (the club van): bookings for whole Melbourne days, from a first day to a last day.
-- Bookings are locked: members change them only through book_bus, decide_bus and cancel_bus, which
-- apply the same rules with the same words as src/domain/bus.ts, checked in the same order. All
-- three take one lock, so two of them queue and the second sees what the first did. Two Booked
-- bookings can never share a day: the actions refuse it, and the exclusion constraint below makes
-- it impossible however a row is written. Waiting bookings may overlap anything.

create type public.bus_purpose as enum ('charity_ride', 'recovery', 'club_event', 'other');
-- requested is Waiting and approved is Booked, as the app shows them.
create type public.bus_status as enum ('requested', 'approved', 'declined', 'cancelled');

-- One booking. The ride and the people are kept loosely: a ride taken off the calendar or a member
-- leaving the club leaves the booking, with nobody (or no ride) named. The limits mirror the actions'.
create table public.bus_bookings (
  id uuid primary key default gen_random_uuid(),
  first_day date not null,
  last_day date not null,
  purpose public.bus_purpose not null,
  ride_id uuid references public.rides (id) on delete set null,
  driver_id uuid references public.members (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  status public.bus_status not null,
  booked_by uuid references public.members (id) on delete set null,
  booked_at timestamptz not null default now(),
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 300),
  cancelled_by uuid references public.members (id) on delete set null,
  cancelled_at timestamptz,
  constraint bus_bookings_in_order check (last_day >= first_day),
  -- 14 days at most, counting both ends.
  constraint bus_bookings_two_weeks check (last_day - first_day <= 13),
  -- The database itself can never double-book: no two Booked bookings share a day.
  constraint bus_bookings_no_double_booking
    exclude using gist (daterange(first_day, last_day, '[]') with &&) where (status = 'approved')
);
create index bus_bookings_ride on public.bus_bookings (ride_id);

-- Approved members read every booking; nobody writes one through the API.
alter table public.bus_bookings enable row level security;
revoke all on public.bus_bookings from public, anon, authenticated;
grant select on public.bus_bookings to authenticated;
create policy bus_bookings_for_members on public.bus_bookings for select to authenticated
  using (private.is_approved_member());

-- Who manages the bus, saying yes or no: the NEC (private.is_national, the app's isNational), or
-- anyone holding a sitting (not ended) board seat in any chapter; the Ride Committee isn't a board
-- seat. The club has one bus, so any board can. The app's managesBus.
create or replace function private.manages_bus()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id is not null
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;
revoke all on function private.manages_bus() from public, anon, authenticated;

-- Whether a Booked booking other than p_except shares a day with p_first to p_last.
create or replace function private.bus_clashes(p_first date, p_last date, p_except uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bus_bookings
    where status = 'approved' and id is distinct from p_except
      and daterange(first_day, last_day, '[]') && daterange(p_first, p_last, '[]')
  );
$$;
revoke all on function private.bus_clashes(date, date, uuid) from public, anon, authenticated;

-- Books the bus and returns the new booking's id. Approved Full and Nomad members book, and so do
-- bus managers. Today is the Melbourne date. A booking is Booked straight away when a manager makes
-- it, or when it is a recovery whose first day is today or tomorrow (a breakdown can't wait for a
-- meeting); then a clash with a Booked booking is refused. Anything else waits for a yes, and may
-- overlap. Notes are trimmed like the app trims, blank notes are stored as none, and lengths count
-- characters.
create or replace function public.book_bus(
  p_first date, p_last date, p_purpose public.bus_purpose, p_ride uuid, p_driver uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  manager boolean;
  clean_notes text;
  straight_away boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The bus lock first, so the clash checked below can't change until this commits.
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  today := private.club_date();
  manager := private.manages_bus();
  if not manager and not exists (
    select 1 from public.members where id = me and approval = 'approved' and status in ('full', 'nomad')
  ) then
    raise exception 'Only Full and Nomad members can book the Rusty Bus.';
  end if;

  if p_first is null or p_last is null then raise exception 'Pick the first and last day.'; end if;
  if p_last < p_first then raise exception 'The last day can’t be before the first.'; end if;
  if p_first < today then raise exception 'Bookings can’t start in the past.'; end if;
  if p_last - p_first + 1 > 14 then raise exception 'Keep a booking to 14 days at most.'; end if;
  if p_first > (today + interval '1 year')::date then raise exception 'Book at most 12 months ahead.'; end if;
  if p_purpose is null then raise exception 'Pick what it’s for.'; end if;
  if p_ride is not null and not exists (select 1 from public.rides where id = p_ride and cancelled_at is null) then
    raise exception 'That ride isn’t on the calendar.';
  end if;
  if p_driver is null or not exists (select 1 from public.members where id = p_driver and approval = 'approved') then
    raise exception 'Pick a driver who’s an approved member.';
  end if;
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_notes) > 500 then raise exception 'Keep the notes to 500 characters at most.'; end if;

  straight_away := manager or (p_purpose = 'recovery' and p_first in (today, today + 1));
  if straight_away and private.bus_clashes(p_first, p_last, null) then
    raise exception 'The Rusty Bus is already booked then.';
  end if;

  insert into public.bus_bookings (first_day, last_day, purpose, ride_id, driver_id, notes, status,
                                   booked_by, booked_at, decided_by, decided_at)
  values (p_first, p_last, p_purpose, p_ride, p_driver, clean_notes,
          case when straight_away then 'approved'::public.bus_status else 'requested'::public.bus_status end,
          me, now(),
          case when straight_away then me end, case when straight_away then now() end)
  returning id into new_id;
  return new_id;
end;
$$;

-- A bus manager says yes (p_yes true) or no to a Waiting booking whose days haven't all passed. A
-- yes that would share a day with a Booked booking is refused: whichever is approved first wins. A
-- no keeps its reason, trimmed, with a blank one stored as none; a yes keeps no reason.
create or replace function public.decide_bus(p_booking uuid, p_yes boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  b public.bus_bookings%rowtype;
  clean_reason text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.manages_bus() then
    raise exception 'Only the board or NEC can say yes or no to Rusty Bus bookings.';
  end if;
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if b.status <> 'requested' then raise exception 'That booking has already been decided.'; end if;
  if b.last_day < private.club_date() then raise exception 'That booking’s days have passed.'; end if;

  if p_yes is true then
    if private.bus_clashes(b.first_day, b.last_day, b.id) then
      raise exception 'The Rusty Bus is already booked then.';
    end if;
    update public.bus_bookings
    set status = 'approved', decided_by = me, decided_at = now(), decline_reason = null
    where id = b.id;
  else
    clean_reason := nullif(private.trim_like_app(p_reason), '');
    if char_length(clean_reason) > 300 then raise exception 'Keep the reason to 300 characters at most.'; end if;
    update public.bus_bookings
    set status = 'declined', decided_by = me, decided_at = now(), decline_reason = clean_reason
    where id = b.id;
  end if;
end;
$$;

-- Calls off a Waiting or a Booked booking whose days haven't all passed. Whoever booked it, its
-- driver or a bus manager can. A booking that started yesterday and ends tomorrow can still be
-- called off. Who said yes, and when, is kept.
create or replace function public.cancel_bus(p_booking uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  b public.bus_bookings%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if not (coalesce(b.booked_by = me, false) or coalesce(b.driver_id = me, false) or private.manages_bus()) then
    raise exception 'Only whoever booked it, its driver or the board can cancel it.';
  end if;
  if b.status in ('declined', 'cancelled') then raise exception 'That booking is already off.'; end if;
  if b.last_day < private.club_date() then raise exception 'That booking’s days have passed.'; end if;

  update public.bus_bookings set status = 'cancelled', cancelled_by = me, cancelled_at = now() where id = b.id;
end;
$$;

revoke all on function public.book_bus(date, date, public.bus_purpose, uuid, uuid, text),
  public.decide_bus(uuid, boolean, text), public.cancel_bus(uuid) from public, anon;
grant execute on function public.book_bus(date, date, public.bus_purpose, uuid, uuid, text),
  public.decide_bus(uuid, boolean, text), public.cancel_bus(uuid) to authenticated;
