-- The treasurer's books (Stage 5, part B): one bank account split into funds (the Club fund,
-- chapter_id null, and one per chapter), the club's payment codes, two approvers for every
-- payment, openings, the cash float, budgets and the monthly Treasurer's Report.
-- See docs/superpowers/specs/2026-10-25-stage-5b-treasurer-design.md. Nobody reaches these tables
-- directly: club_ledger() reads, and each action below checks the rules in src/domain/ledger.ts,
-- refusing with the same words. Section numbers refer to the constitution (v4, section 13).

create table public.ledger_codes (
  code text primary key,
  direction text not null check (direction in ('credit', 'debit')),
  label text not null
);
insert into public.ledger_codes (code, direction, label) values
  ('CR-001', 'credit', 'Member fees'), ('CR-002', 'credit', 'Donations to RSMC'), ('CR-003', 'credit', 'Club payment'),
  ('CR-004', 'credit', 'Bank interest'), ('CR-005', 'credit', 'Merchandise sales'), ('CR-006', 'credit', 'Meeting food'),
  ('CR-007', 'credit', 'Event buy-in'),
  ('DB-001', 'debit', 'Club expenses'), ('DB-002', 'debit', 'Donations to charity'), ('DB-003', 'debit', 'Misc'),
  ('DB-004', 'debit', 'Bank fees'), ('DB-005', 'debit', 'Merchandise purchase'), ('DB-006', 'debit', 'Refund'),
  ('DB-007', 'debit', 'Club meeting expense');

-- Records are kept at least seven years (13.5), so nothing here is ever removed: a mistake is voided.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id), -- null: the Club fund
  code text not null references public.ledger_codes (code),
  description text not null,
  amount_cents int not null check (amount_cents > 0),
  received_on date, -- credits: when the money came in
  entry_on date,    -- when it was banked, or a debit paid
  payee_member_id uuid references public.members (id) on delete restrict,
  payee_name text,
  payment_id uuid unique references public.payments (id) on delete restrict,
  state text not null check (state in ('awaiting', 'approved', 'paid', 'void')),
  recorded_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  void_reason text,
  voided_by uuid references public.members (id) on delete set null,
  voided_at timestamptz,
  check ((state = 'paid') = (entry_on is not null) or state = 'void')
);
create index ledger_entries_fund on public.ledger_entries (chapter_id, entry_on);

create table public.ledger_approvals (
  entry_id uuid not null references public.ledger_entries (id),
  member_id uuid not null references public.members (id) on delete restrict,
  approved_at timestamptz not null default now(),
  primary key (entry_id, member_id)
);

-- A fund's balance on 1 July. A later year without one carries on from the running balance.
create table public.fund_openings (
  chapter_id uuid references public.chapters (id),
  fy int not null,
  amount_cents int not null,
  set_by uuid references public.members (id) on delete set null,
  set_at timestamptz not null default now()
);
create unique index fund_openings_one on public.fund_openings
  (coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid), fy);

create table public.cash_floats (
  fy int primary key,
  amount_cents int not null check (amount_cents >= 0),
  set_by uuid references public.members (id) on delete set null,
  set_at timestamptz not null default now()
);

-- A fund's budget for a year: {code: cents}. A carried board (or NEC) vote approves it (13.4).
create table public.budgets (
  chapter_id uuid references public.chapters (id),
  fy int not null,
  lines jsonb not null default '{}'::jsonb,
  approved_vote_id uuid references public.votes (id),
  approved_at timestamptz,
  approved_by uuid references public.members (id) on delete set null,
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index budgets_one on public.budgets
  (coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid), fy);

-- Months presented to members (13.8). The numbers are worked out when read.
create table public.treasurer_reports (
  month date primary key check (extract(day from month) = 1),
  presented_at timestamptz not null default now(),
  presented_by uuid references public.members (id) on delete set null
);

alter table public.ledger_codes enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_approvals enable row level security;
alter table public.fund_openings enable row level security;
alter table public.cash_floats enable row level security;
alter table public.budgets enable row level security;
alter table public.treasurer_reports enable row level security;
revoke all on public.ledger_codes, public.ledger_entries, public.ledger_approvals, public.fund_openings,
  public.cash_floats, public.budgets, public.treasurer_reports
  from public, anon, authenticated;

-- Who's who -------------------------------------------------------------------------------------

