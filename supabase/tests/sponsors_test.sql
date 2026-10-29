-- Checks the club's sponsors: save_sponsor and archive_sponsor, with the refusals in the same words
-- and order as src/domain/sponsors.ts, who can read them and their logos, and that nothing is
-- writable directly through the API.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000007a1', 'bea@example.com', now()),   -- North Secretary: a board seat
  ('00000000-0000-0000-0000-0000000007a2', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000007a3', 'paul@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-0000000007a4', 'ex@example.com', now()),    -- a seat that has ended
  ('00000000-0000-0000-0000-0000000007a5', 'wes@example.com', now());   -- West President

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000007a1', 'north', 'Bea Board', 'approved'),
  ('00000000-0000-0000-0000-0000000007a2', 'west', 'Nell Member', 'approved'),
  ('00000000-0000-0000-0000-0000000007a3', 'west', 'Paul Pending', 'pending'),
  ('00000000-0000-0000-0000-0000000007a4', 'west', 'Ed Ex', 'approved'),
  ('00000000-0000-0000-0000-0000000007a5', 'west', 'Wes West', 'approved')
) as v(id, slug, name, approval)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on, ended_on)
select v.id::uuid, c.id, v.role::position_role, '2024-07-01', v.ended::date
from (values
  ('00000000-0000-0000-0000-0000000007a1', 'north', 'secretary', null),
  ('00000000-0000-0000-0000-0000000007a4', 'west', 'treasurer', '2025-06-30'),
  ('00000000-0000-0000-0000-0000000007a5', 'west', 'president', null)
) as v(id, slug, role, ended)
join chapters c on c.slug = v.slug;

-- Runs a statement as a signed-in user (or anon when who is null) and returns its error, or null.
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

