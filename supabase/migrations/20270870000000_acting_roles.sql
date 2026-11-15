-- Acting in a role, until a date (Jeff's card, 15 Nov 2026). A member acts in a chapter role until
-- a date: in an empty seat (9.8), or covering an away board holder, who stays seated (8.2, 9.5,
-- 11.2). They show as "Acting <Role>", do only that seat's duties for their own chapter, and the
-- stint ends on its own at Melbourne midnight after its until date, with no scheduled job.
-- See docs/superpowers/specs/2026-11-15-acting-roles-design.md and the plan beside it.
--
-- One section per part, each function in one place (later sections of this job edit their own):
-- §1 schema, views, locks and the lazy close · §2–§3 readers · §4 acting RPCs · §5 writers and
-- endings · §6 votes · §7 money · §8 tightenings for everyone.
--
-- Live: run once (it drops and renames an index), as one transaction (Supabase apply_migration),
-- before the app's over-the-air update.

-- §1 Schema, views, locks and the lazy close ---------------------------------------------------------

-- Requests for acting that wait for a third board member's confirm, or a board vote. member_id is
-- the stand-in; covers is the holder's row for a cover, null for an empty seat. Only the RPCs write
-- them.
create table public.acting_requests (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id),
  role public.position_role not null,
  member_id uuid not null references public.members (id) on delete cascade,
  covers uuid references public.positions (id),
  until date not null, -- the last acting day asked for
  why text not null,
  requested_by uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  outcome text,
  constraint request_why_short check (char_length(btrim(why)) between 1 and 120),
  constraint request_outcome_known check (outcome in ('confirmed', 'withdrawn', 'lapsed', 'rejected')),
  constraint request_closed_has_outcome check ((closed_at is null) = (outcome is null))
);

-- An acting row is a position: every read that asks "who holds this seat" finds it with no join.
alter table public.positions
  add column acting_until date,  -- the last acting day (inclusive); null = a normal term
  add column covers uuid references public.positions (id) on delete restrict, -- the holder's row a cover stands in for
  add column acting_why text,
  add column acting_vote uuid references public.votes (id),  -- the carried vote, when one was needed
  add column acting_request uuid references public.acting_requests (id), -- the request it was confirmed from
  add column ended_reason text,
  add constraint ended_reason_known check (ended_reason in
    ('stepped_down', 'holder_back', 'removed', 'replaced', 'lapsed', 'forgotten', 'renewed', 'left_board')),
  add constraint acting_until_after_start check (acting_until is null or acting_until >= started_on),
  add constraint acting_why_short check (acting_why is null or char_length(btrim(acting_why)) between 1 and 120),
  add constraint acting_in_a_chapter check (acting_until is null or chapter_id is not null), -- never national or Founder
  add constraint cover_is_acting check (covers is null or acting_until is not null),
  add constraint acting_has_why check ((acting_until is null) = (acting_why is null)),
  add constraint acting_end_has_reason check (acting_until is null or (ended_on is null) = (ended_reason is null));

-- Every change to a stint's date, and each stint a seat ending took with it. new_until is null when
-- the change ended the stint.
create table public.acting_changes (
  id bigint generated always as identity primary key,
  position_id uuid not null references public.positions (id),
  chapter_id uuid not null references public.chapters (id),
  old_until date,
  new_until date,
  changed_by uuid references public.members (id) on delete set null,
  changed_at timestamptz not null default now(),
  note text
);

-- An acting vote names its request. An NEC ballot belongs to a chapter, so it can pass to whoever
-- casts that chapter's NEC vote now (11.2).
alter table public.votes add column acting_request uuid references public.acting_requests (id);
alter table public.vote_electors add column for_chapter uuid references public.chapters (id);

-- The seat indexes. An elected holder and an empty-seat acting row still clash, as two elected rows
-- do; a cover sits beside the holder, one per seat.
create unique index one_holder_per_board_seat_v2
  on public.positions (chapter_id, role)
  where ended_on is null and covers is null
    and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain');
create unique index one_cover_per_board_seat
  on public.positions (chapter_id, role)
  where ended_on is null and covers is not null
    and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain');
drop index public.one_holder_per_board_seat;
alter index public.one_holder_per_board_seat_v2 rename to one_holder_per_board_seat;
-- One stint at a time.
create unique index one_acting_per_member on public.positions (member_id) where ended_on is null and acting_until is not null;
-- One open request per board seat.
create unique index one_open_request_per_seat
  on public.acting_requests (chapter_id, role)
  where closed_at is null
    and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain');

-- A covering index for every new foreign key (performance_tidy.sql).
create index positions_covers_idx on public.positions (covers) where covers is not null;
create index positions_acting_vote_idx on public.positions (acting_vote);
create index positions_acting_request_idx on public.positions (acting_request);
create index acting_requests_chapter_id_idx on public.acting_requests (chapter_id);
create index acting_requests_member_id_idx on public.acting_requests (member_id);
create index acting_requests_covers_idx on public.acting_requests (covers);
create index acting_requests_requested_by_idx on public.acting_requests (requested_by);
create index acting_changes_position_id_idx on public.acting_changes (position_id);
create index acting_changes_chapter_id_idx on public.acting_changes (chapter_id);
create index acting_changes_changed_by_idx on public.acting_changes (changed_by);
create index votes_acting_request_idx on public.votes (acting_request);
create index vote_electors_for_chapter_idx on public.vote_electors (for_chapter);

-- The chapter's board and the stand-in read a request; the board and the Auditor read changes.
-- Only the RPCs write either.
alter table public.acting_requests enable row level security;
alter table public.acting_changes enable row level security;
revoke all on public.acting_requests, public.acting_changes from public, anon, authenticated;
grant select on public.acting_requests, public.acting_changes to authenticated;
create policy acting_requests_read on public.acting_requests for select to authenticated
  using (private.is_board_of(chapter_id) or member_id = (select auth.uid()));
create policy acting_changes_read on public.acting_changes for select to authenticated
  using (private.is_board_of(chapter_id) or private.is_auditor());

-- Open NEC votes: each ballot belongs to the chapter of its elector's open President seat, else
-- their VP seat, else their own chapter.
update public.vote_electors e
set for_chapter = coalesce(
  (select p.chapter_id from public.positions p
   where p.member_id = e.member_id and p.ended_on is null and p.role in ('president', 'vice_president')
   order by (p.role = 'president') desc, p.started_on
   limit 1),
  (select m.chapter_id from public.members m where m.id = e.member_id))
from public.votes v
where v.id = e.vote_id and v.electorate = 'nec' and v.closed_at is null;

-- The readings of a seat. Held: open rows whose stint hasn't lapsed (a stint lapses at Melbourne
-- midnight after its until date, closed or not). Duties: held rows, minus any row a held cover
-- points at. Club-wide: duties that aren't acting. "Board member" is a distinct person with a held
-- board row. Only the security-definer helpers read them.
create view private.held_positions as select * from public.positions
  where ended_on is null and (acting_until is null or acting_until >= private.club_date());
create view private.duty_positions as select h.* from private.held_positions h
  where not exists (select 1 from private.held_positions c where c.covers = h.id);
create view private.clubwide_positions as select * from private.duty_positions where acting_until is null;
revoke all on private.held_positions, private.duty_positions, private.clubwide_positions from public, anon, authenticated;

-- A role's name, as the app's ROLE_LABEL (src/domain/labels.ts).
create or replace function private.role_label(p_role public.position_role)
returns text language sql immutable set search_path = '' as $$
  select case p_role
    when 'president' then 'President'
    when 'vice_president' then 'Vice President'
    when 'secretary' then 'Secretary'
    when 'treasurer' then 'Treasurer'
    when 'sergeant_at_arms' then 'Sergeant at Arms'
    when 'road_captain' then 'Road Captain'
    when 'officer' then 'Officer'
    when 'tail_gunner' then 'Tail Gunner'
    when 'social_media_officer' then 'Social Media Officer'
    when 'club_coach' then 'Club Coach'
    when 'ride_committee' then 'Ride Committee'
    when 'assistant_tail_gunner' then 'Assistant Tail Gunner'
    when 'nec_chair' then 'National Chairman'
    when 'nec_secretary' then 'National Secretary'
    when 'nec_auditor' then 'National Auditor'
    when 'founder' then 'Founder'
    when 'charity_committee' then 'Charity Committee'
  end;
$$;

-- The seat lock: every writer that touches a seat takes it first, so two writers on one seat queue.
create or replace function private.lock_seat(p_chapter uuid, p_role public.position_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_chapter::text, 'national') || ':' || p_role::text, 0));
end;
$$;

-- The person locks, after the seat lock: one per member the writer checks, in uuid order, so the
-- checks that span two seats can't race.
create or replace function private.lock_people(p_members uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  for m in select distinct x from unnest(p_members) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('member:' || m::text, 0));
  end loop;
end;
$$;

