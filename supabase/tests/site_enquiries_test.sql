-- Checks website join enquiries: site_enquiry's checks and spam limits (service role only), who
-- sees which enquiries, and handle_site_enquiry's refusals in the same words and order as
-- src/domain/enquiries.ts.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000008a1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-0000000008a2', 'bea@example.com', now()),   -- North Secretary
  ('00000000-0000-0000-0000-0000000008a3', 'chair@example.com', now()), -- NEC Chairman
  ('00000000-0000-0000-0000-0000000008a4', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000008a5', 'paul@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-0000000008a6', 'ex@example.com', now());    -- a seat that has ended

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000008a1', 'west', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-0000000008a2', 'north', 'Bea Board', 'approved'),
  ('00000000-0000-0000-0000-0000000008a3', 'north', 'Charlie Chair', 'approved'),
  ('00000000-0000-0000-0000-0000000008a4', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-0000000008a5', 'west', 'Paul Pending', 'pending'),
  ('00000000-0000-0000-0000-0000000008a6', 'west', 'Ed Ex', 'approved')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on, ended_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01', v.ended::date
from (values
  ('00000000-0000-0000-0000-0000000008a1', 'west', 'president', null),
  ('00000000-0000-0000-0000-0000000008a2', 'north', 'secretary', null),
  ('00000000-0000-0000-0000-0000000008a3', null, 'nec_chair', null),
  ('00000000-0000-0000-0000-0000000008a6', 'west', 'treasurer', '2025-06-30')
) as v(id, slug, role, ended);

-- Runs a statement as a signed-in user (anon when who is null) and returns its error, or null.
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

-- Runs a statement with the service role (how the site-api function calls in) and returns its error, or null.
create function pg_temp.try_service(stmt text) returns text language plpgsql as $$
begin
  set local role service_role;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

-- The ids a signed-in user gets back from list_site_enquiries(), in order, as a string.
create function pg_temp.list_as(who uuid) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select coalesce(string_agg(name, ','), '') into out from (select name from public.list_site_enquiries()) l;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.enquiry_sql(name text, email text, chapter text, about text) returns text language sql as $$
  select format('select public.site_enquiry(%L, %L, %L, %L)', name, email, chapter, about);
$$;

\o
\echo 'Website enquiries: only the function''s service role writes them, with the form checks and spam limits'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000008a1';
  nell constant uuid := '00000000-0000-0000-0000-0000000008a4';
  ok text := pg_temp.enquiry_sql('Sam Rider', 'sam@example.com', 'west', 'Street Glide, keen for Sunday runs.');
  r site_enquiries%rowtype;
  i int;
begin
  -- Nobody but the service role.
  assert pg_temp.try_as(null, ok) like 'permission denied%', 'anon can''t call it';
  assert pg_temp.try_as(nell, ok) like 'permission denied%', 'members can''t call it';
  assert pg_temp.try_as(wes, ok) like 'permission denied%', 'the board can''t call it either';
  assert pg_temp.try_as(wes, 'insert into site_enquiries (name, email, chapter_slug) values (''x'', ''x@y.zz'', ''west'')') like 'permission denied%', 'no direct insert';

  -- The checks, in the app's order and words.
  assert pg_temp.try_service(pg_temp.enquiry_sql('  ', 'sam@example.com', 'west', '')) = 'Tell us your name.', 'no name';
  assert pg_temp.try_service(pg_temp.enquiry_sql(repeat('x', 81), 'sam@example.com', 'west', '')) = 'Keep your name to 80 characters.', 'long name';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', 'sam', 'west', '')) = 'That email address does not look right.', 'no @';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', 'sam@example', 'west', '')) = 'That email address does not look right.', 'no dot';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', repeat('s', 195) || '@ex.com', 'west', '')) = 'That email address does not look right.', 'long email';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', 'sam@example.com', 'south', '')) = 'Pick a chapter: West, North or either.', 'bad chapter';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', 'sam@example.com', null, '')) = 'Pick a chapter: West, North or either.', 'no chapter';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Sam', 'sam@example.com', 'west', repeat('x', 601))) = 'Keep it to 600 characters.', 'long about';

  -- Stored trimmed, email lowercased, an empty about as null.
  assert pg_temp.try_service(pg_temp.enquiry_sql('  Sam Rider ', ' Sam@Example.com ', 'either', '  ')) is null, 'a good one';
  select * into r from site_enquiries;
  assert r.name = 'Sam Rider' and r.email = 'sam@example.com' and r.chapter_slug = 'either' and r.about is null
    and r.handled_at is null and r.handled_by is null, 'kept clean';

  -- The same address: three a day.
  assert pg_temp.try_service(ok) is null, 'second today';
  assert pg_temp.try_service(ok) is null, 'third today';
  assert pg_temp.try_service(ok) = 'Too many enquiries just now. Try again later, or email the club.', 'fourth today refused';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Jo', 'jo@example.com', 'north', '')) is null, 'another address is fine';
  update site_enquiries set created_at = now() - interval '25 hours' where email = 'sam@example.com';
  assert pg_temp.try_service(ok) is null, 'yesterday''s don''t count';

  -- Everyone together: thirty an hour.
  delete from site_enquiries;
  for i in 1..30 loop
    assert pg_temp.try_service(pg_temp.enquiry_sql('Rider ' || i, 'rider' || i || '@example.com', 'west', '')) is null, 'enquiry ' || i;
  end loop;
  assert pg_temp.try_service(pg_temp.enquiry_sql('Rider 31', 'rider31@example.com', 'west', '')) = 'Too many enquiries just now. Try again later, or email the club.', 'the 31st in an hour';
  update site_enquiries set created_at = now() - interval '61 minutes';
  assert pg_temp.try_service(pg_temp.enquiry_sql('Rider 31', 'rider31@example.com', 'west', '')) is null, 'an hour later it''s fine';
  delete from site_enquiries;
