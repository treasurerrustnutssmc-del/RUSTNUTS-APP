-- Ride planning extras: each bike's range (for fuel stops planned around the smallest tank), a
-- ride's plan of stops, route ratings, calling a ride off or postponing it, event hubs with
-- registrations and accommodation, and crew swaps the other person accepts. Everything is written
-- only through the actions below, which apply the same rules with the same words as the app
-- (src/domain/fuel.ts, ridePlan.ts, ratings.ts, rideCalls.ts, hubs.ts, swaps.ts), checked in the
-- same order. Approved members read it all. ride_calendar() and set_rsvp are untouched: the app
-- reads these tables with their own queries. Actions on a ride take the ride row lock first, the
-- same lock set_crew, leave_crew and set_rsvp take, so changes to one ride queue.

-- ---------------------------------------------------------------------------------------------
-- Bike range: km on a full tank before the fuel light comes on.
-- ---------------------------------------------------------------------------------------------
alter table public.bikes add column range_km int check (range_km between 30 and 1000);

-- Sets (or with null clears) the range of one of your own bikes.
create or replace function public.set_bike_range(p_bike uuid, p_range int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.bikes where id = p_bike and member_id = me) then
    raise exception 'That’s not your bike.';
  end if;
  if p_range is not null and (p_range < 30 or p_range > 1000) then
    raise exception 'Range is in km, from 30 to 1000.';
  end if;
  update public.bikes set range_km = p_range where id = p_bike;
end;
$$;

