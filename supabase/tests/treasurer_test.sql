-- Checks the treasurer's books: who keeps, approves and reads each fund through club_ledger(),
-- every action allowed and refused (with the app's words), the two-approver rule, fee payments,
-- budgets and the monthly report. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- t1 West President and National Chairman, t2 West Treasurer, t3 West Secretary, t4 West Full (no
-- seat), t5 North President, t6 North Full, t7 National Auditor, t8 West Legacy, t9 applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, 'c' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'west', 'Wes President', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Tess Treasurer', 'Coins', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Sue Secretary', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c4', 'west', 'Fred Full', 'Fredo', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'Nora President', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c6', 'north', 'Ned North', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c7', 'north', 'Audrey Auditor', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000c8', 'west', 'Len Legacy', null, 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000c9', 'west', 'Al Applicant', null, 'introduced', 'pending')
) as v(id, ch, name, road, status, approval);

insert into positions (member_id, chapter_id, role, started_on)
values
  ('00000000-0000-0000-0000-0000000000c1', (select id from chapters where slug = 'west'), 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000c1', null, 'nec_chair', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000c2', (select id from chapters where slug = 'west'), 'treasurer', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000c3', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000c5', (select id from chapters where slug = 'north'), 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000c7', null, 'nec_auditor', '2025-08-16');

-- Fred's fees: one payment confirmed, one only claimed.
insert into charges (id, member_id, chapter_id, fy, kind, amount_cents, due_on)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000c4', (select id from chapters where slug = 'west'),
        2026, 'annual', 25000, '2026-07-31');
insert into payments (id, charge_id, amount_cents, paid_on, method, state, receipt_no)
values ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f001', 15000, '2026-07-03', 'payid', 'confirmed', 'W26-0001'),
       ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f001', 10000, '2026-07-04', 'payid', 'claimed', null);

-- Votes for budgets, closing after the budgets are saved: a carried West board vote, a lost one, a carried members' vote, a carried NEC vote.
insert into votes (id, chapter_id, question, electorate, threshold, quorum, closes_at, closed_at, result)
values
  ('00000000-0000-0000-0000-00000000b001', (select id from chapters where slug = 'west'), 'Budget?', 'chapter_board', 'majority', 3, now(), now() + interval '1 day', 'carried'),
  ('00000000-0000-0000-0000-00000000b002', (select id from chapters where slug = 'west'), 'Budget?', 'chapter_board', 'majority', 3, now(), now() + interval '1 day', 'lost'),
  ('00000000-0000-0000-0000-00000000b003', (select id from chapters where slug = 'west'), 'Budget?', 'chapter_patched', 'majority', 3, now(), now() + interval '1 day', 'carried'),
  ('00000000-0000-0000-0000-00000000b004', null, 'Budget?', 'nec', 'majority', 1, now(), now() + interval '1 day', 'carried');

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return null;
end $$;

