-- Taking a calendar ride over in the app (Jeff, 21 Nov 2026: Bedroll couldn't change the Big 4 ride,
-- which comes in from the ride committee's Google calendar). A ride manager can turn a calendar ride
-- into a ride made in the app; from then on the calendar sync leaves it alone (no overwrite, no
-- cancel when the calendar drops it, and no second copy, since the row keeps its calendar key), and
-- it changes and calls off like any app ride. Same words and order as takeOverProblem in
-- src/domain/newRide.ts. Checked by supabase/tests/app_rides_test.sql.

-- The sync, as before, but only for rides still owned by the calendar.
create or replace function public.apply_ride_sync(p_feed uuid, p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
  incoming jsonb;
  n int;
begin
  -- The rides as listed, one per (uid, start), the later listing winning.
  select coalesce(jsonb_agg(ev), '[]'::jsonb) into incoming
  from (
    select distinct on (e.uid, e."startsAt") x.ev
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as x(ev, pos)
    cross join lateral jsonb_to_record(x.ev) as e(uid text, "startsAt" timestamptz, category public.ride_category)
    where e.uid is not null and e."startsAt" is not null and e.category is not null
    order by e.uid, e."startsAt", x.pos desc
  ) listed;

  insert into public.rides as r (source, feed_id, external_uid, starts_at, ends_at, all_day, title, location, notes, category,
                            cancelled_at, synced_at)
  select 'feed', p_feed, e.uid, e."startsAt", e."endsAt", coalesce(e."allDay", false),
         coalesce(nullif(trim(e.title), ''), 'Ride'), nullif(trim(e.location), ''), nullif(trim(e.notes), ''),
         e.category, null, now()
  from jsonb_to_recordset(incoming) as e(
    uid text, "startsAt" timestamptz, "endsAt" timestamptz, "allDay" boolean, title text, location text,
    notes text, category public.ride_category)
  on conflict (feed_id, external_uid, starts_at) do update set
    ends_at = excluded.ends_at, all_day = excluded.all_day, title = excluded.title, location = excluded.location,
    notes = excluded.notes, category = excluded.category, cancelled_at = null, synced_at = now()
  where r.source = 'feed' and (r.ends_at, r.all_day, r.title, r.location, r.notes, r.category, r.cancelled_at)
    is distinct from (excluded.ends_at, excluded.all_day, excluded.title, excluded.location, excluded.notes,
                      excluded.category, null::timestamptz);
  get diagnostics n = row_count;

  update public.rides r set cancelled_at = now(), synced_at = now()
  where r.feed_id = p_feed and r.source = 'feed' and r.cancelled_at is null and r.starts_at >= today_start
    and not exists (
      select 1 from jsonb_to_recordset(incoming) as i(uid text, "startsAt" timestamptz)
      where i.uid = r.external_uid and i."startsAt" = r.starts_at);

  update private.ride_feeds set last_ok_at = now(), last_error = null where id = p_feed;
  return n;
end;
$$;

create or replace function public.take_over_ride(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  existing public.rides%rowtype;
  last_day date;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into existing from public.rides where id = p_id for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if not private.manages_chapter_rides(null) then
    raise exception 'Only the board, ride committee or NEC can make and change rides.';
  end if;
  if not private.manages_ride_category(existing.category) then
    raise exception 'Only that chapter’s board or ride committee can run its rides.';
  end if;
  if existing.source = 'app' then raise exception 'That ride is already made in the app.'; end if;
  last_day := private.club_date(case
    when existing.ends_at is null then existing.starts_at
    when existing.all_day then existing.ends_at - interval '1 millisecond'
    else existing.ends_at end);
  if last_day < private.club_date() then raise exception 'That ride is history; it can’t change now.'; end if;
  update public.rides
  set source = 'app', website = true, updated_by = me, updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.take_over_ride(uuid) from public, anon;
grant execute on function public.take_over_ride(uuid) to authenticated;
