-- Ride briefings: the Road Captain's part of each ride's briefing card (hazards, one-off changes to
-- the Road Rules, notes), and who has tapped Got it. Both are locked: members change them only
-- through save_briefing and read_briefing, which apply the same rules with the same words as
-- src/domain/briefings.ts, checked in the same order.

-- One briefing per ride, which goes with its ride. Who last changed it is kept loosely: a member
-- leaving the club leaves the briefing. The limits mirror save_briefing's; each hazard's length
-- (120 at most) is checked there only, since a check constraint can't look inside the list.
create table public.ride_briefings (
  ride_id uuid primary key references public.rides (id) on delete cascade,
  hazards text[] not null default '{}' check (cardinality(hazards) <= 12),
  changes text check (char_length(changes) <= 2000),
  notes text check (char_length(notes) <= 2000),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Who read which ride's briefing, and when. A read is current when it is at or after the
-- briefing's updated_at. It goes with its ride and with its member.
create table public.ride_briefing_reads (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (ride_id, member_id)
);
create index ride_briefing_reads_member on public.ride_briefing_reads (member_id);

-- Approved members read both; nobody writes either through the API.
alter table public.ride_briefings enable row level security;
alter table public.ride_briefing_reads enable row level security;
revoke all on public.ride_briefings, public.ride_briefing_reads from public, anon, authenticated;
grant select on public.ride_briefings, public.ride_briefing_reads to authenticated;
create policy ride_briefings_for_members on public.ride_briefings for select to authenticated
  using (private.is_approved_member());
create policy ride_briefing_reads_for_members on public.ride_briefing_reads for select to authenticated
  using (private.is_approved_member());

-- Writes a ride's briefing, or replaces it, until the ride's first Melbourne day is over. Briefing
-- writers are the ride's crew managers plus whoever holds its Road Captain crew spot. Texts are
-- trimmed like the app trims, blank hazard lines are left out, and lengths count characters.
create or replace function public.save_briefing(p_ride uuid, p_hazards text[], p_changes text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  first_day_end timestamptz;
  clean_hazards text[];
  clean_changes text;
  clean_notes text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  -- The ride row first, the same lock as set_crew, leave_crew, set_rsvp and set_ride_route take (see set_crew).
  select * into ride from public.rides where id = p_ride for no key update;
  if not found then raise exception 'No such ride.'; end if;
  if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
  first_day_end := ((date(ride.starts_at at time zone 'Australia/Melbourne') + 1)::timestamp at time zone 'Australia/Melbourne');
  if now() >= first_day_end then raise exception 'The briefing can’t change after the ride day.'; end if;
  if not (private.manages_ride(p_ride) or exists (
    select 1 from public.ride_crew where ride_id = p_ride and member_id = me and role = 'road_captain'
  )) then
    raise exception 'Only the board, ride committee or this ride’s Road Captain can write the briefing.';
  end if;

  select coalesce(array_agg(t.line order by t.n), '{}') into clean_hazards
  from unnest(p_hazards) with ordinality as h(raw, n)
  cross join lateral (select private.trim_like_app(h.raw) as line, h.n) t
  where t.line is not null and t.line <> '';
  clean_changes := nullif(private.trim_like_app(p_changes), '');
  clean_notes := nullif(private.trim_like_app(p_notes), '');

  if cardinality(clean_hazards) > 12 then raise exception 'That’s too many hazards (12 at most).'; end if;
  if exists (select 1 from unnest(clean_hazards) line where char_length(line) > 120) then
    raise exception 'Keep each hazard to one short line (120 characters at most).';
  end if;
  if char_length(clean_changes) > 2000 or char_length(clean_notes) > 2000 then
    raise exception 'That’s too long (2000 characters at most).';
  end if;
  if cardinality(clean_hazards) = 0 and clean_changes is null and clean_notes is null then
    raise exception 'Write at least one hazard, change or note.';
  end if;

  insert into public.ride_briefings (ride_id, hazards, changes, notes, updated_by, updated_at)
  values (p_ride, clean_hazards, clean_changes, clean_notes, me, now())
  on conflict (ride_id) do update
    set hazards = excluded.hazards, changes = excluded.changes, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- Got it: marks the ride's briefing read by you, now. It works at any time, on a cancelled or past
-- ride too, and reading again moves your read time to now.
create or replace function public.read_briefing(p_ride uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not exists (select 1 from public.rides where id = p_ride) then raise exception 'No such ride.'; end if;
  if not exists (select 1 from public.ride_briefings where ride_id = p_ride) then
    raise exception 'There’s no briefing for this ride yet.';
  end if;

  insert into public.ride_briefing_reads (ride_id, member_id, read_at) values (p_ride, me, now())
  on conflict (ride_id, member_id) do update set read_at = excluded.read_at;
end;
$$;

revoke all on function public.save_briefing(uuid, text[], text, text), public.read_briefing(uuid) from public, anon;
grant execute on function public.save_briefing(uuid, text[], text, text), public.read_briefing(uuid) to authenticated;

-- ride_calendar as before, plus the briefings and reads of the rides it shows.
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
      'ride_routes', coalesce((select jsonb_agg(jsonb_build_object('ride_id', rr.ride_id, 'route_id', rr.route_id)
                                                order by rr.ride_id)
                               from public.ride_routes rr
                               where rr.ride_id in (select id from shown) and rr.route_id is not null), '[]'::jsonb),
      'briefings', coalesce((select jsonb_agg(jsonb_build_object('ride_id', b.ride_id, 'hazards', to_jsonb(b.hazards),
                                                                 'changes', b.changes, 'notes', b.notes,
                                                                 'updated_by', b.updated_by, 'updated_at', b.updated_at)
                                              order by b.ride_id)
                             from public.ride_briefings b where b.ride_id in (select id from shown)), '[]'::jsonb),
      'briefing_reads', coalesce((select jsonb_agg(jsonb_build_object('ride_id', br.ride_id, 'member_id', br.member_id,
                                                                      'read_at', br.read_at)
                                                   order by br.ride_id, br.member_id)
                                  from public.ride_briefing_reads br where br.ride_id in (select id from shown)),
                                 '[]'::jsonb),
      'synced_at', (select case when bool_and(last_ok_at is not null) then min(last_ok_at) end from private.ride_feeds)
    )
  );
end;
$$;
revoke all on function public.ride_calendar() from public, anon;
grant execute on function public.ride_calendar() to authenticated;