create function pg_temp.value_as(who uuid, expr text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  execute 'select (' || expr || ')::text' into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function pg_temp.ledger_as(who uuid) returns jsonb language sql as $$
  select pg_temp.value_as(who, 'public.club_ledger()')::jsonb
$$;

create function pg_temp.west() returns uuid language sql as $$ select id from chapters where slug = 'west' $$;
create function pg_temp.north() returns uuid language sql as $$ select id from chapters where slug = 'north' $$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000c' || n)::uuid $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.ledger_as(uuid),
  pg_temp.west(), pg_temp.north(), pg_temp.u(int) to anon, authenticated;

\o
\echo 'Nobody reaches the tables directly'
do $$
declare t text;
begin
  foreach t in array array['ledger_codes', 'ledger_entries', 'ledger_approvals', 'fund_openings', 'cash_floats', 'budgets', 'treasurer_reports'] loop
    assert pg_temp.try_as(pg_temp.u(1), format('select count(*) from public.%I', t)) is not null, 'read ' || t;
    assert pg_temp.try_as(null, format('select count(*) from public.%I', t)) is not null, 'anon read ' || t;
  end loop;
  assert pg_temp.try_as(null, 'select public.club_ledger()') is not null, 'anon can''t call club_ledger';
  assert pg_temp.try_as(pg_temp.u(1), 'select private.month_report(date ''2026-08-01'')') is not null, 'the report helper is private';
end $$;

\echo 'Money in: who records it, and the refusals'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(9), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, null, date '2026-08-01')$q$, pg_temp.west()))
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, null, date '2026-08-01')$q$, pg_temp.west()))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'a Secretary';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, null, date '2026-08-01')$q$, pg_temp.north()))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'another chapter';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.record_credit(gen_random_uuid(), 'CR-002', 'x', 100, null, date '2026-08-01')$q$)
    = 'No such fund.', 'no fund';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'DB-001', 'x', 100, null, date '2026-08-01')$q$, pg_temp.west()))
    = 'Pick a money-in code.', 'debit code';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', '  ', 100, null, date '2026-08-01')$q$, pg_temp.west()))
    = 'Say what it’s for.', 'description';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', 'x', 0, null, date '2026-08-01')$q$, pg_temp.west()))
    = 'Enter an amount over $0.', 'amount';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, null, null)$q$, pg_temp.west()))
    = 'Pick the date it was banked.', 'date';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, null, private.club_date() + 1)$q$, pg_temp.west()))
    = 'That date hasn’t happened yet.', 'future';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', 'x', 100, date '2026-08-02', date '2026-08-01')$q$, pg_temp.west()))
    = 'It can’t be banked before it came in.', 'received after banked';

  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_credit(%L, 'CR-002', ' Raffle ', 5000, null, date '2026-08-03')$q$, pg_temp.west())) is null, 'recorded';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.record_credit(null, 'CR-005', 'Hoodies', 82000, null, date '2026-08-04')$q$) is null, 'a treasurer keeps the Club fund';
  assert (select description from ledger_entries where code = 'CR-002') = 'Raffle', 'trimmed';
  assert (select received_on from ledger_entries where code = 'CR-002') = date '2026-08-03', 'received defaults to banked';
  assert (select state from ledger_entries where code = 'CR-002') = 'paid', 'money in is banked';
end $$;

