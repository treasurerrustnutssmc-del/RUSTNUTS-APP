-- Checks the Treasurer's Report for a meeting: the figures (the same fixture and numbers as
-- src/domain/meetingReport.test.ts), the refusals with the app's words, who saves, presents and
-- deletes, and who reads drafts and presented reports. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- t1 National Chairman, t2 West Treasurer, t3 West Secretary, t4 West Full, t8 West Legacy, t9 applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'd' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, null, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Cal Chairman', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Tess Treasurer', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'Sue Secretary', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'west', 'Fred Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d8', 'west', 'Len Legacy', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Al Applicant', 'introduced', 'pending')
) as v(id, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on) values
  ('00000000-0000-0000-0000-0000000000d1', null, 'nec_chair', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d2', (select id from chapters where slug = 'west'), 'treasurer', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d3', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16');

insert into fund_openings (chapter_id, fy, amount_cents) values
  (null, 2025, 1),
  (null, 2026, 100000),
  ((select id from chapters where slug = 'west'), 2026, 20000),
  ((select id from chapters where slug = 'north'), 2026, 0);
insert into cash_floats (fy, amount_cents) values (2026, 40000);

insert into ledger_entries (chapter_id, code, description, amount_cents, entry_on, state, updated_at)
select (select id from chapters where slug = v.ch), v.code, v.what, v.cents, v.on_::date, v.state, coalesce(v.changed::timestamptz, '2026-08-10T01:00:00Z')
from (values
  (null, 'CR-005', 'Last year', 77777, '2026-06-20', 'paid', null),
  ('west', 'CR-001', 'Member fees (Bear)', 36000, '2026-07-20', 'paid', null),
  (null, 'DB-004', 'Transaction fees', 40, '2026-08-01', 'paid', null),
  ('west', 'CR-001', 'Member fees (Tigs)', 36000, '2026-08-10', 'paid', null),
  (null, 'CR-005', 'Merch order', 5000, '2026-09-05', 'paid', null),
  (null, 'DB-001', 'Accommodation', 10000, '2026-09-17', 'paid', '2026-09-18T01:00:00Z'),
  ('north', 'CR-001', 'Member fees (Dysco)', 36000, '2026-10-04', 'paid', null),
  (null, 'DB-005', 'Dawn Studios', 2000, '2026-10-21', 'paid', null),
  (null, 'CR-005', 'After the period', 999, '2026-10-25', 'paid', null),
  ('west', 'DB-003', 'Void', 1200, '2026-09-01', 'void', null),
  ('west', 'DB-001', 'Awaiting', 5000, null, 'awaiting', null)
) as v(ch, code, what, cents, on_, state, changed);

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

create function pg_temp.reports_as(who uuid) returns jsonb language sql as $$
  select pg_temp.value_as(who, 'public.meeting_reports()')::jsonb
$$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.west() returns text language sql as $$ select id::text from chapters where slug = 'west' $$;
create function pg_temp.north() returns text language sql as $$ select id::text from chapters where slug = 'north' $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.reports_as(uuid), pg_temp.u(int),
  pg_temp.west(), pg_temp.north() to anon, authenticated;

\o
\echo 'Nobody reaches the table or the helpers directly'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(1), 'select count(*) from public.treasurer_meeting_reports') is not null, 'read the table';
  assert pg_temp.try_as(null, 'select count(*) from public.treasurer_meeting_reports') is not null, 'anon reads the table';
  assert pg_temp.try_as(null, 'select public.meeting_reports()') is not null, 'anon can''t call meeting_reports';
  assert pg_temp.try_as(pg_temp.u(1), $q$select private.meeting_report(date '2026-08-01', date '2026-08-31')$q$) is not null, 'the figures helper is private';
end $$;

\echo 'The figures, as meetingFigures works them out'
do $$
declare r jsonb := private.meeting_report(date '2026-08-01', date '2026-10-21');
begin
  assert (r->>'opening_cents')::int = 156000, 'opening ' || (r->>'opening_cents');
  assert (r->>'receipts_cents')::int = 77000 and (r->>'payments_cents')::int = 12040, 'receipts and payments';
  assert (r->>'closing_cents')::int = 220960 and (r->>'float_cents')::int = 40000, 'closing and float';
  assert r->'funds'->'club' = '{"opening_cents": 100000, "receipts_cents": 5000, "payments_cents": 12040, "closing_cents": 92960}'::jsonb, 'Club fund';
  assert r->'funds'->pg_temp.west() = '{"opening_cents": 56000, "receipts_cents": 36000, "payments_cents": 0, "closing_cents": 92000}'::jsonb, 'West fund';
  assert r->'funds'->pg_temp.north() = '{"opening_cents": 0, "receipts_cents": 36000, "payments_cents": 0, "closing_cents": 36000}'::jsonb, 'North fund';
  assert jsonb_array_length(r->'credits') = 7 and jsonb_array_length(r->'debits') = 7, 'every code';
  assert r->'credits'->0 = '{"code": "CR-001", "cents": 72000}'::jsonb and r->'debits'->3 = '{"code": "DB-004", "cents": 40}'::jsonb, 'by code';
  assert r->'months' = '[
    {"month": "2026-08-01", "from": "2026-08-01", "to": "2026-08-31", "receipts_cents": 36000, "payments_cents": 40},
    {"month": "2026-09-01", "from": "2026-09-01", "to": "2026-09-30", "receipts_cents": 5000, "payments_cents": 10000},
    {"month": "2026-10-01", "from": "2026-10-01", "to": "2026-10-21", "receipts_cents": 36000, "payments_cents": 2000}]'::jsonb, 'months';
  assert (r->>'line_count')::int = 6, 'paid lines in the period';
  assert (r->>'last_change_at')::timestamptz = '2026-09-18T01:00:00Z', 'last change';

  r := private.meeting_report(date '2026-08-05', date '2026-10-21');
  assert r->'months'->0->>'from' = '2026-08-05', 'the first month is cut to the period';

  r := private.meeting_report(date '2026-07-01', date '2026-07-31');
  assert (r->>'opening_cents')::int = 120000 and (r->>'closing_cents')::int = 156000, '1 July opens on the new year''s openings';
