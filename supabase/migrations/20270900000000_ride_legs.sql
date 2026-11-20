-- Rides ridden in legs (Jeff, 21 Nov 2026: the Big 4 went in as three separate rides). Each leg stays
-- a ride of its own, with its own route, crew, chat and ride comms; ride_legs only links rides into a
-- trip and numbers them. Apart from public.rides so the calendar sync never touches it. Same rules
-- and words as src/domain/rideLegs.ts, in the same order. Checked by supabase/tests/ride_legs_test.sql.
-- Spec: docs/superpowers/specs/2026-11-21-ride-legs-design.md.

create table if not exists public.ride_legs (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  trip_id uuid not null,
  leg_no smallint not null check (leg_no between 1 and 6),
  set_by uuid references public.members (id) on delete set null,
  set_at timestamptz not null default now(),
  constraint ride_legs_trip_leg unique (trip_id, leg_no) deferrable initially deferred
);
create index if not exists ride_legs_set_by on public.ride_legs (set_by);

alter table public.ride_legs enable row level security;
revoke all on public.ride_legs from public, anon, authenticated;
grant select on public.ride_legs to authenticated;
drop policy if exists ride_legs_for_members on public.ride_legs;
create policy ride_legs_for_members on public.ride_legs for select to authenticated
  using ((select private.is_approved_member()));

-- Makes these rides, in this order, the legs of one trip. Rides already in other trips leave them
-- (a trip left with one ride ends; the rest are renumbered). One ride or none just unlinks. Returns
-- the new trip's id, or null.
create or replace function public.set_ride_legs(p_rides uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n int := coalesce(cardinality(p_rides), 0);
  first_start timestamptz;
  old_trips uuid[];
  t uuid;
  trip uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if n > 6 then raise exception 'A ride has at most 6 legs.'; end if;
  if (select count(distinct x) from unnest(p_rides) x) <> n then raise exception 'List each leg once.'; end if;
  if exists (select 1 from unnest(p_rides) x where not exists (select 1 from public.rides r where r.id = x)) then
    raise exception 'No such ride.';
  end if;
  if not private.manages_chapter_rides(null) then
    raise exception 'Only the board, ride committee or NEC can make and change rides.';
  end if;
  if exists (select 1 from public.rides r where r.id = any(p_rides) and not private.manages_ride_category(r.category)) then
    raise exception 'Only that chapter’s board or ride committee can run its rides.';
  end if;
  if n >= 2 then
    -- A ride that's history can't join a trip, but one already in it with another listed leg stays
    -- (a trip under way keeps its first legs when it changes or gets a new one). A ride is history
    -- once its last Melbourne day has passed (a calendar's all-day end is the midnight after).
    if exists (
      select 1 from public.rides r
      where r.id = any(p_rides)
        and private.club_date(case
          when r.ends_at is null then r.starts_at
          when r.all_day then r.ends_at - interval '1 millisecond'
          else r.ends_at end) < private.club_date()
        and not exists (
          select 1 from public.ride_legs a join public.ride_legs b on b.trip_id = a.trip_id
          where a.ride_id = r.id and b.ride_id <> r.id and b.ride_id = any(p_rides))) then
      raise exception 'That ride is history; it can’t change now.';
    end if;
    select r.starts_at into first_start from public.rides r where r.id = p_rides[1];
    if exists (select 1 from public.rides r where r.id = any(p_rides) and abs(extract(epoch from r.starts_at - first_start)) > 14 * 86400) then
      raise exception 'Legs start within 14 days of the first.';
    end if;
  end if;

  -- One change to legs at a time, so two saves at once queue rather than collide.
  perform pg_advisory_xact_lock(hashtext('public.set_ride_legs'));
  -- Take the listed rides out of the trips they were in, and tidy what's left of those trips.
  select coalesce(array_agg(distinct l.trip_id), '{}') into old_trips from public.ride_legs l where l.ride_id = any(p_rides);
  delete from public.ride_legs l where l.ride_id = any(p_rides);
  foreach t in array old_trips loop
    if (select count(*) from public.ride_legs l where l.trip_id = t) < 2 then
      delete from public.ride_legs l where l.trip_id = t;
    else
      update public.ride_legs l set leg_no = k.no
      from (select ride_id, row_number() over (order by leg_no) as no from public.ride_legs where trip_id = t) k
      where l.ride_id = k.ride_id;
    end if;
  end loop;

  if n < 2 then return null; end if;
  trip := gen_random_uuid();
  insert into public.ride_legs (ride_id, trip_id, leg_no, set_by)
  select x.id, trip, x.no, me from unnest(p_rides) with ordinality as x(id, no);
  return trip;
end;
$$;
revoke all on function public.set_ride_legs(uuid[]) from public, anon;
grant execute on function public.set_ride_legs(uuid[]) to authenticated;
