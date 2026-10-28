-- Checks unclaimed_roster_counts(): approved members see how many roster places in each chapter
-- nobody has claimed yet, as numbers only. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'jeff@example.com', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'pending@example.com', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'claimed@example.com', now());

insert into members (id, chapter_id, full_name, status, approval)
select '00000000-0000-0000-0000-0000000000b1', id, 'Jeff', 'full', 'approved' from chapters where slug = 'west';
insert into members (id, chapter_id, full_name, status, approval)
select '00000000-0000-0000-0000-0000000000b2', id, 'Pending', 'introduced', 'pending' from chapters where slug = 'west';

insert into private.roster (email, chapter_id, full_name, status, claimed_by)
select v.email, c.id, v.email, v.status::member_status, v.claimed::uuid
from (values
  ('w1@example.com', 'west', 'full', null),
  ('w2@example.com', 'west', 'full', null),
  ('w3@example.com', 'west', 'fng', null),
  ('n1@example.com', 'north', 'fng', null),
  ('claimed@example.com', 'west', 'full', '00000000-0000-0000-0000-0000000000b3'),
  ('JEFF@example.com', 'west', 'full', null)  -- already a member before the roster went in
) as v(email, chapter, status, claimed)
join chapters c on c.slug = v.chapter;

create function pg_temp.counts_as(who uuid) returns table (chapter text, status text, n int) language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  return query select c.slug, r.status::text, r.n from public.unclaimed_roster_counts() r join chapters c on c.id = r.chapter_id;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

\o
\echo 'An approved member sees unclaimed roster places per chapter and status'
do $$
begin
  assert (select n from pg_temp.counts_as('00000000-0000-0000-0000-0000000000b1') where chapter = 'west' and status = 'full') = 2,
    'two unclaimed West Full places; the claimed one and the existing member are left out';
  assert (select n from pg_temp.counts_as('00000000-0000-0000-0000-0000000000b1') where chapter = 'west' and status = 'fng') = 1;
  assert (select n from pg_temp.counts_as('00000000-0000-0000-0000-0000000000b1') where chapter = 'north' and status = 'fng') = 1;
  assert (select count(*) from pg_temp.counts_as('00000000-0000-0000-0000-0000000000b1')) = 3, 'one row per chapter and status';
end $$;
reset role;

\echo 'Applicants and strangers get nothing, and the roster itself stays closed'
do $$
begin
  assert (select count(*) from pg_temp.counts_as('00000000-0000-0000-0000-0000000000b2')) = 0, 'a pending applicant sees nothing';
  assert (select count(*) from pg_temp.counts_as(null)) = 0, 'signed out sees nothing';
  assert not has_table_privilege('authenticated', 'private.roster', 'select'), 'no direct read of the roster';
  assert not has_function_privilege('anon', 'public.unclaimed_roster_counts()', 'execute'), 'not for signed-out callers';
end $$;
reset role;
