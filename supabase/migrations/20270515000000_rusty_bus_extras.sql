-- Rusty Bus extras: changing a booking, who has the keys, the odometer, and the running costs.
-- Like the bookings, these change only through their actions, which apply the same rules with the
-- same words as src/domain/bus.ts (change_bus) and src/domain/busLog.ts (the rest), checked in the
-- same order. Every action takes the bus lock, so they queue behind book_bus, decide_bus and
-- cancel_bus. Nothing is ever deleted: a reading or cost logged by mistake is struck out, stays,
-- and counts for nothing.

-- Who last changed a booking, and when.
alter table public.bus_bookings
  add column changed_by uuid references public.members (id) on delete set null,
  add column changed_at timestamptz;

create type public.bus_cost_kind as enum ('fuel', 'service', 'repairs', 'tyres', 'rego', 'insurance', 'tolls', 'cleaning', 'other');

-- The keys passing to someone. The newest row names who has them now.
create table public.bus_key_handovers (
  id uuid primary key default gen_random_uuid(),
  to_id uuid references public.members (id) on delete set null,
  note text check (char_length(note) <= 200),
  logged_by uuid references public.members (id) on delete set null,
  logged_at timestamptz not null default now()
);
create index bus_key_handovers_newest on public.bus_key_handovers (logged_at desc, id desc);

-- Odometer readings in whole km.
create table public.bus_km (
  id uuid primary key default gen_random_uuid(),
  km int not null check (km between 1 and 2000000),
  read_on date not null,
  booking_id uuid references public.bus_bookings (id) on delete set null,
  note text check (char_length(note) <= 200),
  logged_by uuid references public.members (id) on delete set null,
  logged_at timestamptz not null default now(),
  struck_by uuid references public.members (id) on delete set null,
  struck_at timestamptz
);
create index bus_km_read_on on public.bus_km (read_on);
create index bus_km_booking on public.bus_km (booking_id);

-- Money spent on the bus. Litres are for fuel only.
create table public.bus_costs (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  kind public.bus_cost_kind not null,
  amount_cents int not null check (amount_cents between 1 and 10000000),
  litres numeric(6, 2) check (litres > 0 and litres <= 1000),
  booking_id uuid references public.bus_bookings (id) on delete set null,
  note text check (char_length(note) <= 200),
  logged_by uuid references public.members (id) on delete set null,
  logged_at timestamptz not null default now(),
  struck_by uuid references public.members (id) on delete set null,
  struck_at timestamptz,
  constraint bus_costs_litres_for_fuel check (litres is null or kind = 'fuel')
);
create index bus_costs_spent_on on public.bus_costs (spent_on);
create index bus_costs_booking on public.bus_costs (booking_id);

-- Approved members read the keys and the odometer. The costs are club spending, so they stay with
-- the bus managers (every board seat and the NEC, so every treasurer), and each member sees the
-- ones they logged. Nobody writes any of them through the API.
alter table public.bus_key_handovers enable row level security;
alter table public.bus_km enable row level security;
alter table public.bus_costs enable row level security;
revoke all on public.bus_key_handovers, public.bus_km, public.bus_costs from public, anon, authenticated;
grant select on public.bus_key_handovers, public.bus_km, public.bus_costs to authenticated;
create policy bus_key_handovers_for_members on public.bus_key_handovers for select to authenticated
  using (private.is_approved_member());
create policy bus_km_for_members on public.bus_km for select to authenticated
  using (private.is_approved_member());