-- Whether you write this ride's plan and can call it: its crew managers (private.manages_ride),
-- plus whoever holds its Road Captain spot. The app's writesBriefing.
create or replace function private.writes_ride(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_ride(p_ride) or exists (
    select 1 from public.ride_crew where ride_id = p_ride and member_id = auth.uid() and role = 'road_captain'
  );
$$;
revoke all on function private.writes_ride(uuid) from public, anon, authenticated;

-- The first Melbourne midnight after a ride's Melbourne start date.
create or replace function private.ride_day_end(p_starts timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select ((date(p_starts at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
$$;
revoke all on function private.ride_day_end(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Ride plans: the RC's stops, on top of the route.
-- ---------------------------------------------------------------------------------------------
-- stops is [{kind, name, km, time}], kind one of fuel, coffee, lunch, regroup, other; km a number
-- or null; time 'HH:MM' or null. Apart from the rides table so the calendar sync never touches it.
create table public.ride_plans (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  stops jsonb not null default '[]' check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) <= 15),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Writes or replaces a ride's plan, until the ride day ends. p_seen is the version the editor
-- opened on (null when there was none): a save on top of someone else's newer plan is refused.
-- Names are trimmed like the app trims; stops are kept in km order, those without a km after.
create or replace function public.save_ride_plan(p_ride uuid, p_stops jsonb, p_seen timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  stored timestamptz;
  s jsonb;
  clean jsonb := '[]';
  name text;
  km numeric;
  at_time text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The plan can’t change after the ride day.'; end if;
  if not private.writes_ride(p_ride) then
    raise exception 'Only the board, ride committee or this ride’s Road Captain can plan the ride.';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' then p_stops := '[]'; end if;
  if jsonb_array_length(p_stops) > 15 then raise exception 'That’s too many stops (15 at most).'; end if;

  for s in select value from jsonb_array_elements(p_stops) loop
    name := private.trim_like_app(case when jsonb_typeof(s->'name') = 'string' then s->>'name' end);
    if jsonb_typeof(s) <> 'object' or coalesce(s->>'kind', '') not in ('fuel', 'coffee', 'lunch', 'regroup', 'other')
       or name is null or name = '' or char_length(name) > 60 then
      raise exception 'Give each stop a short name (60 characters at most).';
    end if;
    km := null;
    if s->'km' is not null and jsonb_typeof(s->'km') <> 'null' then
      if jsonb_typeof(s->'km') <> 'number' then raise exception 'Check the km: 0 to 2000.'; end if;
      km := (s->>'km')::numeric;
      if km < 0 or km > 2000 then raise exception 'Check the km: 0 to 2000.'; end if;
    end if;
    at_time := null;
    if s->'time' is not null and jsonb_typeof(s->'time') <> 'null' then
      at_time := s->>'time';
      if jsonb_typeof(s->'time') <> 'string' or at_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Write times as 24-hour HH:MM, like 10:30.';
      end if;
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('kind', s->>'kind', 'name', name, 'km', km, 'time', at_time));
  end loop;

  select updated_at into stored from public.ride_plans where ride_id = p_ride;
  if found and (p_seen is null or stored > p_seen + interval '1 millisecond') then
    raise exception 'Someone else saved this plan while you were editing. Your changes aren’t saved: copy them, then open the plan again.';
  end if;

  -- km order, stops without a km keeping their place after those with one.
  select coalesce(jsonb_agg(e.value order by (e.value->>'km')::numeric nulls last, e.n), '[]') into clean
  from jsonb_array_elements(clean) with ordinality as e(value, n);

  insert into public.ride_plans (ride_id, stops, updated_by, updated_at) values (p_ride, clean, me, now())
  on conflict (ride_id) do update set stops = excluded.stops, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Route ratings: one per member per route.
-- ---------------------------------------------------------------------------------------------
create table public.route_ratings (
  route_id uuid not null references public.routes (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 280),
  rated_at timestamptz not null default now(),
  primary key (route_id, member_id)
);

-- Rates a route, or changes your rating. A blank comment is stored as none.
create or replace function public.rate_route(p_route uuid, p_stars int, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.routes%rowtype;
  clean_comment text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.routes where id = p_route;
  if not found then raise exception 'That route no longer exists.'; end if;
  if r.archived_at is not null then raise exception 'That route is archived.'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Pick 1 to 5 stars.'; end if;
  clean_comment := nullif(private.trim_like_app(p_comment), '');
  if char_length(clean_comment) > 280 then raise exception 'Keep the comment to 280 characters at most.'; end if;
  insert into public.route_ratings (route_id, member_id, stars, comment, rated_at)
  values (p_route, me, p_stars, clean_comment, now())
  on conflict (route_id, member_id) do update
    set stars = excluded.stars, comment = excluded.comment, rated_at = excluded.rated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Calling a ride: Off, Postponed (with an optional new day) or Back on.
-- ---------------------------------------------------------------------------------------------
create type public.ride_call_state as enum ('off', 'postponed', 'on');

create table public.ride_calls (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  state public.ride_call_state not null,
  reason text check (char_length(reason) <= 200),
  new_day date,
  called_by uuid references public.members (id) on delete set null,
  called_at timestamptz not null default now(),
  check (new_day is null or state = 'postponed')
);

-- Calls a ride, until its ride day ends, and posts the call in the ride's chat as the caller.
-- Back on clears the reason and new day. Reasons are trimmed; a blank one is stored as none.
create or replace function public.call_ride(p_ride uuid, p_state public.ride_call_state, p_reason text, p_new_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  ride_day date;
  clean_reason text;
  line text;
  chat uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'It’s too late to call this ride.'; end if;
  if not private.writes_ride(p_ride) then
    raise exception 'Only the board, ride committee or this ride’s Road Captain can call the ride.';
  end if;
  if p_state is null then p_state := 'off'; end if;
  clean_reason := case when p_state = 'on' then null else nullif(private.trim_like_app(p_reason), '') end;
  if char_length(clean_reason) > 200 then raise exception 'Keep the reason to 200 characters at most.'; end if;
  if p_new_day is not null and p_state <> 'postponed' then raise exception 'Only a postponed ride takes a new day.'; end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  if p_new_day is not null and (p_new_day <= ride_day or p_new_day > (ride_day + interval '1 year')::date) then
    raise exception 'Pick a new day after the ride, within 12 months.';
  end if;

  insert into public.ride_calls (ride_id, state, reason, new_day, called_by, called_at)
  values (p_ride, p_state, clean_reason, p_new_day, me, now())
  on conflict (ride_id) do update
    set state = excluded.state, reason = excluded.reason, new_day = excluded.new_day,
        called_by = excluded.called_by, called_at = excluded.called_at;

  -- The same line as the app's callLine.
  line := case p_state
    when 'off' then 'Ride’s off'
    when 'postponed' then 'Ride’s postponed' || coalesce(' to ' || to_char(p_new_day, 'DD/MM/YYYY'), '')
    else 'Ride’s back on'
  end || coalesce(': ' || clean_reason, '.');
  select id into chat from public.conversations where kind = 'ride' and ride_id = p_ride;
  if chat is not null then
    insert into public.messages (conversation_id, author_id, body) values (chat, me, line);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Event hubs (the Big 4 and the Not Dead Yet Run): registrations and accommodation, no payments.
-- ---------------------------------------------------------------------------------------------
create table public.ride_hubs (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  members_only boolean not null default true,
  closes_on date,
  beds int check (beds between 1 and 500),
  accommodation text check (char_length(accommodation) <= 1000),
  notes text check (char_length(notes) <= 1000),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

create type public.hub_staying as enum ('group', 'own', 'camping', 'day');

-- A withdrawn registration keeps its row, with withdrawn_at set; registering again clears it.
create table public.hub_registrations (
  ride_id uuid not null references public.ride_hubs (ride_id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  staying public.hub_staying not null,
  pillion boolean not null default false,
  share_with text check (char_length(share_with) <= 80),
  notes text check (char_length(notes) <= 200),
  registered_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (ride_id, member_id)
);

-- When a ride's registrations close: at its start, or for an all-day ride when its first day is over.
create or replace function private.ride_answers_close(ride public.rides)
returns timestamptz language sql stable set search_path = '' as $$
  select case when ride.all_day then private.ride_day_end(ride.starts_at) else ride.starts_at end;
$$;
revoke all on function private.ride_answers_close(public.rides) from public, anon, authenticated;

-- Opens a ride's hub, or changes it (the ride's crew managers). Texts are trimmed; blank is none.
create or replace function public.save_hub(p_ride uuid, p_members_only boolean, p_closes_on date, p_beds int,
  p_accommodation text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  clean_accommodation text;
  clean_notes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The hub can’t change after the ride day.'; end if;
  if not private.manages_ride(p_ride) then raise exception 'Only the board, ride committee or NEC can run the hub.'; end if;
  if p_beds is not null and (p_beds < 1 or p_beds > 500) then raise exception 'Group beds: 1 to 500, or leave it blank.'; end if;
  clean_accommodation := nullif(private.trim_like_app(p_accommodation), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_accommodation) > 1000 or char_length(clean_notes) > 1000 then
    raise exception 'That’s too long (1000 characters at most).';
  end if;
  insert into public.ride_hubs (ride_id, members_only, closes_on, beds, accommodation, notes, updated_by, updated_at)
  values (p_ride, coalesce(p_members_only, true), p_closes_on, p_beds, clean_accommodation, clean_notes, me, now())
  on conflict (ride_id) do update
    set members_only = excluded.members_only, closes_on = excluded.closes_on, beds = excluded.beds,
        accommodation = excluded.accommodation, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- Registers you for a ride's hub, or changes your registration (or brings back a withdrawn one).
create or replace function public.register_hub(p_ride uuid, p_staying public.hub_staying, p_pillion boolean,
  p_share_with text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  hub public.ride_hubs%rowtype;
  clean_share text;
  clean_notes text;
  taken int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  select * into hub from public.ride_hubs where ride_id = p_ride;
  if not found then raise exception 'This ride doesn’t take registrations.'; end if;
  if now() >= private.ride_answers_close(ride) or (hub.closes_on is not null and private.club_date() > hub.closes_on) then
    raise exception 'Registrations have closed.';
  end if;
  if hub.members_only and not exists (
    select 1 from public.members where id = me and status in ('fng', 'full', 'nomad')
  ) then
    raise exception 'This one’s for FNG, Full and Nomad members.';
  end if;
  clean_share := nullif(private.trim_like_app(p_share_with), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');
  if char_length(clean_share) > 80 or char_length(clean_notes) > 200 then
    raise exception 'Keep it short: 80 characters for who you’re sharing with, 200 for notes.';
  end if;
  if p_staying is null then p_staying := 'group'; end if;
  if p_staying = 'group' and hub.beds is not null then
    select coalesce(sum(1 + pillion::int), 0) into taken from public.hub_registrations
    where ride_id = p_ride and staying = 'group' and withdrawn_at is null and member_id <> me;
    if taken + 1 + coalesce(p_pillion, false)::int > hub.beds then raise exception 'The group booking is full.'; end if;
  end if;
  insert into public.hub_registrations (ride_id, member_id, staying, pillion, share_with, notes, registered_at, withdrawn_at)
  values (p_ride, me, p_staying, coalesce(p_pillion, false), clean_share, clean_notes, now(), null)
  on conflict (ride_id, member_id) do update
    set staying = excluded.staying, pillion = excluded.pillion, share_with = excluded.share_with,
        notes = excluded.notes, registered_at = excluded.registered_at, withdrawn_at = null;
end;
$$;

-- Withdraws your registration, until the ride starts (the closing day doesn't stop it).
create or replace function public.withdraw_hub(p_ride uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if not exists (select 1 from public.hub_registrations where ride_id = p_ride and member_id = me and withdrawn_at is null) then
    raise exception 'You’re not registered.';
  end if;
  if now() >= private.ride_answers_close(ride) then raise exception 'Registrations have closed.'; end if;
  update public.hub_registrations set withdrawn_at = now() where ride_id = p_ride and member_id = me;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Crew swaps: a crew member asks someone to take their spot (or trade spots), and they accept.
-- ---------------------------------------------------------------------------------------------
create type public.swap_state as enum ('asked', 'accepted', 'declined', 'withdrawn');

create table public.crew_swaps (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  asked_by uuid not null references public.members (id) on delete cascade,
  role public.crew_role not null,
  asked_to uuid not null references public.members (id) on delete cascade,
  -- The spot the person asked held when asked: a trade. Null when they weren't on the crew.
  their_role public.crew_role,
  note text check (char_length(note) <= 200),
  state public.swap_state not null default 'asked',
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);
create index crew_swaps_ride on public.crew_swaps (ride_id);
-- One open ask per asker per ride.
create unique index crew_swaps_one_open on public.crew_swaps (ride_id, asked_by) where state = 'asked';

-- Why p_member can't hold p_role on this ride, or null when they can: set_crew's checks, in its order.
create or replace function private.crew_eligibility(p_member uuid, p_role public.crew_role, ride_day date)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  m public.members%rowtype;
  first_aid date;
begin
  select * into m from public.members where id = p_member;
  if m.approval <> 'approved' or m.status not in ('full', 'nomad') then return 'Only Full and Nomad members can crew a ride.'; end if;
  if m.on_hiatus then return 'Members on hiatus can’t crew a ride.'; end if;
  if p_role in ('tail_gunner', 'assistant_tail_gunner') then
    select mp.first_aid_expiry into first_aid from public.member_private mp where mp.member_id = p_member;
    if first_aid is null or first_aid < ride_day then return 'Tail Gunners need a current first aid certificate on file.'; end if;
  end if;
  if exists (select 1 from public.road_rules_versions) and not private.road_rules_signed(p_member) then
    return 'They haven’t signed the Road Rules yet.';
  end if;
  return null;
end;
$$;
revoke all on function private.crew_eligibility(uuid, public.crew_role, date) from public, anon, authenticated;

-- Asks someone to take your spot on a ride's crew (or trade, when they hold a spot); returns the ask's id.
create or replace function public.ask_swap(p_ride uuid, p_to uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  ride_day date;
  my_role public.crew_role;
  their public.crew_role;
  problem text;
  clean_note text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The crew can’t change after the ride day.'; end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  select role into my_role from public.ride_crew where ride_id = p_ride and member_id = me;
  if not found then raise exception 'You’re not on this ride’s crew.'; end if;
  if p_to = me then raise exception 'Pick someone else.'; end if;
  if p_to is null or not exists (select 1 from public.members where id = p_to) then raise exception 'That member no longer exists.'; end if;
  problem := private.crew_eligibility(p_to, my_role, ride_day);
  if problem is not null then raise exception '%', problem; end if;
  if exists (select 1 from public.rsvps where ride_id = p_ride and member_id = p_to and answer = 'no') then
    raise exception 'They said they can’t make it.';
  end if;
  select role into their from public.ride_crew where ride_id = p_ride and member_id = p_to;
  if their = my_role then raise exception 'They already have that spot.'; end if;
  if their is not null then
    problem := private.crew_eligibility(me, their, ride_day);
    if problem is not null then raise exception '%', problem; end if;
  end if;
  if exists (select 1 from public.crew_swaps where ride_id = p_ride and asked_by = me and state = 'asked') then
    raise exception 'You’ve already asked someone. Withdraw that first.';
  end if;
  clean_note := nullif(private.trim_like_app(p_note), '');
  if char_length(clean_note) > 200 then raise exception 'Keep the note to 200 characters at most.'; end if;
  insert into public.crew_swaps (ride_id, asked_by, role, asked_to, their_role, note)
  values (p_ride, me, my_role, p_to, their, clean_note)
  returning id into new_id;
  return new_id;
end;
$$;

-- The person asked says yes (moving the spots, and making them Going) or no.
create or replace function public.answer_swap(p_swap uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.crew_swaps%rowtype;
  ride public.rides%rowtype;
  ride_day date;
  problem text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into s from public.crew_swaps where id = p_swap;
  if not found then raise exception 'No such swap.'; end if;
  if s.asked_to <> me then raise exception 'That ask isn’t for you.'; end if;
  if p_yes is not true then
    update public.crew_swaps set state = 'declined', answered_at = now() where id = s.id and state = 'asked';
    if not found then raise exception 'That ask has already been answered.'; end if;
    return;
  end if;
  -- The ride row first, then the ask again (it may have been answered or withdrawn meanwhile).
  select * into ride from public.rides where id = s.ride_id for no key update;
  select * into s from public.crew_swaps where id = p_swap for update;
  if s.state <> 'asked' then raise exception 'That ask has already been answered.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if now() >= private.ride_day_end(ride.starts_at) then raise exception 'The crew can’t change after the ride day.'; end if;
  if not exists (select 1 from public.ride_crew where ride_id = s.ride_id and member_id = s.asked_by and role = s.role)
     or (select role from public.ride_crew where ride_id = s.ride_id and member_id = me) is distinct from s.their_role then
    raise exception 'The crew has changed since. Ask again.';
  end if;
  ride_day := date(ride.starts_at at time zone 'Australia/Melbourne');
  problem := private.crew_eligibility(me, s.role, ride_day);
  if problem is null and s.their_role is not null then problem := private.crew_eligibility(s.asked_by, s.their_role, ride_day); end if;
  if problem is not null then raise exception '%', problem; end if;

  if s.their_role is null then
    update public.ride_crew set member_id = me, assigned_by = me, assigned_at = now()
    where ride_id = s.ride_id and member_id = s.asked_by;
  else
    -- Through Officer (which has no limit), so the one-per-spot index never sees two holders.
    update public.ride_crew set role = 'officer' where ride_id = s.ride_id and member_id = s.asked_by;
    update public.ride_crew set role = s.role, assigned_by = me, assigned_at = now() where ride_id = s.ride_id and member_id = me;
    update public.ride_crew set role = s.their_role, assigned_by = me, assigned_at = now() where ride_id = s.ride_id and member_id = s.asked_by;
  end if;
  insert into public.rsvps (ride_id, member_id, answer) values (s.ride_id, me, 'going')
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
  update public.crew_swaps set state = 'accepted', answered_at = now() where id = s.id;
end;
$$;

-- Whoever asked takes the ask back, while it's open.
create or replace function public.withdraw_swap(p_swap uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.crew_swaps%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into s from public.crew_swaps where id = p_swap for update;
  if not found then raise exception 'No such swap.'; end if;
  if s.asked_by <> me then raise exception 'Only whoever asked can withdraw it.'; end if;
  if s.state <> 'asked' then raise exception 'That ask has already been answered.'; end if;
  update public.crew_swaps set state = 'withdrawn', answered_at = now() where id = s.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who reads what: approved members read everything; nobody writes except through the actions.
-- ---------------------------------------------------------------------------------------------
alter table public.ride_plans enable row level security;
alter table public.route_ratings enable row level security;
alter table public.ride_calls enable row level security;
alter table public.ride_hubs enable row level security;
alter table public.hub_registrations enable row level security;
alter table public.crew_swaps enable row level security;
revoke all on public.ride_plans, public.route_ratings, public.ride_calls, public.ride_hubs,
  public.hub_registrations, public.crew_swaps from public, anon, authenticated;
grant select on public.ride_plans, public.route_ratings, public.ride_calls, public.ride_hubs,
  public.hub_registrations, public.crew_swaps to authenticated;
create policy ride_plans_for_members on public.ride_plans for select to authenticated using (private.is_approved_member());
create policy route_ratings_for_members on public.route_ratings for select to authenticated using (private.is_approved_member());
create policy ride_calls_for_members on public.ride_calls for select to authenticated using (private.is_approved_member());
create policy ride_hubs_for_members on public.ride_hubs for select to authenticated using (private.is_approved_member());
create policy hub_registrations_for_members on public.hub_registrations for select to authenticated using (private.is_approved_member());
create policy crew_swaps_for_members on public.crew_swaps for select to authenticated using (private.is_approved_member());

revoke all on function public.set_bike_range(uuid, int),
  public.save_ride_plan(uuid, jsonb, timestamptz),
  public.rate_route(uuid, int, text),
  public.call_ride(uuid, public.ride_call_state, text, date),
  public.save_hub(uuid, boolean, date, int, text, text),
  public.register_hub(uuid, public.hub_staying, boolean, text, text),
  public.withdraw_hub(uuid),
  public.ask_swap(uuid, uuid, text),
  public.answer_swap(uuid, boolean),
  public.withdraw_swap(uuid) from public, anon;
grant execute on function public.set_bike_range(uuid, int),
  public.save_ride_plan(uuid, jsonb, timestamptz),
  public.rate_route(uuid, int, text),
  public.call_ride(uuid, public.ride_call_state, text, date),
  public.save_hub(uuid, boolean, date, int, text, text),
  public.register_hub(uuid, public.hub_staying, boolean, text, text),
  public.withdraw_hub(uuid),
  public.ask_swap(uuid, uuid, text),
  public.answer_swap(uuid, boolean),
  public.withdraw_swap(uuid) to authenticated;