-- The lazy close. Every writer that touches a seat runs it first, so the partial indexes are free
-- once a stint has lapsed (they can't read the club clock). A lapsed stint ends the day after its
-- until date, by nobody. A request closes as rejected once any acting vote on it is lost (a vote
-- without quorum leaves it open), and as lapsed after its until date or 28 days after it was made.
create or replace function private.close_lapsed_acting()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.positions
  set ended_on = acting_until + 1, ended_reason = 'lapsed', ended_by = null
  where ended_on is null and acting_until is not null and acting_until < private.club_date();

  update public.acting_requests r
  set closed_at = now(), outcome = 'rejected'
  where r.closed_at is null
    and exists (select 1 from public.votes v where v.acting_request = r.id and v.result = 'lost');

  update public.acting_requests
  set closed_at = now(), outcome = 'lapsed'
  where closed_at is null
    and (until < private.club_date() or private.club_date(created_at) + 28 <= private.club_date());
end;
$$;

-- A cover points at the open, non-acting holder of the same seat, seated on or before it started.
create or replace function private.check_covers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.covers is not null and not exists (
    select 1 from public.positions h
    where h.id = new.covers and h.id <> new.id and h.ended_on is null and h.acting_until is null
      and h.chapter_id = new.chapter_id and h.role = new.role and h.started_on <= new.started_on
  ) then
    raise exception 'A cover must point at the open holder of the same seat.';
  end if;
  return new;
end;
$$;
create trigger positions_check_covers before insert or update of covers on public.positions
  for each row execute function private.check_covers();

-- When a row ends, the stints that rested on it end too (left_board), logged in acting_changes:
-- a cover of that row; a cover whose stand-in has no other board seat in the chapter now; and a
-- President stint recorded with no vote because the person was the sitting VP, when their VP row
-- ends. A stint already past its date closes as lapsed instead.
create or replace function private.on_position_end()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  board constant public.position_role[] := array['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];
  today constant date := private.club_date();
begin
  -- The covered holder's own row ended.
  with ended as (
    update public.positions c
    set ended_on = case when c.acting_until < today then c.acting_until + 1 else greatest(today, c.started_on) end,
        ended_reason = case when c.acting_until < today then 'lapsed' else 'left_board' end,
        ended_by = null
    where c.covers = new.id and c.ended_on is null
    returning c.id, c.chapter_id, c.acting_until, c.ended_reason
  )
  insert into public.acting_changes (position_id, chapter_id, old_until, new_until, changed_by, note)
  select id, chapter_id, acting_until, null, auth.uid(), 'Holder’s seat ended' from ended where ended_reason = 'left_board';

  -- The stand-in's last non-acting board seat in the chapter ended.
  if new.acting_until is null and new.chapter_id is not null and new.role = any (board) and not exists (
    select 1 from public.positions o
    where o.member_id = new.member_id and o.chapter_id = new.chapter_id and o.ended_on is null
      and o.acting_until is null and o.role = any (board)
  ) then
    with ended as (
      update public.positions c
      set ended_on = case when c.acting_until < today then c.acting_until + 1 else greatest(today, c.started_on) end,
          ended_reason = case when c.acting_until < today then 'lapsed' else 'left_board' end,
          ended_by = null
      where c.member_id = new.member_id and c.chapter_id = new.chapter_id and c.covers is not null and c.ended_on is null
      returning c.id, c.chapter_id, c.acting_until, c.ended_reason
    )
    insert into public.acting_changes (position_id, chapter_id, old_until, new_until, changed_by, note)
    select id, chapter_id, acting_until, null, auth.uid(), 'Stand-in left the board' from ended where ended_reason = 'left_board';
  end if;

  -- A sitting VP's President stint with no vote behind it ends with their VP row (8.2).
  if new.role = 'vice_president' and new.acting_until is null then
    with ended as (
      update public.positions c
      set ended_on = case when c.acting_until < today then c.acting_until + 1 else greatest(today, c.started_on) end,
          ended_reason = case when c.acting_until < today then 'lapsed' else 'left_board' end,
          ended_by = null
      where c.member_id = new.member_id and c.chapter_id = new.chapter_id and c.role = 'president'
        and c.acting_until is not null and c.acting_vote is null and c.ended_on is null
      returning c.id, c.chapter_id, c.acting_until, c.ended_reason
    )
    insert into public.acting_changes (position_id, chapter_id, old_until, new_until, changed_by, note)
    select id, chapter_id, acting_until, null, auth.uid(), 'Stand-in left the board' from ended where ended_reason = 'left_board';
  end if;
  return null;
end;
$$;
create trigger positions_on_end after update of ended_on on public.positions
  for each row when (old.ended_on is null and new.ended_on is not null)
  execute function private.on_position_end();

-- The covered holder hears, whatever their settings (as push_ride_alert): when someone else asks for
-- a cover of their seat (once a day per seat, however often it's re-filed), and whenever a cover of
-- their seat is confirmed, their own request included.
create or replace function private.push_acting_holder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  holder uuid := (select h.member_id from private.held_positions h where h.id = new.covers);
  stand_in text := (select private.short_name(m) from public.members m where m.id = new.member_id);
  seat text := private.role_label(new.role) || ' (' || (select c.name from public.chapters c where c.id = new.chapter_id) || ')';
  k text;
  t text;
  b text;
begin
  if holder is null then return null; end if;
  if tg_table_name = 'acting_requests' then
    if new.requested_by = holder then return null; end if;
    k := 'acting-ask:' || new.covers || ':' || to_char(private.club_date(), 'YYYY-MM-DD');
    t := 'Cover asked for your seat';
    b := (select private.short_name(m) from public.members m where m.id = new.requested_by) || ' asked for ' || stand_in
      || ' to act as ' || seat || ' for you until ' || to_char(new.until, 'DD/MM/YYYY') || '. If you’re available, tap I’m back.';
  else
    k := 'acting-on:' || new.id;
    t := 'Your seat is covered';
    b := stand_in || ' is acting as ' || seat || ' for you until ' || to_char(new.acting_until, 'DD/MM/YYYY')
      || '. If you’re available, tap I’m back.';
  end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  values (holder, k, t, b, jsonb_build_object('kind', 'acting', 'positionId', new.covers))
  on conflict (member_id, dedupe_key) do nothing;
  return null;
end;
$$;
create trigger acting_requests_push after insert on public.acting_requests
  for each row when (new.covers is not null) execute function private.push_acting_holder();
create trigger positions_push_cover after insert on public.positions
  for each row when (new.covers is not null) execute function private.push_acting_holder();

revoke all on function private.role_label(public.position_role), private.lock_seat(uuid, public.position_role),
  private.lock_people(uuid[]), private.close_lapsed_acting(), private.check_covers(), private.on_position_end(),
  private.push_acting_holder()
  from public, anon, authenticated;

-- §2 Readers: board member and held ----------------------------------------------------------------

-- "Board member" is a distinct person with a held board row in the chapter, covered or not: a
-- covered holder keeps the board's ballot, records and approvals, a stand-in was on the board
-- already, and acting in an empty board seat seats someone on it (9.8). A lapsed stint gives none of
-- it from Melbourne midnight, closed or not. Each body below is the latest one, re-pointed at
-- private.held_positions; their Ride Committee parts read private.duty_positions, and their
-- is_national and is_nec_officer calls stay as they are (§3 gives those the duties reading).

-- Acts as a chapter's board: a seated board member of that chapter (8.2, 12.3).
create or replace function private.is_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.held_positions
    where member_id = auth.uid() and chapter_id = target_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
  );
$$;

-- Sits on that chapter's board (not just the NEC). Mirrors holdsBoardSeat.
create or replace function private.holds_board_seat(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.held_positions where member_id = auth.uid() and chapter_id = p_chapter
      and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'));
$$;

/** Holds a board seat in any chapter, or sits on the NEC. */
create or replace function private.is_any_board()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from private.held_positions
      where member_id = auth.uid()
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

-- Who manages the bus, saying yes or no: the NEC (private.is_national, the app's isNational), or
-- anyone holding a sitting (not ended) board seat in any chapter; the Ride Committee isn't a board
-- seat. The club has one bus, so any board can. The app's managesBus.
create or replace function private.manages_bus()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from private.held_positions
      where member_id = auth.uid() and chapter_id is not null
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

-- That chapter's board or the NEC; for a whole-club ride (null), any chapter's board.
create or replace function private.can_run_checkin(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target_chapter is not null then private.is_board_of(target_chapter)
              else private.is_approved_member() and (private.is_national() or exists (
                select 1 from private.held_positions where member_id = auth.uid()
                  and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')))
         end;
$$;

-- The chapter's board sets the amounts, as can whoever handles its money. (Not the wider NEC.)
create or replace function private.can_set_fees(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_fees(target_chapter) or private.is_board_of(target_chapter);
$$;

-- Everyone who gets a ballot. Legacy members and anyone not approved never vote. Nomads vote on
-- national matters only (10.7); the NEC has one vote per chapter, cast by its President (11.2).
create or replace function private.electors_for(p_electorate public.electorate, p_chapter uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.approval = 'approved' and m.status <> 'legacy' and case p_electorate
    when 'chapter_board' then exists (
      select 1 from private.held_positions p
      where p.member_id = m.id and p.chapter_id = p_chapter
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))
    when 'chapter_patched' then m.chapter_id = p_chapter and m.status = 'full'
    when 'club_patched' then m.status in ('full', 'nomad')
    when 'nec' then m.id in (select private.nec_voter_for(c.id) from public.chapters c)
  end
  order by m.id;
$$;

-- Someone asks to join: that chapter's board hears about it.
create or replace function private.push_applicant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approval <> 'pending' then return new; end if;
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'applicant:' || new.id, 'Waiting for approval',
    new.full_name || ' asked to join ' || c.name, jsonb_build_object('kind', 'applicant', 'memberId', new.id)
  from private.held_positions pos
  join public.members b on b.id = pos.member_id
  join public.chapters c on c.id = new.chapter_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.chapter_id = new.chapter_id and b.approval = 'approved'
    and pos.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

-- Who sees an enquiry: a board seat in the chapter it names, any board seat for "either", and the
-- NEC officers (Chairman, Secretary) for the lot. The same as enquiriesSeenBy in the app.
create or replace function private.sees_site_enquiry(target_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_nec_officer() or exists (
      select 1 from private.held_positions p
      join public.chapters c on c.id = p.chapter_id
      where p.member_id = auth.uid()
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
        and (target_slug = 'either' or c.slug = target_slug)
    )
  );
$$;

-- Off the NEC, so not a ride leader either: Road Captain, Tail Gunner or Assistant TG, or a board
-- or NEC officer seat.
create or replace function private.is_ride_leader(who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.held_positions p join public.members m on m.id = p.member_id
    where p.member_id = who and m.approval = 'approved'
      and p.role in ('road_captain', 'tail_gunner', 'assistant_tail_gunner', 'president', 'vice_president',
                     'secretary', 'treasurer', 'sergeant_at_arms', 'nec_chair', 'nec_secretary')
  );
$$;

-- Who manages a ride's crew: anyone on the NEC; for a North or West ride, that chapter's board or
-- Ride Committee; for any other ride, any chapter's board or Ride Committee. Same as managesRide.
create or replace function private.manages_ride(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from public.rides r
      join (select member_id, chapter_id from private.held_positions
            where role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
            union all
            select member_id, chapter_id from private.duty_positions where role = 'ride_committee') p
        on p.member_id = auth.uid()
      left join public.chapters c on c.slug = r.category::text
      where r.id = p_ride
        and (r.category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$$;

-- manages_ride, for a chapter instead of a ride.
create or replace function private.manages_chapter_rides(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from (select member_id, chapter_id from private.held_positions
            where role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
            union all
            select member_id, chapter_id from private.duty_positions where role = 'ride_committee') p
      where p.member_id = auth.uid()
        and (p_chapter is null or p.chapter_id = p_chapter)
    )
  );
$$;

-- The managesRide rule (crew.ts) asked of a category: North and West need that chapter's board or
-- ride committee (or the NEC); the rest take any board seat, ride committee seat or the NEC.
create or replace function private.manages_ride_category(p_category public.ride_category)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1
      from (select member_id, chapter_id from private.held_positions
            where role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
            union all
            select member_id, chapter_id from private.duty_positions where role = 'ride_committee') p
      left join public.chapters c on c.slug = p_category::text
      where p.member_id = auth.uid()
        and (p_category not in ('north', 'west') or p.chapter_id = c.id)
    )
  );
$$;

-- Why p_member can't hold p_role, or null. Now also: the Auditor can't be National Chairman or
-- Secretary at the same time, since they aren't on the NEC (11.2, 11.8). Reads held rows: a covered
-- holder still holds their seat; a lapsed stint holds nothing.
create or replace function private.hold_problem(p_member uuid, p_role public.position_role)
returns text language plpgsql stable security definer set search_path = '' as $$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member;
  if target.status not in ('full', 'nomad') then
    return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  end if;
  if target.status = 'nomad' and p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms',
                                            'road_captain', 'nec_chair', 'nec_secretary', 'nec_auditor') then
    return 'Nomads can’t hold a board or national seat (9.1).';
  end if;
  if (p_role = 'nec_auditor' and exists (
        select 1 from private.held_positions where member_id = p_member and role in ('president', 'treasurer')))
     or (p_role in ('president', 'treasurer') and exists (
        select 1 from private.held_positions where member_id = p_member and role = 'nec_auditor')) then
    return 'The National Auditor can’t also be a President or Treasurer (11.8).';
  end if;
  if (p_role = 'nec_auditor' and exists (
        select 1 from private.held_positions where member_id = p_member and role in ('nec_chair', 'nec_secretary')))
     or (p_role in ('nec_chair', 'nec_secretary') and exists (
        select 1 from private.held_positions where member_id = p_member and role = 'nec_auditor')) then
    return 'The National Auditor isn’t on the NEC, so can’t also be National Chairman or Secretary (11.8).';
  end if;
  return null;
end;
$$;

-- §3 Readers: duties and club-wide ------------------------------------------------------------------

-- Duties: held rows, minus any row a held cover points at. They chair, cast the chapter's NEC vote,
-- keep its books and run each one-role check, for their own chapter only; a covered holder pauses
-- them until the cover ends. Club-wide: duty rows that aren't acting. No acting row keeps the Club
-- fund's books, approves its spending, runs the shop or the feedback inbox, or opens every
-- chapter's private details; an Acting President still takes part in NEC business (11.2). Each
-- body below is the latest one, re-pointed at a view, every other line kept.

-- Sees every chapter's private details: the National Chairman or Secretary, or a sitting President,
-- none of them acting. The national branch of sees_board_of, and other chapters' chapter chats.
create or replace function private.sees_every_chapter()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.clubwide_positions
    where member_id = auth.uid() and role in ('nec_chair', 'nec_secretary', 'president')
  );
$$;

create or replace function private.is_auditor()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions where member_id = auth.uid() and role = 'nec_auditor'
  );
$$;

-- The Chairman, the Secretary and the Presidents with the seat's duties (an Acting President takes
-- part in NEC business; a covered one is off the NEC until the cover ends). The Auditor holds a
-- national seat but isn't on the NEC (11.2, 11.8).
create or replace function private.is_national()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions
    where member_id = auth.uid()
      and role in ('nec_chair', 'nec_secretary', 'president')
  );
$$;

-- National Chairman or Secretary. The Auditor doesn't seat the people they review (11.8).
create or replace function private.is_nec_officer()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions
    where member_id = auth.uid()
      and role in ('nec_chair', 'nec_secretary')
  );
$$;

-- The sitting National Chairman: the only one who hands out or ends the other national roles.
create or replace function private.is_chairman()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions
    where member_id = auth.uid() and role = 'nec_chair'
  );
$$;

-- Whoever has the casting vote: the chapter's President, or the National Chairman (inferred).
create or replace function private.chair_of(p_chapter uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  -- The chapter President with the seat's duties (an Acting President, or the President's
  -- stand-in), then the VP with that seat's duties, so an Acting VP or a VP's stand-in chairs
  -- (constitution 10.9); the National Chairperson for the whole club (11.2).
  select member_id from private.duty_positions
  where chapter_id is not distinct from p_chapter
    and role in (case when p_chapter is null then 'nec_chair' else 'president' end::public.position_role,
                 case when p_chapter is null then 'nec_chair' else 'vice_president' end::public.position_role)
  order by role = 'vice_president', started_on desc limit 1;
$$;

-- Who casts a chapter's NEC vote on a vote opened on p_day, counting only rows that started before
-- that day, so a seating on or after it neither takes the ballot nor takes it away: the President
-- with the seat's duties, unless they chair the NEC (an Acting President counts); then the Vice
-- President, from a VP row that isn't acting and that no cover points at, since a VP takes part
-- only while formally acting as President (11.2). A cover with no vote behind it counts from the
-- start of the row it covers, because the holder chose the stand-in; while a President row from
-- before the day is under a cover that doesn't count, it's nobody: the covered President is off the
-- NEC, and the board didn't pick who casts. The newest holder of a seat acts during a handover (9.8).
create or replace function private.nec_voter_before(p_chapter uuid, p_day date)
returns uuid language sql stable security definer set search_path = '' as $$
  with seat as (
    select h.id, h.member_id, h.role, h.covers,
      coalesce(case when h.acting_vote is null then c.started_on end, h.started_on) as counts_from
    from private.held_positions h
    left join private.held_positions c on c.id = h.covers
    where h.chapter_id = p_chapter and h.role in ('president', 'vice_president')
  )
  select case
    when exists (
      select 1 from seat p join seat s on s.covers = p.id
      where p.role = 'president' and p.counts_from < p_day and s.counts_from >= p_day
    ) then null
    else (
      select x.member_id from seat x
      where x.counts_from < p_day and (
        (x.role = 'president' and not exists (select 1 from seat s where s.covers = x.id)
          and x.member_id not in (select n.member_id from private.duty_positions n where n.role = 'nec_chair'))
        or (x.role = 'vice_president' and x.id in (select w.id from private.clubwide_positions w)))
      order by x.role = 'vice_president', x.counts_from desc
      limit 1)
  end;
