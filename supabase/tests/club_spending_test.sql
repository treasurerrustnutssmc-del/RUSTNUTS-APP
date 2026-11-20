-- Checks Club spending for members: every paid expense, member names hidden, money in never listed,
-- and who reads it (the same people as presented Treasurer's Reports). Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- e2 West Treasurer, e4 West Full, e8 West Legacy, e9 applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, 'e' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = 'west'), v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000e2', 'Tess Treasurer', 'El Jefe', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e4', 'Gary Kowalski', 'Rusty', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e8', 'Len Legacy', null, 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000e9', 'Al Applicant', null, 'introduced', 'pending')
) as v(id, name, road, status, approval);

insert into positions (member_id, chapter_id, role, started_on) values
  ('00000000-0000-0000-0000-0000000000e2', (select id from chapters where slug = 'west'), 'treasurer', '2025-08-16');

insert into ledger_entries (chapter_id, code, description, amount_cents, entry_on, state, payee_name, payee_member_id)
select (select id from chapters where slug = v.ch), v.code, v.what, v.cents, v.on_::date, v.state, v.payee, v.pm::uuid
from (values
  (null, 'DB-007', 'Meeting food (El Jefe)', 25000, '2026-09-01', 'paid', 'El Jefe', null),
  ('west', 'DB-005', 'Dawn Studios - merchandise', 22600, '2026-10-06', 'paid', 'Dawn Studios', null),
  (null, 'DB-001', 'Refund to Gary Kowalski for RUSTY’s fuel', 3000, '2026-10-07', 'paid', null, '00000000-0000-0000-0000-0000000000e4'),
  (null, 'DB-001', 'Rustyness test', 100, '2026-10-08', 'paid', null, null),
  (null, 'DB-001', 'Awaiting', 5000, null, 'awaiting', null, null),
  (null, 'DB-001', 'Void', 1200, '2026-10-09', 'void', null, null),
  (null, 'CR-003', 'Club oil (Gary Kowalski)', 3000, '2026-10-10', 'paid', null, null)
) as v(ch, code, what, cents, on_, state, payee, pm);

create function pg_temp.spending_as(who uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  v := public.club_spending();
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
grant execute on function pg_temp.spending_as(uuid), pg_temp.u(int) to authenticated;

\o
\echo 'Club spending: paid expenses only, newest first, member names hidden'
do $$
declare r jsonb := pg_temp.spending_as(pg_temp.u(4));
begin
  assert jsonb_array_length(r) = 4, 'four paid expenses, got ' || jsonb_array_length(r);
  assert r->0->>'description' = 'Rustyness test' and r->0->>'payee' is null, 'only whole words; no payee';
  assert r->1->>'description' = 'Refund to a member for a member’s fuel', 'full and road names, any case: ' || (r->1->>'description');
  assert r->1->>'payee' = 'A member', 'a member payee by id';
  assert r->2->>'payee' = 'Dawn Studios' and (r->2->>'amount_cents')::int = 22600 and r->2->>'code' = 'DB-005', 'a business stays named';
  assert r->2->>'chapter_id' = (select id::text from chapters where slug = 'west'), 'with its fund';
  assert r->3->>'description' = 'Meeting food (a member)' and r->3->>'payee' = 'A member', 'a member payee by name';
  assert r->3->>'entry_on' = '2026-09-01', 'the date';
  assert not exists (select 1 from jsonb_array_elements(r) x where x->>'description' like '%oil%'), 'money in is never listed';
end $$;

\echo 'Club spending: who reads it'
do $$
begin
  assert jsonb_array_length(pg_temp.spending_as(pg_temp.u(2))) = 4, 'the treasurer';
  assert jsonb_array_length(pg_temp.spending_as(pg_temp.u(8))) = 0, 'Legacy members have left';
  assert jsonb_array_length(pg_temp.spending_as(pg_temp.u(9))) = 0, 'applicants see nothing';
  assert jsonb_array_length(pg_temp.spending_as(null)) = 0, 'signed out sees nothing';
  begin
    set local role anon;
    perform public.club_spending();
    assert false, 'anon can call it';
  exception when insufficient_privilege then reset role;
  end;
  begin
    set local role authenticated;
    perform private.hide_member_names('x');
    assert false, 'the helper is private';
  exception when insufficient_privilege then reset role;
  end;
end $$;

\echo 'All club spending checks passed'