\echo 'Money out: two approvers, neither the payee, before it’s paid (13.3)'
do $$
declare patches uuid; refund uuid; fees uuid;
begin
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_debit(%L, 'CR-001', 'x', 100, null, 'x', null)$q$, pg_temp.west()))
    = 'Pick a money-out code.', 'credit code';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_debit(%L, 'DB-001', 'x', 100, null, ' ', null)$q$, pg_temp.west()))
    = 'Say who’s being paid.', 'payee';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_debit(%L, 'DB-001', 'x', 100, %L, null, null)$q$, pg_temp.west(), pg_temp.u(9)))
    = 'No such member.', 'unapproved payee';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_debit(%L, 'DB-004', 'Fee', 40, null, null, null)$q$, pg_temp.west()))
    = 'Pick the date the bank took it.', 'bank fee date';

  patches := pg_temp.value_as(pg_temp.u(2), format($q$public.record_debit(%L, 'DB-001', 'Patches', 30000, null, ' Embroidery Co ', null)$q$, pg_temp.west()))::uuid;
  assert (select state from ledger_entries where id = patches) = 'awaiting', 'awaiting';
  assert (select payee_name from ledger_entries where id = patches) = 'Embroidery Co', 'payee trimmed';
  assert (select array_agg(member_id) from ledger_approvals where entry_id = patches) = array[pg_temp.u(2)], 'the treasurer''s board seat counts';

  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_debit(%L)$q$, patches)) = 'You’ve already approved this.', 'twice';
  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.approve_debit(%L)$q$, patches)) = 'You can’t approve spending from this fund.', 'member';
  assert pg_temp.try_as(pg_temp.u(7), format($q$select public.approve_debit(%L)$q$, patches)) = 'You can’t approve spending from this fund.', 'auditor';
  assert pg_temp.try_as(pg_temp.u(5), format($q$select public.approve_debit(%L)$q$, patches)) = 'You can’t approve spending from this fund.', 'North President';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, date '2026-08-05')$q$, patches)) = 'It needs two approvals before it’s paid (13.3).', 'pay early';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_debit(%L)$q$, patches)) is null, 'second approval';
  assert (select state from ledger_entries where id = patches) = 'approved', 'approved';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.approve_debit(%L)$q$, patches)) = 'That isn’t waiting for approval.', 'third';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.pay_debit(%L, date '2026-08-05')$q$, patches))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'a Secretary pays';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, null)$q$, patches)) = 'Pick the date it was paid.', 'no date';
  update ledger_approvals set approved_at = '2026-08-01T01:00:00Z' where entry_id = patches;
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, date '2026-07-31')$q$, patches))
    = 'It can’t be paid before it was approved (13.3).', 'paid before it was approved';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, private.club_date() + 1)$q$, patches)) = 'That date hasn’t happened yet.', 'future';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, date '2026-08-05')$q$, patches)) is null, 'paid';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.pay_debit(%L, date '2026-08-05')$q$, patches)) = 'That’s already been paid or voided.', 'paid twice';

  -- A payee recording their own refund isn't an approver, and can't approve it.
  refund := pg_temp.value_as(pg_temp.u(2), format($q$public.record_debit(%L, 'DB-006', 'Refund', 5000, %L, null, null)$q$, pg_temp.west(), pg_temp.u(2)))::uuid;
  assert not exists (select 1 from ledger_approvals where entry_id = refund), 'no self-approval for the payee';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_debit(%L)$q$, refund)) = 'The payee can’t approve their own payment (13.3).', 'payee approves';

  fees := pg_temp.value_as(pg_temp.u(2), $q$public.record_debit(null, 'DB-004', 'Account fee', 40, null, null, date '2026-08-06')$q$)::uuid;
  assert (select (state, entry_on, payee_name) from ledger_entries where id = fees) = ('paid'::text, date '2026-08-06', 'Bank'::text), 'bank fees are paid';
  assert not exists (select 1 from ledger_approvals where entry_id = fees), 'and need no approval';
end $$;

\echo 'Void keeps the line; fee payments go in once'
do $$
declare raffle uuid := (select id from ledger_entries where code = 'CR-002');
begin
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.void_entry(%L, ' ')$q$, raffle)) = 'Say why it’s being voided.', 'reason';
  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.void_entry(%L, 'x')$q$, raffle))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'member voids';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.void_entry(%L, ' Entered twice ')$q$, raffle)) is null, 'voided';
  assert (select (state, void_reason, voided_by) from ledger_entries where id = raffle) = ('void'::text, 'Entered twice'::text, pg_temp.u(2)), 'kept, with why';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.void_entry(%L, 'x')$q$, raffle)) = 'That’s already void.', 'twice';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.void_entry(%L, 'x')$q$, gen_random_uuid())) = 'No such entry.', 'missing';

  assert pg_temp.try_as(pg_temp.u(2), $q$select public.add_fee_payment('00000000-0000-0000-0000-00000000f102')$q$)
    = 'Only a confirmed payment goes in the ledger.', 'claimed';
  assert pg_temp.try_as(pg_temp.u(5), $q$select public.add_fee_payment('00000000-0000-0000-0000-00000000f101')$q$)
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'North President';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.add_fee_payment(gen_random_uuid())$q$) = 'No such payment.', 'missing';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.add_fee_payment('00000000-0000-0000-0000-00000000f101')$q$) is null, 'added';
  assert (select (code, chapter_id, amount_cents, entry_on, description) from ledger_entries where payment_id = '00000000-0000-0000-0000-00000000f101')
    = ('CR-001'::text, pg_temp.west(), 15000, date '2026-07-03', 'Member fees: Fredo'::text), 'as CR-001 on the day it was paid';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.add_fee_payment('00000000-0000-0000-0000-00000000f101')$q$)
    = 'That payment is already in the ledger.', 'twice';
end $$;

