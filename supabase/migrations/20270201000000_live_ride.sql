-- Live ride mode. See docs/superpowers/specs/2026-10-24-phone-superpowers-design.md, section 1.
-- Ride day only, opt-in, switches itself off, nothing kept: each rider has one row holding their
-- latest fix (never a trail), and everything for a ride is deleted once its live window closes.
-- Nobody reads the tables directly; the actions below decide who sees what. The app applies the
-- same rules with the same words (src/domain/liveRide.ts).
-- An alert kind of 'out' is the "I'm out of the ride" button.

create type public.ride_alert_kind as enum ('emergency', 'out', 'regroup');

create table public.live_riders (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  lat double precision,
  lng double precision,
  accuracy_m real,
  heading real,
  speed_kmh real,
  updated_at timestamptz,
  started_at timestamptz not null default now(),
  stops_at timestamptz not null,
  primary key (ride_id, member_id)
);

create table public.ride_alerts (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  kind public.ride_alert_kind not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.members (id) on delete set null
);
create index ride_alerts_ride on public.ride_alerts (ride_id);
-- One open emergency (and one open "out") per rider per ride, even if two sends arrive at once.
create unique index ride_alerts_one_open on public.ride_alerts (ride_id, member_id, kind)
  where resolved_at is null and kind <> 'regroup';

alter table public.live_riders enable row level security;
alter table public.ride_alerts enable row level security;
revoke all on public.live_riders, public.ride_alerts from public, anon, authenticated;

-- When live mode is open for a ride: 2 hours before a timed ride to 2 hours after it ends (or to
-- Melbourne midnight when it has no end); an all-day ride, midnight to midnight over its days.
-- No row for a cancelled ride.
create or replace function private.live_window(r public.rides)
returns table (opens timestamptz, closes timestamptz)
language sql stable set search_path = '' as $$
  select
    case when r.all_day then r.starts_at else r.starts_at - interval '2 hours' end,
    case
      when r.all_day then
        ((case when r.ends_at is null then (r.starts_at at time zone 'Australia/Melbourne')::date
               else ((r.ends_at - interval '1 millisecond') at time zone 'Australia/Melbourne')::date end) + 1)::timestamp
          at time zone 'Australia/Melbourne'
      when r.ends_at is not null then r.ends_at + interval '2 hours'
      else (((r.starts_at at time zone 'Australia/Melbourne')::date) + 1)::timestamp at time zone 'Australia/Melbourne'
    end
  where r.cancelled_at is null;
$$;

-- Road Captain, Tail Gunner or Assistant TG, or a board or NEC seat.
create or replace function private.is_ride_leader(who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.positions p join public.members m on m.id = p.member_id
    where p.member_id = who and p.ended_on is null and m.approval = 'approved'
      and p.role in ('road_captain', 'tail_gunner', 'assistant_tail_gunner', 'president', 'vice_president',
                     'secretary', 'treasurer', 'sergeant_at_arms', 'nec_chair', 'nec_secretary', 'nec_auditor')
  );
$$;

-- Whether the caller is sharing on this ride right now: still approved, the ride not cancelled, and
-- not past their switch-off time (so nothing old shows even before cleanup runs).
create or replace function private.is_sharing(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.live_riders lr join public.rides r on r.id = lr.ride_id
    where lr.ride_id = p_ride and lr.member_id = auth.uid() and lr.stops_at > now() and r.cancelled_at is null
  );
$$;

