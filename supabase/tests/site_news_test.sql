-- Checks club news for the website: only the board posts, lists and takes down (in the app's
-- words and order, src/domain/siteNews.ts), and public_site_news() gives anon the newest five live
-- notices under 60 days old with nothing personal.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000009a1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-0000000009a2', 'chair@example.com', now()), -- NEC Chairman
  ('00000000-0000-0000-0000-0000000009a3', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000009a4', 'paul@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-0000000009a5', 'ex@example.com', now());    -- a seat that has ended

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'Wes West', 'approved'),
  ('00000000-0000-0000-0000-0000000009a2', 'north', 'Charlie Chair', 'approved'),
  ('00000000-0000-0000-0000-0000000009a3', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-0000000009a4', 'west', 'Paul Pending', 'pending'),
  ('00000000-0000-0000-0000-0000000009a5', 'west', 'Ed Ex', 'approved')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on, ended_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01', v.ended::date
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'president', null),
  ('00000000-0000-0000-0000-0000000009a2', null, 'nec_chair', null),
  ('00000000-0000-0000-0000-0000000009a5', 'west', 'treasurer', '2025-06-30')
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

create function pg_temp.post_sql(title text, body text, link text) returns text language sql as $$
  select format('select public.post_site_news(%L, %L, %L)', title, body, link);
$$;

-- The titles a signed-in user gets back from list_site_news(), in order, as a string.
create function pg_temp.list_as(who uuid) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select coalesce(string_agg(title, ','), '') into out from (select title from public.list_site_news()) l;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

-- The titles anon gets from public_site_news(), in order, as a string.
create function pg_temp.public_titles() returns text language plpgsql as $$
declare out text;
begin
  set local role anon;
  select coalesce(string_agg(title, ','), '') into out from (select title from public.public_site_news()) l;
  reset role;
  return out;
end $$;

\o
\echo 'Club news: only the board posts, with the form checks in the app''s words and order'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000009a1';
  chair constant uuid := '00000000-0000-0000-0000-0000000009a2';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a3';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a4';
  ex constant uuid := '00000000-0000-0000-0000-0000000009a5';
  ok text := pg_temp.post_sql('Toy run', 'Sunday 7 December, meet at the clubhouse 9am.', '');
  r site_news%rowtype;
begin
  assert pg_temp.try_as(null, ok) like 'permission denied%', 'anon can''t post';
  assert pg_temp.try_as(paul, ok) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, ok) = 'Only the board can post club news.', 'no seat';
  assert pg_temp.try_as(ex, ok) = 'Only the board can post club news.', 'an ended seat';
  assert pg_temp.try_as(wes, 'insert into site_news (title, body) values (''x'', ''y'')') like 'permission denied%', 'no direct insert';

  assert pg_temp.try_as(wes, pg_temp.post_sql('  ', 'Words.', '')) = 'Give the notice a title.', 'no title';
  assert pg_temp.try_as(wes, pg_temp.post_sql(repeat('x', 81), 'Words.', '')) = 'Keep the title to 80 characters.', 'long title';
  assert pg_temp.try_as(wes, pg_temp.post_sql('Toy run', '  ', '')) = 'Write what members of the public should know.', 'no body';
  assert pg_temp.try_as(wes, pg_temp.post_sql('Toy run', repeat('x', 401), '')) = 'Keep the notice to 400 characters.', 'long body';
  assert pg_temp.try_as(wes, pg_temp.post_sql('Toy run', 'Words.', 'http://rustnutssmc.com.au')) = 'The link must start with https://.', 'http link';
  assert pg_temp.try_as(wes, pg_temp.post_sql('Toy run', 'Words.', 'https://' || repeat('x', 300))) = 'The link must start with https://.', 'long link';
  assert pg_temp.try_as(wes, pg_temp.post_sql('Toy run', 'Words.', 'https://a b')) = 'The link must start with https://.', 'space in link';

  assert pg_temp.try_as(wes, pg_temp.post_sql('  Toy run ', ' Sunday 7 December. ', '  ')) is null, 'West President posts';
  select * into r from site_news;
  assert r.title = 'Toy run' and r.body = 'Sunday 7 December.' and r.link is null and r.posted_by = wes and r.removed_at is null, 'kept clean';
  assert pg_temp.try_as(chair, pg_temp.post_sql('AGM', 'Saturday 14 March.', ' https://www.rustnutssmc.com.au/ ')) is null, 'a national seat posts';
  assert (select link from site_news where title = 'AGM') = 'https://www.rustnutssmc.com.au/', 'link kept trimmed';
  -- Both landed in this one transaction, at the same now(): make the toy run the older notice.
  update site_news set created_at = now() - interval '1 hour' where title = 'Toy run';