end $$;

\echo 'Saving: who, and the refusals'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(9), $q$select public.save_meeting_report(null, date '2026-08-01', date '2026-10-21', '')$q$)
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as(pg_temp.u(3), $q$select public.save_meeting_report(null, date '2026-08-01', date '2026-10-21', '')$q$)
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting_report(null, null, date '2026-10-21', '')$q$)
    = 'Pick the first and last day of the report.', 'no from';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting_report(null, date '2026-10-22', date '2026-10-21', '')$q$)
    = 'The report has to start before it ends.', 'backwards';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting_report(null, date '2026-10-01', %L, '')$q$, private.club_date() + 1))
    = 'The report can’t run past today.', 'future';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting_report(null, date '2026-06-30', date '2026-10-21', '')$q$)
    = 'Keep the report inside one financial year (1 July to 30 June).', 'across 1 July';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting_report(null, date '2026-08-01', date '2026-10-21', %L)$q$, repeat('x', 4001)))
    = 'Keep the notes under 4,000 characters.', 'long notes';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting_report('00000000-0000-0000-0000-000000000000', date '2026-08-01', date '2026-10-21', '')$q$)
    = 'No such report.', 'unknown';

  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting_report(null, date '2026-07-01', date '2026-07-31', 'July')$q$) is null, 'a West treasurer keeps the Club fund';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.save_meeting_report(null, date '2026-08-01', date '2026-10-20', 'Bear & Tigs')$q$) is null, 'the Chairman';
  assert (select count(*) from treasurer_meeting_reports) = 2, 'two drafts';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting_report(%L, date '2026-08-01', date '2026-10-21', 'Bear and Tigs')$q$,
    (select id from treasurer_meeting_reports where notes = 'Bear & Tigs'))) is null, 'a draft changes';
  assert (select (to_on, notes, saved_by) from treasurer_meeting_reports where from_on = '2026-08-01')
    = (date '2026-10-21', 'Bear and Tigs'::text, pg_temp.u(2)), 'changed in place';
end $$;

\echo 'Presenting, deleting, and who reads what'
do $$
declare
  july uuid := (select id from treasurer_meeting_reports where from_on = '2026-07-01');
  oct uuid := (select id from treasurer_meeting_reports where from_on = '2026-08-01');
  r jsonb;
begin
  assert pg_temp.try_as(pg_temp.u(3), format('select public.present_meeting_report(%L)', july))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary presents';
  assert pg_temp.try_as(pg_temp.u(2), 'select public.present_meeting_report(''00000000-0000-0000-0000-000000000000'')') = 'No such report.', 'unknown';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.present_meeting_report(%L)', july)) is null, 'presented';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.present_meeting_report(%L)', july)) = 'That report is already presented.', 'twice';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting_report(%L, date '2026-07-01', date '2026-07-31', 'x')$q$, july))
    = 'That report is presented and can’t be changed.', 'locked';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.delete_meeting_report(%L)', july))
    = 'That report is presented and can’t be changed.', 'a presented report stays';

  r := pg_temp.reports_as(pg_temp.u(4));
  assert jsonb_array_length(r) = 1 and r->0->>'id' = july::text, 'members read presented reports, not drafts';
  assert r->0->>'notes' = 'July' and (r->0->'figures'->>'closing_cents')::int = 156000, 'with the notes and figures';
  assert not (r->0 ? 'lines') and not (r->0->'figures' ? 'lines'), 'never the lines';
  assert jsonb_array_length(pg_temp.reports_as(pg_temp.u(8))) = 0, 'Legacy members have left';
  assert jsonb_array_length(pg_temp.reports_as(pg_temp.u(9))) = 0, 'applicants see nothing';
  assert jsonb_array_length(pg_temp.reports_as(pg_temp.u(2))) = 2, 'book-keepers read drafts too';
  assert (pg_temp.reports_as(pg_temp.u(1))->0->'figures'->>'receipts_cents')::int = 77000, 'the October draft first, worked out';

  assert pg_temp.try_as(pg_temp.u(3), format('select public.delete_meeting_report(%L)', oct))
    = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.', 'Secretary deletes';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.delete_meeting_report(%L)', oct)) is null, 'a draft goes';
  assert (select count(*) from treasurer_meeting_reports) = 1, 'one left';
end $$;

\echo 'All meeting report checks passed'
