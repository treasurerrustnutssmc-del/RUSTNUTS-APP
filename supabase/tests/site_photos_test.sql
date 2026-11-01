-- Checks club photos for the website: the Social Media Officer, their crew and the NEC pick and
-- upload (in the app's words and order, src/domain/sitePhotos.ts); someone else's chat photo waits
-- for the poster's yes (and a push); take down by editor or poster; public_site_photos() gives anon
-- the newest live photos with nothing personal; a deleted member's photos leave the list.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000007b1', 'smo@example.com', now()),    -- West Social Media Officer
  ('00000000-0000-0000-0000-0000000007b2', 'chair@example.com', now()),  -- NEC Chairman
  ('00000000-0000-0000-0000-0000000007b3', 'crew@example.com', now()),   -- Full, put on the crew
  ('00000000-0000-0000-0000-0000000007b4', 'snap@example.com', now()),   -- Full, posts the photos
  ('00000000-0000-0000-0000-0000000007b5', 'paul@example.com', now()),   -- pending
  ('00000000-0000-0000-0000-0000000007b6', 'rest@example.com', now()),   -- Full, on hiatus
  ('00000000-0000-0000-0000-0000000007b7', 'nell@example.com', now());   -- Full, no part in it

insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus)
select v.id::uuid, c.id, v.name, v.road, 'full', v.approval::approval_state, v.hiatus
from (values
  ('00000000-0000-0000-0000-0000000007b1', 'west', 'Sam Social', 'Bam Bam', 'approved', false),
  ('00000000-0000-0000-0000-0000000007b2', 'north', 'Charlie Chair', null, 'approved', false),
  ('00000000-0000-0000-0000-0000000007b3', 'west', 'Cris Crew', null, 'approved', false),
  ('00000000-0000-0000-0000-0000000007b4', 'west', 'Sally Snap', 'Snap', 'approved', false),
  ('00000000-0000-0000-0000-0000000007b5', 'west', 'Paul Pending', null, 'pending', false),
  ('00000000-0000-0000-0000-0000000007b6', 'west', 'Rex Rest', null, 'approved', true),
  ('00000000-0000-0000-0000-0000000007b7', 'west', 'Nell Member', null, 'approved', false)
) as v(id, slug, name, road, approval, hiatus)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01'
from (values
  ('00000000-0000-0000-0000-0000000007b1', 'west', 'social_media_officer'),
  ('00000000-0000-0000-0000-0000000007b2', null, 'nec_chair')
) as v(id, slug, role);

-- Snap and Nell have phones saved.
insert into public.push_devices (token, member_id, platform) values
  ('ExponentPushToken[snap]', '00000000-0000-0000-0000-0000000007b4', 'android'),
  ('ExponentPushToken[nell]', '00000000-0000-0000-0000-0000000007b7', 'android');

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

create function pg_temp.value_as(who uuid, stmt text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute stmt into out;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

create function pg_temp.chat(k text) returns uuid language sql as $$
  select c.id from conversations c left join chapters ch on ch.id = c.chapter_id
  where (k = 'club' and c.kind = 'club') or (c.kind = 'chapter' and ch.slug = k) limit 1;
$$;

-- Snap uploads a photo into a chat and sends it; gives the media row's id.
create function pg_temp.post_photo(who uuid, chat uuid, file text, kind text default 'photo') returns uuid language plpgsql as $$
declare msg uuid;
begin
  perform pg_temp.try_as(who, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$, chat || '/' || file, who, who));
  msg := pg_temp.value_as(who, format('select public.send_message(%L, %L, %L::jsonb, null)', chat, 'pic',
           jsonb_build_array(jsonb_build_object('kind', kind, 'path', chat || '/' || file, 'width', 1200, 'height', 900))))::uuid;
  return (select id from message_media where message_id = msg);
end $$;

-- The ids list_site_photos() gives a signed-in user, with status, in order, as a string.
create function pg_temp.list_as(who uuid) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select coalesce(string_agg(coalesce(caption, '-') || ':' || status, ','), '') into out from (select caption, status from public.list_site_photos()) l;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

-- The captions anon gets from public_site_photos(), in order.
create function pg_temp.public_captions() returns text language plpgsql as $$
declare out text;
begin
  set local role anon;
  select coalesce(string_agg(coalesce(caption, '-'), ','), '') into out from (select caption from public.public_site_photos()) l;
  reset role;
  return out;
