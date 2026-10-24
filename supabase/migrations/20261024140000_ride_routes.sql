-- Ride routes: the club's library of GPX routes, and which route each ride uses. Routes are locked:
-- members change them only through save_route, archive_route and set_ride_route, which apply the
-- same rules with the same words as src/domain/routes.ts, checked in the same order. Nothing is ever
-- removed: archiving hides a route from the library and from choosing, and rides that use it keep it.

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  chapter_id uuid references public.chapters (id), -- null: the whole club
  notes text,
  gpx text not null check (octet_length(gpx) <= 5242880),
  -- The summary the app read from the file: metres, [[lat,lng],…], [{name,lat,lng}], {minLat,…}.
  distance_m int not null default 0,
  climb_m int,
  line jsonb not null default '[]' check (jsonb_typeof(line) = 'array'),
  stops jsonb not null default '[]' check (jsonb_typeof(stops) = 'array'),
  bounds jsonb,
  -- Who made and last changed it, kept loosely (a plain id) so a member can still leave the club.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- A ride's route, apart from the rides table so the calendar sync never touches it. A cleared
-- route is a row with no route_id. The sync never removes rides (it marks them cancelled), so the
-- ride link has no cascade: a ride with a route stays until its route row is cleared away by hand.
create table public.ride_routes (
  ride_id uuid primary key references public.rides (id),
  route_id uuid references public.routes (id),
  set_by uuid, -- kept loosely, as on routes
  set_at timestamptz not null default now()
);
create index ride_routes_route on public.ride_routes (route_id);

-- Approved members read both. The library is read without the files, which can be 5 MB each:
-- one route's file comes through route_gpx.
alter table public.routes enable row level security;
alter table public.ride_routes enable row level security;
revoke all on public.routes, public.ride_routes from public, anon, authenticated;
grant select (id, name, chapter_id, notes, distance_m, climb_m, line, stops, bounds,
              created_by, created_at, updated_by, updated_at, archived_at) on public.routes to authenticated;
grant select on public.ride_routes to authenticated;
create policy routes_for_members on public.routes for select to authenticated using (private.is_approved_member());
create policy ride_routes_for_members on public.ride_routes for select to authenticated
  using (private.is_approved_member());

-- Who manages a chapter's routes: anyone on the NEC; for a chapter, that chapter's board or Ride
-- Committee; for the whole club (null), any chapter's board or Ride Committee. The same people as
-- manages_ride, for a chapter instead of a ride.
create or replace function private.manages_chapter_rides(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.positions p
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
        and (p_chapter is null or p.chapter_id = p_chapter)
    )
  );
$$;
revoke all on function private.manages_chapter_rides(uuid) from public, anon;
grant execute on function private.manages_chapter_rides(uuid) to authenticated;