$$;

-- Who casts a chapter's NEC vote now (constitution 11.2).
create or replace function private.nec_voter_for(p_chapter uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select private.nec_voter_before(p_chapter, 'infinity');
$$;

-- The chapter's Treasurer with the seat's duties (an Acting Treasurer, or the Treasurer's
-- stand-in), or the National Chairman or Secretary.
create or replace function private.can_manage_fees(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions where member_id = auth.uid()
      and ((role = 'treasurer' and chapter_id = target_chapter) or role in ('nec_chair', 'nec_secretary'))
  );
$$;

-- Holds a seat on that committee: Road Captains and the Ride Committee, or the Charity Committee.
create or replace function private.is_on_committee(p_committee public.chat_committee)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.duty_positions
    where member_id = auth.uid()
      and case p_committee when 'ride' then role in ('ride_committee', 'road_captain')
                           else role = 'charity_committee' end
  );
$$;

-- The Social Media Officer (either chapter) or the NEC. Mirrors managesSitePhotoCrew.
create or replace function private.manages_site_photo_crew()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from private.duty_positions
      where member_id = auth.uid() and role = 'social_media_officer'
    )
  );
$$;

-- Whether you run this ride's sign-ups: its crew managers, or anyone on the Charity Committee.
-- The app's runsCharity.
create or replace function private.runs_charity(p_ride uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.manages_ride(p_ride) or (private.is_approved_member() and exists (
    select 1 from private.duty_positions where member_id = auth.uid() and role = 'charity_committee'
  ));
$$;

-- The NEC (11.2: the Chair and the Chapter Presidents), and the National Secretary who keeps Club records.
create or replace function private.can_designate_big4()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_national();
$$;

-- Records (or corrects) the date of a year's AGM.
create or replace function public.record_agm(p_held_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_nec_officer() then
    raise exception 'Only the National Chairman or Secretary records the AGM.';
  end if;
  if p_held_on is null then raise exception 'Pick the AGM date.'; end if;
  if extract(month from p_held_on) < 7 then raise exception 'The AGM is held between July and December.'; end if;
  insert into public.agms (year, held_on, recorded_by) values (extract(year from p_held_on)::int, p_held_on, auth.uid())
  on conflict (year) do update set held_on = excluded.held_on, recorded_by = excluded.recorded_by, recorded_at = now();
end;
$$;

-- Keeps a fund's books: its chapter's Treasurer with the seat's duties, or the National Chairman or
-- Secretary; the Club fund's, any chapter Treasurer too (inferred), though never an acting one.
-- Mirrors keepsBooks.
create or replace function private.keeps_books(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    exists (select 1 from private.duty_positions where member_id = auth.uid() and role in ('nec_chair', 'nec_secretary'))
    or (p_chapter is not null and exists (
      select 1 from private.duty_positions where member_id = auth.uid() and role = 'treasurer' and chapter_id = p_chapter))
    or (p_chapter is null and exists (
      select 1 from private.clubwide_positions where member_id = auth.uid() and role = 'treasurer')));
$$;

-- Approves a fund's spending (13.3): a chapter's board members (a covered holder and an acting one
-- included), or for the Club fund the sitting Presidents, none of them acting or covered; the
-- National Chairman and Secretary for both. Never the National Auditor (11.8).
create or replace function private.approves_for(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    exists (select 1 from private.duty_positions where member_id = auth.uid() and role in ('nec_chair', 'nec_secretary'))
    or (p_chapter is null and exists (
      select 1 from private.clubwide_positions where member_id = auth.uid() and role = 'president'))
    or (p_chapter is not null and exists (
      select 1 from private.held_positions where member_id = auth.uid() and chapter_id = p_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))));
$$;

create or replace function private.sees_ledger(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.keeps_books(p_chapter) or private.approves_for(p_chapter) or private.is_auditor();
$$;

-- Holds a seat that runs the shop: NEC Chair or Secretary, a President or a Treasurer, none of them
-- acting or covered. Mirrors holdsShopSeat.
create or replace function private.shop_seat()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.clubwide_positions where member_id = auth.uid()
      and role in ('nec_chair', 'nec_secretary', 'president', 'treasurer'));
$$;

-- A sitting Treasurer (either chapter) or NEC Chairman / Secretary, none of them acting or covered.
-- The same as isFeedbackKeeper.
create or replace function private.is_feedback_keeper()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from private.clubwide_positions
    where member_id = auth.uid()
      and role in ('treasurer', 'nec_chair', 'nec_secretary')
  );
$$;

-- A new report: every keeper hears, like a join request (their "approvals" setting), once per report.
create or replace function private.push_feedback_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'feedback:' || new.id, 'App feedback',
    who || ': ' || left(new.body, 80), jsonb_build_object('kind', 'feedback-sent', 'feedbackId', new.id)
  from private.clubwide_positions pos
  join public.members k on k.id = pos.member_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.role in ('treasurer', 'nec_chair', 'nec_secretary')
    and k.approval = 'approved' and k.status <> 'family' and pos.member_id <> new.member_id
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

-- Sees a chapter's board records: a board member of that chapter (a covered holder included), or
-- whoever sees every chapter.
create or replace function private.sees_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.sees_every_chapter() or exists (
      select 1 from private.held_positions
      where member_id = auth.uid() and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

-- Why the caller can't read this chat, or null when they can. Same words as readProblem. Otherwise as
-- in 20270810000100_family_chat.sql: another chapter's chapter chat is member data, so it takes
-- sees_every_chapter; the NEC and committee chats are NEC business and keep is_national.
create or replace function private.chat_problem(p_chat uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  -- Family get the Family chat and nothing else.
  if private.is_family() then
    select * into c from public.conversations where id = p_chat;
    if not found then return 'No such chat.'; end if;
    if c.kind = 'family' then return null; end if;
    return 'Family can only use the Family chat.';
  end if;
  if not private.is_approved_member() then return 'Only approved members can do that.'; end if;
  select * into c from public.conversations where id = p_chat;
  if not found then return 'No such chat.'; end if;
  -- Someone who might join gets the whole-club and ride chats only, until they're an FNG.
  if c.kind not in ('club', 'ride')
     and (select status from public.members where id = auth.uid()) = 'introduced' then
    if c.kind = 'direct' then return 'Private chats open up once you’re an FNG.'; end if;
    if c.kind = 'chapter' then return 'Chapter chats open up once you’re an FNG.'; end if;
    return 'That chat opens up once you’re an FNG.';
  end if;
  if c.kind = 'chapter' then
    if private.chapter_of(auth.uid()) = c.chapter_id or private.sees_every_chapter() then return null; end if;
    return format('That chat is for %s chapter members.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'board' then
    if private.sees_board_of(c.chapter_id) then return null; end if;
    return format('That chat is for the %s board.', (select name from public.chapters where id = c.chapter_id));
  elsif c.kind = 'nec' then
    if private.is_national() then return null; end if;
    return 'That chat is for the NEC.';
  elsif c.kind = 'committee' then
    if private.is_on_committee(c.committee) or private.is_national() then return null; end if;
    return format('That chat is for the %s committee.', c.committee);
  elsif c.kind = 'direct' then
    if exists (select 1 from public.conversation_members where conversation_id = p_chat and member_id = auth.uid()) then
      return null;
    end if;
    return 'That’s a private chat.';
  end if;
  return null;
end;
$$;

-- Before each draft, as the member: refuses with the words the app shows, counts the draft, and
-- hands back the meeting, the people who could have been there and the scope's seated positions.
-- Otherwise as in 20270660000000_otter_minutes.sql.
create or replace function public.minutes_draft_start(p_meeting uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  this_month constant date := date_trunc('month', private.club_date())::date;
  budget constant bigint := private.assistant_setting('assistant_month_budget_microusd', 20000000);
  max_drafts constant int := 5;
  daily_limit constant bigint := private.assistant_setting('assistant_daily_limit', 15);
  asked int;
  m public.meetings%rowtype;
  done int;
  spent bigint;
  meeting jsonb;
  people jsonb;
  board jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then
    raise exception 'No such meeting.';
  end if;
  perform private.require_scope(m.chapter_id);
  if m.cancelled_at is not null then
    raise exception 'That meeting was cancelled.';
  end if;
  if m.minutes_approved_at is not null then
    raise exception 'Those minutes are approved and locked.';
  end if;
  if m.starts_at > now() then
    raise exception 'The meeting hasn’t happened yet.';
  end if;
  if not private.assistant_on() then
    raise exception 'Ask the club isn’t switched on yet.';
  end if;

  -- Counted first and checked after, so drafts asked for at the same moment queue on the row
  -- rather than all slipping through; a refusal rolls its own count back.
  insert into private.minutes_drafts as d (meeting_id, drafts) values (p_meeting, 1)
  on conflict (meeting_id) do update set drafts = d.drafts + 1
  returning drafts into done;
  if done > max_drafts then
    raise exception 'This meeting has been drafted % times. Finish it by hand.', max_drafts;
  end if;
  -- Each draft is also one of the member's Ask the club questions for the day.
  delete from private.assistant_days where day < private.club_date() - 1;
  insert into private.assistant_days as a (member_id, day, questions) values (auth.uid(), private.club_date(), 1)
  on conflict (member_id, day) do update set questions = a.questions + 1
  returning questions into asked;
  if asked > daily_limit then
    raise exception 'You’ve asked % today. More tomorrow.', daily_limit;
  end if;
  insert into private.assistant_months as mo (month, questions) values (this_month, 1)
  on conflict (month) do update set questions = mo.questions + 1
  returning spent_microusd into spent;
  if spent >= budget then
    raise exception 'Ask the club is resting until %: this month’s budget is used.',
      to_char(private.assistant_next_month(private.club_date()), 'DD/MM/YYYY');
  end if;

  select jsonb_build_object(
    'id', m.id, 'title', m.title, 'kind', m.kind, 'startsAt', m.starts_at, 'location', m.location,
    'chapter', (select c.name from public.chapters c where c.id = m.chapter_id),
    'agenda', coalesce(m.agenda, '[]'::jsonb))
  into meeting;

  -- Approved members other than Family (visitors from the other chapter count), and for a chapter
  -- meeting its applicants in their introduction phase. Mirrors minutesPeople in src/domain/otterMinutes.ts.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'name', x.full_name, 'roadName', x.road_name, 'chapter', c.name, 'status', x.status)
    order by x.full_name), '[]'::jsonb)
  into people
  from public.members x left join public.chapters c on c.id = x.chapter_id
  where (x.approval = 'approved' and x.status <> 'family')
     or (m.chapter_id is not null and x.approval = 'pending' and x.status = 'introduced' and x.chapter_id = m.chapter_id);

  -- Held seats, an acting one flagged, so the draft names an Acting President as such; a covered
  -- holder keeps their seat. The NEC is the national roles plus the chapter Presidents with the
  -- seat's duties: an Acting President, not the President they cover (11.2).
  select coalesce(jsonb_agg(jsonb_build_object('role', p.role, 'name', x.full_name, 'acting', p.acting_until is not null)
    order by p.role), '[]'::jsonb)
  into board
  from (select * from private.held_positions where chapter_id is not distinct from m.chapter_id
        union all
        select * from private.duty_positions where m.chapter_id is null and role = 'president') p
  join public.members x on x.id = p.member_id
  where p.started_on <= private.club_date();

  return jsonb_build_object('meeting', meeting, 'people', people, 'board', board);
end;
$$;

revoke all on function private.sees_every_chapter(), private.nec_voter_before(uuid, date) from public, anon, authenticated;

-- §4 Acting RPCs and caps ---------------------------------------------------------------------------

-- Three routes start a stint (spec "How a stint starts"): one board member records an empty seat
-- (appoint_acting); a holder asks for a cover of their own seat and a third board member confirms
-- it (request_cover, confirm_acting); or a board member proposes one that needs a board vote and,
-- once it has carried, a board member who isn't the stand-in confirms it (request_acting,
-- confirm_acting). Each takes the seat lock and the person locks, then runs the lazy close, then
-- checks in the same order as the app (src/domain/access.ts): 1 signed in and approved, 2 the
-- caller's standing, 3 the Auditor, 4 the board's size and whether it needs a vote, 5 who may act,
-- 6 the vote rule, 7 the why, 8 the date. The words are the spec's Appendix A.

