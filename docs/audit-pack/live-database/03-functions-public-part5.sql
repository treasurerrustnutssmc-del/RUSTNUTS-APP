-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the public schema (these are callable through the API as RPCs if granted; see 02 for grants).
-- Part 5 of 5.

CREATE OR REPLACE FUNCTION public.signup_counts()
 RETURNS TABLE(ride_id uuid, hub_riders integer, hub_pillions integer, hub_group integer, hub_own integer, hub_camping integer, hub_day integer, hub_group_beds integer, charity_riding integer, charity_pillions integer, charity_guests integer, charity_helping integer, charity_people integer, website_riding integer, website_pillions integer, website_guests integer, website_helping integer, website_people integer, website_signups integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      coalesce(sum((case when w.riding then 1 else 0 end) + (case when w.pillion then 1 else 0 end) + w.guests), 0)::int as people,
      count(*)::int as signups
    from public.website_signups w group by w.ride_id
  )
  select coalesce(h.ride_id, c.ride_id, s.ride_id),
    coalesce(h.riders, 0), coalesce(h.pillions, 0), coalesce(h.grp, 0), coalesce(h.own, 0), coalesce(h.camping, 0), coalesce(h.day, 0),
    coalesce(h.group_beds, 0),
    coalesce(c.riding, 0), coalesce(c.pillions, 0), coalesce(c.guests, 0), coalesce(c.helping, 0), coalesce(c.people, 0),
    coalesce(s.riding, 0), coalesce(s.pillions, 0), coalesce(s.guests, 0), coalesce(s.helping, 0), coalesce(s.people, 0),
    coalesce(s.signups, 0)
  from hubs h
  full join charity c on c.ride_id = h.ride_id
  full join site s on s.ride_id = coalesce(h.ride_id, c.ride_id)
  where private.is_approved_member();
$function$
;

