-- Charity ride sign-ups from the club website. An organiser ticks "Take sign-ups from the website"
-- on a charity ride; the website then lists it (public_charity_rides) and people who aren't in the
-- app sign up through the site-api Edge Function, which calls website_signup() with the service
-- role after the same checks. Website sign-ups share the ride's places with members' sign-ups and
-- are read only by the people who run that ride; the numbers are everyone's (signup_counts).
-- The same rules and words as src/domain/websiteSignups.ts and src/domain/charity.ts.
-- Spec: docs/superpowers/specs/2026-11-01-website-charity-signups-design.md

alter table public.charity_rides add column website boolean not null default false;

create table public.website_signups (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.charity_rides (ride_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 30),
  riding boolean not null default true,
  pillion boolean not null default false,
  guests int not null default 0 check (guests between 0 and 10),
  guest_names text check (char_length(guest_names) <= 200),
  job text check (char_length(job) <= 40),
  notes text check (char_length(notes) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ride_id, email),
  check (riding or job is not null),
  check (riding or not pillion)
);
create index website_signups_email_created_idx on public.website_signups (email, created_at);
create index website_signups_created_idx on public.website_signups (created_at);

alter table public.website_signups enable row level security;
revoke all on public.website_signups from public, anon, authenticated;
grant select on public.website_signups to authenticated;
-- Only the people who run the ride's sign-ups see who signed up from the website.
create policy website_signups_for_organisers on public.website_signups for select to authenticated
  using (private.runs_charity(ride_id));

-- People on bikes signed up from the website for a ride (all of them, or all but one email).
create or replace function private.website_on_bikes(p_ride uuid, p_except_email text default null)
returns int language sql stable set search_path = '' as $$
  select coalesce(sum(w.riding::int + w.pillion::int + w.guests), 0)::int
  from public.website_signups w
  where w.ride_id = p_ride and (p_except_email is null or w.email <> p_except_email);
$$;
revoke all on function private.website_on_bikes(uuid, text) from public, anon, authenticated;