-- Why p_member can't act in this seat until p_until (p_covers: the holder's row for a cover, null
-- for an empty seat), or null. Reads held rows: a lapsed stint holds nothing.
create or replace function private.acting_problem(p_member uuid, p_chapter uuid, p_role public.position_role,
  p_covers uuid, p_until date)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  board constant public.position_role[] := array['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];
  target public.members%rowtype;
  unfit text;
begin
  if p_chapter is null or p_role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder') then
    return 'Acting is for chapter roles, not national seats or honours.';
  end if;
  select * into target from public.members where id = p_member;
  if not found or target.chapter_id is distinct from p_chapter then return 'They’re not a member of that chapter.'; end if;
  if target.approval <> 'approved' then return 'Approve them first.'; end if;
  unfit := private.hold_problem(p_member, p_role);
  if unfit is not null then return unfit; end if;
  if exists (select 1 from private.held_positions where member_id = p_member and chapter_id = p_chapter and role = p_role) then
    return 'They already hold that role.';
  end if;
  -- The seat checks are for the six board seats: other roles can have several holders.
  if p_role = any (board) then
    if p_covers is null then
      if exists (select 1 from private.held_positions where chapter_id = p_chapter and role = p_role and acting_until is null) then
        return 'That seat has a holder. Arrange a cover instead.';
      end if;
    elsif not exists (
      select 1 from private.held_positions
      where id = p_covers and chapter_id = p_chapter and role = p_role and acting_until is null) then
      return 'The seat they asked to cover has ended.';
    end if;
    if exists (select 1 from private.held_positions where chapter_id = p_chapter and role = p_role and acting_until is not null)
       or exists (select 1 from public.acting_requests where chapter_id = p_chapter and role = p_role and closed_at is null) then
      return 'Someone is already acting in that seat, or a request is waiting.';
    end if;
  end if;
  if exists (select 1 from private.held_positions where member_id = p_member and acting_until is not null) then
    return 'They’re already acting in a role. One stint at a time.';
  end if;
  if exists (
    select 1 from private.held_positions h join private.held_positions c on c.covers = h.id
    where h.member_id = p_member) then
    return 'Their own seat is covered, so they can’t act for anyone.';
  end if;
  -- Chair and books stay apart (9.5, inferred).
  if p_role = 'president' and exists (
    select 1 from private.held_positions where member_id = p_member and chapter_id = p_chapter and role = 'treasurer') then
    return 'An Acting President can’t also keep the chapter’s books (9.5).';
  end if;
  if p_role = 'treasurer' and exists (
    select 1 from private.held_positions where member_id = p_member and chapter_id = p_chapter and role = 'president') then
    return 'An Acting Treasurer can’t also be the chapter’s President (9.5).';
  end if;
  -- Every role is_ride_leader counts.
  if target.on_hiatus and (p_role = any (board) or p_role in ('tail_gunner', 'assistant_tail_gunner')) then
    return 'Members on hiatus can’t lead rides.';
  end if;
  if private.is_learner(p_member) or exists (
    select 1 from public.member_private where member_id = p_member and licence_expiry < p_until) then
    return 'Their recorded licence ends before the until date (9.7).';
  end if;
  if p_covers is not null then
    if not (p_role = any (board)) then return 'Only board seats can be covered.'; end if;
    if not exists (
      select 1 from private.held_positions
      where member_id = p_member and chapter_id = p_chapter and role = any (board) and acting_until is null) then
      return 'A cover goes to someone already on that chapter’s board.';
    end if;
  end if;
  return null;
end;
$$;

-- The last day a stint starting on p_start can run to (spec "Caps", measured from the start). A
-- cover: three months. A non-board role: six months. An empty board seat: its run, chained back
-- from this stint through the seat's acting rows, each open or ended within 28 days before the next
-- one started, after the seat's last non-acting row ended, starts at the earliest; the cap is the
-- Melbourne date of the chapter's first uncancelled ACM on or after the run's start, held or not,
-- at most twelve months on, else six months on. Months end at the month's end.
create or replace function private.acting_cap(p_chapter uuid, p_role public.position_role, p_cover boolean, p_start date)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  run_start date := p_start;
  fell_empty date;
  earlier date;
  acm date;
begin
  if p_cover then return (p_start + interval '3 months')::date; end if;
  if p_role not in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
    return (p_start + interval '6 months')::date;
  end if;
  select max(ended_on) into fell_empty from public.positions
  where chapter_id = p_chapter and role = p_role and acting_until is null and ended_on is not null;
  loop
    select min(p.started_on) into earlier from public.positions p
    where p.chapter_id = p_chapter and p.role = p_role and p.acting_until is not null
      and p.started_on < run_start
      and (fell_empty is null or p.started_on >= fell_empty)
      and (p.ended_on is null or p.ended_on >= run_start - 28);
    exit when earlier is null;
    run_start := earlier;
  end loop;
  select private.club_date(m.starts_at) into acm from public.meetings m
  where m.chapter_id = p_chapter and m.kind = 'agm' and m.cancelled_at is null
    and private.club_date(m.starts_at) >= run_start
  order by m.starts_at
  limit 1;
  return least(coalesce(acm, (run_start + interval '6 months')::date), (run_start + interval '12 months')::date);
end;
$$;

-- A carried vote ended their time in this seat in the last 90 days: one about them in that chapter
-- and role, in the chapter board's majority shape (ending acting) or the role's 9.3 shape (removal),
-- that wasn't a vote for acting.
create or replace function private.ended_by_vote(p_member uuid, p_chapter uuid, p_role public.position_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.votes v
    where v.subject_member_id = p_member and v.chapter_id = p_chapter and v.subject_role = p_role
      and v.acting_request is null and v.closed_at is not null and v.result = 'carried'
      and private.club_date(v.closed_at) >= private.club_date() - 90
      and ((v.electorate = 'chapter_board' and v.threshold = 'majority')
        or (p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
            and v.electorate = 'chapter_patched' and v.threshold = 'two_thirds'))
  );
$$;

-- Acting here needs a carried board vote: anyone but the sitting VP acting as President (8.2, 9.8),
-- and anyone a carried vote ended their time in the seat. The sitting VP holds a non-acting VP row
-- there; for an empty President seat it started before the seat's last non-acting President row
-- ended, so a VP seated after the seat fell empty needs a vote too.
create or replace function private.acting_needs_vote(p_member uuid, p_chapter uuid, p_role public.position_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.ended_by_vote(p_member, p_chapter, p_role) or (p_role = 'president' and not exists (
    select 1 from private.held_positions vp
    where vp.member_id = p_member and vp.chapter_id = p_chapter and vp.role = 'vice_president' and vp.acting_until is null
      and (exists (select 1 from private.held_positions h
                   where h.chapter_id = p_chapter and h.role = 'president' and h.acting_until is null)
           or vp.started_on < (select max(p.ended_on) from public.positions p
                               where p.chapter_id = p_chapter and p.role = 'president' and p.acting_until is null))));
$$;

-- A request needs a vote: a cover the holder didn't ask for, or acting that needs one.
create or replace function private.request_needs_vote(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (r.covers is not null and r.requested_by is distinct from (select h.member_id from private.held_positions h where h.id = r.covers))
    or private.acting_needs_vote(r.member_id, r.chapter_id, r.role)
  from public.acting_requests r where r.id = p_request;
$$;

-- The carried vote naming the request, closed in the last 90 days, or null.
create or replace function private.has_carried_acting_vote(p_request uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select v.id from public.votes v
  where v.acting_request = p_request and v.closed_at is not null and v.result = 'carried'
    and private.club_date(v.closed_at) >= private.club_date() - 90
  order by v.closed_at desc
  limit 1;
$$;

-- The caller holds the National Auditor seat, and this is a President or Treasurer seat (11.8).
create or replace function private.auditor_stays_out(p_role public.position_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_role in ('president', 'treasurer')
    and exists (select 1 from private.held_positions where member_id = auth.uid() and role = 'nec_auditor');
$$;

-- Who decides a vote on acting in this seat: the chapter's board members, less the stand-in, the
-- covered holder and, for a President or Treasurer seat, the National Auditor (8.5, 9.9, 11.8, 11.10).
create or replace function private.acting_electors(p_chapter uuid, p_role public.position_role, p_member uuid, p_covers uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e from private.electors_for('chapter_board', p_chapter) e
  where e is distinct from p_member
    and e is distinct from (select h.member_id from private.held_positions h where h.id = p_covers)
    and not (p_role in ('president', 'treasurer')
             and exists (select 1 from private.held_positions a where a.member_id = e and a.role = 'nec_auditor'))
  order by e;
$$;

-- Route 1: one board member records someone acting in an empty seat, from today (9.8). For
-- President, only the sitting VP; anyone else goes through a board vote (8.2).
create or replace function public.appoint_acting(p_member uuid, p_chapter uuid, p_role public.position_role,
  p_until date, p_why text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  problem text;
  cap date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  perform private.lock_seat(p_chapter, p_role);
  perform private.lock_people(array[p_member]);
  perform private.close_lapsed_acting();
  today := private.club_date();

  if not private.is_board_of(p_chapter) then raise exception 'Only that chapter’s board can record acting here.'; end if;
  if p_member = me then raise exception 'You can’t record yourself as acting.'; end if;
  if private.auditor_stays_out(p_role) then
    raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
  end if;
  problem := private.acting_problem(p_member, p_chapter, p_role, null, p_until);
  if problem is not null then raise exception '%', problem; end if;
  if private.ended_by_vote(p_member, p_chapter, p_role) then
    raise exception 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.';
  end if;
  if private.acting_needs_vote(p_member, p_chapter, p_role) then
    raise exception 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).';
  end if;
  if p_why is null or char_length(btrim(p_why)) not between 1 and 120 then
    raise exception 'Say why, in 120 characters or fewer.';
  end if;
  cap := private.acting_cap(p_chapter, p_role, false, today);
  if cap < today then
    raise exception 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).';
  end if;
  if p_until is null or p_until < today or p_until > cap then
    raise exception 'Pick an until date from today to %.', to_char(cap, 'DD/MM/YYYY');
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, acting_until, acting_why, appointed_by)
  values (p_member, p_chapter, p_role, today, p_until, btrim(p_why), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Route 2: a holder asks, from their own board seat, for a board member to cover it until a date
-- (9.5). Nothing moves until a third board member confirms it.
create or replace function public.request_cover(p_position uuid, p_member uuid, p_until date, p_why text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  seat private.held_positions%rowtype;
  problem text;
  cap date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_member = me then raise exception 'You can’t record yourself as acting.'; end if;
  select * into seat from private.held_positions where id = p_position;
  if not found or seat.member_id <> me or seat.acting_until is not null
     or seat.role not in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
    raise exception 'You can only ask for cover of your own board seat.';
  end if;
  perform private.lock_seat(seat.chapter_id, seat.role);
  perform private.lock_people(array[p_member, me]);
  perform private.close_lapsed_acting();
  today := private.club_date();
  select * into seat from private.held_positions where id = p_position for update;
  if not found then raise exception 'You can only ask for cover of your own board seat.'; end if;

  if exists (
    select 1 from public.acting_requests
    where requested_by = me and chapter_id = seat.chapter_id and role = seat.role and outcome = 'rejected'
      and private.club_date(closed_at) > today - 28) then
    raise exception 'The board voted down your request for this seat in the last 28 days.';
  end if;
  if private.auditor_stays_out(seat.role) then
    raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
  end if;
  if (select count(*) from private.electors_for('chapter_board', seat.chapter_id)) < 3 then
    raise exception 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).';
  end if;
  problem := private.acting_problem(p_member, seat.chapter_id, seat.role, p_position, p_until);
  if problem is not null then raise exception '%', problem; end if;
  if private.ended_by_vote(p_member, seat.chapter_id, seat.role) then
    raise exception 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.';
  end if;
  if private.acting_needs_vote(p_member, seat.chapter_id, seat.role) then
    raise exception 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).';
  end if;
  if p_why is null or char_length(btrim(p_why)) not between 1 and 120 then
    raise exception 'Say why, in 120 characters or fewer.';
  end if;
  cap := private.acting_cap(seat.chapter_id, seat.role, true, today);
  if p_until is null or p_until < today or p_until > cap then
    raise exception 'Pick an until date from today to %.', to_char(cap, 'DD/MM/YYYY');
  end if;

  insert into public.acting_requests (chapter_id, role, member_id, covers, until, why, requested_by)
  values (seat.chapter_id, seat.role, p_member, p_position, p_until, btrim(p_why), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Route 3: a board member proposes acting that needs a board vote: a cover the holder can't be
-- asked about, or an Acting President who isn't the sitting VP (p_covers null for an empty seat).
-- The vote opens on the request (open_acting_vote); once it has carried, confirm_acting seats it.
create or replace function public.request_acting(p_member uuid, p_chapter uuid, p_role public.position_role,
  p_covers uuid, p_until date, p_why text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  holder uuid;
  problem text;
  cap date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  holder := (select h.member_id from private.held_positions h where h.id = p_covers);
  perform private.lock_seat(p_chapter, p_role);
  perform private.lock_people(array[p_member, holder]);
  perform private.close_lapsed_acting();
  today := private.club_date();
  holder := (select h.member_id from private.held_positions h where h.id = p_covers);

  if not private.is_board_of(p_chapter) then raise exception 'Only that chapter’s board can record acting here.'; end if;
  if p_member = me then raise exception 'You can’t record yourself as acting.'; end if;
  if exists (
    select 1 from public.acting_requests
    where requested_by = me and chapter_id = p_chapter and role = p_role and outcome = 'rejected'
      and private.club_date(closed_at) > today - 28) then
    raise exception 'The board voted down your request for this seat in the last 28 days.';
  end if;
  if private.auditor_stays_out(p_role) then
    raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
  end if;
  if (select count(*) from private.acting_electors(p_chapter, p_role, p_member, p_covers)) < 3 then
    raise exception 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).';
  end if;
  if not ((p_covers is not null and holder is distinct from me) or private.acting_needs_vote(p_member, p_chapter, p_role)) then
    raise exception 'This doesn’t need a vote. Record it as acting, or ask for cover from your own seat.';
  end if;
  problem := private.acting_problem(p_member, p_chapter, p_role, p_covers, p_until);
  if problem is not null then raise exception '%', problem; end if;
  if p_why is null or char_length(btrim(p_why)) not between 1 and 120 then
    raise exception 'Say why, in 120 characters or fewer.';
  end if;
  cap := private.acting_cap(p_chapter, p_role, p_covers is not null, today);
  if cap < today then
    raise exception 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).';
  end if;
  if p_until is null or p_until < today or p_until > cap then
    raise exception 'Pick an until date from today to %.', to_char(cap, 'DD/MM/YYYY');
  end if;

  insert into public.acting_requests (chapter_id, role, member_id, covers, until, why, requested_by)
  values (p_chapter, p_role, p_member, p_covers, p_until, btrim(p_why), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- The stand-in (declining) or the holder closes an open request; the person who asked can too, but
-- only while no vote on it is open or has carried, so no one board member undoes a vote (8.2).
create or replace function public.withdraw_acting_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  req public.acting_requests%rowtype;
  holder uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into req from public.acting_requests where id = p_request;
  if not found then raise exception 'That request isn’t open.'; end if;
  holder := (select h.member_id from private.held_positions h where h.id = req.covers);
  perform private.lock_seat(req.chapter_id, req.role);
  perform private.lock_people(array[req.member_id, holder]);
  perform private.close_lapsed_acting();
  select * into req from public.acting_requests where id = p_request for update;
  if req.closed_at is not null then raise exception 'That request isn’t open.'; end if;
  holder := (select h.member_id from private.held_positions h where h.id = req.covers);

  if not (me = req.member_id or me is not distinct from holder or (me = req.requested_by and not exists (
      select 1 from public.votes v where v.acting_request = p_request and (v.closed_at is null or v.result = 'carried')))) then
    raise exception 'Only the stand-in or the holder can withdraw this, or the person who asked before a vote on it opens.';
  end if;
  update public.acting_requests set closed_at = now(), outcome = 'withdrawn' where id = p_request;
end;
$$;

-- A board member who is neither the stand-in nor the holder confirms a request, which seats the
-- stint from today. Every check runs again on the request as it stands now, and one that needs a
-- vote needs it carried in the last 90 days; the row records the vote.
create or replace function public.confirm_acting(p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  req public.acting_requests%rowtype;
  holder uuid;
  problem text;
  vote uuid;
  cap date;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into req from public.acting_requests where id = p_request;
  if not found then raise exception 'That request isn’t open.'; end if;
  holder := (select h.member_id from public.positions h where h.id = req.covers);
  perform private.lock_seat(req.chapter_id, req.role);
  perform private.lock_people(array[req.member_id, holder]);
  perform private.close_lapsed_acting();
  today := private.club_date();
  select * into req from public.acting_requests where id = p_request for update;
  if req.closed_at is not null then raise exception 'That request isn’t open.'; end if;

  if not private.is_board_of(req.chapter_id) then raise exception 'Only that chapter’s board can record acting here.'; end if;
  if me = req.member_id then raise exception 'The stand-in can’t confirm their own acting.'; end if;
  if me = holder then raise exception 'A third board member confirms the cover you asked for (9.5).'; end if;
  if private.auditor_stays_out(req.role) then
    raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
  end if;
  -- Closed first, so the seat checks don't count this request as one waiting; a refusal below
  -- rolls it back.
  update public.acting_requests set closed_at = now(), outcome = 'confirmed' where id = p_request;
  problem := private.acting_problem(req.member_id, req.chapter_id, req.role, req.covers, req.until);
  if problem is not null then raise exception '%', problem; end if;
  if private.request_needs_vote(p_request) then
    vote := private.has_carried_acting_vote(p_request);
    if vote is null then raise exception 'This needs a carried board vote on the request in the last 90 days.'; end if;
  end if;
  if char_length(btrim(req.why)) not between 1 and 120 then raise exception 'Say why, in 120 characters or fewer.'; end if;
  cap := private.acting_cap(req.chapter_id, req.role, req.covers is not null, today);
  if cap < today then
    raise exception 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).';
  end if;
  if req.until < today or req.until > cap then
    raise exception 'Pick an until date from today to %.', to_char(cap, 'DD/MM/YYYY');
  end if;

  insert into public.positions (member_id, chapter_id, role, started_on, acting_until, acting_why, covers,
                                appointed_by, acting_request, acting_vote)
  values (req.member_id, req.chapter_id, req.role, today, req.until, req.why, req.covers, me, p_request, vote)
  returning id into new_id;
  return new_id;
end;
$$;

-- Moves a stint's last day, never before today, logged in acting_changes; the row keeps its start.
-- Earlier: the acting person, or for a cover the covered holder. Later: for an empty seat, a board
-- member who isn't the acting person; for an agreed cover, only the holder ("still away"); within
-- the cap from the stint's start. A stint with a carried vote behind it needs a new vote to run
-- longer, and a President stint recorded because they were the sitting VP runs longer only while
-- they still are.
create or replace function public.set_acting_until(p_position uuid, p_until date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date;
  pos public.positions%rowtype;
  holder public.members%rowtype;
  cap date;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into pos from public.positions where id = p_position;
  if not found then raise exception 'That position no longer exists.'; end if;
  select m.* into holder from public.positions h join public.members m on m.id = h.member_id where h.id = pos.covers;
  perform private.lock_seat(pos.chapter_id, pos.role);
  perform private.lock_people(array[pos.member_id, holder.id]);
  perform private.close_lapsed_acting();
  today := private.club_date();
  select * into pos from public.positions where id = p_position for update;

  if pos.acting_until is null then raise exception 'That isn’t an acting seat.'; end if;
  if pos.ended_on is not null then raise exception 'That term has already ended.'; end if;
  if p_until is null then raise exception 'Pick today or later. To end it now, step down.'; end if;
  if p_until <= pos.acting_until then
    if me <> pos.member_id and me is distinct from holder.id then
      raise exception 'Only the acting person or the holder can bring the date forward.';
    end if;
    if private.auditor_stays_out(pos.role) then
      raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
    end if;
    if p_until < today then raise exception 'Pick today or later. To end it now, step down.'; end if;
  else
    if pos.acting_vote is not null then
      raise exception 'The board voted for this stint, so it needs a new vote to run longer.';
    end if;
    if pos.covers is null then
      if me = pos.member_id or not private.is_board_of(pos.chapter_id) then
        raise exception 'Only another board member can give this more time.';
      end if;
    elsif me is distinct from holder.id then
      raise exception 'Only % can keep this cover going longer.', private.short_name(holder);
    end if;
    if private.auditor_stays_out(pos.role) then
      raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
    end if;
    if pos.role = 'president' then
      if private.ended_by_vote(pos.member_id, pos.chapter_id, pos.role) then
        raise exception 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.';
      end if;
      if private.acting_needs_vote(pos.member_id, pos.chapter_id, pos.role) then
        raise exception 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).';
      end if;
    end if;
    cap := private.acting_cap(pos.chapter_id, pos.role, pos.covers is not null, pos.started_on);
    if cap < today then
      raise exception 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).';
    end if;
    if p_until > cap then raise exception 'Pick an until date from today to %.', to_char(cap, 'DD/MM/YYYY'); end if;
  end if;
  if p_until = pos.acting_until then return; end if;

  update public.positions set acting_until = p_until where id = p_position;
  insert into public.acting_changes (position_id, chapter_id, old_until, new_until, changed_by)
  values (p_position, pos.chapter_id, pos.acting_until, p_until, me);
end;
$$;

revoke all on function private.acting_problem(uuid, uuid, public.position_role, uuid, date),
  private.acting_cap(uuid, public.position_role, boolean, date), private.ended_by_vote(uuid, uuid, public.position_role),
  private.acting_needs_vote(uuid, uuid, public.position_role), private.request_needs_vote(uuid),
  private.has_carried_acting_vote(uuid), private.auditor_stays_out(public.position_role),
  private.acting_electors(uuid, public.position_role, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.appoint_acting(uuid, uuid, public.position_role, date, text),
  public.request_cover(uuid, uuid, date, text),
  public.request_acting(uuid, uuid, public.position_role, uuid, date, text),
  public.withdraw_acting_request(uuid), public.confirm_acting(uuid), public.set_acting_until(uuid, date)
  from public, anon;
grant execute on function public.appoint_acting(uuid, uuid, public.position_role, date, text),
  public.request_cover(uuid, uuid, date, text),
  public.request_acting(uuid, uuid, public.position_role, uuid, date, text),
  public.withdraw_acting_request(uuid), public.confirm_acting(uuid), public.set_acting_until(uuid, date)
  to authenticated;

-- §5 Writers and endings ----------------------------------------------------------------------------

-- Every writer that touches a seat takes the seat lock and the person locks, then runs the lazy
-- close, so it never trips over a stint that lapsed last night (spec "Data shape"); forgetting a
-- member, deleting an account and changing a status run only the lazy close. Every ending says why
-- (ended_reason).

-- A removal vote about this term has carried (9.3): the chapter's vote, naming the holder and the
-- role, in the shape the role takes, closed in the last 90 days and since the term began. An acting
-- row also ends on the chapter board's majority (the shape 9.3 gives a Non-Board removal), and a
-- vote for acting is never one to end it. A 9.3 vote that closes after a stint began counts for it,
-- so a holder can't step down, be recorded acting and outlast the vote.
create or replace function private.has_carried_removal_vote(p_position uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.held_positions p
    join public.votes v on v.subject_member_id = p.member_id and v.subject_role = p.role and v.chapter_id = p.chapter_id
    where p.id = p_position
      and v.acting_request is null
      and ((v.electorate = case
              when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
                then 'chapter_patched' else 'chapter_board' end::public.electorate
            and v.threshold = case
              when p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
                then 'two_thirds' else 'majority' end::public.vote_threshold)
        or (p.acting_until is not null and v.electorate = 'chapter_board' and v.threshold = 'majority'))
      and v.closed_at is not null and v.result = 'carried'
      and private.club_date(v.closed_at) >= private.club_date() - 90
      and private.club_date(v.closed_at) >= p.started_on
  );
$$;

-- A full appointment. Over acting: seating the acting person in full ends their stint (replaced);
-- anyone else waits until they step down or a board vote ends it, because no meeting row proves an
-- election (spec "How it ends"). The seat check counts only full holders, so a cover never takes a
-- seat. Chair and books stay apart only against an acting row, so no sitting holder or 17.6
-- arrangement changes. A carried board vote that ended someone's acting in a board seat holds for
-- 90 days here too.
create or replace function public.appoint_position(p_member uuid, p_chapter uuid, p_role public.position_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  board constant public.position_role[] := array['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];
  me uuid := auth.uid();
  target public.members%rowtype;
  is_national_role boolean := p_role in ('nec_chair', 'nec_secretary', 'nec_auditor');
  seat uuid;
  unfit text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
  if p_member = me then raise exception 'You can’t appoint yourself.'; end if;
  seat := case when is_national_role then null else p_chapter end;
  perform private.lock_seat(seat, p_role);
  perform private.lock_people(array[p_member]);
  perform private.close_lapsed_acting();
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if target.status = 'legacy' then raise exception 'Legacy members don’t hold positions.'; end if;

  if is_national_role then
    if p_role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    if not private.is_chairman() then raise exception 'Only the National Chairman hands out national roles.'; end if;
  else
    if seat is null or seat <> target.chapter_id then raise exception 'They’re not a member of that chapter.'; end if;
    if p_role = 'president' then
      if not private.is_nec_officer() then
        raise exception 'Only the National Chairman or Secretary can seat a President.';
      end if;
    elsif not private.is_board_of(seat) then
      raise exception 'Only that chapter’s board can appoint here.';
    end if;
  end if;

  unfit := private.hold_problem(p_member, p_role);
  if unfit is not null then raise exception '%', unfit; end if;

  -- Their own acting in an empty seat is the one row this appointment replaces.
  if exists (
    select 1 from private.held_positions
    where member_id = p_member and role = p_role and chapter_id is not distinct from seat
      and not (acting_until is not null and covers is null)
  ) then
    raise exception 'They already hold that role.';
  end if;
  if (is_national_role or p_role = any (board))
    and exists (
      select 1 from private.held_positions
      where role = p_role and chapter_id is not distinct from seat and acting_until is null
    ) then
    raise exception 'That seat is taken. End the current term first.';
  end if;
  if p_role = 'president' and exists (
    select 1 from private.held_positions
    where member_id = p_member and chapter_id = seat and role = 'treasurer' and acting_until is not null) then
    raise exception 'An Acting Treasurer can’t also be the chapter’s President (9.5).';
  end if;
  if p_role = 'treasurer' and exists (
    select 1 from private.held_positions
    where member_id = p_member and chapter_id = seat and role = 'president' and acting_until is not null) then
    raise exception 'An Acting President can’t also keep the chapter’s books (9.5).';
  end if;
  if p_role = any (board) then
    if exists (
      select 1 from private.held_positions
      where chapter_id = seat and role = p_role and acting_until is not null and covers is null and member_id <> p_member) then
      raise exception 'Someone is acting in that seat. They step down first, or a carried board vote ends their acting.';
    end if;
    -- On a board seat only acting has the board-majority shape, so this is a vote that ended acting.
    if exists (
      select 1 from public.votes v
      where v.subject_member_id = p_member and v.chapter_id = seat and v.subject_role = p_role
        and v.electorate = 'chapter_board' and v.threshold = 'majority' and v.acting_request is null
        and v.closed_at is not null and v.result = 'carried'
        and private.club_date(v.closed_at) >= private.club_date() - 90) then
      raise exception 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.';
    end if;
  end if;
  -- The Auditor (11.8) and the Secretary (11.6) are seated after a carried two-thirds NEC vote about them.
  if p_role in ('nec_auditor', 'nec_secretary') and not private.has_carried_nec_vote(p_member, p_role) then
    raise exception 'Appointing the National % needs a carried two-thirds NEC vote about them in the last 90 days (%).',
      case p_role when 'nec_auditor' then 'Auditor' else 'Secretary' end,
      case p_role when 'nec_auditor' then '11.8' else '11.6' end;
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), started_on), ended_by = me, ended_reason = 'replaced'
  where member_id = p_member and role = p_role and chapter_id is not distinct from seat
    and ended_on is null and acting_until is not null and covers is null;
  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (p_member, seat, p_role, private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Ending a term. Anyone can step down from their own seat, even while suspended (ChatGPT audit
-- F10). An acting row: the acting person steps down; the covered holder ends a cover of their own
-- seat whenever they're back, agreed or voted, since keeping a willing holder out would be a
-- suspension; anyone else is the chapter board on a carried board-majority vote (9.3), with no NEC
-- officer branch and the Auditor out of President and Treasurer seats (11.8). A normal row is as
-- before: a removal follows its vote (9.3).
create or replace function public.end_position(p_position uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  pos public.positions%rowtype;
  reason text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into pos from public.positions where id = p_position;
  if not found then raise exception 'That position no longer exists.'; end if;
  -- Stepping down from your own seat needs no standing. Ending anyone else's needs approval.
  if pos.member_id <> me and not private.is_approved_member() then
    raise exception 'Only approved members can do that.';
  end if;
  perform private.lock_seat(pos.chapter_id, pos.role);
  perform private.lock_people(array[pos.member_id, (select h.member_id from public.positions h where h.id = pos.covers)]);
  perform private.close_lapsed_acting();
  select * into pos from public.positions where id = p_position for update;
  if pos.ended_on is not null then raise exception 'That term has already ended.'; end if;

  if pos.acting_until is not null then
    if pos.member_id = me then
      reason := 'stepped_down';
    elsif exists (select 1 from public.positions h where h.id = pos.covers and h.member_id = me) then
      reason := 'holder_back';
    else
      if not private.is_board_of(pos.chapter_id) then raise exception 'Only that chapter’s board can end this term.'; end if;
      if private.auditor_stays_out(pos.role) then
        raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
      end if;
      if not private.has_carried_removal_vote(p_position) then
        raise exception 'Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3).';
      end if;
      reason := 'removed';
    end if;
  else
    if pos.role = 'founder' then raise exception 'Founder is an honour the club’s admin records.'; end if;
    if pos.role = 'nec_chair' then
      raise exception 'The National Chairman changes after the vote, and the club’s admin records it.';
    end if;
    -- Ending someone else's takes the right standing and, for a chapter role, a carried removal vote (9.3).
    if pos.member_id <> me then
      if pos.chapter_id is null then
        if not private.is_chairman() then raise exception 'Only the National Chairman can end a national role.'; end if;
      elsif pos.role = 'president' then
        if not (private.is_board_of(pos.chapter_id) or private.is_nec_officer()) then
          raise exception 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.';
        end if;
        if not private.has_carried_removal_vote(p_position) then
          raise exception 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
        end if;
      else
        if not private.is_board_of(pos.chapter_id) then raise exception 'Only that chapter’s board can end this term.'; end if;
        if not private.has_carried_removal_vote(p_position) then
          if pos.role in ('vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
            raise exception 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
          end if;
          raise exception 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).';
        end if;
      end if;
    end if;
    reason := case when pos.member_id = me then 'stepped_down' else 'removed' end;
  end if;

  update public.positions
  set ended_on = greatest(private.club_date(), pos.started_on), ended_by = me, ended_reason = reason
  where id = p_position;
end;
$$;

-- A seat from the club's sheet is one of the terms the constitution records as beginning
-- 1 August 2026 (17.6), so it runs from then. The sheet records the claimant's 2026 election, so the
-- seat was never a 9.8 vacancy: someone acting in it in the meantime stops (replaced, by nobody,
-- logged), and a stint that lapsed last night has closed first. A seat with a holder is skipped, as
-- before.
create or replace function private.add_roster_position(p_member uuid, p_seat uuid, p_role public.position_role)
returns boolean language plpgsql set search_path = '' as $$
declare
  stint public.positions%rowtype;
begin
  select * into stint from private.held_positions
  where chapter_id = p_seat and role = p_role and acting_until is not null and covers is null
    and p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain');
  perform private.lock_seat(p_seat, p_role);
  perform private.lock_people(array[p_member, stint.member_id]);
  perform private.close_lapsed_acting();
  select * into stint from public.positions
  where chapter_id = p_seat and role = p_role and ended_on is null and acting_until is not null and covers is null
    and p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
  for update;
  if found then
    update public.positions
    set ended_on = greatest(private.club_date(), stint.started_on), ended_reason = 'replaced', ended_by = null
    where id = stint.id;
    insert into public.acting_changes (position_id, chapter_id, old_until, new_until, changed_by, note)
    values (stint.id, stint.chapter_id, stint.acting_until, null, p_member, 'Elected holder claimed the seat (17.6)');
  end if;
  insert into public.positions (member_id, chapter_id, role, started_on)
  values (p_member, p_seat, p_role,
          case when p_role = 'founder' then private.club_date() else least(private.club_date(), date '2026-08-01') end);
  return true;
exception when unique_violation then
  return false;
end;
$$;

-- Settles a proposal by the NEC's closed vote on it. Carried: the chapter is made (its chats make
-- themselves), the founders move to it (12.4) and the President and SAA take their seats today.
-- The new chapter's two seats and the founders are locked before the founders' seats are checked,
-- and a founder still acting in their old chapter ends that first. Returns the new chapter's id,
-- or null when the vote didn't carry.
create or replace function public.settle_chapter_proposal(p_id uuid, p_vote uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); p public.chapter_proposals := private.open_chapter_proposal(p_id);
  v public.votes; problem text; new_id uuid := gen_random_uuid();
begin
  if not private.is_national() then raise exception 'Only the NEC can approve a new chapter (12.1).'; end if;
  select * into v from public.votes where id = p_vote and chapter_id is null and electorate = 'nec'
    and closed_at is not null and opened_at > p.proposed_at and not private.vote_used(id);
  if not found then raise exception 'Pick the NEC’s closed vote on it (12.1).'; end if;
  if v.result is distinct from 'carried' then
    update public.chapter_proposals set status = 'not_approved', vote_id = v.id, decided_by = me, decided_at = now() where id = p.id;
    return null;
  end if;
  perform private.lock_seat(new_id, 'president');
  perform private.lock_seat(new_id, 'sergeant_at_arms');
  perform private.lock_people(p.founder_ids);
  perform private.close_lapsed_acting();
  if private.chapter_name_taken(p.name, p.id) then raise exception 'There’s already a chapter called that.'; end if;
  problem := private.founders_problem(p.founder_ids, p.president_id, p.saa_id);
  if problem is not null then raise exception '%', problem; end if;
  if exists (select 1 from private.held_positions where member_id = any (p.founder_ids)
             and chapter_id is not null and role <> 'founder') then
    raise exception 'Founders have to end their positions in their old chapter first.';
  end if;
  insert into public.chapters (id, slug, name, area, state) values (new_id, private.slug_of(p.name), p.name, p.area, p.state);
  update public.members set chapter_id = new_id where id = any (p.founder_ids);
  insert into public.positions (member_id, chapter_id, role, started_on) values
    (p.president_id, new_id, 'president', private.club_date()),
    (p.saa_id, new_id, 'sergeant_at_arms', private.club_date());
  update public.chapter_proposals set status = 'approved', vote_id = v.id, decided_by = me, decided_at = now(), chapter_id = new_id
  where id = p.id;
  return new_id;
end;
$$;

-- With a fresh carried vote, the Chairman renews the sitting Auditor in the last 60 days of their
-- term or after it: the old term ends today (renewed) and a new twelve-month one starts today (11.8).
create or replace function public.renew_auditor()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  seat public.positions%rowtype;
  unfit text;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_chairman() then raise exception 'Only the National Chairman renews the National Auditor.'; end if;
  select * into seat from public.positions where role = 'nec_auditor' and ended_on is null;
  if not found then raise exception 'There’s no sitting National Auditor to renew.'; end if;
  perform private.lock_seat(null, 'nec_auditor');
  perform private.lock_people(array[seat.member_id]);
  perform private.close_lapsed_acting();
  select * into seat from public.positions where id = seat.id and ended_on is null for update;
  if not found then raise exception 'There’s no sitting National Auditor to renew.'; end if;
  if seat.member_id = me then raise exception 'You can’t renew yourself.'; end if;
  if (seat.started_on + interval '1 year')::date - private.club_date() > 60 then
    raise exception 'The Auditor’s term isn’t ending yet. Renew in its last 60 days.';
  end if;
  unfit := private.hold_problem(seat.member_id, 'nec_auditor');
  if unfit is not null then raise exception '%', unfit; end if;
  if not private.has_carried_auditor_vote(seat.member_id) then
    raise exception 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).';
  end if;
  update public.positions set ended_on = greatest(private.club_date(), seat.started_on), ended_by = me, ended_reason = 'renewed'
  where id = seat.id;
  insert into public.positions (member_id, chapter_id, role, started_on, appointed_by)
  values (seat.member_id, null, 'nec_auditor', private.club_date(), me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Forgets a deleted account (as before): closes stints that lapsed last night first, then ends the
-- member's open rows as forgotten. Ending a covered holder's row ends the cover with it (left_board).
create or replace function private.forget_member(p_member uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today constant date := private.club_date();
begin
  perform private.close_lapsed_acting();
  delete from public.member_private where member_id = p_member;
  delete from public.bikes where member_id = p_member; -- regos go with them
  delete from public.emergency_contacts where member_id = p_member;
  delete from public.notification_prefs where member_id = p_member;
  delete from public.push_devices where member_id = p_member;
  delete from private.push_outbox where member_id = p_member;
  -- Chat
  -- Their messages go, with photos and reactions, apart from any someone has reported: those stay
  -- for the board to deal with.
  delete from public.messages m where m.author_id = p_member
    and not exists (select 1 from public.message_reports r where r.message_id = m.id);
  delete from public.message_reactions where member_id = p_member;
  delete from public.message_reports where reporter_id = p_member;
  delete from public.chat_reads where member_id = p_member;
  delete from public.conversation_members where member_id = p_member;
  delete from public.member_blocks where blocker_id = p_member or blocked_id = p_member;
  -- Rides
  delete from public.rsvps where member_id = p_member;
  delete from public.ride_crew where member_id = p_member;
  delete from public.crew_swaps where asked_by = p_member or asked_to = p_member;
  delete from public.ride_briefing_reads where member_id = p_member;
  delete from public.road_rules_signoffs where member_id = p_member;
  delete from public.live_riders where member_id = p_member;
  delete from public.ride_alerts where member_id = p_member;
  delete from public.route_ratings where member_id = p_member;
  delete from public.hub_registrations where member_id = p_member;
  delete from public.charity_signups where member_id = p_member;
  delete from public.document_signoffs where member_id = p_member;
  -- Social
  delete from public.member_birthdays where member_id = p_member;
  delete from public.member_skills where member_id = p_member;
  delete from public.mechanic_vouches where member_id = p_member;
  delete from public.listings where seller_id = p_member;
  delete from public.build_updates where author_id = p_member;
  delete from public.brag_nominations where nominated_by = p_member; -- with the votes on them
  delete from public.brag_votes where member_id = p_member;
  -- The club shop: the orders stay for the books, without the name, email, address and phone.
  delete from public.shop_runners where member_id = p_member;
  update public.shop_orders set buyer_name = 'Former member', road_name = null, email = '', phone = null,
         street = null, suburb = null, state = null, postcode = null where member_id = p_member;
  update private.roster
     set phone = null, emergency_name = null, emergency_relationship = null, emergency_phone = null,
         bike_make = null, bike_model = null, bike_rego = null, roles = '{}',
         -- Used for good: claim_roster only takes a place never claimed (ChatGPT audit F01).
         claimed_at = coalesce(claimed_at, now())
   where claimed_by = p_member or (p_email is not null and lower(trim(email)) = lower(trim(p_email)));

  -- Their files (deep audit F1): everything they uploaded to the personal buckets that no surviving
  -- row still names. A file on a reported message stays with the message, for the board. The
  -- purge-files Edge Function deletes what's queued; the database can't reach Storage itself.
  insert into private.storage_purge (bucket, path, member_id)
  select o.bucket_id, o.name, p_member
  from storage.objects o
  where o.owner_id = p_member::text
    and o.bucket_id in ('chat-media', 'swap-media', 'build-media', 'brag-media')
    and not exists (select 1 from public.message_media mm where mm.path = o.name or mm.poster_path = o.name)
    and not exists (select 1 from public.listings l where l.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.build_updates u where u.photos @> jsonb_build_array(jsonb_build_object('path', o.name)))
    and not exists (select 1 from public.brag_nominations n where n.photo->>'path' = o.name);

  delete from public.positions where member_id = p_member and ended_on is null and started_on > today;
  update public.positions set ended_on = today, ended_reason = 'forgotten' where member_id = p_member and ended_on is null;
  update public.members
     set full_name = 'Former member', road_name = null, bio = null, share_phone = false, on_hiatus = false,
         approval = 'declined', account_deleted_on = today, updated_at = now()
   where id = p_member;
end $function$;

-- Delete my account (as before): a seat the club has to fill comes first, and so does any stint,
-- acting in any role. A stint that lapsed last night doesn't count.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  perform private.close_lapsed_acting();
  if exists (select 1 from private.held_positions where member_id = me and role = 'nec_chair') then
    raise exception 'The National Chairman’s seat changes by the club’s vote. To delete your account, email apps@rustnutssmc.com.au.';
  end if;
  if exists (
    select 1 from private.held_positions
    where member_id = me
      and (acting_until is not null
           or role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain',
                       'nec_chair', 'nec_secretary', 'nec_auditor'))
  ) then
    raise exception 'Step down from your seat first, so the club can fill it. Then you can delete your account.';
  end if;
  delete from auth.users where id = me; -- the trigger forgets the member
end;
$$;

-- A member's status (as downward_notice_gate.sql): "End their positions first" reads held rows, so
-- an acting row blocks the change and a stint that lapsed last night doesn't, and it closes first.
create or replace function public.set_member_status(p_member uuid, p_status public.member_status, p_by_request boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  today date := private.club_date();
  notice uuid;
begin
  if p_member = auth.uid() then raise exception 'You can’t change your own status.'; end if;
  perform private.close_lapsed_acting();
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
    select 1 from private.held_positions where member_id = p_member and role <> 'founder'
  ) then
    raise exception 'End their positions first.';
  end if;
  if p_status = 'nomad' and exists (
    select 1 from private.held_positions where member_id = p_member
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
$$;

-- §6 Votes ------------------------------------------------------------------------------------------

-- A vote about acting is one to seat it (open_acting_vote, on a request that needs one) or one to end
-- it (open_vote, naming a role its subject holds as acting). Either is a majority of the chapter
-- board, decided without the acting person, the covered holder or, for a President or Treasurer
-- seat, the National Auditor (8.5, 9.3, 9.9, 11.8, 11.10), by at least three of the rest (8.6). It
-- stays open at least 48 hours, so the holder can answer and nobody voids it by closing early:
-- close_vote won't close it sooner, even when everyone has voted. An NEC ballot belongs to its
-- chapter (11.2), so each NEC elector row names it (for_chapter).

-- Opening a vote (as removal_and_gate.sql, same signature). Stints that lapsed last night close
-- first, and the subject checks read held rows. A vote naming a role its subject holds as acting is
-- one to end their acting: a chapter board majority (ACTING_END_SHAPE), its electors and quorum
-- from acting_electors (SMALL_BOARD under three), closing 48 hours or more after it opens
-- (ACTING_VOTE_OPEN). Each NEC ballot is a chapter's voter's, with the chapter on the row; a chapter
-- with nobody to cast it gets none.
create or replace function public.open_vote(
  p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text,
  p_electorate public.electorate, p_threshold public.vote_threshold, p_secret boolean, p_quorum int,
  p_closes_at timestamptz, p_role public.position_role default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  electors int;
  subject public.members%rowtype;
  stint private.held_positions%rowtype;
  opened uuid;
begin
  perform private.close_lapsed_acting();
  perform private.require_scope(p_chapter);
  if nullif(trim(p_question), '') is null then raise exception 'Ask a question.'; end if;
  if (p_chapter is null) <> (p_electorate in ('club_patched', 'nec')) then
    raise exception 'That electorate doesn’t fit here.';
  end if;
  -- The subject's acting row in that role: a vote about it ends their acting (9.3).
  if p_chapter is not null and p_subject is not null and p_role is not null then
    select * into stint from private.held_positions
    where member_id = p_subject and chapter_id = p_chapter and role = p_role and acting_until is not null;
  end if;
  if stint.id is not null then
    if p_electorate <> 'chapter_board' or p_threshold <> 'majority' then
      raise exception 'Ending someone’s acting is a majority vote of the chapter board (9.3).';
    end if;
    select count(*) into electors from private.acting_electors(p_chapter, p_role, p_subject, stint.covers);
    if electors < 3 then
      raise exception 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).';
    end if;
    if p_closes_at < now() + interval '48 hours' then
      raise exception 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.';
    end if;
  else
    select count(*) into electors from private.electors_for(p_electorate, p_chapter);
    if electors = 0 then raise exception 'Nobody can vote in that electorate yet.'; end if;
    if p_electorate = 'chapter_board' and electors < 3 then
      raise exception 'A board vote needs at least three board members (8.5).';
    end if;
  end if;
  if p_quorum is null or p_quorum < private.min_quorum(p_electorate, electors) or p_quorum > electors then
    raise exception 'Quorum must be between % and %.', private.min_quorum(p_electorate, electors), electors;
  end if;
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Pick a closing time in the future.'; end if;
  if p_closes_at > now() + interval '1440 hours' then raise exception 'Votes can stay open for 60 days at most.'; end if;
  -- A vote that names a role: the NEC seats someone (11.6, 11.8), or a chapter removes someone (9.3).
  if p_role is not null and p_chapter is null and p_role not in ('nec_auditor', 'nec_secretary') then
    raise exception 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).';
  end if;
  if p_role in ('nec_auditor', 'nec_secretary') and (p_subject is null or p_chapter is not null) then
    raise exception 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).';
  end if;
  if p_role is not null and p_chapter is not null and (p_subject is null or p_role in ('founder', 'nec_chair')) then
    raise exception 'A removal vote is the chapter’s vote about one of its own role holders (9.3).';
  end if;
  if p_subject is not null and p_chapter is null then
    select * into subject from public.members where id = p_subject;
    if found and subject.approval = 'approved' and subject.status = 'full' then
      -- Seating a Full Member as National Auditor (11.8) or National Secretary (11.6): two-thirds of
      -- the NEC, on someone who could hold the seat.
      if p_role is null then
        raise exception 'Say which seat the vote is for: National Auditor or National Secretary (11.6, 11.8).';
      end if;
      if p_role = 'nec_auditor' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from private.held_positions where member_id = p_subject
             and role in ('president', 'treasurer', 'nec_chair', 'nec_secretary'))) then
        raise exception 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
      end if;
      if p_role = 'nec_secretary' and (p_electorate <> 'nec' or p_threshold <> 'two_thirds' or exists (
           select 1 from private.held_positions where member_id = p_subject
             and role in ('nec_chair', 'nec_secretary', 'nec_auditor'))) then
        raise exception 'A vote to appoint the National Secretary is an NEC two-thirds vote on a Full Member who isn’t already National Chairman, Secretary or Auditor (11.6).';
      end if;
    elsif p_role is not null then
      raise exception 'Only a Full Member can be voted into a national seat (9.1).';
    elsif not found or subject.approval <> 'approved' or subject.status not in ('supporter', 'legacy', 'family', 'introduced')
       or p_electorate <> 'nec' or p_threshold <> 'majority' then
      -- Bringing someone back to Full or Nomad is the NEC's decision (5.6).
      raise exception 'A reinstatement vote is an NEC majority vote on a member who isn’t Full, Nomad or an FNG (5.6).';
    end if;
  elsif p_subject is not null and p_role is not null then
    -- A removal vote (9.3): about a Full Member or Nomad who holds that role in this chapter. A board
    -- seat goes by two-thirds of the chapter's Full Members; any other chapter role by a board majority.
    -- Ending someone's acting took its shape above.
    select * into subject from public.members where id = p_subject;
    if not found or subject.approval <> 'approved' or subject.status not in ('full', 'nomad') or not exists (
         select 1 from private.held_positions
         where member_id = p_subject and chapter_id = p_chapter and role = p_role) then
      raise exception 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).';
    end if;
    if stint.id is not null then
      null;
    elsif p_role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain') then
      if p_electorate <> 'chapter_patched' or p_threshold <> 'two_thirds' then
        raise exception 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).';
      end if;
    elsif p_electorate <> 'chapter_board' or p_threshold <> 'majority' then
      raise exception 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).';
    end if;
  elsif p_subject is not null then
    select * into subject from public.members where id = p_subject;
    if not found or subject.chapter_id <> p_chapter or subject.approval <> 'approved' or subject.status <> 'fng' then
      raise exception 'A patch vote is for an approved FNG of that chapter.';
    end if;
    if p_electorate <> 'chapter_patched' or p_threshold <> 'unanimous' or not coalesce(p_secret, false) then
      raise exception 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.';
    end if;
    -- Full Membership can't be granted before nine months (4.7).
    if subject.fng_started_on is not null and subject.fng_started_on + interval '9 months' > private.club_date() then
      raise exception 'A patch vote can open only nine months into the FNG’s trial (4.7).';
    end if;
  end if;
  if p_meeting is not null and not exists (
    select 1 from public.meetings where id = p_meeting and chapter_id is not distinct from p_chapter) then
    raise exception 'No such meeting.';
  end if;

  insert into public.votes (chapter_id, meeting_id, subject_member_id, subject_role, question, details, electorate,
                            threshold, secret, quorum, closes_at, created_by)
  values (p_chapter, p_meeting, p_subject, p_role, trim(p_question), nullif(trim(p_details), ''), p_electorate,
          p_threshold, coalesce(p_secret, false), p_quorum, p_closes_at, me)
  returning id into opened;
  if stint.id is not null then
    insert into public.vote_electors (vote_id, member_id)
    select opened, e from private.acting_electors(p_chapter, p_role, p_subject, stint.covers) e;
  elsif p_electorate = 'nec' then
    insert into public.vote_electors (vote_id, member_id, for_chapter)
    select opened, x.voter, x.id
    from (select c.id, private.nec_voter_for(c.id) as voter from public.chapters c) x
    where x.voter in (select private.electors_for('nec', null));
  else
    insert into public.vote_electors (vote_id, member_id)
    select opened, e from private.electors_for(p_electorate, p_chapter) e;
  end if;
  return opened;
