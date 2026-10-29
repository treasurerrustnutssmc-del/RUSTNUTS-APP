-- Invites to and from other clubs. Other clubs ask Rustnuts to their rides and events (invites in:
-- any member passes one on, the board or Ride Committee answers for the club and says how it goes
-- on the club calendar), and the board or Ride Committee asks other clubs to the club's own rides
-- (invites out). The app sends nothing to anyone: invitations and replies are text members share
-- themselves. Everything changes only through save_other_club, archive_other_club, save_invite_in,
-- invite_club, answer_invite and archive_invite, which apply the same checks with the same words as
-- src/domain/invites.ts, in the same order. Nothing is ever deleted: taking off archives, with who.

create table public.other_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  town text check (char_length(town) between 1 and 60),
  -- Who to talk to: a name, a phone number, a Facebook page.
  contact text check (char_length(contact) between 1 and 200),
  note text check (char_length(note) between 1 and 300),
  -- Whoever added it may leave; the club stays on the list.
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null
);
-- One of each name on the list at a time (a club taken off can come back).
create unique index other_clubs_name on public.other_clubs (lower(name)) where archived_at is null;

create type public.invite_direction as enum ('in', 'out');
create type public.invite_answer as enum ('waiting', 'yes', 'no');

create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  direction public.invite_direction not null,
  club_id uuid not null references public.other_clubs (id),
  -- Whose invite: a chapter's, or the whole club's (null). An outgoing one takes its ride's.
  chapter_id uuid references public.chapters (id),
  -- Out: the club's ride they're asked to. In: the calendar ride it became, once linked.
  ride_id uuid references public.rides (id),
  -- In only: the event as the other club described it.
  title text check (char_length(title) between 1 and 80),
  event_on date,
  place text check (char_length(place) between 1 and 120),
  details text check (char_length(details) between 1 and 1000),
  answer public.invite_answer not null default 'waiting',
  -- In, answered yes: the website calendar's label for it.
  calendar_label public.ride_category check (calendar_label in ('supported', 'non_nuts')),
  -- Out, answered yes: how many bikes they're bringing, when they said.
  bikes int check (bikes between 1 and 500),
  note text check (char_length(note) between 1 and 300),
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  answered_by uuid references public.members (id) on delete set null,
  answered_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.members (id) on delete set null,
  check (direction = 'out' or (title is not null and event_on is not null)),
  check (direction = 'in' or (ride_id is not null and title is null and event_on is null and place is null and details is null)),
  check (calendar_label is null or (direction = 'in' and answer = 'yes')),
  check (bikes is null or (direction = 'out' and answer = 'yes'))
);
create index club_invites_ride on public.club_invites (ride_id);
create index club_invites_club on public.club_invites (club_id);
-- A club is asked to a ride once at a time.
create unique index club_invites_once on public.club_invites (ride_id, club_id)
  where direction = 'out' and archived_at is null;
-- A calendar ride is the event of one incoming invite at a time.
create unique index club_invites_one_event on public.club_invites (ride_id)
  where direction = 'in' and archived_at is null;

-- Approved members read what hasn't been taken off; nobody writes through the API.
alter table public.other_clubs enable row level security;
alter table public.club_invites enable row level security;
revoke all on public.other_clubs, public.club_invites from public, anon, authenticated;
grant select on public.other_clubs, public.club_invites to authenticated;
create policy other_clubs_for_members on public.other_clubs for select to authenticated
  using (private.is_approved_member() and archived_at is null);
create policy club_invites_for_members on public.club_invites for select to authenticated
  using (private.is_approved_member() and archived_at is null);

-- ---------------------------------------------------------------------------------------------
-- Who may do what

-- Whoever added it, any chapter's board or Ride Committee, or the NEC. Same as canEditClub.
create or replace function private.can_edit_other_club(p_added_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member()
    and (coalesce(p_added_by = auth.uid(), false) or private.manages_chapter_rides(null));
$$;
revoke all on function private.can_edit_other_club(uuid) from public, anon, authenticated;

-- Who answers for the club: the invite's chapter's ride managers (any chapter's for a whole-club
-- one), which for an outgoing invite are its ride's, since it takes its ride's chapter. Same as canAnswer.
create or replace function private.manages_invite(i public.club_invites)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_chapter_rides(i.chapter_id);
$$;
revoke all on function private.manages_invite(public.club_invites) from public, anon, authenticated;

-- Its managers; or, for an incoming invite still waiting, whoever passed it on. Same as canChangeInvite.
create or replace function private.can_change_invite(i public.club_invites)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    coalesce(i.direction = 'in' and i.answer = 'waiting' and i.added_by = auth.uid(), false) or private.manages_invite(i)
  );
$$;
revoke all on function private.can_change_invite(public.club_invites) from public, anon, authenticated;

