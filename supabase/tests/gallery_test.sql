-- Checks the club gallery (src/domain/gallery.ts, in the same words and order): members add photos
-- and videos into their own folder, Photos and ride walls show them, the website crew approve the
-- ticked ones, videos wait for Cloudflare, take-downs and deleted accounts clear the files.
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


-- A ride for an album.
insert into rides (id, title, starts_at, category) values
  ('00000000-0000-0000-0000-00000000a001', 'Coast run', now() - interval '2 days', 'club'),
  ('00000000-0000-0000-0000-00000000a002', 'Old run', now() - interval '40 days', 'club'),
  ('00000000-0000-0000-0000-00000000a003', 'Next run', now() + interval '3 days', 'club');

-- A file in Snap's (or anyone's) gallery folder, uploaded as them through the storage rules.
create function pg_temp.up(who uuid, file text) returns text language plpgsql as $$
begin
  return pg_temp.try_as(who, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$,
    'gallery/' || who || '/' || file, who, who));
end $$;
create function pg_temp.add_sql(ride uuid, caption text, ok boolean, consent boolean, items jsonb) returns text language sql as $$
  select format('select public.add_gallery_items(%L, %L, %L, %L, %L::jsonb)', ride, caption, ok, consent, items);
$$;
create function pg_temp.item(who uuid, file text, kind text default 'photo', poster text default null) returns jsonb language sql as $$
  select jsonb_build_object('kind', kind, 'path', 'gallery/' || who || '/' || file, 'width', 1200, 'height', 900,
    'poster_path', case when poster is null then null else 'gallery/' || who || '/' || poster end, 'duration_ms', 12000);
$$;

\o
\echo 'Gallery: members upload into their own folder only'
\o /dev/null
do $$
declare
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  paul constant uuid := '00000000-0000-0000-0000-0000000007b5';
begin
  assert pg_temp.up(snap, 'a.jpg') is null, 'own folder';
  assert pg_temp.up(paul, 'p.jpg') is not null, 'pending can''t upload';
  assert pg_temp.try_as(nell, format($q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('chat-media', %L, %L, %L)$q$,
    'gallery/' || snap || '/sneaky.jpg', nell, nell)) is not null, 'not into someone else''s folder';
  assert pg_temp.value_as(nell, format($q$select count(*) from storage.objects where bucket_id = 'chat-media' and name = %L$q$, 'gallery/' || snap || '/a.jpg')) = '1', 'members can read gallery files';
  assert pg_temp.value_as(paul, format($q$select count(*) from storage.objects where bucket_id = 'chat-media' and name = %L$q$, 'gallery/' || snap || '/a.jpg')) = '0', 'pending can''t';
  -- Tidying an unlisted upload works for its owner only (and never errors for other buckets).
  perform pg_temp.up(snap, 'tidy.jpg');
  assert pg_temp.try_as(nell, format('delete from storage.objects where name = %L', 'gallery/' || snap || '/tidy.jpg')) is null, 'no error';
  assert exists (select 1 from storage.objects where name = 'gallery/' || snap || '/tidy.jpg'), 'but Nell can''t delete it';
  assert pg_temp.try_as(snap, format('delete from storage.objects where name = %L', 'gallery/' || snap || '/tidy.jpg')) is null, 'Snap tidies';
  assert not exists (select 1 from storage.objects where name = 'gallery/' || snap || '/tidy.jpg'), 'gone';
end $$;

\o
\echo 'Gallery: the album picker offers the last 30 days of rides'
\o /dev/null
do $$
begin
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000007b4', 'select string_agg(e->>''title'', '','') from jsonb_array_elements(public.gallery_albums()) e') = 'Coast run', 'past month only';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000007b5', 'select jsonb_array_length(public.gallery_albums())') = '0', 'pending sees none';
  assert pg_temp.try_as(null, 'select public.gallery_albums()') like 'permission denied%', 'anon';
end $$;

\o
\echo 'Gallery: adding, with the checks in the app''s words and order'
\o /dev/null
do $$
declare
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  paul constant uuid := '00000000-0000-0000-0000-0000000007b5';
  ride constant uuid := '00000000-0000-0000-0000-00000000a001';
  one jsonb := jsonb_build_array(pg_temp.item(snap, 'a.jpg'));
  eleven jsonb := (select jsonb_agg(pg_temp.item(snap, 'a.jpg')) from generate_series(1, 11));