end;
$$;

-- Route 3's vote (spec "How a stint starts"): a board member who isn't the stand-in opens the
-- board's vote on a request that needs one. It's a majority of the chapter board, not secret, about
-- the stand-in and the seat, decided by acting_electors, with the quorum worked out on them and a
-- closing time 48 hours or more away; the question comes from the request. Once it has carried,
-- confirm_acting seats the stint. Checks, in the app's order (Task 13 mirrors them): the request is
-- open and needs a vote; a board member of its chapter who isn't the stand-in; the Auditor; too few
-- to decide it; the 48 hours; then open_vote's quorum, closing and meeting words.
create or replace function public.open_acting_vote(p_request uuid, p_quorum int, p_closes_at timestamptz, p_meeting uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  req public.acting_requests%rowtype;
  stand_in public.members%rowtype;
  holder public.members%rowtype;
  electors int;
  opened uuid;
begin
  select * into req from public.acting_requests where id = p_request;
  if not found then raise exception 'That request isn’t open.'; end if;
  perform private.lock_seat(req.chapter_id, req.role);
  perform private.lock_people(array[req.member_id, (select h.member_id from private.held_positions h where h.id = req.covers)]);
  perform private.close_lapsed_acting();
  select * into req from public.acting_requests where id = p_request for update;
  if req.closed_at is not null then raise exception 'That request isn’t open.'; end if;

  if not private.request_needs_vote(p_request) then
    raise exception 'This request doesn’t need a vote. A third board member confirms it.';
  end if;
  if not private.is_board_of(req.chapter_id) then raise exception 'Only that chapter’s board can record acting here.'; end if;
  if me = req.member_id then raise exception 'You can’t record yourself as acting.'; end if;
  if private.auditor_stays_out(req.role) then
    raise exception 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
  end if;
  select count(*) into electors from private.acting_electors(req.chapter_id, req.role, req.member_id, req.covers);
  if electors < 3 then
    raise exception 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).';
  end if;
  if p_closes_at < now() + interval '48 hours' then
    raise exception 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.';
  end if;
  if p_quorum is null or p_quorum < private.min_quorum('chapter_board', electors) or p_quorum > electors then
    raise exception 'Quorum must be between % and %.', private.min_quorum('chapter_board', electors), electors;
  end if;
  if p_closes_at is null or p_closes_at <= now() then raise exception 'Pick a closing time in the future.'; end if;
  if p_closes_at > now() + interval '1440 hours' then raise exception 'Votes can stay open for 60 days at most.'; end if;
  if p_meeting is not null and not exists (select 1 from public.meetings where id = p_meeting and chapter_id = req.chapter_id) then
    raise exception 'No such meeting.';
  end if;

  select * into stand_in from public.members where id = req.member_id;
  select m.* into holder from private.held_positions h join public.members m on m.id = h.member_id where h.id = req.covers;
  insert into public.votes (chapter_id, meeting_id, subject_member_id, subject_role, question, electorate, threshold,
                            secret, quorum, closes_at, created_by, acting_request)
  values (req.chapter_id, p_meeting, req.member_id, req.role,
          private.short_name(stand_in) || ' acts as ' || private.role_label(req.role)
            || ' (' || (select c.name from public.chapters c where c.id = req.chapter_id) || ')'
            || case when holder.id is not null then ' for ' || private.short_name(holder) else '' end
            || ' until ' || to_char(req.until, 'DD/MM/YYYY') || ': ' || req.why,
          'chapter_board', 'majority', false, p_quorum, p_closes_at, me, p_request)
  returning id into opened;
  insert into public.vote_electors (vote_id, member_id)
  select opened, e from private.acting_electors(req.chapter_id, req.role, req.member_id, req.covers) e;
  return opened;