-- Whether the caller may read a cost logged by p_logged_by: a bus manager, or whoever logged it.
-- The policy's own check, so members may run it; it says nothing about anyone else.
create or replace function private.can_read_bus_cost(p_logged_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_bus() or (private.is_approved_member() and p_logged_by = auth.uid());
$$;
revoke all on function private.can_read_bus_cost(uuid) from public, anon;
grant execute on function private.can_read_bus_cost(uuid) to authenticated;
create policy bus_costs_for_managers on public.bus_costs for select to authenticated
  using (private.can_read_bus_cost(logged_by));

-- Who has the keys now: the newest handover's member, or null.
create or replace function private.bus_key_holder()
returns uuid language sql stable security definer set search_path = '' as $$
  select to_id from public.bus_key_handovers order by logged_at desc, id desc limit 1;
$$;
revoke all on function private.bus_key_holder() from public, anon, authenticated;

-- Who can log keys, km and costs: anyone who can book the bus (approved Full and Nomad members,
-- and bus managers), and whoever has the keys right now. The app's isBusHand.
create or replace function private.bus_hand()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.manages_bus()
    or exists (select 1 from public.members where id = auth.uid() and status in ('full', 'nomad'))
    or private.bus_key_holder() is not distinct from auth.uid()
  );
$$;
revoke all on function private.bus_hand() from public, anon, authenticated;

