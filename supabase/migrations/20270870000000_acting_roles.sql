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