end;
$$;

-- Closing a vote (as removal_and_gate.sql). A vote about acting (on a request, or naming a role its
-- subject holds as acting) can't close within 48 hours of opening, even when everyone has voted.
-- Afterwards the lazy close runs, so a lost vote on a request closes it as rejected now, and the 28
-- days before its requester can ask again count from the day it was lost.
create or replace function public.close_vote(p_vote uuid, p_casting text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  v public.votes%rowtype;
  n_yes int; n_no int; n_abstain int; n_electors int;
  res public.vote_result;
  tied boolean;
  represented boolean;
  about_member boolean;
  chair uuid;
begin
  select * into v from public.votes where id = p_vote for update;
  if not found then raise exception 'No such vote.'; end if;
  perform private.require_scope(v.chapter_id);
  if v.closed_at is not null then raise exception 'That vote has already closed.'; end if;
  if now() < v.opened_at + interval '48 hours' and (v.acting_request is not null or exists (
       select 1 from private.held_positions h
       where h.member_id = v.subject_member_id and h.chapter_id = v.chapter_id and h.role = v.subject_role
         and h.acting_until is not null)) then
    raise exception 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.';
  end if;
  if now() < v.closes_at and exists (select 1 from public.vote_electors where vote_id = p_vote and voted_at is null) then
    raise exception 'Wait until it closes, or until everyone has voted.';
  end if;
  select count(*) filter (where choice = 'yes'), count(*) filter (where choice = 'no'), count(*) filter (where choice = 'abstain')
  into n_yes, n_no, n_abstain from public.vote_ballots where vote_id = p_vote;
  select count(*) into n_electors from public.vote_electors where vote_id = p_vote;
  select d.result, d.tied into res, tied from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, null, n_electors) d;
  represented := v.electorate <> 'club_patched' or private.chapters_represented(p_vote);
  if not represented then res := 'no_quorum'; tied := false; end if;
  about_member := v.subject_member_id is not null;
  chair := private.chair_of(v.chapter_id);
  if tied and about_member and p_casting is not null then
    raise exception 'No casting vote on a vote about a member (10.7): a tie is lost.';
  end if;
  -- The chair casts or declines, and a declined tie is lost (9.10).
  if tied and not about_member and chair is not null and (p_casting is null or me <> chair) then
    raise exception 'It’s a tie. The chair gives a casting vote or lets it fall.';
  end if;
  if not tied and p_casting is not null then raise exception 'There’s no tie, so no casting vote.'; end if;
  if p_casting in ('yes', 'no') and chair is null then
    raise exception 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.';
  end if;
  if p_casting is not null and p_casting not in ('yes', 'no', 'decline') then raise exception 'Pick an answer.'; end if;
  if tied and not about_member then
    select d.result into res from private.decide(v.threshold, v.quorum, n_yes, n_no, n_abstain, p_casting, n_electors) d;
  end if;

  -- A patch vote keeps only its result (4.9): no counts, and its ballots are blanked.
  if v.subject_member_id is not null and v.subject_role is null and v.electorate = 'chapter_patched' then
    update public.vote_ballots set choice = null where vote_id = p_vote;
    n_yes := null; n_no := null; n_abstain := null;
  end if;
  update public.votes set closed_at = now(), result = res, casting_vote = nullif(p_casting, 'decline'),
    yes_count = n_yes, no_count = n_no, abstain_count = n_abstain
  where id = p_vote;
  perform private.close_lapsed_acting();
