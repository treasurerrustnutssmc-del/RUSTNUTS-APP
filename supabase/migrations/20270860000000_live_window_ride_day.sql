-- Ride comms and live location stay open longer (Jeff, 15 Nov 2026): from 12:00 am Melbourne on the
-- day before the ride's first day, to midnight as its last day ends (an overnight ride's last day is
-- the day it finishes). It was 2 hours either side of a timed ride. Mirrors liveWindow in
-- src/domain/liveRide.ts. Everything that asks live_window (start_live_ride, ride_voice_room, the
-- sweep, cleanup) follows; only the "not yet" words and how far ahead the sweep looks change here.

create or replace function private.live_window(r public.rides)
returns table (opens timestamptz, closes timestamptz)
language sql stable set search_path = '' as $$
  select
    (((r.starts_at at time zone 'Australia/Melbourne')::date) - 1)::timestamp at time zone 'Australia/Melbourne',
    ((case
        when r.ends_at is null then (r.starts_at at time zone 'Australia/Melbourne')::date
        when r.all_day then ((r.ends_at - interval '1 millisecond') at time zone 'Australia/Melbourne')::date
        else (r.ends_at at time zone 'Australia/Melbourne')::date
      end) + 1)::timestamp at time zone 'Australia/Melbourne'
  where r.cancelled_at is null;
$$;
revoke all on function private.live_window(public.rides) from public, anon, authenticated;

create or replace function private.live_problem_for(p_ride uuid, p_member uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ride public.rides%rowtype;
  w record;
begin
  if not exists (select 1 from public.members where id = p_member and approval = 'approved' and status <> 'family') then
    return 'Only approved members can do that.';
  end if;
  select * into ride from public.rides where id = p_ride;
  if not found then return 'No such ride.'; end if;
  if ride.cancelled_at is not null then return 'That ride was cancelled.'; end if;
  select * into w from private.live_window(ride);
  if now() < w.opens then return 'Live ride opens the day before the ride.'; end if;
  if now() >= w.closes then return 'This ride’s finished.'; end if;
  return null;
end;
$$;
revoke all on function private.live_problem_for(uuid, uuid) from public, anon, authenticated;

-- A window can now open about two days before the start (11:30 pm tomorrow opens at today's start;
-- up to 49 hours when daylight saving ends in between), so look 3 days ahead, not 1.
create or replace function private.voice_sweep_due()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rides r, private.live_window(r) w
    where r.starts_at > now() - interval '7 days' and r.starts_at < now() + interval '3 days'
      and w.opens <= now() and w.closes > now() - interval '6 hours'
  ) or exists (
    -- A ride called off while its room was open.
    select 1 from public.rides r
    where r.cancelled_at > now() - interval '6 hours' and r.starts_at > now() - interval '7 days'
  );
$$;
revoke all on function private.voice_sweep_due() from public, anon, authenticated;
