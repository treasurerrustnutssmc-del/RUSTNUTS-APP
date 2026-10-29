-- Big 4 RSVP rules and the 5.5 notice (constitution v4 4.12, 5.4, 5.5, 5.8).
-- Adds: who can say Going on a Big 4 (set_rsvp) or be put on its crew (set_crew); the board's
-- excuse from 5.4 for one Big 4; and the 5.5 notice a member gets before any status change is
-- proposed. Nothing here changes anyone's status or sends anything. The words match
-- src/domain/big4.ts and src/domain/notices.ts.
-- Spec: docs/superpowers/specs/2026-10-29-big4-rsvp-rules-and-notices-design.md

-- The checks below read the Big 4 tables, which PL/pgSQL only looks up when a function runs.
-- Pasted before attendance-big4.sql, this would apply cleanly and then break every answer.
do $$
begin
  if to_regclass('public.big4_rides') is null or to_regclass('public.attendance_exemptions') is null then
    raise exception 'Paste attendance-big4.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.big4_waivers (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  ground text not null check (ground in ('work', 'family', 'health', 'injury', 'distance')),
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (ride_id, member_id)
);
create index big4_waivers_member on public.big4_waivers (member_id);

create table public.status_notices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade, -- the member's when given
  about text not null check (about in ('attendance', 'dues')),
  record text not null check (char_length(record) between 1 and 2000),
  proposal text not null check (char_length(proposal) between 1 and 500),
  given_on date not null default private.club_date(),
  respond_by date not null,
  given_by uuid references public.members (id) on delete set null,
  response text check (char_length(response) <= 2000),
  responded_at timestamptz,
  outcome text check (outcome in ('withdrawn', 'decided')),
  outcome_note text check (char_length(outcome_note) <= 500),
  closed_on date,
  closed_by uuid references public.members (id) on delete set null
);
create index status_notices_member on public.status_notices (member_id);
-- One open notice per member and kind.
create unique index status_notices_one_open on public.status_notices (member_id, about) where outcome is null;
create index status_notices_chapter on public.status_notices (chapter_id);

alter table public.big4_waivers enable row level security;
alter table public.status_notices enable row level security;
revoke all on public.big4_waivers, public.status_notices from public, anon, authenticated;
grant select on public.big4_waivers, public.status_notices to authenticated;

-- Both can be personal (health, money): the member and their chapter's board.
create policy big4_waivers_read on public.big4_waivers for select to authenticated using (
  member_id = auth.uid() or private.is_board_of(private.chapter_of(member_id))
);
create policy status_notices_read on public.status_notices for select to authenticated using (
  member_id = auth.uid() or private.is_board_of(chapter_id)
);

-- ---------------------------------------------------------------------------
-- Who can ride a Big 4 (5.4, 5.8)
-- ---------------------------------------------------------------------------

-- Why this member can't say Going on (p_crew false), or be put on the crew of (p_crew true), this
-- ride under the Big 4 rules, or null. Not a Big 4: null. 5.4: two of the three most recent
-- official (ordinary or special) meetings of their chapter, held before the ride's date and by
-- today, skipping ones they were excused from and didn't come to; all of them if fewer than two.
-- On the same day, the ones they came to count first. The board's excuse for this ride clears it.
create or replace function private.big4_problem(p_member uuid, p_ride uuid, p_crew boolean)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  m public.members%rowtype;
  ride_day date;
  came int;
  held int;
  needed int;
  phrase text;
begin
  if not exists (select 1 from public.big4_rides where ride_id = p_ride) then return null; end if;
  select * into m from public.members where id = p_member;
  if not found then return null; end if;
  if not p_crew then
    if m.status = 'supporter' then return 'Supporters can’t join Big 4 Club-only rides (5.8).'; end if;
    if m.status not in ('fng', 'full', 'nomad') then return 'Big 4 rides are for FNGs, Full Members and Nomads (5.4).'; end if;
  end if;
  if exists (select 1 from public.big4_waivers where ride_id = p_ride and member_id = p_member) then return null; end if;
  select private.club_date(r.starts_at) into ride_day from public.rides r where r.id = p_ride;

  select count(*) filter (where recent.came), count(*) into came, held
  from (
    select exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = p_member) as came
    from public.checkin_sessions s
    where s.kind = 'meeting' and s.chapter_id = m.chapter_id and coalesce(s.meeting_type, 'ordinary') <> 'event'
      and s.held_on < ride_day and s.held_on <= private.club_date()
      and not (
        exists (select 1 from public.attendance_exemptions e where e.session_id = s.id and e.member_id = p_member)
        and not exists (select 1 from public.attendance a where a.session_id = s.id and a.member_id = p_member)
      )
    order by s.held_on desc, 1 desc
    limit 3
  ) recent;
  needed := least(2, held);
  if came >= needed then return null; end if;
  phrase := case when held = 1 then 'the last meeting' else needed || ' of the last ' || held || ' meetings' end;
  if p_crew then return 'They need ' || phrase || ' to ride this Big 4 (5.4).'; end if;
  return 'You need ' || phrase || ' to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.';
end;
$$;