\echo 'Openings, float and the monthly report'
do $$
declare r jsonb;
begin
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.set_opening(%L, 1999, 0)$q$, pg_temp.west())) = 'Pick a financial year.', 'year';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.set_opening(%L, 2026, 100000)$q$, pg_temp.west())) is null, 'West opening';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.set_opening(%L, 2026, 300000)$q$, pg_temp.west())) is null, 'set again replaces it';
  assert (select count(*) from fund_openings) = 1 and (select amount_cents from fund_openings) = 300000, 'one opening';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.set_opening(null, 2026, 500000)$q$) is null, 'Club opening';
  assert pg_temp.try_as(pg_temp.u(3), $q$select public.set_cash_float(2026, 40000)$q$)
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary float';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.set_cash_float(2026, -1)$q$) = 'Enter an amount of $0 or more.', 'negative float';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.set_cash_float(2025, 40000)$q$) is null, 'float';

  -- August: West has the patches paid (30000 out); the Club fund the hoodies (82000 in) and the
  -- bank fee (40 out). The raffle is void, the refund unpaid, and Fred's fees were in July.
  r := private.month_report(date '2026-08-01');
  assert (r->>'opening_cents')::int = 300000 + 500000 + 15000, 'opening: openings plus July';
  assert (r->>'credit_total')::int = 82000 and (r->>'debit_total')::int = 30040, 'totals skip void and unpaid';
  assert jsonb_array_length(r->'credits') = 7 and jsonb_array_length(r->'debits') = 7, 'every code';
  assert r->'credits'->4 = '{"code": "CR-005", "cents": 82000}'::jsonb, 'by code';
  assert (r->'funds'->>'club')::int = 500000 + 82000 - 40, 'Club fund';
  assert (r->'funds'->>pg_temp.west()::text)::int = 300000 + 15000 - 30000, 'West fund';
  assert (r->'funds'->>pg_temp.north()::text)::int = 0, 'North fund';
  assert (r->>'float_cents')::int = 40000, 'last year''s float carries on';
  assert (r->>'bank_cents')::int = (r->>'total_cents')::int - 40000, 'bank is total less float';
  assert (private.month_report(date '2026-07-01')->>'opening_cents')::int = 800000, 'July opens from the openings';
end $$;

\echo 'Presenting a month, and who reads what'
do $$
declare r jsonb;
begin
  assert pg_temp.try_as(pg_temp.u(3), $q$select public.present_report(date '2026-08-01')$q$)
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary presents';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.present_report(date '2026-08-02')$q$) = 'Pick a month.', 'not a month';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.present_report(%L)$q$, date_trunc('month', private.club_date())::date))
    = 'Wait until the month is over.', 'this month';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.present_report(date '2026-08-01')$q$) is null, 'presented';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.present_report(date '2026-08-01')$q$) = 'That month is already presented.', 'twice';

  r := pg_temp.ledger_as(pg_temp.u(4));
  assert jsonb_array_length(r->'entries') = 0, 'members get no lines';
  assert jsonb_array_length(r->'reports') = 1 and jsonb_array_length(r->'report_totals') = 1, 'but the presented report';
  assert (r->'report_totals'->0->>'credit_total')::int = 82000, 'with its totals';
  assert jsonb_array_length(r->'openings') = 2, 'and the openings';
  assert jsonb_array_length(pg_temp.ledger_as(pg_temp.u(8))->'reports') = 0, 'Legacy members have left';
  assert jsonb_array_length(pg_temp.ledger_as(pg_temp.u(9))->'reports') = 0, 'applicants see nothing';

  r := pg_temp.ledger_as(pg_temp.u(3));
  assert (select count(*) from jsonb_array_elements(r->'entries') e where e->>'chapter_id' is null) = 0, 'the West Secretary reads West, not the Club fund';
  assert (select count(*) from jsonb_array_elements(r->'entries') e where e->>'chapter_id' = pg_temp.west()::text) = 4, 'all of West';
  assert (select e->>'credit_total' from jsonb_array_elements(r->'report_totals') e where e->>'month' = '2026-08-01')::int = 82000,
    'a reader of one fund gets every month worked out over all of them';
  assert (select count(*) from jsonb_array_elements(r->'report_totals') e where e->>'month' = to_char(date_trunc('month', private.club_date()), 'YYYY-MM-DD')) = 1,
    'up to this month';
  assert jsonb_array_length(pg_temp.ledger_as(pg_temp.u(7))->'entries') = 6, 'the Auditor reads every line';
  assert jsonb_array_length(pg_temp.ledger_as(pg_temp.u(5))->'entries') = 2, 'a President reads the Club fund';
  r := (select e from jsonb_array_elements(pg_temp.ledger_as(pg_temp.u(2))->'entries') e where e->>'code' = 'DB-001');
  assert jsonb_array_length(r->'approvals') = 2, 'approvals come with the entry';