begin
  assert pg_temp.try_as(null, pg_temp.add_sql(null, null, false, false, one)) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, pg_temp.add_sql(null, null, false, false, one)) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, false, false, '[]')) = 'Pick at least one photo or video.', 'none';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, false, false, eleven)) = 'Up to 10 photos or videos at a time.', 'eleven';
  assert pg_temp.try_as(snap, pg_temp.add_sql('00000000-0000-0000-0000-00000000ffff', null, false, false, one)) = 'No such ride.', 'ride';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, repeat('x', 121), false, false, one)) = 'Keep the caption to 120 characters.', 'caption';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, true, false, one)) = 'Tick that everyone in them is happy to be on the website.', 'consent';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, false, false, jsonb_build_array(pg_temp.item(snap, 'missing.jpg')))) = 'That file didn’t upload properly. Try again.', 'not uploaded';
  assert pg_temp.try_as(nell, pg_temp.add_sql(null, null, false, false, one)) = 'That file didn’t upload properly. Try again.', 'someone else''s file';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, false, false, jsonb_build_array(pg_temp.item(snap, 'a.jpg', 'gif')))) = 'That file didn’t upload properly. Try again.', 'not a gif';
  assert pg_temp.value_as(snap, pg_temp.add_sql(ride, '  Coast  ', true, true, one)) = '1', 'Snap adds one to the Coast run album';
  assert (select caption from gallery_items where path = 'gallery/' || snap || '/a.jpg') = 'Coast', 'caption trimmed';
  assert pg_temp.try_as(snap, pg_temp.add_sql(null, null, false, false, one)) = 'That file didn’t upload properly. Try again.', 'the same file twice';
  -- A video with its still, into Club life, not for the website.
  perform pg_temp.up(snap, 'v.mp4'); perform pg_temp.up(snap, 'v.jpg');
  assert pg_temp.value_as(snap, pg_temp.add_sql(null, null, false, false, jsonb_build_array(pg_temp.item(snap, 'v.mp4', 'video', 'v.jpg')))) = '1', 'video';
  assert (select duration_ms from gallery_items where path like '%v.mp4') = 12000, 'length kept';
  -- (One transaction gives one now(): put the video a minute later, as it would be.)
  update gallery_items set created_at = created_at + interval '1 minute' where path like '%v.mp4';
  assert pg_temp.try_as(snap, 'select * from public.gallery_items') like 'permission denied%', 'no direct reading';
end $$;

\o
\echo 'Gallery: Photos and the ride wall show gallery items beside chat photos'
\o /dev/null
do $$
declare
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  paul constant uuid := '00000000-0000-0000-0000-0000000007b5';
  ride constant uuid := '00000000-0000-0000-0000-00000000a001';
begin
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.club_photos(null, 60))') = '2', 'both in the feed';
  assert pg_temp.value_as(nell, $q$select public.club_photos(null, 60)->0->>'kind'$q$) = 'video', 'newest first';
  assert pg_temp.value_as(nell, $q$select public.club_photos(null, 60)->1->>'gallery'$q$) = 'true', 'marked as gallery';
  assert pg_temp.value_as(nell, $q$select public.club_photos(null, 1)->>0 is not null$q$) = 'true', 'limit works';
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.club_photos(null, 1))') = '1', 'one';
  assert pg_temp.value_as(paul, 'select jsonb_array_length(public.club_photos(null, 60))') = '0', 'pending sees none';
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.ride_walls())') = '1', 'the ride has a wall without a chat';
  assert pg_temp.value_as(nell, $q$select public.ride_walls()->0->>'count'$q$) = '1', 'one on it';
  assert pg_temp.value_as(nell, format('select jsonb_array_length(public.ride_wall(%L)->''media'')', ride)) = '1', 'ride wall';
  -- Nell blocks Snap: Snap's gallery items leave her feed.
  insert into member_blocks (blocker_id, blocked_id) values (nell, snap);
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.club_photos(null, 60))') = '0', 'blocked';
  delete from member_blocks where blocker_id = nell;
end $$;

\o
\echo 'Gallery: the website crew approve what members ticked; the uploader is told'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  coast uuid := (select id from gallery_items where path like '%a.jpg');
  vid uuid := (select id from gallery_items where path like '%v.mp4');
