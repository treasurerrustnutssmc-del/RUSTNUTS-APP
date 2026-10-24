-- Ride calendar and RSVPs. See docs/superpowers/specs/2026-10-24-ride-calendar-design.md.
-- Rides come from the club website's calendar feeds (the sync-rides Edge Function), so nobody
-- writes them through the API. Members answer through set_rsvp; the demo applies the same rules
-- with the same words (src/domain/rides.ts).

create type public.ride_category as enum ('north', 'west', 'club', 'supported', 'non_nuts');
create type public.rsvp_answer as enum ('going', 'maybe', 'no');

-- The calendar feeds to read. Only an admin sets these up; the addresses stay out of the app.
create table private.ride_feeds (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  category public.ride_category, -- null: each ride's colour comes from its title or category
  last_ok_at timestamptz,
  last_error text
);
revoke all on private.ride_feeds from public, anon, authenticated;
alter table private.ride_feeds enable row level security;

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'feed' check (source in ('feed', 'app')),
  feed_id uuid references private.ride_feeds (id) on delete set null,
  external_uid text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  title text not null,
  location text,
  notes text,
  category public.ride_category not null,
  cancelled_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (feed_id, external_uid, starts_at)
);
create index rides_starts_at on public.rides (starts_at);

create table public.rsvps (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  answer public.rsvp_answer not null,
  updated_at timestamptz not null default now(),
  primary key (ride_id, member_id)
);

alter table public.rides enable row level security;
alter table public.rsvps enable row level security;
revoke all on public.rides, public.rsvps from public, anon, authenticated;
grant select on public.rides, public.rsvps to authenticated;
create policy rides_for_members on public.rides for select to authenticated using (private.is_approved_member());
create policy rsvps_for_members on public.rsvps for select to authenticated using (private.is_approved_member());

create or replace function public.set_rsvp(p_ride uuid, p_answer public.rsvp_answer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if ride.starts_at <= now() then raise exception 'That ride has already started.'; end if;

  insert into public.rsvps (ride_id, member_id, answer) values (p_ride, me, p_answer)
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
end;
$$;
revoke all on function public.set_rsvp(uuid, public.rsvp_answer) from public, anon;
grant execute on function public.set_rsvp(uuid, public.rsvp_answer) to authenticated;

-- One feed's rides, as the sync read them: [{uid, startsAt, endsAt, allDay, title, location,
-- notes, category}]. Upserts them, then cancels this feed's rides from today on that weren't in
-- the list (never deletes, so answers are kept). Rides before today are left as they were.
create or replace function public.apply_ride_sync(p_feed uuid, p_events jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
  n int;
begin
  create temporary table incoming on commit drop as
  select e.uid, e."startsAt" as starts_at, e."endsAt" as ends_at, coalesce(e."allDay", false) as all_day,
         coalesce(nullif(trim(e.title), ''), 'Ride') as title, nullif(trim(e.location), '') as location,
         nullif(trim(e.notes), '') as notes, e.category
  from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as e(
    uid text, "startsAt" timestamptz, "endsAt" timestamptz, "allDay" boolean, title text, location text,
    notes text, category public.ride_category)
  where e.uid is not null and e."startsAt" is not null and e.category is not null;

  insert into public.rides (source, feed_id, external_uid, starts_at, ends_at, all_day, title, location, notes, category,
                            cancelled_at, synced_at)
  select 'feed', p_feed, uid, starts_at, ends_at, all_day, title, location, notes, category, null, now()
  from incoming
  on conflict (feed_id, external_uid, starts_at) do update set
    ends_at = excluded.ends_at, all_day = excluded.all_day, title = excluded.title, location = excluded.location,
    notes = excluded.notes, category = excluded.category, cancelled_at = null, synced_at = now();
  get diagnostics n = row_count;

  update public.rides r set cancelled_at = now(), synced_at = now()
  where r.feed_id = p_feed and r.cancelled_at is null and r.starts_at >= today_start
    and not exists (select 1 from incoming i where i.uid = r.external_uid and i.starts_at = r.starts_at);

  update private.ride_feeds set last_ok_at = now(), last_error = null where id = p_feed;
  drop table incoming;
  return n;
end;
$$;

create or replace function public.record_ride_sync_error(p_feed uuid, p_error text)
returns void language sql security definer set search_path = '' as $$
  update private.ride_feeds set last_error = left(p_error, 500) where id = p_feed;
$$;

revoke all on function public.apply_ride_sync(uuid, jsonb), public.record_ride_sync_error(uuid, text)
  from public, anon, authenticated;
grant execute on function public.apply_ride_sync(uuid, jsonb), public.record_ride_sync_error(uuid, text) to service_role;