end $$;

\echo 'Budgets: book-keepers edit, a carried board vote approves, then it’s locked (13.4)'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.save_budget(%L, 2026, '{}')$q$, pg_temp.west()))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary edits';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{"XX-1": 1}')$q$, pg_temp.west())) = 'Pick a payment code.', 'code';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{"DB-001": -1}')$q$, pg_temp.west()))
    = 'Budget amounts must be $0 or more.', 'negative';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{"DB-001": 1.5}')$q$, pg_temp.west()))
    = 'Budget amounts must be $0 or more.', 'part cents';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west()))
    = 'Save the budget first.', 'none yet';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{"DB-001": 50000, "CR-001": 500000}')$q$, pg_temp.west())) is null, 'saved';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{"DB-001": 60000}')$q$, pg_temp.west())) is null, 'saved again';
  assert (select count(*) from budgets) = 1 and (select lines from budgets) = '{"DB-001": 60000}'::jsonb, 'one budget';

  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west()))
    = 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.', 'member approves';
  assert pg_temp.try_as(pg_temp.u(7), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west()))
    = 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.', 'the Auditor approves (11.8)';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b002')$q$, pg_temp.west()))
    = 'Pick a carried board vote for this budget (13.4).', 'lost vote';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b003')$q$, pg_temp.west()))
    = 'Pick a carried board vote for this budget (13.4).', 'members'' vote';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b004')$q$, pg_temp.west()))
    = 'Pick a carried board vote for this budget (13.4).', 'NEC vote for a chapter';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west())) is null, 'approved';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west()))
    = 'That budget is already approved.', 'twice';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_budget(%L, 2026, '{}')$q$, pg_temp.west()))
    = 'That budget is approved and locked. Reopen it to change it.', 'locked';
  assert pg_temp.try_as(pg_temp.u(7), format($q$select public.reopen_budget(%L, 2026)$q$, pg_temp.west()))
    = 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.', 'the Auditor reopens (11.8)';
  assert pg_temp.try_as(pg_temp.u(5), format($q$select public.reopen_budget(%L, 2026)$q$, pg_temp.west()))
    = 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.', 'another chapter’s President reopens';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.reopen_budget(%L, 2026)$q$, pg_temp.west())) is null, 'reopened';
  update votes set closed_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-00000000b001';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.approve_budget(%L, 2026, '00000000-0000-0000-0000-00000000b001')$q$, pg_temp.west()))
    = 'That vote closed before the budget’s last change. It needs a new vote (13.4).', 'the old vote again';
  assert (select (approved_at, lines) from budgets) = (null::timestamptz, '{"DB-001": 60000}'::jsonb), 'reopening keeps the lines';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.reopen_budget(%L, 2026)$q$, pg_temp.west())) = 'That budget isn’t approved.', 'reopen twice';

  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_budget(null, 2026, '{"DB-002": 100000}')$q$) is null, 'Club budget';
  assert pg_temp.try_as(pg_temp.u(5), $q$select public.approve_budget(null, 2026, '00000000-0000-0000-0000-00000000b004')$q$) is null, 'a carried NEC vote approves it';
end $$;

\echo 'All treasurer checks passed'
