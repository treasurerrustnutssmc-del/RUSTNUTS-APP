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
  assert exists (select 1 from member_private where member_id = jefe and email = 'treasurer.rustnutssmc@gmail.com'),
    'his contact and licence record exists, so saving his profile works';
  assert exists (select 1 from positions where member_id = jefe and role = 'founder' and chapter_id is null), 'Founder';
  assert exists (select 1 from positions where member_id = jefe and role = 'nec_chair' and chapter_id is null), 'National Chairman';
  assert (
    select count(*) from positions p join chapters c on c.id = p.chapter_id
    where p.member_id = jefe and p.role = 'treasurer' and c.slug in ('west', 'north')
  ) = 2, 'Treasurer of West and North';

  perform set_config('request.jwt.claim.sub', jefe::text, true);
  perform public.save_profile('Jeff Ostler', 'El Jefe', null, false, true,
    'treasurer.rustnutssmc@gmail.com', '0400000000', null, null, null);
  assert (select phone from member_private where member_id = jefe) = '0400000000', 'he can save his profile';
  assert private.is_chairman(), 'he can hand out national roles';
  assert private.is_board_of((select id from chapters where slug = 'north')), 'he sits on the North board';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

\echo 'Founder seed moves a pending Ask-to-join row to West and fills in his dates'
do $$
declare
  jefe constant uuid := '00000000-0000-0000-0000-0000000000ee';
begin
  delete from positions; delete from members;
  insert into members (id, chapter_id, full_name, status, approval)
  select jefe, id, 'Jeff', 'introduced', 'pending' from chapters where slug = 'north';
end $$;
\o /dev/null
\ir ../seed/founder.sql
\o
do $$
declare
  jefe constant uuid := '00000000-0000-0000-0000-0000000000ee';
begin
  assert exists (
    select 1 from members m join chapters c on c.id = m.chapter_id
    where m.id = jefe and c.slug = 'west' and m.road_name = 'El Jefe' and m.full_name = 'Jeff Ostler'
      and m.status = 'full' and m.approval = 'approved' and m.patched_on is not null and m.joined_on is not null
  ), 'pending row becomes approved Full in West with dates';
  assert (select count(*) from positions where member_id = jefe and ended_on is null) = 4, 'four positions';
end $$;

\echo 'A re-run after handing on a seat neither fails nor gives it back'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'jiggles@example.com');
do $$
declare
  jefe constant uuid := '00000000-0000-0000-0000-0000000000ee';
  other constant uuid := '00000000-0000-0000-0000-0000000000aa';
  north uuid := (select id from chapters where slug = 'north');
  west uuid := (select id from chapters where slug = 'west');
begin
  insert into members (id, chapter_id, full_name, status, approval) values (other, north, 'Other', 'full', 'approved');
  -- The Melbourne date, which seats start on: the server's current_date can be a day behind it.
  update positions set ended_on = private.club_date() where member_id = jefe and role = 'treasurer' and chapter_id in (north, west);
  insert into positions (member_id, chapter_id, role) values (other, north, 'treasurer');
end $$;
\o /dev/null
\ir ../seed/founder.sql
\o
do $$
declare
  jefe constant uuid := '00000000-0000-0000-0000-0000000000ee';
begin
  assert (select count(*) from positions where member_id = jefe and ended_on is null) = 2,
    'only Founder and Chairman stay open; West Treasurer not handed back';
  assert (select count(*) from positions where role = 'treasurer' and ended_on is null) = 1, 'North keeps its new Treasurer';
end $$;

\echo 'Founder seed refuses to run before he has signed in (the error below is expected)'
delete from auth.users where email = 'treasurer.rustnutssmc@gmail.com';
\set ON_ERROR_STOP 0
\o /dev/null
\ir ../seed/founder.sql
\o
\set ON_ERROR_STOP 1
select position('hasn''t signed in' in :'LAST_ERROR_MESSAGE') > 0 as refused \gset
\if :refused
\else
  \warn 'the seed should stop with an error when he has not signed in'
  select 1/0;
\endif
