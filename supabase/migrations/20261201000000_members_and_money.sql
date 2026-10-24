-- Stage 4: members and money. See docs/superpowers/specs/2026-10-24-members-and-money-design.md.
-- Check-ins at rides and meetings, the board's decisions on applicants and FNG reviews, and fees
-- with PayID claims and receipts. Everything is written through the actions below, which apply
-- the same rules with the same words as the app (src/domain/attendance.ts, joining.ts, fees.ts).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ride', 'meeting')),
  chapter_id uuid references public.chapters (id), -- null: a whole-club ride
  ride_id uuid unique references public.rides (id),
  title text not null check (length(trim(title)) > 0),
  held_on date not null,
  code text not null unique,
  opened_by uuid references public.members (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check (kind = 'ride' or (chapter_id is not null and ride_id is null)),
  check (kind = 'meeting' or ride_id is not null)
);
create index checkin_sessions_held_on on public.checkin_sessions (held_on);

create table public.attendance (
  session_id uuid not null references public.checkin_sessions (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  marked_by uuid references public.members (id) on delete set null, -- null: checked themselves in
  primary key (session_id, member_id)
);
create index attendance_member on public.attendance (member_id);

create table public.member_decisions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  kind text not null check (kind in ('application', 'fng_review')),
  at_months int check (at_months is null or at_months >= 6),
  outcome text not null check (outcome in ('approved', 'declined', 'continue', 'patch', 'not_continuing')),
  status public.member_status,
  votes_for int check (votes_for >= 0),
  votes_against int check (votes_against >= 0),
  votes_abstained int check (votes_abstained >= 0),
  note text,
  decided_on date not null,
  recorded_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'fng_review') = (at_months is not null))
);
create unique index member_decisions_one_per_slot on public.member_decisions (member_id, at_months) where kind = 'fng_review';

create table public.fee_rates (
  chapter_id uuid not null references public.chapters (id),
  fy int not null,
  status public.member_status not null check (status in ('full', 'nomad', 'fng', 'supporter', 'family')),
  amount_cents int not null check (amount_cents > 0),
  due_on date not null,
  primary key (chapter_id, fy, status)
);

create table public.continuation_fees (
  chapter_id uuid not null references public.chapters (id),
  fy int not null,
  amount_cents int not null check (amount_cents > 0),
  primary key (chapter_id, fy)
);

create table public.payment_details (
  chapter_id uuid primary key references public.chapters (id),
  payid text,
  payid_name text,
  bsb text,
  account_no text,
  updated_at timestamptz not null default now()
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id),
  fy int not null,
  kind text not null check (kind in ('annual', 'continuation', 'other')),
  description text,
  amount_cents int not null check (amount_cents > 0),
  due_on date not null,
  raised_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  waived_at timestamptz,
  waived_by uuid references public.members (id) on delete set null
);
create unique index charges_one_yearly on public.charges (member_id, fy, kind) where kind in ('annual', 'continuation');
create index charges_chapter on public.charges (chapter_id, fy);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  paid_on date not null,
  method text not null check (method in ('payid', 'bank', 'cash', 'card')),
  reference text,
  state text not null default 'claimed' check (state in ('claimed', 'confirmed', 'rejected')),
  claimed_by uuid references public.members (id) on delete set null,
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  receipt_no text unique,
  created_at timestamptz not null default now(),
  check ((state = 'confirmed') = (receipt_no is not null))
);
create index payments_charge on public.payments (charge_id);

-- ---------------------------------------------------------------------------
-- "Who is asking?" helpers
-- ---------------------------------------------------------------------------

-- Approved members, and applicants still in their introduction phase.
create or replace function private.can_check_in()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members where id = auth.uid()
      and (approval = 'approved' or (approval = 'pending' and status = 'introduced'))
  );
$$;