-- Why the caller can't use live mode on this ride right now, or null. The same words as the app.
create or replace function private.live_problem(p_ride uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ride public.rides%rowtype;
  w record;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride;
  if not found then return 'No such ride.'; end if;
  if ride.cancelled_at is not null then return 'That ride was cancelled.'; end if;
  select * into w from private.live_window(ride);
  if now() < w.opens then return 'Live ride opens 2 hours before the start.'; end if;
  if now() >= w.closes then return 'This ride’s finished.'; end if;
  return null;
end;
$$;

-- A fix has to be a real place (null, for "the phone doesn't know", is fine).
create or replace function private.fix_problem(p_lat double precision, p_lng double precision)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_lat is null and p_lng is null then null
    when p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
      or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
      then 'That location doesn’t look right.'
  end;
$$;

revoke all on function private.live_window(public.rides), private.is_ride_leader(uuid), private.is_sharing(uuid),
  private.live_problem(uuid), private.fix_problem(double precision, double precision)
  from public, anon, authenticated;

-- Switch sharing on (or renew it). Returns when it switches itself off: 12 hours on, or the
-- window's close if sooner.
create or replace function public.start_live_ride(p_ride uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  problem text := private.live_problem(p_ride);
  stops timestamptz;
begin
  if problem is not null then raise exception '%', problem; end if;
  stops := least(now() + interval '12 hours', (select w.closes from public.rides r, private.live_window(r) w where r.id = p_ride));
  insert into public.live_riders (ride_id, member_id, started_at, stops_at) values (p_ride, auth.uid(), now(), stops)
  on conflict (ride_id, member_id) do update set started_at = now(), stops_at = excluded.stops_at;
  return stops;
end;
$$;

-- What a rider sharing on this ride can see. Leaders' numbers go to everyone sharing; a leader also
-- gets the number and emergency contacts of anyone with an open emergency (and the number of anyone
-- who has left the ride). Alerts show while open and for 10 minutes after they're cleared.
create or replace function public.live_ride_state(p_ride uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  leader boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
  leader := private.is_ride_leader(me);
  return (
    with open_emergency as (
      select distinct member_id from public.ride_alerts
      where ride_id = p_ride and kind = 'emergency' and resolved_at is null
    ),
    riders as (
      select lr.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, private.is_ride_leader(lr.member_id) as is_leader,
             mp.phone as raw_phone
      from public.live_riders lr
      join public.members m on m.id = lr.member_id
      left join public.member_private mp on mp.member_id = lr.member_id
      where lr.ride_id = p_ride and lr.stops_at > now()
    ),
    alerts as (
      select a.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, mp.phone as raw_phone
      from public.ride_alerts a
      join public.members m on m.id = a.member_id
      left join public.member_private mp on mp.member_id = a.member_id
      where a.ride_id = p_ride and (a.resolved_at is null or a.resolved_at > now() - interval '10 minutes')
    )
    select jsonb_build_object(
      'me', (select jsonb_build_object('stops_at', stops_at) from riders where member_id = me),
      'riders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', r.member_id, 'name', r.name, 'leader', r.is_leader, 'lat', r.lat, 'lng', r.lng,
          'accuracy_m', r.accuracy_m, 'updated_at', r.updated_at,
          'phone', case when r.is_leader or (leader and r.member_id in (select member_id from open_emergency))
                        then r.raw_phone end
        ) order by r.name) from riders r), '[]'::jsonb),
      'alerts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'ride_id', a.ride_id, 'member_id', a.member_id, 'kind', a.kind, 'name', a.name,
          'lat', a.lat, 'lng', a.lng, 'created_at', a.created_at, 'resolved_at', a.resolved_at,
          'phone', case when leader and a.kind in ('emergency', 'out') and a.resolved_at is null then a.raw_phone end
        ) order by a.created_at desc) from alerts a), '[]'::jsonb),
      'contacts', case when leader then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'member_id', c.member_id, 'name', c.name, 'relationship', c.relationship, 'phone', c.phone
        ) order by c.created_at) from public.emergency_contacts c
        where c.member_id in (select member_id from open_emergency)), '[]'::jsonb) else '[]'::jsonb end
    )
  );
end;
$$;

-- Your latest fix, overwriting the last one. Returns what you can see, so one call posts and polls.
create or replace function public.update_live_position(
  p_ride uuid, p_lat double precision, p_lng double precision, p_accuracy real, p_heading real, p_speed real)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
  if private.fix_problem(p_lat, p_lng) is not null then raise exception '%', private.fix_problem(p_lat, p_lng); end if;
  update public.live_riders
  set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy, heading = p_heading, speed_kmh = p_speed, updated_at = now()
  where ride_id = p_ride and member_id = auth.uid();
  return public.live_ride_state(p_ride);
end;
$$;

