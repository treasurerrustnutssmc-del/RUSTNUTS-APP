-- Ride crew: who's Road Captain, Tail Gunner, Assistant Tail Gunner and Officers on each ride.
-- See docs/superpowers/specs/2026-10-24-ride-crew-design.md. Members change the crew only through
-- set_crew and leave_crew, which apply the same rules with the same words as src/domain/crew.ts,
-- checked in the same order.

create type public.crew_role as enum ('road_captain', 'tail_gunner', 'assistant_tail_gunner', 'officer');

create table public.ride_crew (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  role public.crew_role not null,
  assigned_by uuid references public.members (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (ride_id, member_id)
);
-- One RC, one TG and one ATG per ride; any number of Officers.
create unique index ride_crew_one_per_spot on public.ride_crew (ride_id, role) where role <> 'officer';
create index ride_crew_member on public.ride_crew (member_id);

alter table public.ride_crew enable row level security;
revoke all on public.ride_crew from public, anon, authenticated;
grant select on public.ride_crew to authenticated;
create policy ride_crew_for_members on public.ride_crew for select to authenticated using (private.is_approved_member());

-- Who manages a ride's crew: anyone on the NEC; for a North or West ride, that chapter's board or
-- Ride Committee; for any other ride, any chapter's board or Ride Committee. Same as managesRide.
create or replace function private.manages_ride(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.rides r
      join public.positions p on p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'ride_committee')
      left join public.chapters c on c.slug = r.category::text
      where r.id = p_ride
        and (r.category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$$;
revoke all on function private.manages_ride(uuid) from public, anon;
grant execute on function private.manages_ride(uuid) to authenticated;

-- Puts a member in a crew spot on a ride. A manager's pick replaces whoever held a single spot;
-- moving to another spot replaces your old one. Joining the crew means going.
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

-- Takes a member off a ride's crew: yourself, or anyone if you manage the crew.
create or replace function public.leave_crew(p_ride uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  first_day_end timestamptz;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, the same lock as set_crew and set_rsvp take (see set_crew).
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  first_day_end := ((date(ride.starts_at at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The crew can’t change after the ride day.'; end if;

  if p_member is distinct from me and not private.manages_ride(p_ride) then
    raise exception 'Only the board or ride committee can take someone else off the crew.';
  end if;
  delete from public.ride_crew where ride_id = p_ride and member_id = p_member;
  if not found then raise exception 'They’re not on the crew.'; end if;
end;
$$;

revoke all on function public.set_crew(uuid, uuid, public.crew_role), public.leave_crew(uuid, uuid) from public, anon;
grant execute on function public.set_crew(uuid, uuid, public.crew_role), public.leave_crew(uuid, uuid) to authenticated;

-- set_rsvp as before, plus: an answer other than Going takes you off that ride's crew.
create or replace function public.set_rsvp(p_ride uuid, p_answer public.rsvp_answer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  closes timestamptz;
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

  insert into public.rsvps (ride_id, member_id, answer) values (p_ride, me, p_answer)
  on conflict (ride_id, member_id) do update set answer = excluded.answer, updated_at = now();
  if p_answer <> 'going' then
    delete from public.ride_crew where ride_id = p_ride and member_id = me;
  end if;
end;
$$;
revoke all on function public.set_rsvp(uuid, public.rsvp_answer) from public, anon;
grant execute on function public.set_rsvp(uuid, public.rsvp_answer) to authenticated;

-- ride_calendar as before, plus the crew of the rides it shows.
create or replace function public.ride_calendar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today_start timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
begin
  if not private.is_approved_member() then
    return jsonb_build_object('rides', '[]'::jsonb, 'rsvps', '[]'::jsonb, 'synced_at', null);
  end if;
  return (
    with shown as (
      select * from public.rides
      where starts_at >= today_start or ends_at > today_start
    )
    select jsonb_build_object(
      'rides', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at, s.id) from shown s), '[]'::jsonb),
      'rsvps', coalesce((select jsonb_agg(to_jsonb(a) order by a.ride_id, a.member_id)
                         from public.rsvps a where a.ride_id in (select id from shown)), '[]'::jsonb),
      'crew', coalesce((select jsonb_agg(to_jsonb(k) order by k.ride_id, k.role, k.assigned_at)
                        from public.ride_crew k where k.ride_id in (select id from shown)), '[]'::jsonb),
      'synced_at', (select case when bool_and(last_ok_at is not null) then min(last_ok_at) end from private.ride_feeds)
    )
  );
end;
$$;
revoke all on function public.ride_calendar() from public, anon;
grant execute on function public.ride_calendar() to authenticated;