-- Keeps a fund's books: its chapter's Treasurer, or the National Chairman or Secretary; the Club
-- fund's, any chapter Treasurer too (inferred). Mirrors keepsBooks.
create or replace function private.keeps_books(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and (role in ('nec_chair', 'nec_secretary') or (role = 'treasurer' and (p_chapter is null or chapter_id = p_chapter))));
$$;

-- Approves a fund's spending (13.3): a chapter's board seats, or for the Club fund the sitting
-- Presidents; the National Chairman and Secretary for both. Never the National Auditor (11.8).
create or replace function private.approves_for(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null
      and (role in ('nec_chair', 'nec_secretary')
        or (p_chapter is null and role = 'president')
        or (p_chapter is not null and chapter_id = p_chapter
            and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'))));
$$;

create or replace function private.sees_ledger(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.keeps_books(p_chapter) or private.approves_for(p_chapter) or (private.is_approved_member() and exists (
    select 1 from public.positions where member_id = auth.uid() and ended_on is null and role = 'nec_auditor'));
$$;

-- Signed in, approved, a real fund, and keeps its books. Returns the caller's id.
create or replace function private.require_books(p_chapter uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me uuid := private.require_member();
begin
  if p_chapter is not null and not exists (select 1 from public.chapters where id = p_chapter) then
    raise exception 'No such fund.';
  end if;
  if not private.keeps_books(p_chapter) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  return me;
end;
$$;

-- Working it out --------------------------------------------------------------------------------

-- A fund's balance at the end of p_upto: the latest opening for that year or before, plus
-- everything paid since. With no opening at all, it counts from nothing. Mirrors fundBalance.
create or replace function private.fund_balance(p_chapter uuid, p_upto date)
returns bigint language sql stable security definer set search_path = '' as $$
  with o as (
    select fy, amount_cents from public.fund_openings
    where chapter_id is not distinct from p_chapter and fy <= private.fy_of(p_upto)
    order by fy desc limit 1
  )
  select coalesce((select amount_cents from o), 0) + coalesce((
    select sum(case when c.direction = 'credit' then e.amount_cents else -e.amount_cents end)
    from public.ledger_entries e join public.ledger_codes c on c.code = e.code
    where e.state = 'paid' and e.chapter_id is not distinct from p_chapter and e.entry_on <= p_upto
      and (not exists (select 1 from o) or e.entry_on >= make_date((select fy from o), 7, 1))), 0);
$$;

-- A fund's balance as a month starts: on 1 July, the new year's opening when there is one.
create or replace function private.balance_before(p_chapter uuid, p_month date)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select amount_cents::bigint from public.fund_openings
     where extract(month from p_month) = 7 and chapter_id is not distinct from p_chapter and fy = private.fy_of(p_month)),
    private.fund_balance(p_chapter, p_month - 1));
$$;

-- The monthly Treasurer's Report, as monthReport works it out.
create or replace function private.month_report(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  last_day date := (p_month + interval '1 month' - interval '1 day')::date;
  funds jsonb;
  total bigint;
  fl int := coalesce((select amount_cents from public.cash_floats where fy <= private.fy_of(p_month) order by fy desc limit 1), 0);
begin
  select jsonb_object_agg(coalesce(f.id::text, 'club'), private.fund_balance(f.id, last_day)),
         sum(private.fund_balance(f.id, last_day))
    into funds, total
  from (select null::uuid as id union all select id from public.chapters) f;
  return jsonb_build_object(
    'month', p_month,
    'opening_cents', (select sum(private.balance_before(f.id, p_month))
                      from (select null::uuid as id union all select id from public.chapters) f),
    'credits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents', coalesce(t.cents, 0)) order by c.code)
                from public.ledger_codes c left join (
                  select code, sum(amount_cents) as cents from public.ledger_entries
                  where state = 'paid' and entry_on between p_month and last_day group by code) t on t.code = c.code
                where c.direction = 'credit'),
    'credit_total', coalesce((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_codes c on c.code = e.code
                     where e.state = 'paid' and c.direction = 'credit' and e.entry_on between p_month and last_day), 0),
    'debits', (select jsonb_agg(jsonb_build_object('code', c.code, 'cents', coalesce(t.cents, 0)) order by c.code)
               from public.ledger_codes c left join (
                 select code, sum(amount_cents) as cents from public.ledger_entries
                 where state = 'paid' and entry_on between p_month and last_day group by code) t on t.code = c.code
               where c.direction = 'debit'),
    'debit_total', coalesce((select sum(e.amount_cents) from public.ledger_entries e join public.ledger_codes c on c.code = e.code
                    where e.state = 'paid' and c.direction = 'debit' and e.entry_on between p_month and last_day), 0),
    'funds', funds,
    'total_cents', total,
    'float_cents', fl,
    'bank_cents', total - fl,
    'last_change_at', (select max(updated_at) from public.ledger_entries where entry_on between p_month and last_day));
end;
$$;

revoke all on function private.keeps_books(uuid), private.approves_for(uuid), private.sees_ledger(uuid),
  private.require_books(uuid), private.fund_balance(uuid, date), private.balance_before(uuid, date),
  private.month_report(date)
  from public, anon, authenticated;

-- Entries ---------------------------------------------------------------------------------------

create or replace function public.record_credit(
  p_chapter uuid, p_code text, p_description text, p_amount_cents int, p_received_on date, p_entry_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(p_chapter); new_id uuid;
begin
  if not exists (select 1 from public.ledger_codes where code = p_code and direction = 'credit') then
    raise exception 'Pick a money-in code.';
  end if;
  if coalesce(private.trim_like_app(p_description), '') = '' then raise exception 'Say what it’s for.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter an amount over $0.'; end if;
  if p_entry_on is null then raise exception 'Pick the date it was banked.'; end if;
  if p_entry_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  if p_received_on > p_entry_on then raise exception 'It can’t be banked before it came in.'; end if;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, state, recorded_by)
  values (p_chapter, p_code, private.trim_like_app(p_description), p_amount_cents, coalesce(p_received_on, p_entry_on),
          p_entry_on, 'paid', me)
  returning id into new_id;
  return new_id;
end;
$$;

-- A debit waits for two approvals. Whoever records it counts as the first when they can approve
-- for that fund and aren't the payee (inferred). The bank takes its fees, so those are paid.
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
  if not bank and private.approves_for(p_chapter) and p_payee_member is distinct from me then
    insert into public.ledger_approvals (entry_id, member_id) values (new_id, me);
  end if;
  return new_id;
end;
$$;

-- The second distinct approval makes it approved (13.3).
create or replace function public.approve_debit(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); e public.ledger_entries;
begin
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.approves_for(e.chapter_id) then raise exception 'You can’t approve spending from this fund.'; end if;
  if e.state <> 'awaiting' then raise exception 'That isn’t waiting for approval.'; end if;
  if e.payee_member_id = me then raise exception 'The payee can’t approve their own payment (13.3).'; end if;
  if exists (select 1 from public.ledger_approvals where entry_id = p_id and member_id = me) then
    raise exception 'You’ve already approved this.';
  end if;
  insert into public.ledger_approvals (entry_id, member_id) values (p_id, me);
  update public.ledger_entries
  set state = case when (select count(*) from public.ledger_approvals where entry_id = p_id) >= 2 then 'approved' else 'awaiting' end,
      updated_at = now()
  where id = p_id;
end;
$$;

create or replace function public.pay_debit(p_id uuid, p_paid_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.ledger_entries;
begin
  perform private.require_member();
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.keeps_books(e.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if e.state = 'awaiting' then raise exception 'It needs two approvals before it’s paid (13.3).'; end if;
  if e.state <> 'approved' then raise exception 'That’s already been paid or voided.'; end if;
  if p_paid_on is null then raise exception 'Pick the date it was paid.'; end if;
  if p_paid_on > private.club_date() then raise exception 'That date hasn’t happened yet.'; end if;
  update public.ledger_entries set state = 'paid', entry_on = p_paid_on, updated_at = now() where id = p_id;
end;
$$;

-- A void line stays, and counts for nothing.
create or replace function public.void_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); e public.ledger_entries;
begin
  select * into e from public.ledger_entries where id = p_id for update;
  if not found then raise exception 'No such entry.'; end if;
  if not private.keeps_books(e.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if e.state = 'void' then raise exception 'That’s already void.'; end if;
  if coalesce(private.trim_like_app(p_reason), '') = '' then raise exception 'Say why it’s being voided.'; end if;
  update public.ledger_entries
  set state = 'void', void_reason = private.trim_like_app(p_reason), voided_by = me, voided_at = now(), updated_at = now()
  where id = p_id;
end;
$$;

-- A confirmed fee payment, as CR-001 in its chapter's fund, on the day it was paid.
create or replace function public.add_fee_payment(p_payment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); p public.payments; c public.charges; who text; new_id uuid;
begin
  select * into p from public.payments where id = p_payment;
  select * into c from public.charges where id = p.charge_id;
  if p.id is null or c.id is null then raise exception 'No such payment.'; end if;
  if not private.keeps_books(c.chapter_id) then
    raise exception 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
  end if;
  if p.state <> 'confirmed' then raise exception 'Only a confirmed payment goes in the ledger.'; end if;
  if exists (select 1 from public.ledger_entries where payment_id = p_payment) then
    raise exception 'That payment is already in the ledger.';
  end if;
  select coalesce(road_name, full_name) into who from public.members where id = c.member_id;
  insert into public.ledger_entries (chapter_id, code, description, amount_cents, received_on, entry_on, payment_id, state, recorded_by)
  values (c.chapter_id, 'CR-001', 'Member fees: ' || coalesce(who, 'Member'), p.amount_cents, p.paid_on, p.paid_on, p_payment, 'paid', me)
  returning id into new_id;
  return new_id;
end;
$$;

-- Openings and float ----------------------------------------------------------------------------

create or replace function public.set_opening(p_chapter uuid, p_fy int, p_amount_cents int)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

create or replace function public.set_cash_float(p_fy int, p_amount_cents int)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(null);
begin
  if p_fy is null or p_fy < 2019 or p_fy > 2100 then raise exception 'Pick a financial year.'; end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'Enter an amount of $0 or more.'; end if;
  insert into public.cash_floats (fy, amount_cents, set_by) values (p_fy, p_amount_cents, me)
  on conflict (fy) do update set amount_cents = excluded.amount_cents, set_by = excluded.set_by, set_at = now();
end;
$$;

-- Budgets ---------------------------------------------------------------------------------------

create or replace function public.save_budget(p_chapter uuid, p_fy int, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(p_chapter); line record;
begin
  if p_fy is null or p_fy < 2019 or p_fy > 2100 then raise exception 'Pick a financial year.'; end if;
  if exists (select 1 from public.budgets where chapter_id is not distinct from p_chapter and fy = p_fy and approved_at is not null) then
    raise exception 'That budget is approved and locked. Reopen it to change it.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'object' then raise exception 'Pick a payment code.'; end if;
  for line in select key, value from jsonb_each(p_lines) loop
    if not exists (select 1 from public.ledger_codes where code = line.key) then raise exception 'Pick a payment code.'; end if;
    if jsonb_typeof(line.value) <> 'number' or line.value::text::numeric < 0 or line.value::text::numeric <> floor(line.value::text::numeric) then
      raise exception 'Budget amounts must be $0 or more.';
    end if;
  end loop;
  update public.budgets set lines = p_lines, updated_by = me, updated_at = now()
  where chapter_id is not distinct from p_chapter and fy = p_fy;
  if not found then
    insert into public.budgets (chapter_id, fy, lines, updated_by) values (p_chapter, p_fy, p_lines, me);
  end if;
end;
$$;

-- Approved by a carried vote of the chapter's board, or of the NEC for the Club fund (13.4).
create or replace function public.approve_budget(p_chapter uuid, p_fy int, p_vote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); b public.budgets;
begin
  perform private.require_scope(p_chapter);
  select * into b from public.budgets where chapter_id is not distinct from p_chapter and fy = p_fy for update;
  if not found then raise exception 'Save the budget first.'; end if;
  if b.approved_at is not null then raise exception 'That budget is already approved.'; end if;
  if not exists (
    select 1 from public.votes where id = p_vote and result = 'carried' and chapter_id is not distinct from p_chapter
      and electorate = case when p_chapter is null then 'nec' else 'chapter_board' end::public.electorate) then
    raise exception 'Pick a carried board vote for this budget (13.4).';
  end if;
  update public.budgets set approved_vote_id = p_vote, approved_at = now(), approved_by = me
  where chapter_id is not distinct from p_chapter and fy = p_fy;
end;
$$;

create or replace function public.reopen_budget(p_chapter uuid, p_fy int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  perform private.require_scope(p_chapter);
  update public.budgets set approved_vote_id = null, approved_at = null, approved_by = null, updated_at = now()
  where chapter_id is not distinct from p_chapter and fy = p_fy and approved_at is not null;
  if not found then raise exception 'That budget isn’t approved.'; end if;
end;
$$;

-- Reports ---------------------------------------------------------------------------------------

create or replace function public.present_report(p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_books(null);
begin
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Pick a month.'; end if;
  if (p_month + interval '1 month' - interval '1 day')::date >= private.club_date() then
    raise exception 'Wait until the month is over.';
  end if;
  if exists (select 1 from public.treasurer_reports where month = p_month) then
    raise exception 'That month is already presented.';
  end if;
  insert into public.treasurer_reports (month, presented_by) values (p_month, me);
end;
$$;

-- Reading ---------------------------------------------------------------------------------------

-- The lines go to whoever reads that fund; totals (openings, floats, budgets and the presented
-- months' reports) to every approved member who hasn't left (13.8).
create or replace function public.club_ledger()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare reads_reports boolean := exists (
  select 1 from public.members where id = auth.uid() and approval = 'approved' and status <> 'legacy');
begin
  if not private.is_approved_member() then
    return jsonb_build_object('entries', '[]'::jsonb, 'openings', '[]'::jsonb, 'floats', '[]'::jsonb,
      'budgets', '[]'::jsonb, 'reports', '[]'::jsonb, 'report_totals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'chapter_id', e.chapter_id, 'code', e.code, 'description', e.description, 'amount_cents', e.amount_cents,
        'received_on', e.received_on, 'entry_on', e.entry_on, 'payee_member_id', e.payee_member_id, 'payee_name', e.payee_name,
        'payment_id', e.payment_id, 'state', e.state, 'recorded_by', e.recorded_by, 'recorded_at', e.recorded_at,
        'updated_at', e.updated_at, 'void_reason', e.void_reason, 'voided_by', e.voided_by,
        'approvals', (select coalesce(jsonb_agg(jsonb_build_object('member_id', a.member_id, 'approved_at', a.approved_at)
                                                order by a.approved_at, a.member_id), '[]'::jsonb)
                      from public.ledger_approvals a where a.entry_id = e.id)
        ) order by e.entry_on desc nulls first, e.recorded_at desc)
      from public.ledger_entries e where private.sees_ledger(e.chapter_id)), '[]'::jsonb),
    'openings', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'amount_cents', amount_cents) order by fy, chapter_id)
      from public.fund_openings), '[]'::jsonb) else '[]'::jsonb end,
    'floats', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('fy', fy, 'amount_cents', amount_cents) order by fy)
      from public.cash_floats), '[]'::jsonb) else '[]'::jsonb end,
    'budgets', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', chapter_id, 'fy', fy, 'lines', lines, 'approved_vote_id', approved_vote_id,
        'approved_at', approved_at, 'approved_by', approved_by) order by fy, chapter_id)
      from public.budgets), '[]'::jsonb) else '[]'::jsonb end,
    'reports', case when reads_reports then coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'presented_at', presented_at, 'presented_by', presented_by) order by month desc)
      from public.treasurer_reports), '[]'::jsonb) else '[]'::jsonb end,
    'report_totals', case when reads_reports then coalesce((
      select jsonb_agg(private.month_report(month) order by month desc) from public.treasurer_reports), '[]'::jsonb)
      else '[]'::jsonb end);
end;
$$;

revoke all on function
  public.record_credit(uuid, text, text, int, date, date),
  public.record_debit(uuid, text, text, int, uuid, text, date),
  public.approve_debit(uuid), public.pay_debit(uuid, date), public.void_entry(uuid, text), public.add_fee_payment(uuid),
  public.set_opening(uuid, int, int), public.set_cash_float(int, int),
  public.save_budget(uuid, int, jsonb), public.approve_budget(uuid, int, uuid), public.reopen_budget(uuid, int),
  public.present_report(date), public.club_ledger()
  from public, anon;
grant execute on function
  public.record_credit(uuid, text, text, int, date, date),
  public.record_debit(uuid, text, text, int, uuid, text, date),
  public.approve_debit(uuid), public.pay_debit(uuid, date), public.void_entry(uuid, text), public.add_fee_payment(uuid),
  public.set_opening(uuid, int, int), public.set_cash_float(int, int),
  public.save_budget(uuid, int, jsonb), public.approve_budget(uuid, int, uuid), public.reopen_budget(uuid, int),
  public.present_report(date), public.club_ledger()
  to authenticated;