end $$;

\o
\echo 'Website enquiries: a chapter board sees its own and "either", the NEC officers see the lot, others nothing'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000008a1';
  bea constant uuid := '00000000-0000-0000-0000-0000000008a2';
  chair constant uuid := '00000000-0000-0000-0000-0000000008a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000008a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000008a5';
  ex constant uuid := '00000000-0000-0000-0000-0000000008a6';
begin
  insert into site_enquiries (name, email, chapter_slug, created_at) values
    ('W old', 'w1@example.com', 'west', now() - interval '3 days'),
    ('N one', 'n1@example.com', 'north', now() - interval '2 days'),
    ('E one', 'e1@example.com', 'either', now() - interval '1 day'),
    ('W new', 'w2@example.com', 'west', now());
  update site_enquiries set handled_at = now(), handled_by = wes where name = 'W old';

  -- Open ones first, newest first, then the handled one.
  assert pg_temp.list_as(wes) = 'W new,E one,W old', 'West President: ' || pg_temp.list_as(wes);
  assert pg_temp.list_as(bea) = 'E one,N one', 'North Secretary: ' || pg_temp.list_as(bea);
  assert pg_temp.list_as(chair) = 'W new,E one,N one,W old', 'Chairman: ' || pg_temp.list_as(chair);
  assert pg_temp.list_as(nell) = '', 'a member sees none';
  assert pg_temp.list_as(paul) = '', 'pending sees none';
  assert pg_temp.list_as(ex) = '', 'an ended seat sees none';
  assert pg_temp.try_as(null, 'select * from public.list_site_enquiries()') like 'permission denied%', 'anon can''t list';
  assert pg_temp.try_as(null, 'select * from public.site_enquiries') like 'permission denied%', 'anon can''t read the table';
  assert pg_temp.try_as(wes, 'update public.site_enquiries set note = ''x''') like 'permission denied%', 'no direct update';
  assert pg_temp.try_as(wes, 'delete from public.site_enquiries') like 'permission denied%', 'no direct delete';
end $$;

\o
\echo 'Website enquiries: handling is for the board that sees it, once, with a short note'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000008a1';
  bea constant uuid := '00000000-0000-0000-0000-0000000008a2';
  chair constant uuid := '00000000-0000-0000-0000-0000000008a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000008a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000008a5';
  w uuid := (select id from site_enquiries where name = 'W new');
  n uuid := (select id from site_enquiries where name = 'N one');
  e uuid := (select id from site_enquiries where name = 'E one');
  done uuid := (select id from site_enquiries where name = 'W old');
  r site_enquiries%rowtype;
begin
  assert pg_temp.try_as(null, format('select public.handle_site_enquiry(%L, %L)', w, '')) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, format('select public.handle_site_enquiry(%L, %L)', w, '')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, format('select public.handle_site_enquiry(%L, %L)', w, '')) = 'Only the board can see website enquiries.', 'no seat';
  assert pg_temp.try_as(bea, format('select public.handle_site_enquiry(%L, %L)', w, '')) = 'No such enquiry.', 'North can''t handle a West one';
  assert pg_temp.try_as(wes, format('select public.handle_site_enquiry(%L, %L)', '00000000-0000-0000-0000-000000000000', '')) = 'No such enquiry.', 'gone';
  assert pg_temp.try_as(wes, format('select public.handle_site_enquiry(%L, %L)', done, '')) = 'That enquiry has already been handled.', 'already handled';
  assert pg_temp.try_as(wes, format('select public.handle_site_enquiry(%L, %L)', w, repeat('x', 301))) = 'Keep the note to 300 characters.', 'long note';

  assert pg_temp.try_as(wes, format('select public.handle_site_enquiry(%L, %L)', w, ' Rang him, coming Sunday ')) is null, 'West handles its own';
  select * into r from site_enquiries where id = w;
  assert r.handled_at is not null and r.handled_by = wes and r.note = 'Rang him, coming Sunday', 'marked by Wes with the note';
  assert pg_temp.try_as(bea, format('select public.handle_site_enquiry(%L, %L)', e, '')) is null, 'North handles an "either"';
  assert (select note is null from site_enquiries where id = e), 'an empty note is null';
  assert pg_temp.try_as(chair, format('select public.handle_site_enquiry(%L, %L)', n, '')) is null, 'the Chairman handles any';
  assert pg_temp.list_as(wes) = 'W new,E one,W old', 'all handled now, newest first: ' || pg_temp.list_as(wes);
end $$;