end $$;

create function pg_temp.pick_sql(media uuid, caption text, consent boolean) returns text language sql as $$
  select format('select public.pick_site_photo(%L, %L, %L)', media, caption, consent);
$$;

\o
\echo 'Website photos: the SMO or NEC runs the crew, with the checks in the app''s words and order'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  chair constant uuid := '00000000-0000-0000-0000-0000000007b2';
  crew constant uuid := '00000000-0000-0000-0000-0000000007b3';
  paul constant uuid := '00000000-0000-0000-0000-0000000007b5';
  rest constant uuid := '00000000-0000-0000-0000-0000000007b6';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  on_sql text := 'select public.set_site_photo_crew(%L, true)';
  off_sql text := 'select public.set_site_photo_crew(%L, false)';
begin
  assert pg_temp.try_as(null, format(on_sql, crew)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, format(on_sql, crew)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, format(on_sql, crew)) = 'Only the Social Media Officer or the NEC can change the website photo crew.', 'a member';
  assert pg_temp.try_as(crew, format(on_sql, nell)) = 'Only the Social Media Officer or the NEC can change the website photo crew.', 'not yet on the crew';
  assert pg_temp.try_as(smo, format(on_sql, '00000000-0000-0000-0000-000000000000')) = 'Only approved members can join the crew.', 'nobody';
  assert pg_temp.try_as(smo, format(on_sql, paul)) = 'Only approved members can join the crew.', 'pending can''t join';
  assert pg_temp.try_as(smo, format(on_sql, rest)) = 'Members on hiatus can’t join the crew.', 'hiatus';
  assert pg_temp.try_as(smo, format(off_sql, crew)) = 'They’re not on the crew.', 'off before on';
  assert pg_temp.try_as(smo, format(on_sql, crew)) is null, 'the SMO adds Cris';
  assert pg_temp.try_as(smo, format(on_sql, crew)) = 'They’re already on the crew.', 'twice';
  assert pg_temp.try_as(crew, format(on_sql, nell)) = 'Only the Social Media Officer or the NEC can change the website photo crew.', 'crew can''t add crew';
  assert (select added_by from site_photo_crew where member_id = crew) = smo, 'recorded';
  assert pg_temp.try_as(chair, format(on_sql, nell)) is null, 'the NEC adds too';
  assert pg_temp.try_as(chair, format(off_sql, nell)) is null, 'and takes off';
  assert pg_temp.try_as(nell, 'select count(*) from public.site_photo_crew') is null, 'members can see the crew';
  assert pg_temp.value_as(nell, 'select count(*) from public.site_photo_crew') = '1', 'one on it';
  assert pg_temp.try_as(null, 'select * from public.site_photo_crew') like 'permission denied%', 'anon can''t';
  assert pg_temp.try_as(smo, format('insert into public.site_photo_crew (member_id) values (%L)', nell)) like 'permission denied%', 'no direct insert';
end $$;

\o
\echo 'Website photos: picking a chat photo, own goes live, someone else''s waits and gets a push'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  chair constant uuid := '00000000-0000-0000-0000-0000000007b2';
  crew constant uuid := '00000000-0000-0000-0000-0000000007b3';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  paul constant uuid := '00000000-0000-0000-0000-0000000007b5';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  club uuid := pg_temp.chat('club');
  snap_pic uuid := pg_temp.post_photo(snap, club, 'a.jpg');
  snap_vid uuid := pg_temp.post_photo(snap, club, 'v.mp4', 'video');
  smo_pic uuid := pg_temp.post_photo(smo, club, 'mine.jpg');
  direct uuid;
  dm_pic uuid;
  picked uuid;
  p site_photos%rowtype;
