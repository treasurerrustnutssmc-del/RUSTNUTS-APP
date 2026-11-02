-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Every function in the public schema (these are callable through the API as RPCs if granted; see 02 for grants).
-- Part 4 of 5.

CREATE OR REPLACE FUNCTION public.save_hub(p_ride uuid, p_members_only boolean, p_closes_on date, p_beds integer, p_accommodation text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- A closing day already set can stay; a new one runs from today to the ride day.
  if p_closes_on is not null
     and p_closes_on is distinct from (select h.closes_on from public.ride_hubs h where h.ride_id = p_ride)
     and (p_closes_on < private.club_date()
          or p_closes_on > (ride.starts_at at time zone 'Australia/Melbourne')::date) then
    raise exception 'Pick a closing day from today up to the ride day.';
  end if;
  insert into public.ride_hubs (ride_id, members_only, closes_on, beds, accommodation, notes, updated_by, updated_at)
  values (p_ride, coalesce(p_members_only, true), p_closes_on, p_beds, clean_accommodation, clean_notes, me, now())
  on conflict (ride_id) do update
    set members_only = excluded.members_only, closes_on = excluded.closes_on, beds = excluded.beds,
        accommodation = excluded.accommodation, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_invite_in(p_id uuid, p_club uuid, p_chapter uuid, p_title text, p_event_on text, p_place text, p_details text, p_ride uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  i public.club_invites%rowtype;
  r public.rides%rowtype;
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_place text := nullif(private.trim_like_app(p_place), '');
  c_details text := nullif(private.trim_like_app(p_details), '');
  c_on date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into i from public.club_invites where id = p_id and direction = 'in' for update;
    if not found then raise exception 'No such invite.'; end if;
    if i.archived_at is not null then raise exception 'That invite has been taken off.'; end if;
    if not private.can_change_invite(i) then raise exception 'Only the board or Ride Committee can change that invite.'; end if;
  end if;
  -- A club taken off the list keeps the invites it already has.
  if p_id is null or p_club is distinct from i.club_id then
    perform private.check_club_on_list(p_club);
  end if;
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  -- Moving it to another chapter: whoever passed it on may, while it waits; a manager needs that chapter too.
  if p_id is not null and i.chapter_id is distinct from p_chapter
     and not coalesce(i.answer = 'waiting' and i.added_by = me, false) and not private.manages_chapter_rides(p_chapter) then
    raise exception 'Only the board or Ride Committee can change that invite.';
  end if;
  if c_title = '' then raise exception 'Give the event a name.'; end if;
  if char_length(c_title) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if p_event_on is null or p_event_on !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Pick a date.'; end if;
  begin
    c_on := p_event_on::date;
  exception when others then
    raise exception 'Pick a date.';
  end;
  if to_char(c_on, 'YYYY-MM-DD') <> p_event_on then raise exception 'Pick a date.'; end if;
  if c_on < private.club_date() and not (p_id is not null and i.event_on = c_on) then
    raise exception 'That date has passed.';
  end if;
  if char_length(c_place) > 120 then raise exception 'Keep the place to 120 characters at most.'; end if;
  if char_length(c_details) > 1000 then raise exception 'Keep the details to 1,000 characters at most.'; end if;
  -- A ride already linked stays linked.
  if p_ride is not null and not (p_id is not null and i.ride_id is not distinct from p_ride) then
    select * into r from public.rides where id = p_ride;
    if not found then raise exception 'No such ride.'; end if;
    if r.category not in ('supported', 'non_nuts') then raise exception 'Link it to a Supported or Non-Nuts ride.'; end if;
    if r.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
    if (r.starts_at at time zone 'Australia/Melbourne')::date <> c_on then
      raise exception 'That ride is on a different day.';
    end if;
    if exists (select 1 from public.club_invites o
               where o.direction = 'in' and o.ride_id = p_ride and o.archived_at is null and o.id is distinct from p_id) then
      raise exception 'Another invite is already linked to that ride.';
    end if;
  end if;

  if p_id is null then
    begin
      insert into public.club_invites (direction, club_id, chapter_id, ride_id, title, event_on, place, details, added_by)
      values ('in', p_club, p_chapter, p_ride, c_title, c_on, c_place, c_details, me)
      returning id into new_id;
    exception when unique_violation then
      raise exception 'Another invite is already linked to that ride.';
    end;
    return new_id;
  end if;
  begin
    update public.club_invites
    set club_id = p_club, chapter_id = p_chapter, ride_id = p_ride, title = c_title, event_on = c_on, place = c_place,
        details = c_details
    where id = p_id;
  exception when unique_violation then
    raise exception 'Another invite is already linked to that ride.';
  end;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_link_preview(p_url text, p_preview jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into private.link_previews (url, preview, fetched_at) values (left(p_url, 2000), p_preview, now())
  on conflict (url) do update set preview = excluded.preview, fetched_at = excluded.fetched_at;
$function$
;

CREATE OR REPLACE FUNCTION public.save_listing(p_id uuid, p_kind text, p_title text, p_price numeric, p_details text, p_photos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
  c_title text := coalesce(private.trim_like_app(p_title), '');
  c_details text := nullif(private.trim_like_app(p_details), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  c_kind public.listing_kind;
  c_price int;
  bad boolean;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into l from public.listings where id = p_id for update;
    if not found then raise exception 'No such listing.'; end if;
    if l.seller_id <> me then raise exception 'Only whoever listed it can change it.'; end if;
    if l.taken_down_at is not null then raise exception 'That listing has been taken down.'; end if;
  end if;
  if p_kind is null or p_kind not in (select unnest(enum_range(null::public.listing_kind))::text) then
    raise exception 'Pick what kind of listing it is.';
  end if;
  c_kind := p_kind::public.listing_kind;
  if c_title = '' then raise exception 'Give it a title.'; end if;
  if char_length(c_title) > 80 then raise exception 'Keep the title to 80 characters at most.'; end if;
  if c_kind = 'sell' then
    if p_price is null or p_price <> trunc(p_price) or p_price < 1 or p_price > 100000 then
      raise exception 'Put a price on it, in whole dollars.';
    end if;
    c_price := p_price::int;
  end if;
  if char_length(c_details) > 1000 then raise exception 'Keep the details to 1,000 characters at most.'; end if;
  if jsonb_typeof(v_photos) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  if jsonb_array_length(v_photos) > 6 then raise exception 'Up to 6 photos.'; end if;

  select exists (
    select 1 from jsonb_array_elements(v_photos) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'path') is distinct from 'string'
       or split_part(item->>'path', '/', 1) <> me::text
       or not exists (select 1 from storage.objects o
                      where o.bucket_id = 'swap-media' and o.name = item->>'path' and o.owner_id = me::text)
       or exists (select 1 from public.listings other
                  where other.id is distinct from p_id
                    and other.photos @> jsonb_build_array(jsonb_build_object('path', item->>'path')))
       or (select count(*) from jsonb_array_elements(v_photos) sib where sib->>'path' = item->>'path') > 1
  ) into bad;
  if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  -- Kept as just the path and size.
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', item->>'path',
           'width', case when jsonb_typeof(item->'width') = 'number' then round((item->>'width')::numeric) end,
           'height', case when jsonb_typeof(item->'height') = 'number' then round((item->>'height')::numeric) end)
         order by i), '[]')
  into v_photos from jsonb_array_elements(v_photos) with ordinality as e(item, i);

  if p_id is null then
    insert into public.listings (seller_id, kind, title, price_dollars, details, photos)
    values (me, c_kind, c_title, c_price, c_details, v_photos)
    returning id into new_id;
    return new_id;
  end if;
  update public.listings
  set kind = c_kind, title = c_title, price_dollars = c_price, details = c_details, photos = v_photos,
      updated_at = now()
  where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_mechanic(p_id uuid, p_name text, p_suburb text, p_phone text, p_website text, p_speciality text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  m public.mechanics%rowtype;
  c_name text := coalesce(private.trim_like_app(p_name), '');
  c_suburb text := nullif(private.trim_like_app(p_suburb), '');
  c_phone text := nullif(private.trim_like_app(p_phone), '');
  c_website text := nullif(private.trim_like_app(p_website), '');
  c_speciality text := nullif(private.trim_like_app(p_speciality), '');
  c_notes text := nullif(private.trim_like_app(p_notes), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into m from public.mechanics where id = p_id for update;
    if not found then raise exception 'No such workshop.'; end if;
    if not private.can_edit_mechanic(m.added_by) then
      raise exception 'Only whoever added it or the board can change it.';
    end if;
    if m.archived_at is not null then raise exception 'That workshop is off the list.'; end if;
  end if;
  if c_name = '' then raise exception 'Give the workshop a name.'; end if;
  if char_length(c_name) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if char_length(c_suburb) > 60 then raise exception 'Keep the suburb to 60 characters at most.'; end if;
  if char_length(c_phone) > 30 then raise exception 'Keep the phone number to 30 characters at most.'; end if;
  if c_website is not null and c_website !~* '^https?://' then
    raise exception 'Websites start with http:// or https://.';
  end if;
  if char_length(c_website) > 200 then raise exception 'Keep the website to 200 characters at most.'; end if;
  if char_length(c_speciality) > 80 then
    raise exception 'Keep what they’re good at to 80 characters at most.';
  end if;
  if char_length(c_notes) > 500 then raise exception 'Keep the notes to 500 characters at most.'; end if;

  if p_id is null then
    insert into public.mechanics (name, suburb, phone, website, speciality, notes, added_by)
    values (c_name, c_suburb, c_phone, c_website, c_speciality, c_notes, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.mechanics
  set name = c_name, suburb = c_suburb, phone = c_phone, website = c_website, speciality = c_speciality,
      notes = c_notes, updated_at = now()
  where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_meeting(p_id uuid, p_chapter uuid, p_kind meeting_kind, p_title text, p_starts_at timestamp with time zone, p_location text, p_agenda jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  existing public.meetings%rowtype;
  v_agenda jsonb := coalesce(p_agenda, '[]'::jsonb);
  notice_days int;
  notice_name text;
  saved uuid;
begin
  if p_id is not null then
    select * into existing from public.meetings where id = p_id for update;
    if not found then raise exception 'No such meeting.'; end if;
    perform private.require_scope(existing.chapter_id);
  end if;
  perform private.require_scope(p_chapter);
  if existing.cancelled_at is not null then raise exception 'That meeting was cancelled.'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'Give the meeting a title.'; end if;
  if p_starts_at is null then raise exception 'Pick a date and time.'; end if;
  if (p_chapter is null and p_kind = 'board') or (p_chapter is not null and p_kind = 'nec') then
    raise exception 'That kind of meeting doesn’t fit here.';
  end if;
  if jsonb_typeof(v_agenda) <> 'array' or exists (
    select 1 from jsonb_array_elements(v_agenda) a where nullif(trim(a->>'title'), '') is null) then
    raise exception 'Each agenda item needs a title.';
  end if;

  -- Notice (10.4): counted when a meeting is called, or moved earlier, for a time still to come.
  -- Board meetings have no notice rule; an urgent NEC meeting may go ahead sooner (11.5).
  select n.days, n.name into notice_days, notice_name from (values
    (false, 'general'::public.meeting_kind, 7, 'A chapter meeting'),
    (false, 'special'::public.meeting_kind, 7, 'A special meeting'),
    (false, 'agm'::public.meeting_kind, 14, 'An Annual Chapter Meeting'),
    (true, 'general'::public.meeting_kind, 14, 'A National Club meeting'),
    (true, 'special'::public.meeting_kind, 14, 'A National Club meeting'),
    (true, 'agm'::public.meeting_kind, 14, 'The Association AGM')
  ) as n(national, kind, days, name)
  where n.national = (p_chapter is null) and n.kind = p_kind;
  if notice_days is not null and p_starts_at > now()
     and (p_id is null or p_starts_at < existing.starts_at or existing.starts_at <= now()
          or p_kind <> existing.kind or p_chapter is distinct from existing.chapter_id)
     and p_starts_at - now() < make_interval(days => notice_days) then
    raise exception '% needs % days’ notice (10.4).', notice_name, notice_days;
  end if;

  v_agenda := coalesce((
    select jsonb_agg(jsonb_build_object('title', trim(a->>'title'), 'notes', nullif(trim(a->>'notes'), '')) order by pos)
    from jsonb_array_elements(v_agenda) with ordinality as x(a, pos)), '[]'::jsonb);

  if p_id is null then
    insert into public.meetings (chapter_id, kind, title, starts_at, location, agenda, created_by)
    values (p_chapter, p_kind, trim(p_title), p_starts_at, nullif(trim(p_location), ''), v_agenda, me)
    returning id into saved;
  else
    update public.meetings set chapter_id = p_chapter, kind = p_kind, title = trim(p_title), starts_at = p_starts_at,
      location = nullif(trim(p_location), ''), agenda = v_agenda
    where id = p_id returning id into saved;
  end if;
  return saved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_meeting_report(p_id uuid, p_from date, p_to date, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_books(null);
  r public.treasurer_meeting_reports;
  new_id uuid;
begin
  if p_id is not null then
    select * into r from public.treasurer_meeting_reports where id = p_id for update;
    if not found then raise exception 'No such report.'; end if;
    if r.presented_at is not null then raise exception 'That report is presented and can’t be changed.'; end if;
  end if;
  if p_from is null or p_to is null then raise exception 'Pick the first and last day of the report.'; end if;
  if p_from > p_to then raise exception 'The report has to start before it ends.'; end if;
  if p_to > private.club_date() then raise exception 'The report can’t run past today.'; end if;
  if private.fy_of(p_from) <> private.fy_of(p_to) then
    raise exception 'Keep the report inside one financial year (1 July to 30 June).';
  end if;
  if char_length(coalesce(p_notes, '')) > 4000 then raise exception 'Keep the notes to 4,000 characters or fewer.'; end if;
  if p_id is null then
    insert into public.treasurer_meeting_reports (from_on, to_on, notes, saved_by)
    values (p_from, p_to, coalesce(p_notes, ''), me) returning id into new_id;
    return new_id;
  end if;
  update public.treasurer_meeting_reports
    set from_on = p_from, to_on = p_to, notes = coalesce(p_notes, ''), saved_by = me, saved_at = now()
    where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_minutes(p_id uuid, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  update public.meetings set minutes = nullif(trim(p_text), '') where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes,
    new_rides = excluded.new_rides, approvals = excluded.approvals, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, rev_sound, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, p_rev_sound, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes,
    new_rides = excluded.new_rides, approvals = excluded.approvals, rev_sound = excluded.rev_sound, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean, p_chat_messages boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  insert into public.notification_prefs (member_id, ride_reminders, ride_changes, new_rides, approvals, rev_sound, chat_messages, updated_at)
  values (auth.uid(), p_ride_reminders, p_ride_changes, p_new_rides, p_approvals, p_rev_sound, p_chat_messages, now())
  on conflict (member_id) do update set
    ride_reminders = excluded.ride_reminders, ride_changes = excluded.ride_changes, new_rides = excluded.new_rides,
    approvals = excluded.approvals, rev_sound = excluded.rev_sound, chat_messages = excluded.chat_messages, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_other_club(p_id uuid, p_name text, p_town text, p_contact text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.other_clubs%rowtype;
  c_name text := coalesce(private.trim_like_app(p_name), '');
  c_town text := nullif(private.trim_like_app(p_town), '');
  c_contact text := nullif(private.trim_like_app(p_contact), '');
  c_note text := nullif(private.trim_like_app(p_note), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_id is not null then
    select * into c from public.other_clubs where id = p_id for update;
    if not found then raise exception 'No such club.'; end if;
    if c.archived_at is not null then raise exception 'That club is off the list.'; end if;
    if not private.can_edit_other_club(c.added_by) then
      raise exception 'Only whoever added it, the board or the Ride Committee can change it.';
    end if;
  end if;
  if c_name = '' then raise exception 'Give the club’s name.'; end if;
  if char_length(c_name) > 80 then raise exception 'Keep the name to 80 characters at most.'; end if;
  if exists (select 1 from public.other_clubs o
             where o.archived_at is null and o.id is distinct from p_id and lower(o.name) = lower(c_name)) then
    raise exception 'That club’s already on the list.';
  end if;
  if char_length(c_town) > 60 then raise exception 'Keep the town to 60 characters at most.'; end if;
  if char_length(c_contact) > 200 then raise exception 'Keep how to reach them to 200 characters at most.'; end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  begin
    if p_id is null then
      insert into public.other_clubs (name, town, contact, note, added_by)
      values (c_name, c_town, c_contact, c_note, me)
      returning id into new_id;
      return new_id;
    end if;
    update public.other_clubs
    set name = c_name, town = c_town, contact = c_contact, note = c_note, updated_at = now()
    where id = p_id;
  exception when unique_violation then
    -- Someone added the same name a moment ago.
    raise exception 'That club’s already on the list.';
  end;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_profile(p_full_name text, p_road_name text, p_bio text, p_share_phone boolean, p_with_private boolean DEFAULT false, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_licence_class licence_class DEFAULT NULL::licence_class, p_licence_expiry date DEFAULT NULL::date, p_first_aid_expiry date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Your name can’t be blank.'; end if;
  update public.members set
    full_name = trim(p_full_name),
    road_name = nullif(trim(p_road_name), ''),
    bio = nullif(trim(p_bio), ''),
    share_phone = coalesce(p_share_phone, false)
  where id = auth.uid();
  if not found then raise exception 'Apply to join first.'; end if;
  if p_with_private then
    update public.member_private set
      email = nullif(trim(p_email), ''),
      phone = nullif(trim(p_phone), ''),
      licence_class = p_licence_class,
      licence_expiry = p_licence_expiry,
      first_aid_expiry = p_first_aid_expiry
    where member_id = auth.uid();
    if not found then
      raise exception 'Your contact and licence record is missing. Ask your chapter board to sort it out.';
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_ride(p_id uuid, p_title text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_all_day boolean, p_category ride_category, p_location text, p_notes text, p_website boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_ride_plan(p_ride uuid, p_stops jsonb, p_seen timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_route(p_id uuid, p_name text, p_chapter uuid, p_notes text, p_gpx text, p_distance_m integer, p_climb_m integer, p_line jsonb, p_stops jsonb, p_bounds jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  existing public.routes%rowtype;
  route_name text := private.trim_like_app(p_name);
  -- A leading byte order mark (some apps write one) is cut off and not kept, as the app's reader skips it.
  file text := case when left(p_gpx, 1) = chr(65279) then substr(p_gpx, 2) else p_gpx end;
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
  if route_name is null or char_length(route_name) not between 1 and 80 then
    raise exception 'Give the route a name.';
  end if;

  if file is null then
    if p_id is null then raise exception 'That route has no track in it.'; end if;
  else
    if octet_length(file) > 5242880 then raise exception 'That file is too big (5 MB at most).'; end if;
    if not xml_is_well_formed_document(file) then raise exception 'That isn’t a GPX file.'; end if;
    doc := xmlparse(document file);
    if (xpath('local-name(/*)', doc))[1]::text is distinct from 'gpx' then
      raise exception 'That isn’t a GPX file.';
    end if;
    if coalesce(cardinality(xpath('//*[local-name()=''trkpt'' or local-name()=''rtept'']', doc)), 0) < 2 then
      raise exception 'That route has no track in it.';
    end if;
  end if;
  -- The summary has to be one the app could have sent: a line of at most 300 points and at most 100
  -- stops (both arrays), and bounds that are an object. Each is optional.
  if (p_line is not null and case when jsonb_typeof(p_line) = 'array' then jsonb_array_length(p_line) > 300 else true end)
     or (p_stops is not null and case when jsonb_typeof(p_stops) = 'array' then jsonb_array_length(p_stops) > 100 else true end)
     or (p_bounds is not null and jsonb_typeof(p_bounds) <> 'object') then
    raise exception 'That isn’t a GPX file.';
  end if;

  if p_id is null then
    insert into public.routes (name, chapter_id, notes, gpx, distance_m, climb_m, line, stops, bounds,
                               created_by, updated_by)
    values (route_name, p_chapter, nullif(private.trim_like_app(p_notes), ''), file, coalesce(p_distance_m, 0), p_climb_m,
            coalesce(p_line, '[]'::jsonb), coalesce(p_stops, '[]'::jsonb), p_bounds, me, me)
    returning id into saved;
  elsif file is null then
    update public.routes
    set name = route_name, chapter_id = p_chapter, notes = nullif(private.trim_like_app(p_notes), ''),
        updated_by = me, updated_at = now()
    where id = p_id
    returning id into saved;
  else
    update public.routes
    set name = route_name, chapter_id = p_chapter, notes = nullif(private.trim_like_app(p_notes), ''),
        gpx = file, distance_m = coalesce(p_distance_m, 0), climb_m = p_climb_m,
        line = coalesce(p_line, '[]'::jsonb), stops = coalesce(p_stops, '[]'::jsonb), bounds = p_bounds,
        updated_by = me, updated_at = now()
    where id = p_id
    returning id into saved;
  end if;
  return saved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_sponsor(p_id uuid, p_name text, p_blurb text, p_url text, p_deal text, p_logo_path text, p_chapter uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  s public.sponsors%rowtype;
  c_name text := coalesce(private.trim_like_app(p_name), '');
  c_blurb text := nullif(private.trim_like_app(p_blurb), '');
  c_url text := nullif(private.trim_like_app(p_url), '');
  c_deal text := nullif(private.trim_like_app(p_deal), '');
  new_id uuid;
begin
  perform private.check_sponsor_keeper();
  if p_id is not null then
    select * into s from public.sponsors where id = p_id for update;
    if not found then raise exception 'No such sponsor.'; end if;
    if s.archived_at is not null then raise exception 'That sponsor has been taken off.'; end if;
  end if;
  if c_name = '' then raise exception 'Name the sponsor.'; end if;
  if char_length(c_name) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if char_length(c_blurb) > 300 then raise exception 'Keep the blurb to 300 characters at most.'; end if;
  if c_url is not null and c_url !~* '^https?://' then
    raise exception 'Websites start with http:// or https://.';
  end if;
  if char_length(c_url) > 300 then raise exception 'Keep the website to 300 characters at most.'; end if;
  if char_length(c_deal) > 200 then raise exception 'Keep the member deal to 200 characters at most.'; end if;
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such chapter.';
  end if;
  if p_logo_path is not null and p_logo_path is distinct from s.logo_path and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'sponsor-logos' and o.name = p_logo_path and o.owner_id = me::text
  ) then
    raise exception 'That logo didn’t upload. Try again.';
  end if;

  if p_id is null then
    insert into public.sponsors (name, blurb, url, deal, logo_path, chapter_id, added_by)
    values (c_name, c_blurb, c_url, c_deal, p_logo_path, p_chapter, me)
    returning id into new_id;
    return new_id;
  end if;
  update public.sponsors
  set name = c_name, blurb = c_blurb, url = c_url, deal = c_deal, logo_path = p_logo_path,
      chapter_id = p_chapter, updated_at = now()
  where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_app_feedback(p_kind text, p_body text, p_where text, p_screenshot_path text, p_app_version text, p_build text, p_device text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_where text := nullif(trim(coalesce(p_where, '')), '');
  v_shot text := nullif(trim(coalesce(p_screenshot_path, '')), '');
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.uses_app() then raise exception 'Only approved members can do that.'; end if;
  if p_kind is null or p_kind not in ('bug', 'idea', 'other') then
    raise exception 'Pick what it is: something wrong, an idea or other.';
  end if;
  if v_body = '' then raise exception 'Tell us what happened.'; end if;
  if length(v_body) > 1000 then raise exception 'Keep it to 1,000 characters.'; end if;
  if length(v_where) > 60 then raise exception 'Keep “where” to 60 characters.'; end if;
  if v_shot is not null and (split_part(v_shot, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'feedback-media' and o.name = v_shot)) then
    raise exception 'That screenshot didn’t upload. Try again.';
  end if;
  -- One at a time, so two sent together can't both squeeze under the limit.
  perform pg_advisory_xact_lock(hashtext('app_feedback:' || auth.uid()::text));
  if (select count(*) from public.app_feedback f where f.member_id = auth.uid() and f.created_at > now() - interval '1 day') >= 5 then
    raise exception 'That’s five today. Send more tomorrow, or message the treasurer.';
  end if;

  insert into public.app_feedback (member_id, kind, body, where_in_app, screenshot_path, app_version, build, device)
  values (auth.uid(), p_kind, v_body, v_where, v_shot,
          left(trim(coalesce(p_app_version, '')), 40), left(trim(coalesce(p_build, '')), 80), left(trim(coalesce(p_device, '')), 120))
  returning id into new_id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_message(p_chat uuid, p_body text, p_media jsonb DEFAULT '[]'::jsonb, p_reply_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.conversations%rowtype;
  body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  media jsonb := coalesce(p_media, '[]'::jsonb);
  n int;
  other uuid;
  item jsonb;
  bad boolean;
  msg uuid;
  pos int := 0;
begin
  perform private.raise_chat_problem(p_chat);
  select * into c from public.conversations where id = p_chat;
  if c.kind = 'direct' then
    select member_id into other from public.conversation_members where conversation_id = p_chat and member_id <> me;
    if other is not null and private.blocked_between(me, other) then raise exception 'You can’t message them.'; end if;
  end if;
  if p_reply_to is not null
     and not exists (select 1 from public.messages where id = p_reply_to and conversation_id = p_chat) then
    raise exception 'No such message.';
  end if;
  if jsonb_typeof(media) <> 'array' then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  n := jsonb_array_length(media);
  if body = '' and n = 0 then raise exception 'Write something or add a photo.'; end if;
  if char_length(body) > 4000 then raise exception 'Keep it under 4,000 characters.'; end if;
  if n > 10 then raise exception 'Up to 10 photos or videos at a time.'; end if;
  -- A voice note goes on its own, and has a length (from the recorder) of up to two minutes.
  item := (select value from jsonb_array_elements(media) where jsonb_typeof(value) = 'object' and value->>'kind' = 'voice' limit 1);
  if item is not null then
    if body <> '' or n > 1 then raise exception 'A voice note goes on its own.'; end if;
    -- Read as a number only when it is one, so anything else gets the app's words, not Postgres's.
    if coalesce(case when jsonb_typeof(item->'durationMs') = 'number' then (item->>'durationMs')::numeric end, 0) < 1 then
      raise exception 'That voice note didn’t record properly. Try again.';
    end if;
    if (item->>'durationMs')::numeric > 120000 then raise exception 'Voice notes can be up to 2 minutes.'; end if;
  end if;

  -- Each file: the right kind, in this chat's folder, uploaded by the sender, not used before. A GIF
  -- is GIPHY's own https address instead. A voice note is an .m4a or .webm recording with no still.
  for item in select value from jsonb_array_elements(media) loop
    if item->>'kind' = 'gif' then
      if coalesce(item->>'path', '') !~ '^https://(media[0-9]?|i)\.giphy\.com/[A-Za-z0-9_./?&=%-]+$' or item ? 'posterPath' and item->>'posterPath' is not null then
        raise exception 'That photo didn’t upload properly. Try again.';
      end if;
      continue;
    end if;
    select coalesce(item->>'kind', '') not in ('photo', 'video', 'voice')
        or item->>'kind' = 'voice' and (coalesce(item->>'path', '') !~ '\.(m4a|webm)$' or item->>'posterPath' is not null)
        -- a recording goes in as a voice note, and only a recording does (when storage knows the file's type)
        or exists (select 1 from storage.objects o
                   where o.bucket_id = 'chat-media' and o.name = item->>'path' and o.metadata->>'mimetype' is not null
                     and (item->>'kind' = 'voice') <> (o.metadata->>'mimetype' like 'audio/%'))
        or exists (
             select 1 from jsonb_array_elements_text(
               jsonb_build_array(item->'path') || case when item ? 'posterPath' and item->>'posterPath' is not null
                                                       then jsonb_build_array(item->'posterPath') else '[]'::jsonb end) p
             where p is null
                or split_part(p, '/', 1) <> p_chat::text
                or not exists (select 1 from storage.objects o
                               where o.bucket_id = 'chat-media' and o.name = p and o.owner_id = me::text)
                or exists (select 1 from public.message_media mm where mm.path = p or mm.poster_path = p))
        -- and no file twice in this message, a video's still included
        or (select count(*) from jsonb_array_elements(media) sib
            where sib->>'kind' <> 'gif'
              and (sib->>'path' in (item->>'path', item->>'posterPath') or sib->>'posterPath' in (item->>'path', item->>'posterPath')))
           > 1
        or item->>'path' = item->>'posterPath'
      into bad;
    if bad then raise exception 'That photo didn’t upload properly. Try again.'; end if;
  end loop;

  insert into public.messages (conversation_id, author_id, body, reply_to_id)
  values (p_chat, me, nullif(body, ''), p_reply_to)
  returning id into msg;

  for item in select value from jsonb_array_elements(media) loop
    insert into public.message_media (message_id, conversation_id, kind, path, poster_path, width, height, duration_ms, position)
    values (msg, p_chat, (item->>'kind')::public.chat_media_kind, item->>'path', item->>'posterPath',
            -- Phones can report sizes and lengths with fractions (an iPhone video's length always does).
            coalesce(round((item->>'width')::numeric)::int, 0), coalesce(round((item->>'height')::numeric)::int, 0),
            round((item->>'durationMs')::numeric)::int, pos);
    pos := pos + 1;
  end loop;

  -- Your own message means you've seen the chat up to here.
  insert into public.chat_reads (conversation_id, member_id, read_at) values (p_chat, me, clock_timestamp())
  on conflict (conversation_id, member_id) do update set read_at = excluded.read_at;
  return msg;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_action_done(p_id uuid, p_done boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.require_member();
  item public.action_items%rowtype;
begin
  select * into item from public.action_items where id = p_id for update;
  if not found then raise exception 'No such action item.'; end if;
  if item.owner_id <> me and not private.runs_scope(item.chapter_id) then
    raise exception 'Only the owner or the board can tick this off.';
  end if;
  update public.action_items set done_on = case when p_done then private.club_date() end where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_big4_waiver(p_ride uuid, p_member uuid, p_ground text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  target public.members%rowtype;
  closes timestamptz;
begin
  -- The same lock set_rsvp takes, so an excuse cleared while they answer is seen by one or the other.
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if not exists (select 1 from public.big4_rides where ride_id = p_ride) then raise exception 'That ride isn’t a Big 4.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  closes := case when ride.all_day
                 then ((ride.starts_at at time zone 'Australia/Melbourne') + interval '1 day') at time zone 'Australia/Melbourne'
                 else ride.starts_at end;
  if closes <= now() then raise exception 'That ride has already started.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only their chapter’s board can excuse them.'; end if;
  if p_member = me then raise exception 'Someone else on the board has to excuse you.'; end if;
  if p_ground is not null and p_ground not in ('work', 'family', 'health', 'injury', 'distance') then
    raise exception 'Pick work, family, health, injury or distance (5.4).';
  end if;
  if p_ground is null then
    delete from public.big4_waivers where ride_id = p_ride and member_id = p_member;
  else
    insert into public.big4_waivers (ride_id, member_id, ground, granted_by) values (p_ride, p_member, p_ground, me)
    on conflict (ride_id, member_id) do update set ground = excluded.ground, granted_by = excluded.granted_by, granted_at = now();
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_bike_range(p_bike uuid, p_range integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_birthday(p_month integer, p_day integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if (p_month is null) <> (p_day is null) then raise exception 'Pick a day and a month.'; end if;
  if p_month is not null and (
    p_month not between 1 and 12 or p_day < 1 or
    p_day > case when p_month = 2 then 29 when p_month in (4, 6, 9, 11) then 30 else 31 end
  ) then
    raise exception 'That day isn’t in that month.';
  end if;

  insert into public.member_birthdays (member_id, month, day, set_at)
  values (me, p_month, p_day, now())
  on conflict (member_id) do update set month = excluded.month, day = excluded.day, set_at = excluded.set_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_block(p_member uuid, p_blocked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.members where id = p_member) then raise exception 'That member no longer exists.'; end if;
  if p_member = auth.uid() then raise exception 'You can’t block yourself.'; end if;
  if p_blocked then
    insert into public.member_blocks (blocker_id, blocked_id) values (auth.uid(), p_member) on conflict do nothing;
  else
    delete from public.member_blocks where blocker_id = auth.uid() and blocked_id = p_member;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_cash_float(p_fy integer, p_amount_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(null);
begin
  if p_fy is null or p_fy < 2019 or p_fy > 2100 then raise exception 'Pick a financial year.'; end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'Enter an amount of $0 or more.'; end if;
  insert into public.cash_floats (fy, amount_cents, set_by) values (p_fy, p_amount_cents, me)
  on conflict (fy) do update set amount_cents = excluded.amount_cents, set_by = excluded.set_by, set_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_conduct_hearing(p_record uuid, p_panel uuid[], p_hearing date)
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
  if not private.is_board_of(private.conduct_chapter(r)) or me = r.member_id or me = r.recorded_by then
    raise exception 'Only the board, apart from whoever recorded it, can set up the hearing.';
  end if;
  if coalesce(cardinality(p_panel), 0) <> 3 or (select count(distinct x) from unnest(p_panel) x) <> 3 then
    raise exception 'Pick three different people.';
  end if;
  if (select count(*) from public.members where id = any (p_panel) and approval = 'approved' and status <> 'legacy') <> 3 then
    raise exception 'Pick approved members for the panel.';
  end if;
  if r.member_id = any (p_panel) or (r.recorded_by is not null and r.recorded_by = any (p_panel)) then
    raise exception 'The panel can’t include the member or whoever recorded it.';
  end if;
  if p_hearing is null or p_hearing < a.lodged_on then raise exception 'Pick the hearing date.'; end if;
  update public.conduct_appeals set panel = p_panel, hearing_on = p_hearing where record_id = r.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_crew(p_ride uuid, p_member uuid, p_role crew_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  target public.members%rowtype;
  first_day_end timestamptz;
  manages boolean;
  needs_first_aid boolean;
  first_aid date;
  ride_date date;
  big4 text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- Lock order: the ride row first, before rsvps or ride_crew, the same way as leave_crew and
  -- set_rsvp, so two changes to one ride's crew and answers queue instead of deadlocking.
  -- "No key update" still lets other members' answers reference the ride.
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  ride_date := date(ride.starts_at at time zone 'Australia/Melbourne');
  first_day_end := ((ride_date + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The crew can’t change after the ride day.'; end if;

  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  manages := private.manages_ride(p_ride);
  if target.id <> me and not manages then
    raise exception 'Only the board or ride committee can put someone else on the crew.';
  end if;

  if target.approval <> 'approved' or target.status not in ('full', 'nomad') then
    raise exception 'Only Full and Nomad members can crew a ride.';
  end if;
  if target.on_hiatus then raise exception 'Members on hiatus can’t crew a ride.'; end if;
  needs_first_aid := p_role in ('tail_gunner', 'assistant_tail_gunner');
  if needs_first_aid then
    select mp.first_aid_expiry into first_aid from public.member_private mp where mp.member_id = target.id;
    if first_aid is null or first_aid < ride_date then
      raise exception 'Tail Gunners need a current first aid certificate on file.';
    end if;
  end if;
  -- The Going gate: crewing makes them Going, so someone asked to sign (approved, not Legacy) must
  -- have signed the Road Rules, unless nothing is published yet.
  if target.approval = 'approved' and target.status <> 'legacy'
     and exists (select 1 from public.road_rules_versions)
     and not private.road_rules_signed(target.id) then
    raise exception 'They haven’t signed the Road Rules yet.';
  end if;
  -- And on a Big 4, 5.4's meetings rule (or the board's excuse).
  big4 := private.big4_problem(target.id, p_ride, true);
  if big4 is not null then raise exception '%', big4; end if;

  if target.id <> me and exists (
    select 1 from public.rsvps where ride_id = p_ride and member_id = target.id and answer = 'no'
  ) then
    raise exception 'They said they can’t make it.';
  end if;
  if p_role <> 'officer' and not manages and exists (
    select 1 from public.ride_crew where ride_id = p_ride and role = p_role and member_id <> target.id
  ) then
    raise exception 'That spot’s taken.';
  end if;
  if p_role <> 'officer' then
    delete from public.ride_crew where ride_id = p_ride and role = p_role and member_id <> target.id;
  end if;
  insert into public.ride_crew (ride_id, member_id, role, assigned_by, assigned_at)
  values (p_ride, target.id, p_role, me, now())
  on conflict (ride_id, member_id) do update
    set role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
  insert into public.rsvps (ride_id, member_id, answer) values (p_ride, target.id, 'going')
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_exemption(p_session uuid, p_member uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  why text := left(nullif(trim(p_reason), ''), 200);
begin
  if not exists (select 1 from public.checkin_sessions where id = p_session) then
    raise exception 'That check-in no longer exists.';
  end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only their chapter’s board can excuse them.'; end if;
  if p_member = me then raise exception 'Someone else on the board has to excuse you.'; end if;
  if why is not null and exists (select 1 from public.attendance where session_id = p_session and member_id = p_member) then
    raise exception 'They checked in, so there’s nothing to excuse.';
  end if;
  if why is null then
    delete from public.attendance_exemptions where session_id = p_session and member_id = p_member;
  else
    insert into public.attendance_exemptions (session_id, member_id, reason, granted_by) values (p_session, p_member, why, me)
    on conflict (session_id, member_id) do update set reason = excluded.reason, granted_by = excluded.granted_by, granted_at = now();
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_fee_rate(p_chapter uuid, p_fy integer, p_status member_status, p_amount_cents integer, p_due_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_set_fees(p_chapter) then
    raise exception 'Only that chapter’s board sets its fees.';
  end if;
  if p_status not in ('full', 'nomad', 'fng', 'supporter', 'family') then raise exception 'That status doesn’t pay fees.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_due_on is null then raise exception 'Pick a due date.'; end if;
  insert into public.fee_rates (chapter_id, fy, status, amount_cents, due_on)
  values (p_chapter, p_fy, p_status, p_amount_cents, p_due_on)
  on conflict (chapter_id, fy, status) do update set amount_cents = excluded.amount_cents, due_on = excluded.due_on;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_meeting_type(p_session uuid, p_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session for update;
  if not found then raise exception 'That check-in no longer exists.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  if s.kind <> 'meeting' then raise exception 'Only a meeting check-in has a kind.'; end if;
  if p_type is null or p_type not in ('ordinary', 'special', 'event') then raise exception 'Pick what kind of meeting it is.'; end if;
  if s.held_on <= private.club_date() then raise exception 'A meeting’s kind is set before the day it’s held (4.6).'; end if;
  update public.checkin_sessions set meeting_type = p_type where id = p_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_status(p_member uuid, p_status member_status, p_by_request boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.members%rowtype;
  today date := private.club_date();
  notice uuid;
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such member.'; end if;
  -- Bringing an approved Supporter, Family or Legacy member back to Full or Nomad is the NEC's (5.6);
  -- every other change, an applicant's approval first of all, is their chapter board's (8.2).
  if p_status in ('full', 'nomad') and target.status not in ('full', 'nomad', 'fng') and target.approval = 'approved' then
    if not private.is_national() then raise exception 'Only the NEC can bring someone back to Full or Nomad (5.6).'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if not private.has_carried_reinstate_vote(p_member) then
      raise exception 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
    end if;
  else
    if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can change this member’s status.'; end if;
    if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
    if p_status in ('full', 'nomad') and target.status = 'fng' and not private.has_carried_patch_vote(p_member) then
      raise exception 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
    end if;
  end if;
  if p_status = 'fng' and private.is_learner(p_member) then
    raise exception 'A learner permit rider can’t become an FNG yet (3.2).';
  end if;
  if p_status not in ('full', 'nomad') and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null and role <> 'founder'
  ) then
    raise exception 'End their positions first.';
  end if;
  if p_status = 'nomad' and exists (
    select 1 from public.positions where member_id = p_member and ended_on is null
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                   'nec_chair', 'nec_secretary', 'nec_auditor')
  ) then
    raise exception 'End their board and national seats first (9.1).';
  end if;
  -- Moving an FNG, Full Member or Nomad down to Supporter, Legacy or FNG follows a 5.5 notice the board
  -- has decided in the last 90 days, unless the board records that the member asked for it (L2, widened
  -- from Supporter alone by the 31 Oct 2026 deep audit, F2). Nomad is sideways, not down. The NEC's 5.6
  -- branch above never moves anyone down, so this is the board's gate alone.
  if p_status in ('supporter', 'legacy', 'fng') and target.status in ('fng', 'full', 'nomad') and p_status <> target.status
     and not coalesce(p_by_request, false) then
    select id into notice from public.status_notices
    where member_id = p_member and outcome = 'decided' and closed_on >= today - 90
    order by closed_on desc, given_on desc
    limit 1;
    if notice is null then
      raise exception 'Moving them down to Supporter, Legacy or FNG follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
    end if;
  end if;

  update public.members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, today) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, today) else patched_on end,
    on_hiatus = case when p_status = 'legacy' then false else on_hiatus end,
    updated_at = now()
  where id = p_member;
  insert into public.status_changes (member_id, chapter_id, from_status, to_status, by_request, notice_id, changed_by)
  values (p_member, target.chapter_id, target.status, p_status, coalesce(p_by_request, false), notice, auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_opening(p_chapter uuid, p_fy integer, p_amount_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_books(p_chapter);
begin
  if p_fy is null or p_fy < 2019 or p_fy > 2100 then raise exception 'Pick a financial year.'; end if;
  if p_amount_cents is null then raise exception 'Enter an amount.'; end if;
  update public.fund_openings set amount_cents = p_amount_cents, set_by = me, set_at = now()
  where chapter_id is not distinct from p_chapter and fy = p_fy;
  if not found then
    insert into public.fund_openings (chapter_id, fy, amount_cents, set_by) values (p_chapter, p_fy, p_amount_cents, me);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_payment_details(p_chapter uuid, p_payid text, p_payid_name text, p_bsb text, p_account_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  insert into public.payment_details (chapter_id, payid, payid_name, bsb, account_no)
  values (p_chapter, nullif(trim(p_payid), ''), nullif(trim(p_payid_name), ''), nullif(trim(p_bsb), ''), nullif(trim(p_account_no), ''))
  on conflict (chapter_id) do update set payid = excluded.payid, payid_name = excluded.payid_name, bsb = excluded.bsb,
    account_no = excluded.account_no, updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_ride_called_off(p_id uuid, p_off boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_ride_route(p_ride uuid, p_route uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_rsvp(p_ride uuid, p_answer rsvp_answer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  closes timestamptz;
  big4 text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, before rsvps or ride_crew, the same lock as set_crew and leave_crew take:
  -- otherwise a manager moving a member while that member answers could deadlock.
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  -- An all-day ride takes answers until its first day is over.
  closes := case when ride.all_day
                 then ((ride.starts_at at time zone 'Australia/Melbourne') + interval '1 day') at time zone 'Australia/Melbourne'
                 else ride.starts_at end;
  if closes <= now() then raise exception 'That ride has already started.'; end if;
  if p_answer is null then raise exception 'Pick an answer.'; end if;
  -- The Going gate: someone asked to sign (approved, not Legacy) says Going only once they've signed
  -- the Road Rules, unless nothing is published yet. Maybe and Can't make it always work.
  if p_answer = 'going'
     and exists (select 1 from public.members m where m.id = me and m.approval = 'approved' and m.status <> 'legacy')
     and exists (select 1 from public.road_rules_versions)
     and not private.road_rules_signed(me) then
    raise exception 'Sign the Road Rules first.';
  end if;
  -- A Big 4 takes Going only from FNGs, Full Members and Nomads who meet 5.4 or were excused.
  if p_answer = 'going' then
    big4 := private.big4_problem(me, p_ride, false);
    if big4 is not null then raise exception '%', big4; end if;
  end if;

  insert into public.rsvps (ride_id, member_id, answer) values (p_ride, me, p_answer)
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
  if p_answer <> 'going' then
    delete from public.ride_crew where ride_id = p_ride and member_id = me;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_shop_design(p_id uuid, p_name text, p_eligibility text, p_blurb text, p_sort integer, p_on_sale boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_runs_shop();
  n text := private.trim_like_app(coalesce(p_name, ''));
  b text := private.trim_like_app(coalesce(p_blurb, ''));
  new_id uuid;
begin
  if p_id is not null and not exists (select 1 from public.shop_designs where id = p_id) then raise exception 'No such design.'; end if;
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if p_eligibility is null or p_eligibility not in ('any', 'patched', 'family') then raise exception 'Pick who the design is for.'; end if;
  if char_length(b) > 300 then raise exception 'Keep the blurb to 300 characters at most.'; end if;
  if p_sort is null then raise exception 'Sort order is a whole number.'; end if;
  if p_id is null then
    insert into public.shop_designs (name, eligibility, blurb, sort, on_sale, updated_by)
    values (n, p_eligibility, nullif(b, ''), p_sort, coalesce(p_on_sale, true), me) returning id into new_id;
    return new_id;
  end if;
  update public.shop_designs set name = n, eligibility = p_eligibility, blurb = nullif(b, ''), sort = p_sort,
    on_sale = coalesce(p_on_sale, true), updated_by = me, updated_at = now() where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_shop_garment(p_id uuid, p_design uuid, p_name text, p_price_cents integer, p_sizes text[], p_colours text[], p_sort integer, p_on_sale boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n text := private.trim_like_app(coalesce(p_name, ''));
  sz text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_sizes, '{}')) with ordinality as t(x, i) order by i);
  co text[] := array(select private.trim_like_app(x) from unnest(coalesce(p_colours, '{}')) with ordinality as t(x, i) order by i);
  new_id uuid;
begin
  perform private.require_runs_shop();
  if not exists (select 1 from public.shop_designs where id = p_design) then raise exception 'No such design.'; end if;
  if p_id is not null and not exists (select 1 from public.shop_garments where id = p_id and design_id = p_design) then
    raise exception 'No such garment.';
  end if;
  if n = '' then raise exception 'Name it.'; end if;
  if char_length(n) > 60 then raise exception 'Keep the name to 60 characters at most.'; end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then raise exception 'Enter a price from $0.01 to $1,000.'; end if;
  if not private.shop_list_ok(sz, 12, 10) then raise exception 'Keep sizes to 10 characters, no repeats, 12 at most.'; end if;
  if not private.shop_list_ok(co, 12, 20) then raise exception 'Keep colours to 20 characters, no repeats, 12 at most.'; end if;
  if p_sort is null then raise exception 'Sort order is a whole number.'; end if;
  if p_id is null then
    insert into public.shop_garments (design_id, name, price_cents, sizes, colours, sort, on_sale)
    values (p_design, n, p_price_cents, sz, co, p_sort, coalesce(p_on_sale, true)) returning id into new_id;
    return new_id;
  end if;
  update public.shop_garments set name = n, price_cents = p_price_cents, sizes = sz, colours = co, sort = p_sort,
    on_sale = coalesce(p_on_sale, true) where id = p_id;
  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_shop_shipping(p_state text, p_method text, p_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st text := upper(private.trim_like_app(coalesce(p_state, '')));
begin
  perform private.require_runs_shop();
  if st not in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA') then raise exception 'Pick a state.'; end if;
  if p_method is null or p_method not in ('standard', 'express') then raise exception 'Pick Standard or Express.'; end if;
  if p_cents is null or p_cents < 0 or p_cents > 100000 then raise exception 'Enter a shipping cost from $0 to $1,000.'; end if;
  insert into public.shop_shipping (state, method, cents) values (st, p_method, p_cents)
  on conflict (state, method) do update set cents = excluded.cents;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_site_photo_crew(p_member uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  t public.members%rowtype;
  on_crew boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.manages_site_photo_crew() then
    raise exception 'Only the Social Media Officer or the NEC can change the website photo crew.';
  end if;
  select * into t from public.members where id = p_member;
  if not found or t.approval <> 'approved' then raise exception 'Only approved members can join the crew.'; end if;
  on_crew := exists (select 1 from public.site_photo_crew where member_id = p_member);
  if coalesce(p_on, false) then
    if t.on_hiatus then raise exception 'Members on hiatus can’t join the crew.'; end if;
    if on_crew then raise exception 'They’re already on the crew.'; end if;
    insert into public.site_photo_crew (member_id, added_by) values (p_member, me);
  else
    if not on_crew then raise exception 'They’re not on the crew.'; end if;
    delete from public.site_photo_crew where member_id = p_member;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_skills(p_skills text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  clean public.help_skill[];
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_skills is null or exists (
    select 1 from unnest(p_skills) s
    where s is null or s not in (select unnest(enum_range(null::public.help_skill))::text)
  ) then
    raise exception 'That isn’t one of the skills.';
  end if;
  select coalesce(array_agg(s::public.help_skill order by first_at), '{}') into clean
  from (select s, min(i) as first_at from unnest(p_skills) with ordinality as u(s, i) group by s) once;

  insert into public.member_skills (member_id, skills, updated_at) values (me, clean, now())
  on conflict (member_id) do update set skills = excluded.skills, updated_at = excluded.updated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_chapter_proposal(p_id uuid, p_vote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); p public.chapter_proposals := private.open_chapter_proposal(p_id);
  v public.votes; problem text; new_id uuid;
begin
  if not private.is_national() then raise exception 'Only the NEC can approve a new chapter (12.1).'; end if;
  select * into v from public.votes where id = p_vote and chapter_id is null and electorate = 'nec'
    and closed_at is not null and opened_at > p.proposed_at and not private.vote_used(id);
  if not found then raise exception 'Pick the NEC’s closed vote on it (12.1).'; end if;
  if v.result is distinct from 'carried' then
    update public.chapter_proposals set status = 'not_approved', vote_id = v.id, decided_by = me, decided_at = now() where id = p.id;
    return null;
  end if;
  if private.chapter_name_taken(p.name, p.id) then raise exception 'There’s already a chapter called that.'; end if;
  problem := private.founders_problem(p.founder_ids, p.president_id, p.saa_id);
  if problem is not null then raise exception '%', problem; end if;
  if exists (select 1 from public.positions where member_id = any (p.founder_ids) and ended_on is null
             and chapter_id is not null and role <> 'founder') then
    raise exception 'Founders have to end their positions in their old chapter first.';
  end if;
  insert into public.chapters (slug, name, area, state) values (private.slug_of(p.name), p.name, p.area, p.state)
  returning id into new_id;
  update public.members set chapter_id = new_id where id = any (p.founder_ids);
  insert into public.positions (member_id, chapter_id, role, started_on) values
    (p.president_id, new_id, 'president', private.club_date()),
    (p.saa_id, new_id, 'sergeant_at_arms', private.club_date());
  update public.chapter_proposals set status = 'approved', vote_id = v.id, decided_by = me, decided_at = now(), chapter_id = new_id
  where id = p.id;
  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.share_minutes(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.meetings%rowtype := private.meeting_for_action(p_id);
begin
  if m.minutes_approved_at is not null then raise exception 'Those minutes are approved and locked.'; end if;
  if m.starts_at > now() then raise exception 'The meeting hasn’t happened yet.'; end if;
  if nullif(trim(m.minutes), '') is null then raise exception 'Write the minutes first.'; end if;
  if m.minutes_shared_at is not null then raise exception 'The draft is already out to members.'; end if;
  update public.meetings set minutes_shared_at = now() where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shared_phones()
 RETURNS TABLE(member_id uuid, phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select mp.member_id, mp.phone
  from public.member_private mp
  join public.members m on m.id = mp.member_id
  where mp.phone is not null
    and (
      mp.member_id = auth.uid()
      or private.sees_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and private.is_approved_member())
    );
$function$
;

CREATE OR REPLACE FUNCTION public.shop_order_sent(p_order uuid, p_ok boolean, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_ok then
    update public.shop_orders set status = 'sent', make_sent_at = now(), make_error = null where id = p_order and status = 'held';
  else
    update public.shop_orders set make_error = left(coalesce(p_error, 'Make did not accept the order.'), 500) where id = p_order and status = 'held';
  end if;
  if not found then raise exception 'No such order.'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shop_orders()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select jsonb_agg(private.shop_order_json(o) order by o.ordered_at desc)
    from public.shop_orders o where private.sees_shop_order(o)), '[]'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.sign_document(p_version uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := private.require_member(); v public.document_versions; doc public.documents;
begin
  select * into v from public.document_versions where id = p_version;
  if not found then raise exception 'That version isn’t in the library.'; end if;
  select * into doc from public.documents where id = v.document_id;
  if not doc.asks_sign_off then raise exception 'This document doesn’t ask for sign-off.'; end if;
  if not exists (select 1 from public.members where id = me and status <> 'legacy'
                 and (doc.chapter_id is null or chapter_id = doc.chapter_id)) then
    raise exception 'You’re not asked to sign this document.';
  end if;
  if private.document_in_force(doc.id, private.club_date()) is distinct from p_version then
    raise exception 'That version isn’t the one in force. Open the document again, then sign.';
  end if;
  insert into public.document_signoffs (version_id, member_id) values (p_version, me)
  on conflict (version_id, member_id) do update set signed_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sign_road_rules(p_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  current_number int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform pg_advisory_xact_lock_shared(hashtext('road_rules_publish'));
  select max(number) into current_number from public.road_rules_versions;
  if current_number is null then raise exception 'There are no Road Rules to sign yet.'; end if;
  if p_version is null or p_version <> current_number then
    raise exception 'The Road Rules changed while you had them open. Read the new version, then sign.';
  end if;

  insert into public.road_rules_signoffs (member_id, version, signed_at) values (me, current_number, now())
  on conflict (member_id) do update set version = excluded.version, signed_at = excluded.signed_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sign_up_charity(p_ride uuid, p_riding boolean, p_pillion boolean, p_guests integer, p_guest_names text, p_job text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