-- That chapter's board or the NEC; for a whole-club ride (null), any chapter's board.
create or replace function private.can_run_checkin(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target_chapter is not null then private.is_board_of(target_chapter)
              else private.is_approved_member() and (private.is_national() or exists (
                select 1 from public.positions where member_id = auth.uid() and ended_on is null
                  and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')))
         end;
$$;

-- The chapter's Treasurer, or the National Chairman or Secretary.
create or replace function private.can_manage_fees(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and ((role = 'treasurer' and chapter_id = target_chapter) or role in ('nec_chair', 'nec_secretary'))
  );
$$;

create or replace function private.can_see_fees(target_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_fees(target_chapter) or private.is_board_of(target_chapter);
$$;

-- The financial year a date falls in, by the year it starts (2026 = 1 Jul 2026 to 30 Jun 2027).
create or replace function private.fy_of(d date)
returns int language sql immutable set search_path = '' as $$
  select case when extract(month from d) >= 7 then extract(year from d)::int else extract(year from d)::int - 1 end;
$$;

-- What's left to pay on a charge: confirmed payments only, nothing once it's waived.
create or replace function private.owing(p_charge uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case when c.waived_at is not null then 0
              else greatest(0, c.amount_cents - coalesce((
                select sum(amount_cents) from public.payments where charge_id = c.id and state = 'confirmed'), 0))::int
         end
  from public.charges c where c.id = p_charge;
$$;

-- The FNG review that's due: of the slots after the last one recorded (6, 9, 12, 15 …), the latest
-- whose day has come, or else the next one coming. Same as fngDue() in src/domain/joining.ts.
create or replace function private.fng_due(p_member uuid, out at_months int, out due_on date)
language plpgsql stable security definer set search_path = '' as $$
declare
  started date;
  today date := private.club_date();
  last_done int;
begin
  select fng_started_on into started from public.members where id = p_member and status = 'fng';
  if started is null then return; end if;
  select coalesce(max(d.at_months), 0) into last_done from public.member_decisions d
  where d.member_id = p_member and d.kind = 'fng_review';
  at_months := greatest(6, last_done + 3);
  while (started + make_interval(months => at_months + 3))::date <= today loop
    at_months := at_months + 3;
  end loop;
  due_on := (started + make_interval(months => at_months))::date;
end;
$$;

-- The next receipt number for a chapter's year: W26-0001, W26-0002 …
create or replace function private.next_receipt(p_chapter uuid, p_fy int)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('receipt:' || p_chapter::text || ':' || p_fy::text));
  select count(*) + 1 into n from public.payments p join public.charges c on c.id = p.charge_id
  where c.chapter_id = p_chapter and c.fy = p_fy and p.receipt_no is not null;
  return (select upper(left(slug, 1)) from public.chapters where id = p_chapter)
    || lpad((p_fy % 100)::text, 2, '0') || '-' || lpad(n::text, 4, '0');
end;
$$;

-- A fresh 6-character code from letters and digits that are hard to misread.
create or replace function private.new_checkin_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  candidate text;
begin
  loop
    bytes := decode(md5(gen_random_uuid()::text), 'hex');
    candidate := '';
    for i in 0..5 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.checkin_sessions s where s.code = candidate);
  end loop;
  return candidate;
end;
$$;

revoke all on function private.can_check_in(), private.can_run_checkin(uuid), private.can_manage_fees(uuid),
  private.can_see_fees(uuid), private.fy_of(date), private.owing(uuid), private.fng_due(uuid),
  private.next_receipt(uuid, int), private.new_checkin_code() from public, anon;
grant execute on function private.can_check_in(), private.can_run_checkin(uuid), private.can_manage_fees(uuid),
  private.can_see_fees(uuid), private.fy_of(date), private.owing(uuid), private.fng_due(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who can read what. Nothing is written except through the actions.
-- ---------------------------------------------------------------------------

alter table public.checkin_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.member_decisions enable row level security;
alter table public.fee_rates enable row level security;
alter table public.continuation_fees enable row level security;
alter table public.payment_details enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;

revoke all on public.checkin_sessions, public.attendance, public.member_decisions, public.fee_rates,
  public.continuation_fees, public.payment_details, public.charges, public.payments from public, anon, authenticated;

-- Everything about a session except its code: that's only for the people running it.
grant select (id, kind, chapter_id, ride_id, title, held_on, opened_by, opened_at, closed_at) on public.checkin_sessions to authenticated;
grant select on public.attendance, public.member_decisions, public.fee_rates, public.continuation_fees,
  public.payment_details, public.charges, public.payments to authenticated;

create policy checkin_sessions_read on public.checkin_sessions for select to authenticated using (private.can_check_in());

-- Members see who came; an applicant sees their own; a board sees its applicants'.
create policy attendance_read on public.attendance for select to authenticated using (
  member_id = auth.uid()
  or (private.is_approved_member() and private.is_approved(member_id))
  or private.is_board_of(private.chapter_of(member_id))
);

create policy member_decisions_read on public.member_decisions for select to authenticated using (
  member_id = auth.uid() or private.is_board_of(private.chapter_of(member_id))
);

create policy fee_rates_read on public.fee_rates for select to authenticated using (private.is_approved_member());
create policy continuation_fees_read on public.continuation_fees for select to authenticated using (private.is_approved_member());
create policy payment_details_read on public.payment_details for select to authenticated using (private.is_approved_member());

create policy charges_read on public.charges for select to authenticated using (
  member_id = auth.uid() or private.can_see_fees(chapter_id)
);
-- A payment is visible to whoever can see its charge.
create policy payments_read on public.payments for select to authenticated using (
  charge_id in (select id from public.charges)
);

-- ---------------------------------------------------------------------------
-- Check-ins
-- ---------------------------------------------------------------------------

create or replace function public.open_checkin(p_kind text, p_ride uuid, p_chapter uuid, p_title text, p_held_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  ride public.rides%rowtype;
  seat uuid := p_chapter;
  title text := nullif(trim(p_title), '');
  held date := p_held_on;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if p_kind = 'ride' then
    select * into ride from public.rides where id = p_ride;
    if not found then raise exception 'No such ride.'; end if;
    if ride.cancelled_at is not null then raise exception 'That ride was cancelled.'; end if;
    if exists (select 1 from public.checkin_sessions where ride_id = p_ride) then
      raise exception 'Check-in for this ride is already open.';
    end if;
    seat := case when ride.category in ('north', 'west')
                 then (select id from public.chapters where slug = ride.category::text) end;
    title := ride.title;
    held := private.club_date(ride.starts_at);
  elsif p_kind = 'meeting' then
    if p_chapter is null then raise exception 'Pick a chapter.'; end if;
    if title is null then raise exception 'Add a title.'; end if;
    if held is null or held < private.club_date() then raise exception 'Pick today or a later date.'; end if;
  else
    raise exception 'Pick a ride or a meeting.';
  end if;
  if not private.can_run_checkin(seat) then raise exception 'Only that chapter’s board can open a check-in.'; end if;

  insert into public.checkin_sessions (kind, chapter_id, ride_id, title, held_on, code, opened_by)
  values (p_kind, seat, case when p_kind = 'ride' then p_ride end, title, held, private.new_checkin_code(), me)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.checkin_code(p_session uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  return s.code;
end;
$$;

-- Checking in twice does nothing. Returns the session.
create or replace function public.check_in(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  s public.checkin_sessions%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.can_check_in() then raise exception 'Only members and applicants can check in.'; end if;
  if wanted like 'RUSTNUTS:%' then wanted := substr(wanted, 10); end if;
  select * into s from public.checkin_sessions where code = wanted;
  if not found then raise exception 'That code doesn’t match a check-in.'; end if;
  if s.closed_at is not null then raise exception 'That check-in has closed.'; end if;
  if s.held_on <> private.club_date() then raise exception 'That check-in isn’t for today.'; end if;
  insert into public.attendance (session_id, member_id) values (s.id, me) on conflict do nothing;
  return s.id;
end;
$$;

-- Ticks someone off (or un-ticks them), on the day or afterwards.
create or replace function public.mark_attendance(p_session uuid, p_member uuid, p_present boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.checkin_sessions%rowtype;
  target public.members%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not (target.approval = 'approved'
          or (target.approval = 'pending' and target.status = 'introduced' and private.is_board_of(target.chapter_id))) then
    raise exception 'They can’t be checked in.';
  end if;
  if s.held_on > private.club_date() then raise exception 'That check-in hasn’t started yet.'; end if;
  if p_present then
    insert into public.attendance (session_id, member_id, marked_by) values (p_session, p_member, auth.uid())
    on conflict do nothing;
  else
    delete from public.attendance where session_id = p_session and member_id = p_member;
  end if;
end;
$$;

create or replace function public.close_checkin(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.checkin_sessions%rowtype;
begin
  select * into s from public.checkin_sessions where id = p_session for update;
  if not found then raise exception 'No such check-in.'; end if;
  if not private.can_run_checkin(s.chapter_id) then raise exception 'Only that chapter’s board can run this check-in.'; end if;
  if s.closed_at is not null then raise exception 'That check-in is already closed.'; end if;
  update public.checkin_sessions set closed_at = now() where id = p_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- The board's decisions
-- ---------------------------------------------------------------------------

create or replace function private.check_votes(p_for int, p_against int, p_abstained int)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_for, 0) < 0 or coalesce(p_against, 0) < 0 or coalesce(p_abstained, 0) < 0 then
    raise exception 'Vote counts can’t be negative.';
  end if;
end;
$$;

-- Approves an applicant as p_status, or declines them when it's null, and records the tally.
-- The approving and declining are approve_member's and decline_member's, rules and all.
create or replace function public.decide_application(
  p_member uuid, p_status public.member_status, p_for int, p_against int, p_abstained int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare target public.members%rowtype;
begin
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'No such applicant.'; end if;
  if not private.is_board_of(target.chapter_id) then
    if p_status is null then raise exception 'Only that chapter’s board can decline this applicant.'; end if;
    raise exception 'Only the % board can approve this applicant.', (select name from public.chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person isn’t waiting for approval.'; end if;
  if p_status is not null and p_status not in ('introduced', 'fng', 'supporter', 'family') then
    raise exception 'Let them in as Introduced, FNG, Supporter or Family.';
  end if;
  perform private.check_votes(p_for, p_against, p_abstained);

  if p_status is null then
    perform public.decline_member(p_member);
  else
    perform public.approve_member(p_member, p_status);
  end if;
  insert into public.member_decisions (member_id, kind, outcome, status, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'application', case when p_status is null then 'declined' else 'approved' end, p_status,
          p_for, p_against, p_abstained, nullif(trim(p_note), ''), private.club_date(), auth.uid());
end;
$$;

create or replace function public.record_fng_review(
  p_member uuid, p_at_months int, p_outcome text, p_for int, p_against int, p_abstained int, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  target public.members%rowtype;
  due record;
  today date := private.club_date();
  fee int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_member = me then raise exception 'You can’t record your own review.'; end if;
  select * into target from public.members where id = p_member for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Only that chapter’s board can record this review.'; end if;
  select * into due from private.fng_due(p_member);
  if due.at_months is null then raise exception 'They’re not an FNG.'; end if;
  if p_at_months is distinct from due.at_months then raise exception 'Record the review that’s due.'; end if;
  if due.due_on - today > 30 then raise exception 'That review isn’t due yet.'; end if;
  perform private.check_votes(p_for, p_against, p_abstained);
  if p_outcome not in ('continue', 'patch', 'not_continuing') then raise exception 'Pick an outcome.'; end if;
  if p_outcome = 'patch' and not (coalesce(p_for, 0) >= 1 and p_against = 0) then
    raise exception 'Full membership needs a unanimous vote: at least one for and none against.';
  end if;

  insert into public.member_decisions (member_id, kind, at_months, outcome, votes_for, votes_against, votes_abstained,
                                       note, decided_on, recorded_by)
  values (p_member, 'fng_review', p_at_months, p_outcome, p_for, p_against, p_abstained, nullif(trim(p_note), ''),
          today, me);

  if p_outcome = 'patch' then
    update public.members set status = 'full', patched_on = coalesce(patched_on, today), updated_at = now() where id = p_member;
  elsif p_outcome = 'not_continuing' then
    update public.members set status = 'supporter', updated_at = now() where id = p_member;
  elsif p_at_months >= 12 then
    -- Past twelve months, carrying on as an FNG costs the chapter's continuation fee, if it has one.
    select amount_cents into fee from public.continuation_fees
    where chapter_id = target.chapter_id and fy = private.fy_of(today);
    if fee is not null then
      insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
      values (p_member, target.chapter_id, private.fy_of(today), 'continuation', 'FNG continuation fee', fee, today + 30, me)
      on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

create or replace function public.set_fee_rate(p_chapter uuid, p_fy int, p_status public.member_status, p_amount_cents int, p_due_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if p_status not in ('full', 'nomad', 'fng', 'supporter', 'family') then raise exception 'That status doesn’t pay fees.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_due_on is null then raise exception 'Pick a due date.'; end if;
  insert into public.fee_rates (chapter_id, fy, status, amount_cents, due_on)
  values (p_chapter, p_fy, p_status, p_amount_cents, p_due_on)
  on conflict (chapter_id, fy, status) do update set amount_cents = excluded.amount_cents, due_on = excluded.due_on;
end;
$$;

create or replace function public.set_continuation_fee(p_chapter uuid, p_fy int, p_amount_cents int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  insert into public.continuation_fees (chapter_id, fy, amount_cents) values (p_chapter, p_fy, p_amount_cents)
  on conflict (chapter_id, fy) do update set amount_cents = excluded.amount_cents;
end;
$$;

create or replace function public.set_payment_details(p_chapter uuid, p_payid text, p_payid_name text, p_bsb text, p_account_no text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  insert into public.payment_details (chapter_id, payid, payid_name, bsb, account_no)
  values (p_chapter, nullif(trim(p_payid), ''), nullif(trim(p_payid_name), ''), nullif(trim(p_bsb), ''), nullif(trim(p_account_no), ''))
  on conflict (chapter_id) do update set payid = excluded.payid, payid_name = excluded.payid_name, bsb = excluded.bsb,
    account_no = excluded.account_no, updated_at = now();
end;
$$;

-- One yearly charge for every approved member whose status has a rate. Running it again only adds
-- charges for people who don't have one yet. Returns how many were added.
create or replace function public.raise_fees(p_chapter uuid, p_fy int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.can_manage_fees(p_chapter) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if not exists (select 1 from public.fee_rates where chapter_id = p_chapter and fy = p_fy) then
    raise exception 'Set this year’s fees first.';
  end if;
  insert into public.charges (member_id, chapter_id, fy, kind, amount_cents, due_on, raised_by)
  select m.id, p_chapter, p_fy, 'annual', r.amount_cents, r.due_on, auth.uid()
  from public.members m
  join public.fee_rates r on r.chapter_id = m.chapter_id and r.fy = p_fy and r.status = m.status
  where m.chapter_id = p_chapter and m.approval = 'approved'
  on conflict (member_id, fy, kind) where kind in ('annual', 'continuation') do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.raise_charge(p_member uuid, p_description text, p_amount_cents int, p_due_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target public.members%rowtype;
  new_id uuid;
begin
  select * into target from public.members where id = p_member;
  if not found then raise exception 'That member no longer exists.'; end if;
  if not private.can_manage_fees(target.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if target.approval <> 'approved' then raise exception 'Approve them first.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Add what it’s for.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_due_on is null then raise exception 'Pick a due date.'; end if;
  insert into public.charges (member_id, chapter_id, fy, kind, description, amount_cents, due_on, raised_by)
  values (p_member, target.chapter_id, private.fy_of(private.club_date()), 'other', trim(p_description), p_amount_cents, p_due_on, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.waive_charge(p_charge uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.charges%rowtype;
begin
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'No such charge.'; end if;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if c.waived_at is not null then raise exception 'That charge is already waived.'; end if;
  if private.owing(p_charge) = 0 then raise exception 'That charge is already paid.'; end if;
  update public.charges set waived_at = now(), waived_by = auth.uid() where id = p_charge;
end;
$$;

-- The checks a payment against a charge shares, whoever is paying.
create or replace function private.check_payment(c public.charges, p_amount_cents int, p_paid_on date, p_method text, too_much text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare left_to_pay int := private.owing(c.id);
begin
  if c.waived_at is not null then raise exception 'That charge was waived.'; end if;
  if left_to_pay = 0 then raise exception 'That’s already paid.'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_amount_cents > left_to_pay then raise exception '%', too_much; end if;
  if p_paid_on is null or p_paid_on > private.club_date() then raise exception 'The payment date can’t be in the future.'; end if;
  if p_method = 'card' then raise exception 'Card payments aren’t set up yet.'; end if;
  if p_method is null or p_method not in ('payid', 'bank', 'cash') then raise exception 'Pick how it was paid.'; end if;
end;
$$;

-- A member saying they've paid, for the treasurer to confirm.
create or replace function public.claim_payment(p_charge uuid, p_amount_cents int, p_paid_on date, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.charges%rowtype;
  new_id uuid;
begin
  select * into c from public.charges where id = p_charge for update;
  if me is null or not found or c.member_id <> me then raise exception 'You can only pay your own fees.'; end if;
  perform private.check_payment(c, p_amount_cents, p_paid_on, p_method, 'That’s more than you owe.');
  insert into public.payments (charge_id, amount_cents, paid_on, method, reference, state, claimed_by)
  values (p_charge, p_amount_cents, p_paid_on, p_method, nullif(trim(p_reference), ''), 'claimed', me)
  returning id into new_id;
  return new_id;
end;
$$;

-- The treasurer recording money they've received: confirmed, with a receipt, straight away.
create or replace function public.record_payment(p_charge uuid, p_amount_cents int, p_paid_on date, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.charges%rowtype;
  new_id uuid;
begin
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'No such charge.'; end if;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  perform private.check_payment(c, p_amount_cents, p_paid_on, p_method, 'That’s more than they owe.');
  insert into public.payments (charge_id, amount_cents, paid_on, method, reference, state, decided_by, decided_at, receipt_no)
  values (p_charge, p_amount_cents, p_paid_on, p_method, nullif(trim(p_reference), ''), 'confirmed', auth.uid(), now(),
          private.next_receipt(c.chapter_id, c.fy))
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.confirm_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.payments%rowtype;
  c public.charges%rowtype;
begin
  select * into p from public.payments where id = p_payment;
  if not found then raise exception 'No such payment.'; end if;
  select * into c from public.charges where id = p.charge_id for update;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if p.state <> 'claimed' then raise exception 'That payment has already been dealt with.'; end if;
  if p.amount_cents > private.owing(c.id) then raise exception 'That’s more than they owe.'; end if;
  update public.payments set state = 'confirmed', decided_by = auth.uid(), decided_at = now(),
    receipt_no = private.next_receipt(c.chapter_id, c.fy)
  where id = p_payment;
end;
$$;

create or replace function public.reject_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.payments%rowtype;
  c public.charges%rowtype;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'No such payment.'; end if;
  select * into c from public.charges where id = p.charge_id;
  if not private.can_manage_fees(c.chapter_id) then
    raise exception 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.';
  end if;
  if p.state <> 'claimed' then raise exception 'That payment has already been dealt with.'; end if;
  update public.payments set state = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Everything above that this person may see, as one value (so no row limit cuts it short).
-- Runs as the caller, so the read rules above decide what's in it.
-- ---------------------------------------------------------------------------

create or replace function public.members_money()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'chapter_id', s.chapter_id, 'ride_id', s.ride_id,
                                          'title', s.title, 'held_on', s.held_on, 'opened_by', s.opened_by,
                                          'closed_at', s.closed_at) order by s.held_on desc, s.id)
      from public.checkin_sessions s), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(to_jsonb(a) order by a.checked_in_at) from public.attendance a), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_on, d.created_at) from public.member_decisions d), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.fee_rates r), '[]'::jsonb),
    'continuation', coalesce((select jsonb_agg(to_jsonb(f)) from public.continuation_fees f), '[]'::jsonb),
    'charges', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.charges c), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p), '[]'::jsonb),
    'details', coalesce((select jsonb_agg(to_jsonb(x)) from public.payment_details x), '[]'::jsonb)
  );
$$;

revoke all on function
  public.open_checkin(text, uuid, uuid, text, date), public.checkin_code(uuid), public.check_in(text),
  public.mark_attendance(uuid, uuid, boolean), public.close_checkin(uuid),
  public.decide_application(uuid, public.member_status, int, int, int, text),
  public.record_fng_review(uuid, int, text, int, int, int, text),
  public.set_fee_rate(uuid, int, public.member_status, int, date), public.set_continuation_fee(uuid, int, int),
  public.set_payment_details(uuid, text, text, text, text), public.raise_fees(uuid, int),
  public.raise_charge(uuid, text, int, date), public.waive_charge(uuid),
  public.claim_payment(uuid, int, date, text, text), public.record_payment(uuid, int, date, text, text),
  public.confirm_payment(uuid), public.reject_payment(uuid), public.members_money(),
  private.check_votes(int, int, int), private.check_payment(public.charges, int, date, text, text)
from public, anon;
grant execute on function
  public.open_checkin(text, uuid, uuid, text, date), public.checkin_code(uuid), public.check_in(text),
  public.mark_attendance(uuid, uuid, boolean), public.close_checkin(uuid),
  public.decide_application(uuid, public.member_status, int, int, int, text),
  public.record_fng_review(uuid, int, text, int, int, int, text),
  public.set_fee_rate(uuid, int, public.member_status, int, date), public.set_continuation_fee(uuid, int, int),
  public.set_payment_details(uuid, text, text, text, text), public.raise_fees(uuid, int),
  public.raise_charge(uuid, text, int, date), public.waive_charge(uuid),
  public.claim_payment(uuid, int, date, text, text), public.record_payment(uuid, int, date, text, text),
  public.confirm_payment(uuid), public.reject_payment(uuid), public.members_money()
to authenticated;