begin
  assert snap_pic is not null and smo_pic is not null, 'photos posted';
  direct := pg_temp.value_as(smo, format('select public.open_direct_chat(%L)', snap))::uuid;
  dm_pic := pg_temp.post_photo(snap, direct, 'secret.jpg');
  assert dm_pic is not null, 'a private chat photo';

  assert pg_temp.try_as(null, pg_temp.pick_sql(snap_pic, 'x', true)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, pg_temp.pick_sql(snap_pic, 'x', true)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, pg_temp.pick_sql(snap_pic, 'x', true)) = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.', 'a member';
  assert pg_temp.try_as(snap, pg_temp.pick_sql(snap_pic, 'x', true)) = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.', 'the poster can''t pick either';
  assert pg_temp.try_as(smo, pg_temp.pick_sql('00000000-0000-0000-0000-000000000000', 'x', true)) = 'No such photo.', 'gone';
  assert pg_temp.try_as(smo, pg_temp.pick_sql(snap_vid, 'x', true)) = 'Only photos go on the website, not videos or GIFs.', 'video';
  assert pg_temp.try_as(chair, pg_temp.pick_sql(dm_pic, 'x', true)) = 'No such photo.', 'a private chat the Chairman can''t read';
  assert pg_temp.try_as(smo, pg_temp.pick_sql(dm_pic, 'x', true)) = 'Photos from private chats stay private.', 'a private chat the SMO is in';
  assert pg_temp.try_as(smo, pg_temp.pick_sql(snap_pic, 'x', false)) = 'Tick that everyone in the photo is happy to be on the website.', 'no tick';
  assert pg_temp.try_as(smo, pg_temp.pick_sql(snap_pic, repeat('x', 121), true)) = 'Keep the caption to 120 characters.', 'long caption';

  assert pg_temp.try_as(smo, pg_temp.pick_sql(snap_pic, '  Black Spur ', true)) is null, 'the SMO picks Snap''s photo';
  select * into p from site_photos where media_id = snap_pic;
  assert p.status = 'waiting' and p.caption = 'Black Spur' and p.posted_by = snap and p.picked_by = smo and p.bucket = 'chat-media'
     and p.path = club || '/a.jpg' and p.width = 1200 and p.decided_at is null, 'waits for Snap';
  assert exists (select 1 from private.push_outbox where member_id = snap and dedupe_key = 'site-photo:' || p.id
                 and title = 'Photo for the website?' and body like 'Bam Bam wants to put one of your photos%'), 'Snap gets a push';
  assert pg_temp.try_as(crew, pg_temp.pick_sql(snap_pic, 'again', true)) = 'That photo is already on the list.', 'one ask per photo';

  assert pg_temp.try_as(smo, pg_temp.pick_sql(smo_pic, '', true)) is null, 'the SMO''s own photo';
  select * into p from site_photos where media_id = smo_pic;
  assert p.status = 'live' and p.caption is null and p.decided_at is not null and p.posted_by = smo, 'live at once';
  assert not exists (select 1 from private.push_outbox where dedupe_key = 'site-photo:' || p.id), 'no push for your own';
  assert pg_temp.try_as(nell, 'insert into public.site_photos (source, bucket, path, status) values (''upload'', ''site-media'', ''x'', ''live'')') like 'permission denied%', 'no direct insert';
end $$;

\o
\echo 'Website photos: the poster answers, once; uploads from the phone go live'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  crew constant uuid := '00000000-0000-0000-0000-0000000007b3';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  ask uuid := (select id from site_photos where status = 'waiting');
  yes text := 'select public.answer_site_photo(%L, true)';
  no text := 'select public.answer_site_photo(%L, false)';
  up text := 'select public.upload_site_photo(%L, 1600, 1200, %L, %L)';
  upload text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('site-media', %L, %L, %L)$q$;
  p site_photos%rowtype;
