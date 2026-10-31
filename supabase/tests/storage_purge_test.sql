-- Checks the storage purge that Delete my account queues (deep audit F1): the leaving member's own
-- files go to the purge queue, apart from one on a reported message and club assets, and the
-- purge-files function's take/done calls work only for the service role. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fa01', 'gone@example.com'),   -- West member who deletes their account
  ('00000000-0000-0000-0000-00000000fa02', 'sec-fa@example.com'); -- West Secretary, who reported one message
insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.full_name, 'full', 'approved'
from (values ('00000000-0000-0000-0000-00000000fa01', 'Gone Member'), ('00000000-0000-0000-0000-00000000fa02', 'Sec Member')) as v(id, full_name)
cross join chapters c where c.slug = 'west';
insert into positions (member_id, chapter_id, role) select '00000000-0000-0000-0000-00000000fa02', id, 'secretary' from chapters where slug = 'west';
insert into conversation_members (conversation_id, member_id)
select c.id, v.m from conversations c cross join (values ('00000000-0000-0000-0000-00000000fa01'::uuid), ('00000000-0000-0000-0000-00000000fa02'::uuid)) v(m)
where c.kind = 'club' on conflict do nothing;

-- What they posted: a photo and a video (with its poster) on a plain message, a photo on a message
-- the Secretary reported, a listing photo, and an upload no message ever used. Plus a sponsor logo
-- they uploaded as a board member (a club asset) and another member's photo, which must both stay.
insert into messages (id, conversation_id, author_id, body)
select v.id::uuid, c.id, '00000000-0000-0000-0000-00000000fa01', v.body
from (values ('00000000-0000-0000-0000-00000000fa11', 'Sunday pics'), ('00000000-0000-0000-0000-00000000fa12', 'Something rude')) v(id, body)
cross join conversations c where c.kind = 'club';
insert into message_media (message_id, conversation_id, kind, path, poster_path, position)
select v.m::uuid, c.id, v.k::public.chat_media_kind, v.p, v.poster, v.pos
from (values
  ('00000000-0000-0000-0000-00000000fa11', 'photo', 'club/fa01/gone.jpg', null, 0),
  ('00000000-0000-0000-0000-00000000fa11', 'video', 'club/fa01/clip.mp4', 'club/fa01/clip-poster.jpg', 1),
  ('00000000-0000-0000-0000-00000000fa12', 'photo', 'club/fa01/keep.jpg', null, 0)
) v(m, k, p, poster, pos)
cross join conversations c where c.kind = 'club';
insert into message_reports (message_id, reporter_id, reason, body)
values ('00000000-0000-0000-0000-00000000fa12', '00000000-0000-0000-0000-00000000fa02', 'Rude', 'Something rude');
insert into listings (seller_id, kind, title, price_dollars, photos)
values ('00000000-0000-0000-0000-00000000fa01', 'sell', 'Pipes', 100, '[{"path": "00000000-0000-0000-0000-00000000fa01/pipes.jpg"}]');
insert into storage.objects (bucket_id, name, owner, owner_id)
select v.b, v.n, '00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000fa01' from (values
  ('chat-media', 'club/fa01/gone.jpg'), ('chat-media', 'club/fa01/clip.mp4'), ('chat-media', 'club/fa01/clip-poster.jpg'),
  ('chat-media', 'club/fa01/keep.jpg'), ('chat-media', 'club/fa01/orphan.jpg'),
  ('swap-media', '00000000-0000-0000-0000-00000000fa01/pipes.jpg'),
  ('sponsor-logos', '00000000-0000-0000-0000-00000000fa01/logo.png')
) v(b, n);
insert into storage.objects (bucket_id, name, owner, owner_id)
values ('chat-media', 'club/fa02/theirs.jpg', '00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-00000000fa02');

\echo 'Deleting the account queues their files, apart from one on a reported message and club assets'
do $$
declare queued text[];
begin
  assert (select count(*) from private.storage_purge) = 0, 'nothing queued yet';
  delete from auth.users where id = '00000000-0000-0000-0000-00000000fa01'; -- the trigger forgets the member
  select array_agg(bucket || ':' || path order by bucket, path) into queued from private.storage_purge;
  assert queued = array[
    'chat-media:club/fa01/clip-poster.jpg', 'chat-media:club/fa01/clip.mp4', 'chat-media:club/fa01/gone.jpg',
    'chat-media:club/fa01/orphan.jpg', 'swap-media:00000000-0000-0000-0000-00000000fa01/pipes.jpg'
  ], coalesce(array_to_string(queued, ', '), 'nothing');
  assert (select count(*) from private.storage_purge where member_id = '00000000-0000-0000-0000-00000000fa01') = 5, 'all recorded as theirs';
  assert exists (select 1 from message_media where path = 'club/fa01/keep.jpg'), 'the reported message keeps its photo row';
  assert (select count(*) from storage.objects) = 8, 'the database deletes no file itself';
end $$;

\echo 'The purge-files function takes the queue once, marks what is gone, retries what failed; members can''t call it'
do $$
declare batch jsonb; ids bigint[];
begin
  set local role service_role;
  batch := public.purge_take(10);
  assert jsonb_array_length(batch) = 5, batch::text;
  assert (batch->0 ? 'id') and (batch->0 ? 'bucket') and (batch->0 ? 'path'), batch::text;
  assert jsonb_array_length(public.purge_take(10)) = 0, 'taken rows are not handed out twice';
  select array_agg((e->>'id')::bigint order by (e->>'id')::bigint) into ids from jsonb_array_elements(batch) e;
  perform public.purge_done(ids[1:4], jsonb_build_array(jsonb_build_object('id', ids[5], 'error', 'Storage answered 503')));
  reset role;
  assert (select count(*) from private.storage_purge where done_at is not null) = 4, 'four gone';
  assert (select error from private.storage_purge where id = ids[5]) = 'Storage answered 503', 'the error is kept';
  assert (select taken_at is null and attempts = 1 from private.storage_purge where id = ids[5]), 'back in the queue';
  set local role service_role;
  batch := public.purge_take(10);
  reset role;
  assert jsonb_array_length(batch) = 1 and (batch->0->>'id')::bigint = ids[5], 'the failed one is tried again';
  -- A run that died holding a row: after ten minutes the row goes back.
  update private.storage_purge set taken_at = now() - interval '11 minutes' where id = ids[5];
  set local role service_role;
  assert jsonb_array_length(public.purge_take(10)) = 1, 'a stale take goes back';
  reset role;
  assert (select attempts from private.storage_purge where id = ids[5]) = 3, 'attempts counted';
  update private.storage_purge set taken_at = null, attempts = 5 where id = ids[5];
  set local role service_role;
  assert jsonb_array_length(public.purge_take(10)) = 0, 'five attempts is enough';
  reset role;
  -- Signed-in members have no grant on either call.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000fa02', true);
  set local role authenticated;
  begin
    perform public.purge_take(10);
    raise exception 'a member took the purge queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_done(array[1]::bigint[], '[]'::jsonb);
    raise exception 'a member marked the purge queue';
  exception when insufficient_privilege then null;
  end;
  reset role;
  assert private.purge_url() is null, 'no purge_url until an admin sets it';
end $$;

\echo 'STORAGE PURGE CHECKS PASSED'