-- set_rsvp as in 20261025180000_going_needs_road_rules.sql, with the Big 4 check after the Road Rules.
create or replace function public.set_rsvp(p_ride uuid, p_answer public.rsvp_answer)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.set_rsvp(uuid, public.rsvp_answer) from public, anon;
grant execute on function public.set_rsvp(uuid, public.rsvp_answer) to authenticated;

-- set_crew as in 20261025180000_going_needs_road_rules.sql, with the Big 4 check after the Road Rules.
create or replace function public.set_crew(p_ride uuid, p_member uuid, p_role public.crew_role)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.set_crew(uuid, uuid, public.crew_role) from public, anon;
grant execute on function public.set_crew(uuid, uuid, public.crew_role) to authenticated;

-- ---------------------------------------------------------------------------
-- The board's excuse from 5.4 for one Big 4. A ground excuses; null clears it.
-- ---------------------------------------------------------------------------

create or replace function public.set_big4_waiver(p_ride uuid, p_member uuid, p_ground text)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

-- ---------------------------------------------------------------------------
-- The 5.5 notice
-- ---------------------------------------------------------------------------

create or replace function public.give_status_notice(p_member uuid, p_about text, p_record text, p_proposal text, p_respond_by date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  rec text := private.trim_like_app(coalesce(p_record, ''));
  prop text := private.trim_like_app(coalesce(p_proposal, ''));
  new_id uuid;
begin
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only their chapter’s board can give them notice (5.5).'; end if;
  if p_member = me then raise exception 'Someone else on the board has to give you notice.'; end if;
  if target.approval <> 'approved' or target.status not in ('fng', 'full', 'nomad', 'supporter') then
    raise exception 'Notice is for FNGs, Full Members, Nomads and Supporters.';
  end if;
  if p_about is null or p_about not in ('attendance', 'dues') then raise exception 'Say what it’s about: attendance or dues.'; end if;
  if rec = '' then raise exception 'Set out the record.'; end if;
  if char_length(rec) > 2000 then raise exception 'Keep the record under 2000 characters.'; end if;
  if prop = '' then raise exception 'Say what’s proposed.'; end if;
  if char_length(prop) > 500 then raise exception 'Keep the proposal under 500 characters.'; end if;
  if p_respond_by is null then raise exception 'Pick a real date.'; end if;
  if p_respond_by < private.club_date() + 14 then raise exception 'Give them at least 14 days to respond (5.5).'; end if;
  if exists (select 1 from public.status_notices where member_id = p_member and about = p_about and outcome is null) then
    raise exception 'They already have an open notice about that.';
  end if;
  begin
    insert into public.status_notices (member_id, chapter_id, about, record, proposal, respond_by, given_by)
    values (p_member, target.chapter_id, p_about, rec, prop, p_respond_by, me)
    returning id into new_id;
  exception when unique_violation then
    -- Someone else on the board gave one at the same moment.
    raise exception 'They already have an open notice about that.';
  end;
  return new_id;
end;
$$;

create or replace function public.respond_to_notice(p_notice uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n public.status_notices%rowtype;
  reply text := private.trim_like_app(coalesce(p_response, ''));
begin
  select * into n from public.status_notices where id = p_notice for update;
  if not found then raise exception 'No such notice.'; end if;
  if me is null or n.member_id <> me then raise exception 'Only the member can reply to their notice.'; end if;
  if n.outcome is not null then raise exception 'That notice is closed.'; end if;
  if reply = '' then raise exception 'Write your reply.'; end if;
  if char_length(reply) > 2000 then raise exception 'Keep your reply under 2000 characters.'; end if;
  update public.status_notices set response = reply, responded_at = now() where id = p_notice;
end;
$$;

create or replace function public.close_status_notice(p_notice uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n public.status_notices%rowtype;
  note text := private.trim_like_app(coalesce(p_note, ''));
begin
  select * into n from public.status_notices where id = p_notice for update;
  if not found then raise exception 'No such notice.'; end if;
  if not private.is_board_of(n.chapter_id) then raise exception 'Only their chapter’s board can do that.'; end if;
  if n.member_id = me then raise exception 'Someone else on the board has to do that.'; end if;
  if n.outcome is not null then raise exception 'That notice is closed.'; end if;
  if p_outcome is null or p_outcome not in ('withdrawn', 'decided') then raise exception 'Pick withdrawn or decided.'; end if;
  if char_length(note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  if p_outcome = 'decided' and private.club_date() <= n.respond_by then
    raise exception 'The board decides after % (5.5).', to_char(n.respond_by, 'DD/MM/YYYY');
  end if;
  update public.status_notices
  set outcome = p_outcome, outcome_note = nullif(note, ''), closed_on = private.club_date(), closed_by = me
  where id = p_notice;
end;
$$;

revoke all on function private.big4_problem(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_big4_waiver(uuid, uuid, text), public.give_status_notice(uuid, text, text, text, date),
  public.respond_to_notice(uuid, text), public.close_status_notice(uuid, text, text) from public, anon;
grant execute on function public.set_big4_waiver(uuid, uuid, text), public.give_status_notice(uuid, text, text, text, date),
  public.respond_to_notice(uuid, text), public.close_status_notice(uuid, text, text) to authenticated;