end $$;

\o
\echo 'Club news: the board lists and takes down; nobody else reads the table'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000009a1';
  chair constant uuid := '00000000-0000-0000-0000-0000000009a2';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a3';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a4';
  toy uuid := (select id from site_news where title = 'Toy run');
  agm uuid := (select id from site_news where title = 'AGM');
begin
  assert pg_temp.list_as(wes) = 'AGM,Toy run', 'board lists newest first: ' || pg_temp.list_as(wes);
  assert pg_temp.list_as(chair) = 'AGM,Toy run', 'the Chairman too';
  assert pg_temp.list_as(nell) = '', 'a member sees none';
  assert pg_temp.list_as(paul) = '', 'pending sees none';
  assert pg_temp.try_as(null, 'select * from public.list_site_news()') like 'permission denied%', 'anon can''t list';
  assert pg_temp.try_as(null, 'select * from public.site_news') like 'permission denied%', 'anon can''t read the table';
  assert pg_temp.try_as(wes, 'update public.site_news set title = ''x''') like 'permission denied%', 'no direct update';
  assert pg_temp.try_as(wes, 'delete from public.site_news') like 'permission denied%', 'no direct delete';

  assert pg_temp.try_as(null, format('select public.remove_site_news(%L)', toy)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, format('select public.remove_site_news(%L)', toy)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, format('select public.remove_site_news(%L)', toy)) = 'Only the board can post club news.', 'no seat';
  assert pg_temp.try_as(wes, format('select public.remove_site_news(%L)', '00000000-0000-0000-0000-000000000000')) = 'No such notice.', 'gone';
  assert pg_temp.try_as(chair, format('select public.remove_site_news(%L)', toy)) is null, 'any board seat takes any notice down';
  assert (select removed_at is not null and removed_by = chair from site_news where id = toy), 'marked by the Chairman';
  assert pg_temp.try_as(wes, format('select public.remove_site_news(%L)', toy)) = 'That notice has already been taken down.', 'twice';
  assert pg_temp.list_as(wes) = 'AGM,Toy run', 'taken-down ones last: ' || pg_temp.list_as(wes);
  perform agm;
end $$;

\o
\echo 'Club news: the website gets the newest five live notices under 60 days, nothing personal'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000009a1';
  i int;
  cols text;
begin
  assert pg_temp.public_titles() = 'AGM', 'the taken-down one is not public: ' || pg_temp.public_titles();
  delete from site_news;
  insert into site_news (title, body, posted_by, created_at) values
    ('Old', 'x', wes, now() - interval '61 days'),
    ('Edge', 'x', wes, now() - interval '60 days' + interval '1 minute'),
    ('Gone', 'x', wes, now() - interval '1 day');
  update site_news set removed_at = now(), removed_by = wes where title = 'Gone';
  for i in 1..6 loop
    insert into site_news (title, body, posted_by, created_at) values ('N' || i, 'x', wes, now() - (interval '1 day' * (10 - i)));
  end loop;
  assert pg_temp.public_titles() = 'N6,N5,N4,N3,N2', 'five newest live: ' || pg_temp.public_titles();
  delete from site_news where title in ('N1', 'N2', 'N3', 'N4', 'N5', 'N6');
  assert pg_temp.public_titles() = 'Edge', 'under 60 days counts, 61 does not: ' || pg_temp.public_titles();

  -- The feed's columns: no posted_by, no removed_by.
  select string_agg(a.attname, ',' order by a.attname) into cols
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) with ordinality as a(attname, ord)
  where n.nspname = 'public' and p.proname = 'public_site_news';
  assert cols = 'body,created_at,id,link,title', 'public columns: ' || coalesce(cols, '(none)');
  assert pg_temp.try_as(null, 'select * from public.public_site_news()') is null, 'anon reads the feed';
end $$;
