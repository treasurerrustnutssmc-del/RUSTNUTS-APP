-- Checks website visitor counts: only the service role counts, bad pages are dropped silently,
-- a day caps at 200 pages, and only the board reads the summary (the app's words).
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000aa1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-000000000aa2', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-000000000aa3', 'paul@example.com', now());  -- pending

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-000000000aa1', 'west', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-000000000aa2', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-000000000aa3', 'west', 'Paul Pending', 'pending')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
values ('00000000-0000-0000-0000-000000000aa1', (select id from chapters where slug = 'west'), 'president', '2024-07-01');

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

create function pg_temp.summary_as(who uuid) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select coalesce(string_agg(page || '=' || hits, ',' order by hits desc, page), '') into out from public.site_visit_summary();
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

\o
\echo 'Website visits: only the service role counts; bad pages are dropped without a word; a day caps at 200 pages'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-000000000aa1';
  i int;
begin
  assert pg_temp.try_as(null, 'select public.site_visit(''/'')') like 'permission denied%', 'anon can''t count';
  assert pg_temp.try_as(wes, 'select public.site_visit(''/'')') like 'permission denied%', 'the board can''t count either';
  assert pg_temp.try_as(wes, 'insert into site_visits values (current_date, ''/'', 1)') like 'permission denied%', 'no direct insert';
  assert pg_temp.try_as(wes, 'select * from site_visits') like 'permission denied%', 'no direct read';

  assert pg_temp.try_service('select public.site_visit(''/'')') is null, 'home';
  assert pg_temp.try_service('select public.site_visit(''/index.html'')') is null, 'index = home';
  assert pg_temp.try_service('select public.site_visit('''')') is null, 'blank = home';
  assert pg_temp.try_service('select public.site_visit(''get-the-app'')') is null, 'no leading slash is added';
  assert pg_temp.try_service('select public.site_visit(''/Charity.html'')') is null, 'upper case: dropped quietly';
  assert pg_temp.try_service('select public.site_visit(''/x?y=1'')') is null, 'query: dropped quietly';
  assert pg_temp.try_service('select public.site_visit(''/' || repeat('a', 80) || ''')') is null, 'too long: dropped quietly';
  assert (select hits from site_visits where page = '/') = 3, 'home counted three';
  assert (select hits from site_visits where page = '/get-the-app') = 1, 'the tap counter';
  assert (select count(*) from site_visits) = 2, 'nothing else kept';

  for i in 1..200 loop
    perform pg_temp.try_service('select public.site_visit(''/p' || i || '.html'')');
  end loop;
  assert (select count(*) from site_visits) = 200, 'a day stops at 200 pages: ' || (select count(*) from site_visits);
  assert pg_temp.try_service('select public.site_visit(''/'')') is null, 'a page already there still counts';
  assert (select hits from site_visits where page = '/') = 4, 'home counted four';
end $$;

\o
\echo 'Website visits: the board reads the last 30 days, nobody else'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-000000000aa1';
  nell constant uuid := '00000000-0000-0000-0000-000000000aa2';
  paul constant uuid := '00000000-0000-0000-0000-000000000aa3';
begin
  delete from site_visits;
  insert into site_visits (day, page, hits) values
    (current_date, '/', 40), (current_date, '/charity.html', 5),
    (current_date - 29, '/', 10), (current_date - 30, '/', 100);
  assert pg_temp.try_as(null, 'select * from public.site_visit_summary()') like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, 'select * from public.site_visit_summary()') = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, 'select * from public.site_visit_summary()') = 'Only the board can see website visits.', 'no seat';
  assert pg_temp.summary_as(wes) = '/=40,/=10,/charity.html=5', 'the board sees 30 days: ' || pg_temp.summary_as(wes);
end $$;