-- A club an invite can name: on the list.
create or replace function private.check_club_on_list(p_club uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  c public.other_clubs%rowtype;
begin
  select * into c from public.other_clubs where id = p_club;
  if not found then raise exception 'No such club.'; end if;
  if c.archived_at is not null then raise exception 'That club is off the list.'; end if;
end;
$$;
revoke all on function private.check_club_on_list(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Actions

-- Adds a club to the list (p_id null) or changes one, returning its id.
create or replace function public.save_other_club(p_id uuid, p_name text, p_town text, p_contact text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- Takes a club off the list. Its invites stay.
create or replace function public.archive_other_club(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.other_clubs%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into c from public.other_clubs where id = p_id for update;
  if not found then raise exception 'No such club.'; end if;
  if c.archived_at is not null then raise exception 'That club is already off the list.'; end if;
  if not private.can_edit_other_club(c.added_by) then
    raise exception 'Only whoever added it, the board or the Ride Committee can change it.';
  end if;
  update public.other_clubs set archived_at = now(), archived_by = me where id = p_id;
end;
$$;

-- Passes on an invite from another club (p_id null) or changes one, returning its id. The date
-- comes as text so a date that isn't real gets the app's words rather than a cast error. p_ride
-- links it to its ride on the club calendar once it's there.
create or replace function public.save_invite_in(
  p_id uuid, p_club uuid, p_chapter uuid, p_title text, p_event_on text, p_place text, p_details text, p_ride uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- Records that another club was invited to one of the club's own rides, returning its id. The
-- member sends the invitation themselves; this sends nothing.
create or replace function public.invite_club(p_ride uuid, p_club uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rides%rowtype;
  c_note text := nullif(private.trim_like_app(p_note), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into r from public.rides where id = p_ride;
  if not found then raise exception 'No such ride.'; end if;
  if r.category not in ('north', 'west', 'club') then raise exception 'Only the club’s own rides can go out as invites.'; end if;
  if r.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  if private.ride_last_day(r) < private.club_date() then raise exception 'That ride has been and gone.'; end if;
  if not private.manages_ride(p_ride) then
    raise exception 'Only the ride’s board or Ride Committee can invite other clubs.';
  end if;
  perform private.check_club_on_list(p_club);
  if exists (select 1 from public.club_invites
             where direction = 'out' and ride_id = p_ride and club_id = p_club and archived_at is null) then
    raise exception 'That club has already been invited to this ride.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  begin
    insert into public.club_invites (direction, club_id, chapter_id, ride_id, note, added_by)
    values ('out', p_club,
            (select c.id from public.chapters c where r.category in ('north', 'west') and c.slug = r.category::text),
            p_ride, c_note, me)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'That club has already been invited to this ride.';
  end;
  return new_id;
end;
$$;

-- Answers an invite for the club (in), or records the other club's reply (out). Waiting clears it.
-- A label only counts on an incoming yes, bikes only on an outgoing yes.
create or replace function public.answer_invite(p_id uuid, p_answer text, p_label text, p_bikes numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.club_invites%rowtype;
  c_note text := nullif(private.trim_like_app(p_note), '');
  is_yes boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into i from public.club_invites where id = p_id for update;
  if not found then raise exception 'No such invite.'; end if;
  if i.archived_at is not null then raise exception 'That invite has been taken off.'; end if;
  if not private.manages_invite(i) then raise exception 'Only the board or Ride Committee can answer invites.'; end if;
  if p_answer is null or p_answer not in ('waiting', 'yes', 'no') then raise exception 'Pick an answer.'; end if;
  is_yes := p_answer = 'yes';
  if i.direction = 'in' and is_yes and (p_label is null or p_label not in ('supported', 'non_nuts')) then
    raise exception 'Pick how it goes on the club calendar.';
  end if;
  if i.direction = 'out' and is_yes and p_bikes is not null
     and (p_bikes <> trunc(p_bikes) or p_bikes < 1 or p_bikes > 500) then
    raise exception 'Bikes expected must be a whole number from 1 to 500.';
  end if;
  if char_length(c_note) > 300 then raise exception 'Keep the note to 300 characters at most.'; end if;

  update public.club_invites
  set answer = p_answer::public.invite_answer,
      calendar_label = case when i.direction = 'in' and is_yes then p_label::public.ride_category end,
      bikes = case when i.direction = 'out' and is_yes then p_bikes::int end,
      -- An incoming invite that's no longer a yes lets go of its calendar ride.
      ride_id = case when i.direction = 'in' and not is_yes then null else i.ride_id end,
      note = c_note,
      answered_by = case when p_answer = 'waiting' then null else me end,
      answered_at = case when p_answer = 'waiting' then null else now() end
  where id = p_id;
end;
$$;

-- Takes an invite off. It's kept, archived, with who took it off.
create or replace function public.archive_invite(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.club_invites%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into i from public.club_invites where id = p_id for update;
  if not found then raise exception 'No such invite.'; end if;
  if i.archived_at is not null then raise exception 'That invite has already been taken off.'; end if;
  if not private.can_change_invite(i) then raise exception 'Only the board or Ride Committee can change that invite.'; end if;
  update public.club_invites set archived_at = now(), archived_by = me where id = p_id;
end;
$$;

revoke all on function
  public.save_other_club(uuid, text, text, text, text), public.archive_other_club(uuid),
  public.save_invite_in(uuid, uuid, uuid, text, text, text, text, uuid), public.invite_club(uuid, uuid, text),
  public.answer_invite(uuid, text, text, numeric, text), public.archive_invite(uuid)
from public, anon;
grant execute on function
  public.save_other_club(uuid, text, text, text, text), public.archive_other_club(uuid),
  public.save_invite_in(uuid, uuid, uuid, text, text, text, text, uuid), public.invite_club(uuid, uuid, text),
  public.answer_invite(uuid, text, text, numeric, text), public.archive_invite(uuid)
to authenticated;
