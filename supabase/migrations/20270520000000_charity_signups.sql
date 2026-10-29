-- Charity ride sign-ups: a ride raising money for a cause takes sign-ups from any approved member,
-- to ride (with a pillion and guests) or to help with one of its jobs on the day. No payments yet:
-- donations come with payments in the app. Everything is written only through the actions below,
-- which apply the same rules with the same words as the app (src/domain/charity.ts), checked in
-- the same order. Approved members read it all. Actions on a ride take the ride row lock first,
-- the same lock set_crew, set_rsvp and the hub's actions take, so changes to one ride queue.

create table public.charity_rides (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  cause text not null check (char_length(cause) between 1 and 120),
  about text check (char_length(about) <= 1000),
  closes_on date,
  places int check (places between 1 and 2000),
  jobs text[] not null default '{}' check (cardinality(jobs) <= 8),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- A withdrawn sign-up keeps its row, with withdrawn_at set; signing up again clears it.
create table public.charity_signups (
  ride_id uuid not null references public.charity_rides (ride_id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  riding boolean not null default true,
  pillion boolean not null default false,
  guests int not null default 0 check (guests between 0 and 10),
  guest_names text check (char_length(guest_names) <= 200),
  job text check (char_length(job) <= 40),
  notes text check (char_length(notes) <= 200),
  signed_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (ride_id, member_id),
  check (riding or job is not null),
  check (riding or not pillion)
);

-- Whether you run this ride's sign-ups: its crew managers, or anyone on the Charity Committee.
-- The app's runsCharity.
create or replace function private.runs_charity(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_ride(p_ride) or (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'charity_committee'
  ));
$$;
revoke all on function private.runs_charity(uuid) from public, anon, authenticated;

-- Makes a ride a charity ride, or changes its sign-ups (its crew managers and the Charity
-- Committee). Texts are trimmed; blank is none. Blank jobs drop out.
create or replace function public.save_charity(p_ride uuid, p_cause text, p_about text, p_closes_on date, p_places int,
  p_jobs text[])
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
  -- A job stays while someone's signed up for it (the first such job, in the old list's order).
  select j.job into dropped
  from public.charity_rides c, unnest(c.jobs) with ordinality as j(job, n)
  where c.ride_id = p_ride and j.job <> all (clean_jobs)
    and exists (select 1 from public.charity_signups s where s.ride_id = p_ride and s.withdrawn_at is null and s.job = j.job)
  order by j.n limit 1;
  if dropped is not null then raise exception 'Someone’s helping with “%”, so keep that job.', dropped; end if;
  -- A closing day already set can stay; a new one runs from today to the ride day.
  if p_closes_on is not null
     and p_closes_on is distinct from (select c.closes_on from public.charity_rides c where c.ride_id = p_ride)
     and (p_closes_on < private.club_date()
          or p_closes_on > (ride.starts_at at time zone 'Australia/Melbourne')::date) then
    raise exception 'Pick a closing day from today up to the ride day.';
  end if;
  insert into public.charity_rides (ride_id, cause, about, closes_on, places, jobs, updated_by, updated_at)
  values (p_ride, clean_cause, clean_about, p_closes_on, p_places, clean_jobs, me, now())
  on conflict (ride_id) do update
    set cause = excluded.cause, about = excluded.about, closes_on = excluded.closes_on, places = excluded.places,
        jobs = excluded.jobs, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- Signs you up for a charity ride, or changes your sign-up (or brings back a withdrawn one).
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
  -- Places count everyone on bikes; a helper bringing nobody always fits.
  on_bikes := riding::int + pillion::int + guests;
  if charity.places is not null and on_bikes > 0 then
    select coalesce(sum(s.riding::int + s.pillion::int + s.guests), 0) into taken from public.charity_signups s
    where s.ride_id = p_ride and s.withdrawn_at is null and s.member_id <> me;
    if taken + on_bikes > charity.places then raise exception 'The ride’s full.'; end if;
  end if;
  insert into public.charity_signups (ride_id, member_id, riding, pillion, guests, guest_names, job, notes, signed_at, withdrawn_at)
  values (p_ride, me, riding, pillion, guests, clean_names, clean_job, clean_notes, now(), null)
  on conflict (ride_id, member_id) do update
    set riding = excluded.riding, pillion = excluded.pillion, guests = excluded.guests, guest_names = excluded.guest_names,
        job = excluded.job, notes = excluded.notes, signed_at = excluded.signed_at, withdrawn_at = null;
end;
$$;

-- Withdraws your sign-up, until the ride starts (the closing day doesn't stop it).
create or replace function public.withdraw_charity(p_ride uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if not exists (select 1 from public.charity_signups where ride_id = p_ride and member_id = me and withdrawn_at is null) then
    raise exception 'You’re not signed up.';
  end if;
  if now() >= private.ride_answers_close(ride) then raise exception 'Sign-ups have closed.'; end if;
  update public.charity_signups set withdrawn_at = now() where ride_id = p_ride and member_id = me;
end;
$$;

alter table public.charity_rides enable row level security;
alter table public.charity_signups enable row level security;
revoke all on public.charity_rides, public.charity_signups from public, anon, authenticated;
grant select on public.charity_rides, public.charity_signups to authenticated;
create policy charity_rides_for_members on public.charity_rides for select to authenticated using (private.is_approved_member());
create policy charity_signups_for_members on public.charity_signups for select to authenticated using (private.is_approved_member());

revoke all on function public.save_charity(uuid, text, text, date, int, text[]),
  public.sign_up_charity(uuid, boolean, boolean, int, text, text, text),
  public.withdraw_charity(uuid) from public, anon;
grant execute on function public.save_charity(uuid, text, text, date, int, text[]),
  public.sign_up_charity(uuid, boolean, boolean, int, text, text, text),
  public.withdraw_charity(uuid) to authenticated;