begin
  assert pg_temp.try_as(null, format(yes, ask)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(nell, format(yes, '00000000-0000-0000-0000-000000000000')) = 'No such photo.', 'gone';
  assert pg_temp.try_as(smo, format(yes, ask)) = 'Only the member who posted the photo can answer.', 'the picker can''t answer';
  assert pg_temp.try_as(nell, format(yes, ask)) = 'Only the member who posted the photo can answer.', 'a stranger can''t answer';
  assert pg_temp.list_as(snap) = 'Black Spur:waiting', 'Snap sees the ask: ' || pg_temp.list_as(snap);
  assert pg_temp.list_as(nell) = '', 'Nell sees nothing';
  assert pg_temp.try_as(snap, format(no, ask)) is null, 'Snap says no';
  assert (select status = 'declined' and decided_at is not null from site_photos where id = ask), 'declined';
  assert pg_temp.try_as(snap, format(yes, ask)) = 'That one has already been answered.', 'once';
  -- A second ask can't follow a no.
  assert pg_temp.try_as(smo, pg_temp.pick_sql((select media_id from site_photos where id = ask), 'please', true)) = 'That photo is already on the list.', 'no nagging';

  -- Uploads: editors only, in their own folder, the file must be there.
  assert pg_temp.try_as(nell, format(upload, nell || '/x.jpg', nell, nell)) like '%policy%', 'a member can''t upload into site-media';
  assert pg_temp.try_as(crew, format(upload, smo || '/x.jpg', crew, crew)) like '%policy%', 'not into someone else''s folder';
  assert pg_temp.try_as(crew, format(upload, crew || '/x.jpg', crew, crew)) is null, 'the crew uploads into their folder';
  assert pg_temp.try_as(nell, format(up, crew || '/x.jpg', 'Big 4', true)) = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.', 'a member';
  assert pg_temp.try_as(crew, format(up, crew || '/x.jpg', 'Big 4', false)) = 'Tick that everyone in the photo is happy to be on the website.', 'no tick';
  assert pg_temp.try_as(crew, format(up, crew || '/x.jpg', repeat('x', 121), true)) = 'Keep the caption to 120 characters.', 'long';
  assert pg_temp.try_as(crew, format(up, crew || '/missing.jpg', 'Big 4', true)) = 'That photo didn’t upload properly. Try again.', 'no file';
  assert pg_temp.try_as(smo, format(up, crew || '/x.jpg', 'Big 4', true)) = 'That photo didn’t upload properly. Try again.', 'someone else''s file';
  assert pg_temp.try_as(crew, format(up, crew || '/x.jpg', ' Big 4 ', true)) is null, 'the crew puts it up';
  select * into p from site_photos where bucket = 'site-media';
  assert p.status = 'live' and p.source = 'upload' and p.caption = 'Big 4' and p.posted_by = crew and p.picked_by = crew and p.media_id is null and p.width = 1600, 'live';
  assert pg_temp.try_as(crew, format('delete from storage.objects where name = %L', crew || '/x.jpg')) is null, 'tidy is allowed';
  assert exists (select 1 from storage.objects where name = crew || '/x.jpg'), 'but a file on the list stays';
  assert pg_temp.value_as(smo, format('select count(*) from storage.objects where name = %L', crew || '/x.jpg')) = '1', 'editors can see each other''s uploads';
  assert pg_temp.value_as(nell, format('select count(*) from storage.objects where name = %L', crew || '/x.jpg')) = '0', 'members can''t';
end $$;

\o
\echo 'Website photos: the list, taking down, and the public feed'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  chair constant uuid := '00000000-0000-0000-0000-0000000007b2';
  crew constant uuid := '00000000-0000-0000-0000-0000000007b3';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  club uuid := pg_temp.chat('club');
  pic2 uuid := pg_temp.post_photo(snap, club, 'b.jpg');
  own uuid := (select id from site_photos where posted_by = smo);
  big4 uuid := (select id from site_photos where caption = 'Big 4');
  ask2 uuid;
  rm text := 'select public.remove_site_photo(%L)';
  cols text;
  i int;
begin
  assert pg_temp.try_as(crew, pg_temp.pick_sql(pic2, 'Lunch stop', true)) is null, 'the crew asks for a second one';
  ask2 := (select id from site_photos where media_id = pic2);
  assert pg_temp.try_as(snap, format('select public.answer_site_photo(%L, true)', ask2)) is null, 'Snap says yes';
  -- Everything so far landed at this transaction's now(): spread the picks out so the order is testable.
  update site_photos set picked_at = now() - interval '2 minutes' where id = big4;
  update site_photos set picked_at = now() - interval '1 minute' where id = own;
  assert pg_temp.list_as(smo) = 'Lunch stop:live,-:live,Big 4:live,Black Spur:declined', 'the editor''s list: ' || pg_temp.list_as(smo);
  assert pg_temp.list_as(chair) = pg_temp.list_as(smo), 'the NEC sees the same';
  assert pg_temp.list_as(snap) = 'Lunch stop:live,Black Spur:declined', 'Snap sees her own: ' || pg_temp.list_as(snap);
  assert pg_temp.try_as(null, 'select * from public.list_site_photos()') like 'permission denied%', 'anon can''t list';
  assert pg_temp.try_as(null, 'select * from public.site_photos') like 'permission denied%', 'anon can''t read the table';
  assert pg_temp.try_as(smo, 'update public.site_photos set caption = ''x''') like 'permission denied%', 'no direct update';
  assert pg_temp.public_captions() = 'Lunch stop,-,Big 4', 'live ones newest first (chat time, then the upload''s pick time): ' || pg_temp.public_captions();

  assert pg_temp.try_as(null, format(rm, own)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(nell, format(rm, own)) = 'Only the website photo crew or the member who posted it can take it down.', 'a member';
  assert pg_temp.try_as(nell, format(rm, '00000000-0000-0000-0000-000000000000')) = 'No such photo.', 'gone';
  assert pg_temp.try_as(snap, format(rm, ask2)) is null, 'the poster takes her own down';
  assert pg_temp.try_as(crew, format(rm, own)) is null, 'the crew takes the SMO''s down';
  assert (select removed_by = crew and removed_at is not null and status = 'removed' from site_photos where id = own), 'marked';
  assert pg_temp.try_as(smo, format(rm, own)) = 'That photo has already been taken down.', 'twice';
  assert pg_temp.public_captions() = 'Big 4', 'only the upload is left: ' || pg_temp.public_captions();
  assert pg_temp.list_as(smo) = 'Big 4:live,Black Spur:declined,Lunch stop:removed,-:removed', 'taken-down last: ' || pg_temp.list_as(smo);
  -- A taken-down chat photo can go up again.
  assert pg_temp.try_as(smo, pg_temp.pick_sql(pic2, 'Lunch again', true)) is null, 'again';
  assert (select status from site_photos where caption = 'Lunch again') = 'waiting', 'and asks again';

  -- Removing the chat message the app's way (the row stays, removed_at is set) takes its photo down.
  update site_photos set status = 'live', decided_at = now() where caption = 'Lunch again';
  assert exists (select 1 from public.public_site_photos() f join site_photos p on p.id = f.id where p.caption = 'Lunch again'), 'up before';
  perform private.remove_message_now((select message_id from message_media where id = pic2), smo);
  assert (select status = 'removed' and removed_at is not null and removed_by = smo from site_photos where caption = 'Lunch again'), 'down with the message';
  assert not exists (select 1 from public.public_site_photos() f join site_photos p on p.id = f.id where p.caption = 'Lunch again'), 'off the feed';
  -- Deleting the media row (a purge) drops the rows altogether.
  delete from message_media where id = pic2;
  assert not exists (select 1 from site_photos where caption in ('Lunch stop', 'Lunch again')), 'gone with the media';

  -- The feed: at most 60, nothing personal.
  for i in 1..65 loop
    insert into site_photos (source, bucket, path, status, posted_by, picked_by, picked_at, decided_at)
    values ('upload', 'site-media', crew || '/p' || i || '.jpg', 'live', crew, crew, now() - (interval '1 minute' * i), now());
  end loop;
  assert (select count(*) from public.public_site_photos()) = 60, 'sixty at most';
  select string_agg(a.attname, ',' order by a.attname) into cols
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) with ordinality as a(attname, ord)
  where n.nspname = 'public' and p.proname = 'public_site_photos';
  assert cols = 'bucket,caption,height,id,path,taken_at,width', 'public columns: ' || coalesce(cols, '(none)');
  assert pg_temp.try_as(null, 'select * from public.public_site_photos()') is null, 'anon reads the feed';
  perform big4;
end $$;

\o
\echo 'Website photos: a member who deletes their account leaves the list and the crew'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  crew constant uuid := '00000000-0000-0000-0000-0000000007b3';
begin
  -- Their folder: the upload from earlier (x.jpg), one more listed, one that never made the list.
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('site-media', crew || '/p1.jpg', crew, crew::text), ('site-media', crew || '/orphan.jpg', crew, crew::text);
  insert into member_private (member_id) values (crew) on conflict do nothing;
  delete from member_private where member_id = crew;
  assert not exists (select 1 from site_photos where posted_by = crew), 'their photos are gone';
  assert not exists (select 1 from site_photo_crew where member_id = crew), 'and they are off the crew';
  assert (select string_agg(path, ',' order by path) from private.storage_purge where bucket = 'site-media' and member_id = crew)
    = crew || '/orphan.jpg,' || crew || '/p1.jpg,' || crew || '/x.jpg', 'every file in their folder is queued for the purge, listed or not: ' || coalesce((select string_agg(path, ',' order by path) from private.storage_purge where bucket = 'site-media' and member_id = crew), '-');
  assert (select count(*) from site_photos where picked_by = crew) = 0, 'not named as picker';
  perform smo;
end $$;

\o
\echo 'Website photos: all checks passed'