begin
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.gallery_for_site())') = '0', 'members see nothing waiting';
  assert pg_temp.value_as(smo, 'select jsonb_array_length(public.gallery_for_site())') = '1', 'the SMO sees the ticked one';
  assert pg_temp.value_as(smo, $q$select public.gallery_for_site()->0->>'album'$q$) = 'Coast run', 'with its album';
  assert pg_temp.try_as(nell, format('select public.approve_gallery_for_site(%L, null)', coast)) = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.', 'member';
  assert pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, null)', vid)) = 'That one isn’t waiting for the website any more.', 'not ticked';
  assert pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, %L)', coast, repeat('x', 121))) = 'Keep the caption to 120 characters.', 'caption';
  assert pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, null)', coast)) is null, 'approved';
  assert pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, null)', coast)) = 'That one isn’t waiting for the website any more.', 'twice';
  assert pg_temp.try_as(smo, format('select public.decline_gallery_for_site(%L)', coast)) = 'That one isn’t waiting for the website any more.', 'decline after approve';
  assert (select caption from site_photos where gallery_id = coast) = 'Coast', 'keeps the uploader''s caption';
  assert exists (select 1 from private.push_outbox where member_id = snap and dedupe_key like 'site-photo:%'), 'Snap gets the heads-up';
  assert (select string_agg(caption || ':' || coalesce(album, '-'), ',') from public.public_site_photos()) = 'Coast:Coast run', 'on the website with its album';
end $$;

\o
\echo 'Gallery: videos reach the website only once they are on Cloudflare'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  vid uuid;
begin
  perform pg_temp.up(snap, 'w.mp4');
  perform pg_temp.value_as(snap, pg_temp.add_sql(null, 'Burnout', true, true, jsonb_build_array(pg_temp.item(snap, 'w.mp4', 'video'))));
  vid := (select id from gallery_items where path like '%w.mp4');
  assert pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, null)', vid)) is null, 'approved';
  assert (select kind from site_photos where gallery_id = vid) = 'video', 'kind kept';
  assert not exists (select 1 from public.public_site_photos() where caption = 'Burnout'), 'not until copied';
  -- The function's list: copy it. Only the service key may ask.
  assert pg_temp.try_as(smo, 'select public.video_copy_jobs()') like 'permission denied%', 'members can''t list the jobs';
  assert (select public.video_copy_jobs()->0->>'action') = 'copy', 'a job to copy';
  perform public.video_copy_done((select id from site_photos where gallery_id = vid), 'https://example.workers.dev/v/w.mp4', null);
  assert (select jsonb_array_length(public.video_copy_jobs())) = 0, 'nothing left to do';
  assert (select kind || ':' || coalesce(album, 'Club life') from public.public_site_photos() where caption = 'Burnout') = 'video:Club life', 'then it shows';
  -- Taken down: the function is asked to delete it on Cloudflare, then clears the address.
  perform pg_temp.try_as(snap, format('select public.remove_gallery_item(%L)', vid));
  assert (select public.video_copy_jobs()->0->>'action') = 'clear', 'a job to clear';
  perform public.video_copy_cleared((select id from site_photos where gallery_id = vid));
  assert (select video_url from site_photos where gallery_id = vid) is null, 'cleared';
end $$;

\o
\echo 'Gallery: a copy that keeps failing drops out, and nothing can swap an approved file'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  vid uuid;
  sp uuid;
begin
  perform pg_temp.up(snap, 'stuck.mp4');
  perform pg_temp.value_as(snap, pg_temp.add_sql(null, 'Stuck', true, true, jsonb_build_array(pg_temp.item(snap, 'stuck.mp4', 'video'))));
  vid := (select id from gallery_items where path like '%stuck.mp4');
  perform pg_temp.try_as(smo, format('select public.approve_gallery_for_site(%L, null)', vid));
  sp := (select id from site_photos where gallery_id = vid);
  -- The owner can't delete (and so re-upload) a listed gallery file.
  assert pg_temp.try_as(snap, format('delete from storage.objects where name = %L', 'gallery/' || snap || '/stuck.mp4')) is null, 'no error';
  assert exists (select 1 from storage.objects where name = 'gallery/' || snap || '/stuck.mp4'), 'still there';
  assert pg_temp.try_as(smo, format('select public.video_copy_failed(%L)', sp)) like 'permission denied%', 'service key only';
  perform public.video_copy_failed(sp); perform public.video_copy_failed(sp);
  assert (select public.video_copy_jobs()->0->>'id') = sp::text, 'still offered after two tries';
  perform public.video_copy_failed(sp);
  assert (select jsonb_array_length(public.video_copy_jobs())) = 0, 'dropped after three';
  -- Taken down mid-copy: done says no, so the copier deletes what it put.
  perform pg_temp.try_as(snap, format('select public.remove_gallery_item(%L)', vid));
  assert not public.video_copy_done(sp, 'https://example.workers.dev/v/s.mp4', null), 'too late';