-- save_charity gains the website tick. The old shape goes; the app, demo and tests move with it.
drop function public.save_charity(uuid, text, text, date, int, text[]);
create or replace function public.save_charity(p_ride uuid, p_cause text, p_about text, p_closes_on date, p_places int,
  p_jobs text[], p_website boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  clean_cause text;
  clean_about text;
  clean_jobs text[];
  dropped text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'Sign-ups can’t change after the ride day.'; end if;
  if not private.runs_charity(p_ride) then
    raise exception 'Only the board, ride committee, charity committee or NEC can run sign-ups.';
  end if;
  clean_cause := nullif(private.trim_like_app(p_cause), '');
  clean_about := nullif(private.trim_like_app(p_about), '');
  if clean_cause is null then raise exception 'Say who the ride is raising money for.'; end if;
  if char_length(clean_cause) > 120 or char_length(clean_about) > 1000 then
    raise exception 'That’s too long: 120 characters for the cause, 1000 for the rest.';
  end if;
  if p_places is not null and (p_places < 1 or p_places > 2000) then
    raise exception 'Places: 1 to 2000, or leave it blank.';
  end if;
  clean_jobs := array(
    select t from unnest(coalesce(p_jobs, '{}')) with ordinality as j(job, n), private.trim_like_app(j.job) as t
    where t <> '' order by j.n
  );
  if cardinality(clean_jobs) > 8 or exists (select 1 from unnest(clean_jobs) as j(job) where char_length(j.job) > 40) then
    raise exception 'Up to 8 helper jobs, 40 characters each.';
  end if;
  if (select count(distinct lower(j.job)) from unnest(clean_jobs) as j(job)) <> cardinality(clean_jobs) then
    raise exception 'Each job once.';
  end if;
  -- A job stays while someone's signed up for it, from the app or the website.
  select j.job into dropped
  from public.charity_rides c, unnest(c.jobs) with ordinality as j(job, n)
  where c.ride_id = p_ride and j.job <> all (clean_jobs)
    and (exists (select 1 from public.charity_signups s where s.ride_id = p_ride and s.withdrawn_at is null and s.job = j.job)
         or exists (select 1 from public.website_signups w where w.ride_id = p_ride and w.job = j.job))
  order by j.n limit 1;
  if dropped is not null then raise exception 'Someone’s helping with “%”, so keep that job.', dropped; end if;
  if p_closes_on is not null
     and p_closes_on is distinct from (select c.closes_on from public.charity_rides c where c.ride_id = p_ride)
     and (p_closes_on < private.club_date()
          or p_closes_on > (ride.starts_at at time zone 'Australia/Melbourne')::date) then
    raise exception 'Pick a closing day from today up to the ride day.';
  end if;
  insert into public.charity_rides (ride_id, cause, about, closes_on, places, jobs, website, updated_by, updated_at)
  values (p_ride, clean_cause, clean_about, p_closes_on, p_places, clean_jobs, coalesce(p_website, false), me, now())
  on conflict (ride_id) do update
    set cause = excluded.cause, about = excluded.about, closes_on = excluded.closes_on, places = excluded.places,
        jobs = excluded.jobs, website = excluded.website, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.save_charity(uuid, text, text, date, int, text[], boolean) from public, anon;
grant execute on function public.save_charity(uuid, text, text, date, int, text[], boolean) to authenticated;

-- Members' sign-ups now count the website's people towards the places too.
create or replace function public.sign_up_charity(p_ride uuid, p_riding boolean, p_pillion boolean, p_guests int,
  p_guest_names text, p_job text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  charity public.charity_rides%rowtype;
  riding boolean := coalesce(p_riding, false);
  pillion boolean := coalesce(p_pillion, false);
  guests int := coalesce(p_guests, 0);
  clean_job text;
  clean_names text;
  clean_notes text;
  on_bikes int;
  taken int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  select * into charity from public.charity_rides where ride_id = p_ride;
  if not found then raise exception 'This ride doesn’t take sign-ups.'; end if;
  if now() >= private.ride_answers_close(ride) or (charity.closes_on is not null and private.club_date() > charity.closes_on) then
    raise exception 'Sign-ups have closed.';
  end if;
  clean_job := nullif(private.trim_like_app(p_job), '');
  if not riding and clean_job is null then raise exception 'Say you’re riding, or pick a job to help with.'; end if;
  if not riding and pillion then raise exception 'A pillion needs a rider: say you’re riding too.'; end if;
  if guests < 0 or guests > 10 then raise exception 'Guests: 0 to 10.'; end if;
  if clean_job is not null and clean_job <> all (charity.jobs) then raise exception 'That job isn’t on the list.'; end if;
  clean_names := nullif(private.trim_like_app(p_guest_names), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_names) > 200 or char_length(clean_notes) > 200 then
    raise exception 'Keep it short: 200 characters for guests’ names, 200 for notes.';
  end if;
  -- Places count everyone on bikes, from the app and the website; a helper bringing nobody always fits.
  on_bikes := riding::int + pillion::int + guests;
  if charity.places is not null and on_bikes > 0 then
    select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0) into taken from public.charity_signups s
    where s.ride_id = p_ride and s.withdrawn_at is null and s.member_id <> me;
    taken := taken + private.website_on_bikes(p_ride);
    if taken + on_bikes > charity.places then raise exception 'The ride’s full.'; end if;
  end if;
  insert into public.charity_signups (ride_id, member_id, riding, pillion, guests, guest_names, job, notes, signed_at, withdrawn_at)
  values (p_ride, me, riding, pillion, guests, clean_names, clean_job, clean_notes, now(), null)
  on conflict (ride_id, member_id) do update
    set riding = excluded.riding, pillion = excluded.pillion, guests = excluded.guests, guest_names = excluded.guest_names,
        job = excluded.job, notes = excluded.notes, signed_at = excluded.signed_at, withdrawn_at = null;
end;
$$;

-- The website's door, called by site-api with the service role after its own checks. The same
-- checks again here, in the same words, then the spam limits (one address at most five a day,
-- at most thirty an hour from everyone) and the shared places. The same email signing up again
-- for the same ride replaces its earlier answer.
create or replace function public.website_signup(p_ride uuid, p_name text, p_email text, p_phone text, p_riding boolean,
  p_pillion boolean, p_guests int, p_guest_names text, p_job text, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ride public.rides%rowtype;
  charity public.charity_rides%rowtype;
  v_name text := private.trim_like_app(p_name);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := nullif(private.trim_like_app(p_phone), '');
  riding boolean := coalesce(p_riding, false);
  pillion boolean := coalesce(p_pillion, false);
  guests int := coalesce(p_guests, 0);
  clean_job text;
  clean_names text;
  clean_notes text;
  on_bikes int;
  taken int;
  new_id uuid;
begin
  select * into ride from public.rides where id = p_ride for no key update;
  if found then select * into charity from public.charity_rides where ride_id = p_ride; end if;
  if ride.id is null or charity.ride_id is null or not charity.website or ride.cancelled_at is not null then
    raise exception 'This ride isn’t taking sign-ups from the website.';
  end if;
  if now() >= private.ride_answers_close(ride) or (charity.closes_on is not null and private.club_date() > charity.closes_on) then
    raise exception 'Sign-ups have closed.';
  end if;
  if coalesce(v_name, '') = '' then raise exception 'Tell us your name.'; end if;
  if char_length(v_name) > 80 then raise exception 'Keep your name to 80 characters.'; end if;
  if char_length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'That email address does not look right.';
  end if;
  if char_length(v_phone) > 30 then raise exception 'Keep the phone number to 30 characters.'; end if;
  clean_job := nullif(private.trim_like_app(p_job), '');
  if not riding and clean_job is null then raise exception 'Say you’re riding, or pick a job to help with.'; end if;
  if not riding and pillion then raise exception 'A pillion needs a rider: say you’re riding too.'; end if;
  if guests < 0 or guests > 10 then raise exception 'Guests: 0 to 10.'; end if;
  if clean_job is not null and clean_job <> all (charity.jobs) then raise exception 'That job isn’t on the list.'; end if;
  clean_names := nullif(private.trim_like_app(p_guest_names), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_names) > 200 or char_length(clean_notes) > 200 then
    raise exception 'Keep it short: 200 characters for guests’ names, 200 for notes.';
  end if;

  -- One at a time, so two sign-ups landing together can't both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtext('website_signup'));
  if (select count(*) from public.website_signups w where w.email = v_email and w.created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.website_signups w where w.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many sign-ups just now. Try again later, or email the club.';
  end if;

  on_bikes := riding::int + pillion::int + guests;
  if charity.places is not null and on_bikes > 0 then
    select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0) into taken from public.charity_signups s
    where s.ride_id = p_ride and s.withdrawn_at is null;
    taken := taken + private.website_on_bikes(p_ride, v_email);
    if taken + on_bikes > charity.places then raise exception 'The ride’s full.'; end if;
  end if;

  insert into public.website_signups (ride_id, name, email, phone, riding, pillion, guests, guest_names, job, notes)
  values (p_ride, v_name, v_email, v_phone, riding, pillion, guests, clean_names, clean_job, clean_notes)
  on conflict (ride_id, email) do update
    set name = excluded.name, phone = excluded.phone, riding = excluded.riding, pillion = excluded.pillion,
        guests = excluded.guests, guest_names = excluded.guest_names, job = excluded.job, notes = excluded.notes,
        updated_at = now()
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.website_signup(uuid, text, text, text, boolean, boolean, int, text, text, text) from public, anon, authenticated;
grant execute on function public.website_signup(uuid, text, text, text, boolean, boolean, int, text, text, text) to service_role;

-- An organiser removes a website sign-up (a mistake, a duplicate, a robot). Outsiders get
-- "No such sign-up.", as the board's enquiries do.
create or replace function public.remove_website_signup(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  w public.website_signups%rowtype;
  ride public.rides%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into w from public.website_signups where id = p_id;
  if not found or not private.runs_charity(w.ride_id) then raise exception 'No such sign-up.'; end if;
  select * into ride from public.rides where id = w.ride_id for no key update;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'Sign-ups can’t change after the ride day.'; end if;
  delete from public.website_signups where id = p_id;
end;
$$;
revoke all on function public.remove_website_signup(uuid) from public, anon;
grant execute on function public.remove_website_signup(uuid) to authenticated;

-- The website's list: charity rides whose organiser ticked the box, not cancelled, from a day ago
-- to a year ahead. No member data; places_left counts members and website people alike.
create or replace function public.public_charity_rides()
returns table (ride_id uuid, title text, starts_at timestamptz, all_day boolean, location text, cause text, about text,
               closes_on date, jobs text[], places int, places_left int, open boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.starts_at, r.all_day, r.location, c.cause, c.about, c.closes_on, c.jobs, c.places,
    case when c.places is null then null else greatest(0, c.places
      - (select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0)::int from public.charity_signups s
         where s.ride_id = r.id and s.withdrawn_at is null)
      - private.website_on_bikes(r.id)) end,
    now() < private.ride_answers_close(r) and (c.closes_on is null or private.club_date() <= c.closes_on)
  from public.charity_rides c
  join public.rides r on r.id = c.ride_id
  where c.website and r.cancelled_at is null
    and r.starts_at >= now() - interval '1 day'
    and r.starts_at <  now() + interval '1 year'
  order by r.starts_at, r.id;
$$;
revoke all on function public.public_charity_rides() from public;
grant execute on function public.public_charity_rides() to anon, authenticated;

-- The numbers for everyone approved now carry the website's people as well (its row type changes,
-- so it is dropped and made again).
drop function public.signup_counts();
create function public.signup_counts()
returns table (
  ride_id uuid, hub_riders int, hub_pillions int, hub_group int, hub_own int, hub_camping int, hub_day int, hub_group_beds int,
  charity_riding int, charity_pillions int, charity_guests int, charity_helping int, charity_people int,
  website_riding int, website_pillions int, website_guests int, website_helping int, website_people int
)
language sql stable security definer set search_path = '' as $$
  with hubs as (
    select h.ride_id,
      count(*)::int as riders,
      count(*) filter (where h.pillion)::int as pillions,
      count(*) filter (where h.staying = 'group')::int as grp,
      count(*) filter (where h.staying = 'own')::int as own,
      count(*) filter (where h.staying = 'camping')::int as camping,
      count(*) filter (where h.staying = 'day')::int as day,
      coalesce(sum(case when h.staying = 'group' then 1 + (case when h.pillion then 1 else 0 end) else 0 end), 0)::int as group_beds
    from public.hub_registrations h where h.withdrawn_at is null group by h.ride_id
  ), charity as (
    select c.ride_id,
      count(*) filter (where c.riding)::int as riding,
      count(*) filter (where c.pillion)::int as pillions,
      coalesce(sum(c.guests), 0)::int as guests,
      count(*) filter (where c.job is not null)::int as helping,
      coalesce(sum((case when c.riding then 1 else 0 end) + (case when c.pillion then 1 else 0 end) + c.guests), 0)::int as people
    from public.charity_signups c where c.withdrawn_at is null group by c.ride_id
  ), site as (
    select w.ride_id,
      count(*) filter (where w.riding)::int as riding,
      count(*) filter (where w.pillion)::int as pillions,
      coalesce(sum(w.guests), 0)::int as guests,
      count(*) filter (where w.job is not null)::int as helping,
      coalesce(sum((case when w.riding then 1 else 0 end) + (case when w.pillion then 1 else 0 end) + w.guests), 0)::int as people
    from public.website_signups w group by w.ride_id
  )
  select coalesce(h.ride_id, c.ride_id, s.ride_id),
    coalesce(h.riders, 0), coalesce(h.pillions, 0), coalesce(h.grp, 0), coalesce(h.own, 0), coalesce(h.camping, 0), coalesce(h.day, 0),
    coalesce(h.group_beds, 0),
    coalesce(c.riding, 0), coalesce(c.pillions, 0), coalesce(c.guests, 0), coalesce(c.helping, 0), coalesce(c.people, 0),
    coalesce(s.riding, 0), coalesce(s.pillions, 0), coalesce(s.guests, 0), coalesce(s.helping, 0), coalesce(s.people, 0)
  from hubs h
  full join charity c on c.ride_id = h.ride_id
  full join site s on s.ride_id = coalesce(h.ride_id, c.ride_id)
  where private.is_approved_member();
$$;
revoke all on function public.signup_counts() from public, anon;
grant execute on function public.signup_counts() to authenticated;
