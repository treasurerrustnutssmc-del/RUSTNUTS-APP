-- The Going gate (docs/superpowers/specs/2026-10-25-road-rules-going-gate-design.md). A member
-- who's asked to sign the Road Rules (approved, not Legacy) can't say Going, or be put on a ride's
-- crew, while their Road Rules are unsigned or expired. Due soon still counts as signed, and with
-- nothing published nobody is stopped. Answers and crew spots already there stay.
--
-- set_crew and set_rsvp are as in 20261024130000_ride_crew.sql, each with one added check, in the
-- same words and place as src/domain/roadRules.ts and src/domain/crew.ts: set_rsvp's after its
-- other checks, set_crew's after its eligibility checks. Grants are unchanged.

-- The checks below read the Road Rules, which PL/pgSQL only looks up when a function runs. Pasted
-- before road-rules.sql, this would apply cleanly and then break every answer, so it refuses first.
do $$
begin
  if to_regclass('public.road_rules_versions') is null
     or to_regprocedure('private.road_rules_signed(uuid)') is null then
    raise exception 'Paste road-rules.sql first.';
  end if;
end $$;

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
  -- The Going gate: crewing makes them Going, so someone asked to sign (approved, not Legacy) must
  -- have signed the Road Rules, unless nothing is published yet.
  if target.approval = 'approved' and target.status <> 'legacy'
     and exists (select 1 from public.road_rules_versions)
     and not private.road_rules_signed(target.id) then
    raise exception 'They haven’t signed the Road Rules yet.';
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

revoke all on function public.set_crew(uuid, uuid, public.crew_role) from public, anon;
grant execute on function public.set_crew(uuid, uuid, public.crew_role) to authenticated;

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
  -- The Going gate: someone asked to sign (approved, not Legacy) says Going only once they've signed
  -- the Road Rules, unless nothing is published yet. Maybe and Can't make it always work.
  if p_answer = 'going'
     and exists (select 1 from public.members m where m.id = me and m.approval = 'approved' and m.status <> 'legacy')
     and exists (select 1 from public.road_rules_versions)
     and not private.road_rules_signed(me) then
    raise exception 'Sign the Road Rules first.';
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