end;
$$;

-- The club's business (as audit_fixes.sql, same signature and settings). Each vote also carries the
-- request an acting vote is on, and whose chapter each NEC ballot is (elector to chapter, {} when
-- none). An open NEC vote is also listed to whoever would take a chapter's uncast ballot on it (its
-- voter before the day it opened), so a VP who takes one sees it, as the app's canSeeVote.
create or replace function public.club_business()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid();
begin
  if not private.is_approved_member() then
    return jsonb_build_object('meetings', '[]'::jsonb, 'action_items', '[]'::jsonb, 'votes', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'chapter_id', m.chapter_id, 'kind', m.kind, 'title', m.title, 'starts_at', m.starts_at,
        'location', m.location, 'agenda', m.agenda,
        -- A shared draft goes to everyone who sees the meeting (10.8).
        'minutes', case when m.minutes_approved_at is not null or m.minutes_shared_at is not null
                          or private.reviews_scope(m.chapter_id) then m.minutes end,
        'minutes_shared_at', m.minutes_shared_at,
        'minutes_approved_at', m.minutes_approved_at, 'minutes_approved_by', m.minutes_approved_by,
        'cancelled_at', m.cancelled_at, 'created_by', m.created_by) order by m.starts_at, m.id)
      from public.meetings m
      where m.kind not in ('board', 'nec') or private.reviews_scope(m.chapter_id)), '[]'::jsonb),
    'action_items', coalesce((
      select jsonb_agg(to_jsonb(a) - 'created_at' - 'created_by' order by a.due_on nulls last, a.created_at)
      from public.action_items a
      where a.owner_id = me or private.reviews_scope(a.chapter_id)), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'chapter_id', v.chapter_id, 'meeting_id', v.meeting_id, 'subject_member_id', v.subject_member_id,
        'subject_role', v.subject_role,
        'question', v.question, 'details', v.details, 'electorate', v.electorate, 'threshold', v.threshold,
        'secret', v.secret, 'quorum', v.quorum, 'opened_at', v.opened_at, 'closes_at', v.closes_at,
        'closed_at', v.closed_at, 'result', v.result, 'casting_vote', v.casting_vote, 'created_by', v.created_by,
        'tally', case when v.closed_at is not null and v.yes_count is not null
                      then jsonb_build_object('yes', v.yes_count, 'no', v.no_count, 'abstain', v.abstain_count) end,
        'elector_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                        from public.vote_electors e where e.vote_id = v.id),
        'voted_ids', (select coalesce(jsonb_agg(e.member_id order by e.member_id), '[]'::jsonb)
                      from public.vote_electors e where e.vote_id = v.id and e.voted_at is not null),
        'my_voted', exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me and e.voted_at is not null),
        'ballots', case when v.closed_at is not null and not v.secret then (
                     select coalesce(jsonb_agg(jsonb_build_object('member_id', b.member_id, 'choice', b.choice)
                                               order by b.member_id), '[]'::jsonb)
                     from public.vote_ballots b where b.vote_id = v.id)
                   else '[]'::jsonb end,
        'acting_request', v.acting_request,
        'elector_chapters', (select coalesce(jsonb_object_agg(e.member_id, e.for_chapter), '{}'::jsonb)
                             from public.vote_electors e where e.vote_id = v.id and e.for_chapter is not null)
        ) order by v.opened_at desc, v.id)
      from public.votes v
      where private.reviews_scope(v.chapter_id)
         or exists (select 1 from public.vote_electors e where e.vote_id = v.id and e.member_id = me)
         or (v.electorate = 'nec' and v.closed_at is null and exists (
               select 1 from public.vote_electors e
               where e.vote_id = v.id and e.voted_at is null and e.for_chapter is not null
                 and private.nec_voter_before(e.for_chapter, private.club_date(v.opened_at)) = me))), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.open_acting_vote(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.open_acting_vote(uuid, int, timestamptz, uuid) to authenticated;

-- §7 Money (13.3) -----------------------------------------------------------------------------------

-- Two independent approvers (13.3, 9.5): an approval never pairs someone with the person who put
-- them in an acting seat, in either order, and never comes from the payee's own stand-in. "Put
-- there by" is the acting row's appointed_by, or the requested_by of the request it was confirmed
-- from. "Stands only through acting" is an acting board row in the fund's chapter with no
-- non-acting board row there and no nec_chair or nec_secretary row, so nobody does on the Club fund.
-- The member approving is judged by their held rows now. Each approver already counted is judged
-- by their rows on the day they approved, read from the table: an acting row held at any time that
-- day, a non-acting one only if held all day, so a later or same-day step-down, lapse or seating
-- changes nothing. Null, or the refusal's words. Mirrors approvalConflict.
create or replace function private.approval_conflict(p_entry uuid, p_member uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  board constant public.position_role[] := array['president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];
  e public.ledger_entries;
  who text;
begin
  select * into e from public.ledger_entries where id = p_entry;
  if not found then return null; end if;
  -- Seated: the member stands only through acting rows that the recorder, the payee or an approver
  -- already counted put there.
  select private.short_name(m) into who
  from (select e.recorded_by as id, 0 as n, null::timestamptz as at
        union all select e.payee_member_id, 1, null
        union all select a.member_id, 2, a.approved_at from public.ledger_approvals a
                  where a.entry_id = p_entry and a.member_id <> p_member) x
  join public.members m on m.id = x.id
  where x.id <> p_member
    and not exists (
      select 1 from private.held_positions o
      where o.member_id = p_member and o.acting_until is null
        and ((o.chapter_id = e.chapter_id and o.role = any (board)) or o.role in ('nec_chair', 'nec_secretary')))
    and exists (
      select 1 from private.held_positions h left join public.acting_requests r on r.id = h.acting_request
      where h.member_id = p_member and h.chapter_id = e.chapter_id and h.role = any (board)
        and h.acting_until is not null and x.id in (h.appointed_by, r.requested_by))
  order by x.n, x.at, x.id
  limit 1;
  if who is not null then
    return 'You’re acting because ' || who || ' put you there, so you can’t be the second approver on their entry (13.3).';
  end if;
  -- Planted: an approver already counted stood only through acting the day they approved, in a row
  -- the member put there.
  select private.short_name(m) into who
  from public.ledger_approvals a
  cross join lateral (select private.club_date(a.approved_at) as d) day
  join public.members m on m.id = a.member_id
  where a.entry_id = p_entry and a.member_id <> p_member
    and not exists (
      select 1 from public.positions o
      where o.member_id = a.member_id and o.acting_until is null
        and ((o.chapter_id = e.chapter_id and o.role = any (board)) or o.role in ('nec_chair', 'nec_secretary'))
        and o.started_on < day.d and (o.ended_on is null or o.ended_on > day.d))
    and exists (
      select 1 from public.positions h left join public.acting_requests r on r.id = h.acting_request
      where h.member_id = a.member_id and h.chapter_id = e.chapter_id and h.role = any (board)
        and h.acting_until >= day.d and h.started_on <= day.d and (h.ended_on is null or h.ended_on >= day.d)
        and p_member in (h.appointed_by, r.requested_by))
  order by a.approved_at, a.member_id
  limit 1;
  if who is not null then
    return who || ' is acting because you put them there, so you can’t be the second approver after them (13.3).';
  end if;
  -- The payee's stand-in: their payment goes to the other approvers.
  select private.short_name(m) into who
  from private.held_positions c
  join public.positions p on p.id = c.covers
  join public.members m on m.id = p.member_id
  where c.member_id = p_member and p.member_id = e.payee_member_id
  limit 1;
  if who is not null then
    return 'You’re covering ' || who || '’s seat, so their payment goes to the other approvers (13.3).';
  end if;
  return null;
end;
$$;

revoke all on function private.approval_conflict(uuid, uuid) from public, anon, authenticated;

-- A debit waits for two approvals (as treasurer.sql, same signature). Whoever records it counts as
-- the first when they can approve for that fund, aren't the payee (inferred) and approving wouldn't
-- break the independence rule above; otherwise it simply waits, with no error. The bank takes its
-- fees, so those are paid.
create or replace function public.record_debit(
  p_chapter uuid, p_code text, p_description text, p_amount_cents int, p_payee_member uuid, p_payee_name text, p_paid_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(p_chapter); new_id uuid; bank boolean := p_code = 'DB-004';
begin
  if not exists (select 1 from public.ledger_codes where code = p_code and direction = 'debit') then
    raise exception 'Pick a money-out code.';
  end if;
  if coalesce(private.trim_like_app(p_description), '') = '' then raise exception 'Say what it’s for.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if bank then
    if p_paid_on is null then raise exception 'Pick the date the bank took it.'; end if;
    if p_paid_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  elsif p_payee_member is not null then
    if not private.is_approved(p_payee_member) then raise exception 'No such member.'; end if;
  elsif coalesce(private.trim_like_app(p_payee_name), '') = '' then
    raise exception 'Say who’s being paid.';
  end if;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, entry_on, payee_member_id, payee_name, state, recorded_by)
  values (p_chapter, p_code, private.trim_like_app(p_description), p_amount_cents, case when bank then p_paid_on end,
          case when bank then null else p_payee_member end,
          case when bank then coalesce(nullif(private.trim_like_app(p_payee_name), ''), 'Bank')
               else nullif(private.trim_like_app(p_payee_name), '') end,
          case when bank then 'paid' else 'awaiting' end, me)
  returning id into new_id;
  if not bank and private.approves_for(p_chapter) and p_payee_member is distinct from me
     and private.approval_conflict(new_id, me) is null then
    insert into public.ledger_approvals (entry_id, member_id) values (new_id, me);
  end if;
  return new_id;
end;
$$;

-- The second distinct, independent approval makes it approved (13.3; as treasurer.sql, same
-- signature).
create or replace function public.approve_debit(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); e public.ledger_entries; conflict text;
begin
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.approves_for(e.chapter_id) then raise exception 'You can’t approve spending from this fund.'; end if;
  if e.state <> 'awaiting' then raise exception 'That isn’t waiting for approval.'; end if;
  if e.payee_member_id = me then raise exception 'The payee can’t approve their own payment (13.3).'; end if;
  if exists (select 1 from public.ledger_approvals where entry_id = p_id and member_id = me) then
    raise exception 'You’ve already approved this.';
  end if;
  conflict := private.approval_conflict(p_id, me);
  if conflict is not null then raise exception '%', conflict; end if;
  insert into public.ledger_approvals (entry_id, member_id) values (p_id, me);
  update public.ledger_entries
  set state = case when (select count(*) from public.ledger_approvals where entry_id = p_id) >= 2 then 'approved' else 'awaiting' end,
      updated_at = now()
  where id = p_id;
end;
$$;