CREATE OR REPLACE FUNCTION public.site_enquiry(p_name text, p_email text, p_chapter text, p_about text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_about text := nullif(trim(coalesce(p_about, '')), '');
  new_id uuid;
begin
  if v_name = '' then raise exception 'Tell us your name.'; end if;
  if length(v_name) > 80 then raise exception 'Keep your name to 80 characters.'; end if;
  if length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'That email address does not look right.';
  end if;
  if p_chapter is null or p_chapter not in ('west', 'north', 'either') then
    raise exception 'Pick a chapter: West, North or either.';
  end if;
  if length(v_about) > 600 then raise exception 'Keep it to 600 characters.'; end if;

  -- One at a time, so two enquiries landing together can't both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtext('site_enquiry'));
  if (select count(*) from public.site_enquiries e
      where e.email = v_email and e.created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.site_enquiries e where e.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many enquiries just now. Try again later, or email the club.';
  end if;

  insert into public.site_enquiries (name, email, chapter_slug, about)
  values (v_name, v_email, p_chapter, v_about)
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.site_visit(p_page text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_page text := trim(coalesce(p_page, ''));
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  if v_page = '' or v_page = '/index.html' then v_page := '/'; end if;
  if left(v_page, 1) <> '/' then v_page := '/' || v_page; end if;
  if length(v_page) > 80 or v_page !~ '^/[a-z0-9/._-]*$' then return; end if;
  if not exists (select 1 from public.site_visits v where v.day = v_day and v.page = v_page)
     and (select count(*) from public.site_visits v where v.day = v_day) >= 200 then
    return;
  end if;
  -- A page stops counting at 10,000 views a day: enough for any real day, and a ceiling on what a
  -- script looping on the ping can do to the numbers (they are a guide for the board, not an audit).
  insert into public.site_visits (day, page, hits) values (v_day, v_page, 1)
  on conflict (day, page) do update set hits = least(public.site_visits.hits + 1, 10000);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.site_visit_summary()
 RETURNS TABLE(day date, page text, hits integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can see website visits.'; end if;
  return query
    select v.day, v.page, v.hits from public.site_visits v
    where v.day >= (now() at time zone 'Australia/Melbourne')::date - 29
    order by v.day desc, v.hits desc, v.page;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_live_ride(p_ride uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.stop_live_ride(p_ride uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from public.live_riders where ride_id = p_ride and member_id = auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.strike_bus_cost(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  e public.bus_costs%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into e from public.bus_costs where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not (coalesce(e.logged_by = me, false) or private.manages_bus()) then
    raise exception 'Only whoever logged it or the board can strike it out.';
  end if;
  if e.struck_at is not null then raise exception 'That’s already struck out.'; end if;
  update public.bus_costs set struck_by = me, struck_at = now() where id = e.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.strike_bus_km(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  e public.bus_km%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock(hashtext('rusty_bus'));
  select * into e from public.bus_km where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not (coalesce(e.logged_by = me, false) or private.manages_bus()) then
    raise exception 'Only whoever logged it or the board can strike it out.';
  end if;
  if e.struck_at is not null then raise exception 'That’s already struck out.'; end if;
  update public.bus_km set struck_by = me, struck_at = now() where id = e.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.suspend_member_access(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  t public.members%rowtype;
begin
  select * into t from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.id = me then raise exception 'You can’t suspend your own access.'; end if;
  if not private.is_board_of(t.chapter_id) then raise exception 'Only that member’s chapter board can do that.'; end if;
  if t.approval <> 'approved' then raise exception 'They’re not an approved member.'; end if;
  update public.members set approval = 'suspended', updated_at = now() where id = p_member;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.take_down_build_update(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  u public.build_updates%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into u from public.build_updates where id = p_id for update;
  if not found then raise exception 'No such update.'; end if;
  if u.author_id <> me and not private.is_any_board() then
    raise exception 'Only whoever posted it or the board can take it down.';
  end if;
  if u.taken_down_at is not null then raise exception 'That update has already been taken down.'; end if;
  update public.build_updates set taken_down_at = now(), taken_down_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.take_down_listing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into l from public.listings where id = p_id for update;
  if not found then raise exception 'No such listing.'; end if;
  if l.seller_id <> me and not private.is_any_board() then
    raise exception 'Only whoever listed it or the board can take it down.';
  end if;
  if l.taken_down_at is not null then raise exception 'That listing has already been taken down.'; end if;
  update public.listings set taken_down_at = now(), taken_down_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.toggle_reaction(p_message uuid, p_emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'No such message.'; end if;
  perform private.raise_chat_problem(m.conversation_id);
  if m.removed_at is not null then raise exception 'That message was removed.'; end if;
  if p_emoji is null or p_emoji not in ('👍', '❤️', '😂', '🔥', '🍺', '😮') then raise exception 'Pick one of the reactions.'; end if;

  delete from public.message_reactions where message_id = p_message and member_id = auth.uid() and emoji = p_emoji;
  if not found then
    insert into public.message_reactions (message_id, member_id, emoji) values (p_message, auth.uid(), p_emoji);
  end if;
  update public.messages set updated_at = clock_timestamp() where id = p_message;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unclaimed_roster_counts()
 RETURNS TABLE(chapter_id uuid, status member_status, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.chapter_id, r.status, count(*)::int
  from private.roster r
  where r.claimed_by is null and private.is_approved_member()
    and not exists (
      select 1 from auth.users u join public.members m on m.id = u.id
      where lower(trim(u.email)) = lower(trim(r.email))
    )
  group by r.chapter_id, r.status;
$function$
;

CREATE OR REPLACE FUNCTION public.undesignate_big4(p_ride uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  starts timestamptz;
begin
  if not private.can_designate_big4() then raise exception 'Only the NEC designates Big 4 rides (5.11).'; end if;
  select r.starts_at into starts from public.big4_rides b join public.rides r on r.id = b.ride_id where b.ride_id = p_ride for update of b;
  if not found then raise exception 'That ride isn’t a Big 4.'; end if;
  if private.club_date(starts) <= private.club_date() then
    raise exception 'A Big 4 is designated before the ride, not after (5.11).';
  end if;
  delete from public.big4_rides where ride_id = p_ride;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unname_shop_runner(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_shop_seat();
  delete from public.shop_runners where member_id = p_member;
  if not found then raise exception 'Not a shop runner.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_live_position(p_ride uuid, p_lat double precision, p_lng double precision, p_accuracy real, p_heading real, p_speed real)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
  if private.fix_problem(p_lat, p_lng) is not null then raise exception '%', private.fix_problem(p_lat, p_lng); end if;
  update public.live_riders
  set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy, heading = p_heading, speed_kmh = p_speed, updated_at = now()
  where ride_id = p_ride and member_id = auth.uid();
  return public.live_ride_state(p_ride);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upload_site_photo(p_path text, p_width integer, p_height integer, p_caption text, p_consent boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  v_caption text := nullif(private.trim_like_app(coalesce(p_caption, '')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_site_photo_editor() then
    raise exception 'Only the Social Media Officer, their crew or the NEC can put photos on the website.';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Tick that everyone in the photo is happy to be on the website.'; end if;
  if length(coalesce(v_caption, '')) > 120 then raise exception 'Keep the caption to 120 characters.'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> me::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'site-media' and o.name = p_path) then
    raise exception 'That photo didn’t upload properly. Try again.';
  end if;
  insert into public.site_photos (source, bucket, path, width, height, caption, posted_by, picked_by, status, decided_at)
  values ('upload', 'site-media', p_path, greatest(coalesce(p_width, 0), 0), greatest(coalesce(p_height, 0), 0), v_caption, me, me, 'live', now())
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.void_entry(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); e public.ledger_entries;
begin
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.keeps_books(e.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if e.state = 'void' then raise exception 'That’s already void.'; end if;
  if coalesce(private.trim_like_app(p_reason), '') = '' then raise exception 'Say why it’s being voided.'; end if;
  update public.ledger_entries
  set state = 'void', void_reason = private.trim_like_app(p_reason), voided_by = me, voided_at = now(), updated_at = now()
  where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vouch_mechanic(p_id uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into m from public.mechanics where id = p_id;
  if not found then raise exception 'No such workshop.'; end if;
  if m.archived_at is not null then raise exception 'That workshop is off the list.'; end if;
  insert into public.mechanic_vouches (mechanic_id, member_id, vouched, updated_at)
  values (p_id, me, coalesce(p_on, false), now())
  on conflict (mechanic_id, member_id) do update set vouched = excluded.vouched, updated_at = excluded.updated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.waive_charge(p_charge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.charges%rowtype;
begin
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'No such charge.'; end if;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if c.member_id = auth.uid() then raise exception 'Someone else with money rights has to handle your own fees.'; end if;
  if c.waived_at is not null then raise exception 'That charge is already waived.'; end if;
  if private.owing(p_charge) = 0 then raise exception 'That charge is already paid.'; end if;
  update public.charges set waived_at = now(), waived_by = auth.uid() where id = p_charge;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.website_signup(p_ride uuid, p_name text, p_email text, p_phone text, p_riding boolean, p_pillion boolean, p_guests integer, p_guest_names text, p_job text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_chapter_proposal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); p public.chapter_proposals := private.open_chapter_proposal(p_id);
begin
  if not private.is_national() and p.proposed_by is distinct from me then
    raise exception 'Only the NEC or whoever put it forward can withdraw it.';
  end if;
  update public.chapter_proposals set status = 'withdrawn', decided_by = me, decided_at = now() where id = p.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_charity(p_ride uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_conduct_appeal(p_record uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); a public.conduct_appeals; r public.conduct_records;
begin
  perform private.purge_conduct();
  a := private.conduct_open_appeal(p_record);
  select * into r from public.conduct_records where id = a.record_id;
  if r.member_id <> me then raise exception 'Only the member can withdraw it.'; end if;
  update public.conduct_appeals set withdrawn_on = private.club_date() where record_id = r.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_contribution(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k public.national_contributions;
begin
  perform private.require_member();
  k := private.open_contribution(p_id);
  if not private.is_national() then raise exception 'Only the NEC can withdraw it.'; end if;
  update public.national_contributions set status = 'withdrawn', settled_at = now() where id = k.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_hub(p_ride uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_nomination(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  n public.brag_nominations%rowtype;
  a public.brag_awards%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into n from public.brag_nominations where id = p_id for update;
  if not found then raise exception 'No such nomination.'; end if;
  select * into a from public.brag_awards where id = n.award_id;
  if a.archived_at is not null then raise exception 'That award has been taken off.'; end if;
  if n.nominated_by is distinct from me and not private.is_any_board() then
    raise exception 'Only whoever nominated it or the board can withdraw it.';
  end if;
  if private.award_phase(a.nominations_close, a.voting_close) <> 'nominating' then
    raise exception 'Nominations are closed.';
  end if;
  if n.withdrawn_at is not null then raise exception 'That nomination has already been withdrawn.'; end if;
  update public.brag_nominations set withdrawn_at = now(), withdrawn_by = me where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_swap(p_swap uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