-- Changes a Waiting or Booked booking whose days haven't all passed: its days, what it's for, the
-- ride, the driver and the notes. Whoever booked it or a bus manager can. The status never changes:
-- a Waiting booking may move anywhere (the board still says yes), and a Booked one keeps its yes,
-- so someone who isn't a manager may shrink it or change the rest, but only add days when the
-- change would be booked straight away anyway (a recovery from today or tomorrow), and never onto
-- another Booked booking's days. A booking under way may keep its own first day though it's past.
create or replace function public.change_bus(
  p_booking uuid, p_first date, p_last date, p_purpose public.bus_purpose, p_ride uuid, p_driver uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  manager boolean;
  b public.bus_bookings%rowtype;
  clean_notes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  today := private.club_date();
  manager := private.manages_bus();
  select * into b from public.bus_bookings where id = p_booking for update;
  if not found then raise exception 'No such booking.'; end if;
  if not (coalesce(b.booked_by = me, false) or manager) then
    raise exception 'Only whoever booked it or the board can change it.';
  end if;
  if b.status in ('declined', 'cancelled') then raise exception 'That booking is already off.'; end if;
  if b.last_day < today then raise exception 'That booking’s days have passed.'; end if;

  if p_first is null or p_last is null then raise exception 'Pick the first and last day.'; end if;
  if p_last < p_first then raise exception 'The last day can’t be before the first.'; end if;
  if p_first < today and p_first <> b.first_day then raise exception 'Bookings can’t start in the past.'; end if;
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

  if b.status = 'approved' then
    if (p_first < b.first_day or p_last > b.last_day)
       and not (manager or (p_purpose = 'recovery' and p_first in (today, today + 1))) then
      raise exception 'Only the board or NEC can add days to a Booked booking.';
    end if;
    if private.bus_clashes(p_first, p_last, b.id) then
      raise exception 'The Rusty Bus is already booked then.';
    end if;
  end if;

  update public.bus_bookings
  set first_day = p_first, last_day = p_last, purpose = p_purpose, ride_id = p_ride, driver_id = p_driver,
      notes = clean_notes, changed_by = me, changed_at = now()
  where id = b.id;
end;
$$;

-- Logs the keys passing to p_to. Any bus hand can log it: the giver, the taker, or someone who saw it.
create or replace function public.hand_bus_keys(p_to uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_to is null or not exists (select 1 from public.members where id = p_to and approval = 'approved') then
    raise exception 'Pick someone who’s an approved member.';
  end if;
  if private.bus_key_holder() is not distinct from p_to then raise exception 'They already have the keys.'; end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  -- The clock, not the transaction's start, so two handovers in one transaction still have an order.
  insert into public.bus_key_handovers (to_id, note, logged_by, logged_at)
  values (p_to, clean_note, me, clock_timestamp()) returning id into new_id;
  return new_id;
end;
$$;

-- Logs an odometer reading. It may be back-dated, but never later than today (Melbourne), and it
-- must sit in order: no lower than a reading (not struck out) on that day or before, and no higher
-- than one on a later day.
create or replace function public.log_bus_km(p_km int, p_on date, p_booking uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_on is null or p_on > private.club_date() then raise exception 'Pick the day, today or earlier.'; end if;
  if p_km is null or p_km < 1 or p_km > 2000000 then raise exception 'The odometer is in whole km, up to 2,000,000.'; end if;
  if exists (
    select 1 from public.bus_km
    where struck_at is null and ((read_on <= p_on and km > p_km) or (read_on > p_on and km < p_km))
  ) then
    raise exception 'That reading is out of order with the ones before and after it.';
  end if;
  if p_booking is not null and not exists (select 1 from public.bus_bookings where id = p_booking and status = 'approved') then
    raise exception 'Pick a Booked booking.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  insert into public.bus_km (km, read_on, booking_id, note, logged_by)
  values (p_km, p_on, p_booking, clean_note, me) returning id into new_id;
  return new_id;
end;
$$;

-- Logs a running cost. Litres are rounded to two decimals, like the app, and only fuel takes them.
-- These aren't the treasurer's books: paying, or paying someone back, still goes through the Treasury.
create or replace function public.log_bus_cost(
  p_on date, p_kind public.bus_cost_kind, p_cents int, p_litres numeric, p_booking uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  litres numeric := round(p_litres, 2);
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  if not private.bus_hand() then
    raise exception 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.';
  end if;
  if p_on is null or p_on > private.club_date() then raise exception 'Pick the day, today or earlier.'; end if;
  if p_kind is null then raise exception 'Pick what it was for.'; end if;
  if p_cents is null or p_cents < 1 or p_cents > 10000000 then raise exception 'Enter an amount from $0.01 to $100,000.'; end if;
  if litres is not null then
    if p_kind <> 'fuel' then raise exception 'Only fuel takes litres.'; end if;
    if litres <= 0 or litres > 1000 then raise exception 'Litres: more than 0, up to 1000.'; end if;
  end if;
  if p_booking is not null and not exists (select 1 from public.bus_bookings where id = p_booking and status = 'approved') then
    raise exception 'Pick a Booked booking.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;

  insert into public.bus_costs (spent_on, kind, amount_cents, litres, booking_id, note, logged_by)
  values (p_on, p_kind, p_cents, litres, p_booking, clean_note, me) returning id into new_id;
  return new_id;
end;
$$;

-- Strikes out a reading or a cost logged by mistake. Whoever logged it, or a bus manager, can.
create or replace function public.strike_bus_km(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  e public.bus_km%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into e from public.bus_km where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not (coalesce(e.logged_by = me, false) or private.manages_bus()) then
    raise exception 'Only whoever logged it or the board can strike it out.';
  end if;
  if e.struck_at is not null then raise exception 'That’s already struck out.'; end if;
  update public.bus_km set struck_by = me, struck_at = now() where id = e.id;
end;
$$;

create or replace function public.strike_bus_cost(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  e public.bus_costs%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into e from public.bus_costs where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not (coalesce(e.logged_by = me, false) or private.manages_bus()) then
    raise exception 'Only whoever logged it or the board can strike it out.';
  end if;
  if e.struck_at is not null then raise exception 'That’s already struck out.'; end if;
  update public.bus_costs set struck_by = me, struck_at = now() where id = e.id;
end;
$$;

revoke all on function
  public.change_bus(uuid, date, date, public.bus_purpose, uuid, uuid, text),
  public.hand_bus_keys(uuid, text),
  public.log_bus_km(int, date, uuid, text),
  public.log_bus_cost(date, public.bus_cost_kind, int, numeric, uuid, text),
  public.strike_bus_km(uuid),
  public.strike_bus_cost(uuid)
from public, anon;
grant execute on function
  public.change_bus(uuid, date, date, public.bus_purpose, uuid, uuid, text),
  public.hand_bus_keys(uuid, text),
  public.log_bus_km(int, date, uuid, text),
  public.log_bus_cost(date, public.bus_cost_kind, int, numeric, uuid, text),
  public.strike_bus_km(uuid),
  public.strike_bus_cost(uuid)
to authenticated;
