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
  holder uuid := (select h.member_id from public.positions h where h.id = new.covers);
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
