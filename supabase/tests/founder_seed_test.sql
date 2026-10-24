-- Checks supabase/seed/founder.sql against the current schema: it makes El Jefe an approved
-- Full member with Founder, National Chairman and both Treasurer seats, and is safe to run twice.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ee', 'treasurer.rustnutssmc@gmail.com');

\ir ../seed/founder.sql
\ir ../seed/founder.sql

\o
\echo 'Founder seed makes El Jefe and can be run twice'
do $$
declare
  jefe constant uuid := '00000000-0000-0000-0000-0000000000ee';
begin
  assert (select count(*) from members) = 1, 'exactly one member';
  assert exists (
    select 1 from members m join chapters c on c.id = m.chapter_id
    where m.id = jefe and m.road_name = 'El Jefe' and m.status = 'full' and m.approval = 'approved' and c.slug = 'west'
  ), 'El Jefe is an approved Full member of West';
  assert (select count(*) from positions where member_id = jefe and ended_on is null) = 4, 'four open positions, no duplicates';
  assert exists (select 1 from positions where member_id = jefe and role = 'founder' and chapter_id is null), 'Founder';
  assert exists (select 1 from positions where member_id = jefe and role = 'nec_chair' and chapter_id is null), 'National Chairman';
  assert (
    select count(*) from positions p join chapters c on c.id = p.chapter_id
    where p.member_id = jefe and p.role = 'treasurer' and c.slug in ('west', 'north')
  ) = 2, 'Treasurer of West and North';

  perform set_config('request.jwt.claim.sub', jefe::text, true);
  assert private.is_chairman(), 'he can hand out national roles';
  assert private.is_board_of((select id from chapters where slug = 'north')), 'he sits on the North board';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
