-- Rides made in the app (website-and-app task 6). Until now every ride came from the club's Google
-- calendar (sync-rides). The people who run a ride's crew (the chapter's board or ride committee, or
-- the NEC) can now make, change and call off rides in the app. A ride's "website" switch says
-- whether the public feed lists it; notes stay with members. Same rules and words as
-- src/domain/newRide.ts, in the same order (checked by supabase/tests/app_rides_test.sql and the
-- parity cases). Spec: docs/superpowers/specs/2026-11-01-app-made-rides-design.md.

alter table public.rides
  add column if not exists website boolean not null default true,
  add column if not exists created_by uuid references public.members (id) on delete set null,
  add column if not exists updated_by uuid references public.members (id) on delete set null,
  add column if not exists updated_at timestamptz;

-- The managesRide rule (crew.ts) asked of a category: North and West need that chapter's board or
-- ride committee (or the NEC); the rest take any board seat, ride committee seat or the NEC.
create or replace function private.manages_ride_category(p_category public.ride_category)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.positions p
      left join public.chapters c on c.slug = p_category::text
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
        and (p_category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$$;
revoke all on function private.manages_ride_category(public.ride_category) from public, anon;
grant execute on function private.manages_ride_category(public.ride_category) to authenticated;

-- Makes a ride (p_id null) or changes a ride made in the app. The existing triggers do the rest: the
-- ride gets its chat, members who asked for new-ride pushes hear about it, a moved start pushes to
-- those going.
create or replace function public.save_ride(
  p_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean,
  p_category public.ride_category, p_location text, p_notes text, p_website boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.rides%rowtype;
  new_title text := private.trim_like_app(p_title);
  place text := nullif(private.trim_like_app(coalesce(p_location, '')), '');
  new_notes text := nullif(private.trim_like_app(coalesce(p_notes, '')), '');
  last_day date;
  saved uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    -- No lock yet: the checks below refuse most callers, and the update itself locks the row.
    select * into existing from public.rides where id = p_id;
    if not found then raise exception 'No such ride.'; end if;
    if existing.source <> 'app' then raise exception 'This ride comes from the club calendar; change it there.'; end if;
    -- A ride is history once its last Melbourne day has passed (a calendar's all-day end is the midnight after).
    last_day := private.club_date(case
      when existing.ends_at is null then existing.starts_at
      when existing.all_day then existing.ends_at - interval '1 millisecond'
      else existing.ends_at end);
    if last_day < private.club_date() then raise exception 'That ride is history; it can’t change now.'; end if;
  end if;
  if p_category is null then raise exception 'Pick a chapter or colour.'; end if;
  if not private.manages_chapter_rides(null) then
    raise exception 'Only the board, ride committee or NEC can make and change rides.';
  end if;
  if not private.manages_ride_category(p_category)
     or (p_id is not null and not private.manages_ride_category(existing.category)) then
    raise exception 'Only that chapter’s board or ride committee can run its rides.';
  end if;
  if new_title is null or char_length(new_title) < 3 or char_length(new_title) > 80 then
    raise exception 'Give the ride a title (3 to 80 characters).';
  end if;
  if p_starts_at is null then raise exception 'Pick a start date and time.'; end if;
  -- A new ride, or a moved start, lands today or later; a ride already under way keeps its start.
  if (p_id is null or p_starts_at is distinct from existing.starts_at) and private.club_date(p_starts_at) < private.club_date() then
    raise exception 'A ride starts today or later.';
  end if;
  if p_ends_at is not null then
    if (p_all_day and private.club_date(p_ends_at) < private.club_date(p_starts_at))
       or (not p_all_day and p_ends_at <= p_starts_at) then
      raise exception 'The end comes after the start.';
    end if;
  end if;
  if char_length(coalesce(place, '')) > 120 then raise exception 'Keep the meeting place to 120 characters.'; end if;
  if char_length(coalesce(new_notes, '')) > 1000 then raise exception 'Keep the notes to 1,000 characters.'; end if;

  if p_id is null then
    insert into public.rides (source, starts_at, ends_at, all_day, title, location, notes, category, website,
                              created_by, updated_by, updated_at, synced_at)
    values ('app', p_starts_at, p_ends_at, coalesce(p_all_day, false), new_title, place, new_notes, p_category, coalesce(p_website, true),
            me, me, now(), now())
    returning id into saved;
    return saved;
  end if;
  update public.rides
  set starts_at = p_starts_at, ends_at = p_ends_at, all_day = coalesce(p_all_day, false), title = new_title,
      location = place, notes = new_notes, category = p_category, website = coalesce(p_website, true),
      updated_by = me, updated_at = now(), synced_at = now()
  where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.save_ride(uuid, text, timestamptz, timestamptz, boolean, public.ride_category, text, text, boolean) from public, anon;
grant execute on function public.save_ride(uuid, text, timestamptz, timestamptz, boolean, public.ride_category, text, text, boolean) to authenticated;

-- Calls off a ride made in the app (p_off true) or puts it back on (false), before it starts. The
-- cancellation push fires through rides_push_changed as it does for calendar cancellations.
create or replace function public.set_ride_called_off(p_id uuid, p_off boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.rides%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into existing from public.rides where id = p_id for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if existing.source <> 'app' then raise exception 'This ride comes from the club calendar; change it there.'; end if;
  if existing.starts_at <= now() then raise exception 'That ride is history; it can’t change now.'; end if;
  if not private.manages_chapter_rides(null) then
    raise exception 'Only the board, ride committee or NEC can make and change rides.';
  end if;
  if not private.manages_ride_category(existing.category) then
    raise exception 'Only that chapter’s board or ride committee can run its rides.';
  end if;
  if p_off is null then raise exception 'That ride isn’t called off.'; end if;
  if p_off and existing.cancelled_at is not null then raise exception 'That ride is already called off.'; end if;
  if not p_off and existing.cancelled_at is null then raise exception 'That ride isn’t called off.'; end if;
  update public.rides
  set cancelled_at = case when p_off then now() else null end, updated_by = me, updated_at = now(), synced_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.set_ride_called_off(uuid, boolean) from public, anon;
grant execute on function public.set_ride_called_off(uuid, boolean) to authenticated;

-- The website's list: calendar rides as before, plus app rides whose website switch is on, without
-- their notes (those stay with members).
create or replace function public.public_rides()
returns table (id uuid, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
               category public.ride_category, location text, notes text, cancelled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.starts_at, r.ends_at, r.all_day, r.category, r.location,
         case when r.source = 'app' then null else r.notes end as notes,
         r.cancelled_at
  from public.rides r
  where (r.source = 'feed' or r.website)
    and r.starts_at >= now() - interval '1 year'
    and r.starts_at <  now() + interval '2 years'
  order by r.starts_at, r.id;
$$;
revoke all on function public.public_rides() from public;
grant execute on function public.public_rides() to anon, authenticated;