end $$;

\o
\echo 'Gallery: declining and taking down'
\o /dev/null
do $$
declare
  smo constant uuid := '00000000-0000-0000-0000-0000000007b1';
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  nell constant uuid := '00000000-0000-0000-0000-0000000007b7';
  coast uuid := (select id from gallery_items where path like '%a.jpg');
  d uuid;
begin
  perform pg_temp.up(snap, 'd.jpg');
  perform pg_temp.value_as(snap, pg_temp.add_sql(null, null, true, true, jsonb_build_array(pg_temp.item(snap, 'd.jpg'))));
  d := (select id from gallery_items where path like '%d.jpg');
  assert pg_temp.try_as(nell, format('select public.decline_gallery_for_site(%L)', d)) = 'Only the Social Media Officer, their crew or the NEC can put photos on the website.', 'member can''t decline';
  assert pg_temp.try_as(smo, format('select public.decline_gallery_for_site(%L)', d)) is null, 'declined';
  assert pg_temp.value_as(smo, 'select jsonb_array_length(public.gallery_for_site())') = '0', 'nothing waiting';
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.club_photos(null, 60))') = '3', 'still in the gallery';

  assert pg_temp.try_as(nell, format('select public.remove_gallery_item(%L)', coast)) = 'Only the member who added it or the website photo crew can take it down.', 'someone else';
  assert pg_temp.try_as(snap, format('select public.remove_gallery_item(%L)', '00000000-0000-0000-0000-000000000000')) = 'No such photo or video.', 'nothing';
  assert pg_temp.try_as(snap, format('select public.remove_gallery_item(%L)', coast)) is null, 'Snap takes hers down';
  assert pg_temp.try_as(snap, format('select public.remove_gallery_item(%L)', coast)) = 'That has already been taken down.', 'twice';
  assert (select status from site_photos where gallery_id = coast) = 'removed', 'off the website too';
  assert exists (select 1 from private.storage_purge where path = 'gallery/' || snap || '/a.jpg'), 'file queued for the purge';
  assert pg_temp.try_as(smo, format('select public.remove_gallery_item(%L)', d)) is null, 'the SMO can take any down';
  assert pg_temp.value_as(nell, 'select jsonb_array_length(public.club_photos(null, 60))') = '1', 'one left';
end $$;

\o
\echo 'Gallery: a deleted member''s gallery goes with them'
\o /dev/null
do $$
declare
  snap constant uuid := '00000000-0000-0000-0000-0000000007b4';
  vid uuid;
  sp uuid;
begin
  perform pg_temp.up(snap, 'orphan.jpg');
  -- A website video already on Cloudflare.
  perform pg_temp.up(snap, 'cf.mp4');
  perform pg_temp.value_as(snap, pg_temp.add_sql(null, 'On Cloudflare', true, true, jsonb_build_array(pg_temp.item(snap, 'cf.mp4', 'video'))));
  vid := (select id from gallery_items where path like '%cf.mp4');
  perform pg_temp.try_as('00000000-0000-0000-0000-0000000007b1', format('select public.approve_gallery_for_site(%L, null)', vid));
  sp := (select id from site_photos where gallery_id = vid);
  assert public.video_copy_done(sp, 'https://example.workers.dev/v/cf.mp4', null), 'copied';
  insert into member_private (member_id) values (snap) on conflict do nothing;
  delete from member_private where member_id = snap;
  assert not exists (select 1 from gallery_items where uploaded_by = snap), 'items gone';
  assert not exists (select 1 from site_photos where posted_by = snap), 'website rows gone';
  assert exists (select 1 from private.storage_purge where path = 'gallery/' || snap || '/orphan.jpg'), 'unlisted files queued too';
  -- Its Cloudflare copy still has to come off.
  assert (select public.video_copy_jobs()->0->>'id') = sp::text, 'a job to clear';
  assert (select public.video_copy_jobs()->0->>'action') = 'clear', 'clear';
  perform public.video_copy_cleared(sp);
  assert not exists (select 1 from private.video_trash), 'done';
end $$;

\o
\echo 'Gallery: all checks passed'