-- Runs a query as a signed-in user and returns its one value as text. Errors go on up.
create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.count_as(who uuid, tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute format('select count(*) from %s', tbl) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

create function pg_temp.save_sql(id uuid, name text, blurb text, url text, deal text, logo text, chapter uuid)
returns text language sql as $$
  select format('select public.save_sponsor(%L, %L, %L, %L, %L, %L, %L)', id, name, blurb, url, deal, logo, chapter);
$$;

\o
\echo 'Sponsors: the board looks after them, approved members read them, nothing is deleted'
\o /dev/null
do $$
declare
  bea constant uuid := '00000000-0000-0000-0000-0000000007a1';
  nell constant uuid := '00000000-0000-0000-0000-0000000007a2';
  paul constant uuid := '00000000-0000-0000-0000-0000000007a3';
  ex constant uuid := '00000000-0000-0000-0000-0000000007a4';
  wes constant uuid := '00000000-0000-0000-0000-0000000007a5';
  west uuid := (select id from chapters where slug = 'west');
  s uuid;
  r sponsors%rowtype;
begin
  -- Who may: the same order as the app.
  assert pg_temp.try_as(null, pg_temp.save_sql(null, 'Tyre Shed', '', '', '', null, null)) like 'permission denied%', 'anon can''t call it';
  assert pg_temp.try_as(paul, pg_temp.save_sql(null, 'Tyre Shed', '', '', '', null, null)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, pg_temp.save_sql(null, 'Tyre Shed', '', '', '', null, null)) = 'Only the board can look after the club’s sponsors.', 'no seat';
  assert pg_temp.try_as(ex, pg_temp.save_sql(null, 'Tyre Shed', '', '', '', null, null)) = 'Only the board can look after the club’s sponsors.', 'an ended seat';

  -- What's in it.
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, '  ', '', '', '', null, null)) = 'Name the sponsor.', 'no name';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, repeat('x', 61), '', '', '', null, null)) = 'Keep the name to 60 characters at most.', 'long name';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, repeat('🏍', 60), '', '', '', null, null)) is null, 'emoji count once';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', repeat('x', 301), '', '', null, null)) = 'Keep the blurb to 300 characters at most.', 'long blurb';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', 'tyres.example', '', null, null)) = 'Websites start with http:// or https://.', 'bad website';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', 'https://' || repeat('x', 300), '', null, null)) = 'Keep the website to 300 characters at most.', 'long website';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', '', repeat('x', 201), null, null)) = 'Keep the member deal to 200 characters at most.', 'long deal';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', '', '', null, '00000000-0000-0000-0000-000000000000')) = 'No such chapter.', 'no such chapter';
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', '', '', bea || '/nope.png', null)) = 'That logo didn’t upload. Try again.', 'a logo that isn''t there';

  -- A logo uploaded by someone else isn't hers to use.
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', wes || '/a.png', wes, wes::text);
  assert pg_temp.try_as(bea, pg_temp.save_sql(null, 'X', '', '', '', wes || '/a.png', null)) = 'That logo didn’t upload. Try again.', 'not her upload';

  -- Adds one, trimmed, blanks left off.
  delete from sponsors;
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', bea || '/b.png', bea, bea::text);
  s := pg_temp.value_as(bea, pg_temp.save_sql(null, ' Tyre Shed ', '  ', ' https://tyres.example ', ' 10% off ', bea || '/b.png', west))::uuid;
  select * into r from sponsors where id = s;
  assert r.name = 'Tyre Shed' and r.blurb is null and r.url = 'https://tyres.example' and r.deal = '10% off'
    and r.logo_path = bea || '/b.png' and r.chapter_id = west and r.added_by = bea, 'kept as typed, trimmed';

  -- Another board member changes it and keeps the logo that's already on it.
  assert pg_temp.try_as(wes, pg_temp.save_sql(s, 'Tyre Shed', 'Tyres for all', '', '', bea || '/b.png', null)) is null, 'West changes it';
  select * into r from sponsors where id = s;
  assert r.blurb = 'Tyres for all' and r.url is null and r.chapter_id is null and r.logo_path = bea || '/b.png', 'changed';
  assert pg_temp.try_as(wes, pg_temp.save_sql(s, 'Tyre Shed', '', '', '', null, null)) is null, 'and takes the logo off';
  assert (select logo_path is null from sponsors where id = s), 'no logo now';
  assert pg_temp.try_as(bea, pg_temp.save_sql('00000000-0000-0000-0000-000000000000', 'X', '', '', '', null, null)) = 'No such sponsor.', 'gone';

  -- Reading.
  assert pg_temp.count_as(nell, 'sponsors') = 1, 'approved members read them';
  assert pg_temp.count_as(paul, 'sponsors') = 0, 'pending reads none';
  assert pg_temp.count_as(null, 'sponsors') = -1, 'anon reads nothing';
  assert pg_temp.try_as(bea, $q$update sponsors set name = 'x'$q$) like 'permission denied%', 'no writing directly';
  assert pg_temp.try_as(bea, $q$delete from sponsors$q$) like 'permission denied%', 'no deleting';

  -- Logos: members read them, only the board uploads, into their own folder.
  assert pg_temp.count_as(nell, $q$storage.objects where bucket_id = 'sponsor-logos'$q$) = 0, 'members don''t see unused files';
  assert pg_temp.count_as(bea, $q$storage.objects where bucket_id = 'sponsor-logos'$q$) = 2, 'the board sees them all';
  -- Put the logo back on, so members can see it.
  assert pg_temp.try_as(bea, pg_temp.save_sql(s, 'Tyre Shed', '', '', '', bea || '/b.png', null)) is null, 'logo back on';
  assert pg_temp.count_as(nell, $q$storage.objects where bucket_id = 'sponsor-logos'$q$) = 1, 'members see the logo in use';
  assert pg_temp.count_as(paul, $q$storage.objects where bucket_id = 'sponsor-logos'$q$) = 0, 'pending doesn''t';
  assert pg_temp.try_as(nell, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', %L, auth.uid(), auth.uid()::text)$q$, nell || '/c.png'))
    like '%row-level security%', 'members can''t upload';
  assert pg_temp.try_as(bea, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', %L, auth.uid(), auth.uid()::text)$q$, wes || '/c.png'))
    like '%row-level security%', 'not into someone else''s folder';
  assert pg_temp.try_as(bea, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', %L, auth.uid(), auth.uid()::text)$q$, bea || '/c.png'))
    is null, 'the board uploads';
  assert pg_temp.try_as(ex, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('sponsor-logos', %L, auth.uid(), auth.uid()::text)$q$, ex || '/c.png'))
    like '%row-level security%', 'not with an ended seat';
  -- Tidying: an unused upload can go, a logo in use can't.
  perform pg_temp.try_as(bea, format($q$delete from storage.objects where bucket_id = 'sponsor-logos' and name = %L$q$, bea || '/c.png'));
  assert (select count(*) from storage.objects where name = bea || '/c.png') = 0, 'an unused upload is cleared';
  perform pg_temp.try_as(bea, format($q$delete from storage.objects where bucket_id = 'sponsor-logos' and name = %L$q$, bea || '/b.png'));
  assert (select count(*) from storage.objects where name = bea || '/b.png') = 1, 'a logo in use stays';

  -- Taking it off.
  assert pg_temp.try_as(nell, format('select public.archive_sponsor(%L)', s)) = 'Only the board can look after the club’s sponsors.', 'not Nell';
  assert pg_temp.try_as(bea, format('select public.archive_sponsor(%L)', s)) is null, 'the board';
  assert (select archived_by = bea and archived_at is not null from sponsors where id = s), 'kept, with who';
  assert pg_temp.try_as(bea, format('select public.archive_sponsor(%L)', s)) = 'That sponsor has already been taken off.', 'twice';
  assert pg_temp.try_as(bea, pg_temp.save_sql(s, 'X', '', '', '', null, null)) = 'That sponsor has been taken off.', 'can''t change it once off';
  assert pg_temp.try_as(bea, format('select public.archive_sponsor(%L)', '00000000-0000-0000-0000-000000000000')) = 'No such sponsor.', 'gone';
  assert pg_temp.count_as(nell, 'sponsors') = 0, 'hidden once off';
  assert pg_temp.count_as(bea, 'sponsors') = 1, 'the board still reads it';
  assert pg_temp.count_as(nell, $q$storage.objects where bucket_id = 'sponsor-logos'$q$) = 0, 'and its logo is hidden from members';
end $$;

\o
\echo 'Sponsor checks passed'