-- Adds a route (p_id null) or changes one. A null p_gpx keeps the file and its summary and changes
-- only the name, chapter and notes. The file is checked here too, so a wrong or empty one can't get
-- in from a hand-made call.
create or replace function public.save_route(
  p_id uuid, p_name text, p_chapter uuid, p_notes text, p_gpx text,
  p_distance_m int, p_climb_m int, p_line jsonb, p_stops jsonb, p_bounds jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.routes%rowtype;
  doc xml;
  saved uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into existing from public.routes where id = p_id for update;
    if not found then raise exception 'That route no longer exists.'; end if;
  end if;
  if not private.manages_chapter_rides(p_chapter)
     or (p_id is not null and not private.manages_chapter_rides(existing.chapter_id)) then
    raise exception 'Only the board or ride committee can change routes.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Give the route a name.';
  end if;

  if p_gpx is null then
    if p_id is null then raise exception 'That route has no track in it.'; end if;
  else
    if octet_length(p_gpx) > 5242880 then raise exception 'That file is too big (5 MB at most).'; end if;
    if not xml_is_well_formed_document(p_gpx) then raise exception 'That isn’t a GPX file.'; end if;
    doc := xmlparse(document p_gpx);
    if (xpath('local-name(/*)', doc))[1]::text is distinct from 'gpx' then
      raise exception 'That isn’t a GPX file.';
    end if;
    if coalesce(cardinality(xpath('//*[local-name()=''trkpt'' or local-name()=''rtept'']', doc)), 0) < 2 then
      raise exception 'That route has no track in it.';
    end if;
  end if;

  if p_id is null then
    insert into public.routes (name, chapter_id, notes, gpx, distance_m, climb_m, line, stops, bounds,
                               created_by, updated_by)
    values (btrim(p_name), p_chapter, nullif(btrim(p_notes), ''), p_gpx, coalesce(p_distance_m, 0), p_climb_m,
            coalesce(p_line, '[]'::jsonb), coalesce(p_stops, '[]'::jsonb), p_bounds, me, me)
    returning id into saved;
  elsif p_gpx is null then
    update public.routes
    set name = btrim(p_name), chapter_id = p_chapter, notes = nullif(btrim(p_notes), ''),
        updated_by = me, updated_at = now()
    where id = p_id
    returning id into saved;
  else
    update public.routes
    set name = btrim(p_name), chapter_id = p_chapter, notes = nullif(btrim(p_notes), ''),
        gpx = p_gpx, distance_m = coalesce(p_distance_m, 0), climb_m = p_climb_m,
        line = coalesce(p_line, '[]'::jsonb), stops = coalesce(p_stops, '[]'::jsonb), bounds = p_bounds,
        updated_by = me, updated_at = now()
    where id = p_id
    returning id into saved;
  end if;
  return saved;
end;
$$;

-- Hides a route from the library and from choosing. Rides that use it keep it. Archiving an
-- archived route changes nothing.
create or replace function public.archive_route(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.routes%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into existing from public.routes where id = p_id for update;
  if not found then raise exception 'That route no longer exists.'; end if;
  if not private.manages_chapter_rides(existing.chapter_id) then
    raise exception 'Only the board or ride committee can change routes.';
  end if;
  if existing.archived_at is null then
    update public.routes set archived_at = now(), updated_by = me, updated_at = now() where id = p_id;
  end if;
end;
$$;

-- Chooses a ride's route, or clears it (p_route null), until the ride's first Melbourne day is over.
create or replace function public.set_ride_route(p_ride uuid, p_route uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  route public.routes%rowtype;
  first_day_end timestamptz;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, the same lock as set_crew, leave_crew and set_rsvp take (see set_crew).
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  first_day_end := ((date(ride.starts_at at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The route can’t change after the ride day.'; end if;
  if not private.manages_ride(p_ride) then
    raise exception 'Only the board or ride committee can choose this ride’s route.';
  end if;
  if p_route is not null then
    -- Shared, so an archive running at the same moment waits for this choice, or this sees it.
    select * into route from public.routes where id = p_route for share;
    if not found then raise exception 'That route no longer exists.'; end if;
    if route.archived_at is not null then raise exception 'That route has been archived.'; end if;
  end if;

  insert into public.ride_routes (ride_id, route_id, set_by, set_at) values (p_ride, p_route, me, now())
  on conflict (ride_id) do update
    set route_id = excluded.route_id, set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

-- One route's GPX file, for opening in a maps app. Archived routes still read.
create or replace function public.route_gpx(p_route uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  file text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select gpx into file from public.routes where id = p_route;
  if not found then raise exception 'That route no longer exists.'; end if;
  return file;
end;
$$;

revoke all on function public.save_route(uuid, text, uuid, text, text, int, int, jsonb, jsonb, jsonb),
  public.archive_route(uuid), public.set_ride_route(uuid, uuid), public.route_gpx(uuid) from public, anon;
grant execute on function public.save_route(uuid, text, uuid, text, text, int, int, jsonb, jsonb, jsonb),
  public.archive_route(uuid), public.set_ride_route(uuid, uuid), public.route_gpx(uuid) to authenticated;

-- ride_calendar as before, plus the routes of the rides it shows.
create or replace function public.ride_calendar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
begin
  if not private.is_approved_member() then
    return jsonb_build_object('rides', '[]'::jsonb, 'rsvps', '[]'::jsonb, 'synced_at', null);
  end if;
  return (
    with shown as (
      select * from public.rides
      where starts_at >= today_start or ends_at > today_start
    )
    select jsonb_build_object(
      'rides', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at, s.id) from shown s), '[]'::jsonb),
      'rsvps', coalesce((select jsonb_agg(to_jsonb(a) order by a.ride_id, a.member_id)
                         from public.rsvps a where a.ride_id in (select id from shown)), '[]'::jsonb),
      'crew', coalesce((select jsonb_agg(to_jsonb(k) order by k.ride_id, k.role, k.assigned_at)
                        from public.ride_crew k where k.ride_id in (select id from shown)), '[]'::jsonb),
      'ride_routes', coalesce((select jsonb_agg(jsonb_build_object('ride_id', rr.ride_id, 'route_id', rr.route_id)
                                                order by rr.ride_id)
                               from public.ride_routes rr
                               where rr.ride_id in (select id from shown) and rr.route_id is not null), '[]'::jsonb),
      'synced_at', (select case when bool_and(last_ok_at is not null) then min(last_ok_at) end from private.ride_feeds)
    )
  );
end;
$$;
revoke all on function public.ride_calendar() from public, anon;
grant execute on function public.ride_calendar() to authenticated;