-- Raise an alert where you are (the position may be unknown). An emergency or leaving the ride needs
-- only the ride to be on, so one raised with no signal still goes through after the rider's own
-- sharing has switched off; p_at is when it was pressed. A second one from the same rider while one
-- is open updates that one instead. A regroup pin needs a leader who is sharing, and clears the last.
-- Leaving the ride also stops your sharing.
create or replace function public.raise_ride_alert(
  p_ride uuid, p_kind public.ride_alert_kind, p_lat double precision, p_lng double precision,
  p_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  problem text := private.live_problem(p_ride);
  pressed timestamptz := least(now(), greatest(coalesce(p_at, now()), now() - interval '12 hours'));
  new_id uuid;
begin
  if problem is not null then raise exception '%', problem; end if;
  if p_kind = 'regroup' then
    if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
    if not private.is_ride_leader(me) then raise exception 'Only ride leaders can set a regroup pin.'; end if;
  end if;
  problem := private.fix_problem(p_lat, p_lng);
  if problem is not null then raise exception '%', problem; end if;

  if p_kind = 'regroup' then
    update public.ride_alerts set resolved_at = now(), resolved_by = me
    where ride_id = p_ride and kind = 'regroup' and resolved_at is null;
    insert into public.ride_alerts (ride_id, member_id, kind, lat, lng) values (p_ride, me, p_kind, p_lat, p_lng)
    returning id into new_id;
  else
    insert into public.ride_alerts as a (ride_id, member_id, kind, lat, lng, created_at)
    values (p_ride, me, p_kind, p_lat, p_lng, pressed)
    on conflict (ride_id, member_id, kind) where resolved_at is null and kind <> 'regroup'
    do update set lat = coalesce(excluded.lat, a.lat), lng = coalesce(excluded.lng, a.lng)
    returning id into new_id;
  end if;

  if p_kind = 'out' then
    delete from public.live_riders where ride_id = p_ride and member_id = me;
  end if;
  return new_id;
end;
$$;

-- "I'm OK" or "Got them": the rider who raised it, or a ride leader sharing on that ride.
create or replace function public.resolve_ride_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a public.ride_alerts%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into a from public.ride_alerts where id = p_alert;
  if not found then raise exception 'That alert has gone.'; end if;
  if a.resolved_at is not null then raise exception 'Already cleared.'; end if;
  if a.member_id <> me and not (private.is_ride_leader(me) and private.is_sharing(a.ride_id)) then
    raise exception 'Only the rider or a ride leader can clear this.';
  end if;
  update public.ride_alerts set resolved_at = now(), resolved_by = me where id = p_alert;
end;
$$;

-- Stop sharing. Your alerts stay until the window closes, so the TG still sees where you were.
create or replace function public.stop_live_ride(p_ride uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from public.live_riders where ride_id = p_ride and member_id = auth.uid();
end;
$$;

revoke all on function public.start_live_ride(uuid), public.live_ride_state(uuid),
  public.update_live_position(uuid, double precision, double precision, real, real, real),
  public.raise_ride_alert(uuid, public.ride_alert_kind, double precision, double precision, timestamptz),
  public.resolve_ride_alert(uuid), public.stop_live_ride(uuid)
  from public, anon;
grant execute on function public.start_live_ride(uuid), public.live_ride_state(uuid),
  public.update_live_position(uuid, double precision, double precision, real, real, real),
  public.raise_ride_alert(uuid, public.ride_alert_kind, double precision, double precision, timestamptz),
  public.resolve_ride_alert(uuid), public.stop_live_ride(uuid)
  to authenticated;

-- Nothing kept: riders past their switch-off time, and everything for a ride whose window has
-- closed (or that was cancelled), is deleted.
create or replace function private.live_ride_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.live_riders where stops_at <= now();
  delete from public.live_riders lr using public.rides r
  where r.id = lr.ride_id
    and not exists (select 1 from private.live_window(r) w where w.closes > now());
  delete from public.ride_alerts a using public.rides r
  where r.id = a.ride_id
    and not exists (select 1 from private.live_window(r) w where w.closes > now());
end;
$$;
revoke all on function private.live_ride_cleanup() from public, anon, authenticated;

-- Every 5 minutes where pg_cron exists (Supabase; the local test database has none).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('live-ride-cleanup', '*/5 * * * *', 'select private.live_ride_cleanup()');
  else
    raise warning 'pg_cron is missing, so live ride cleanup is not scheduled. Nothing would be deleted.';
  end if;
end $$;
