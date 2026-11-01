-- Checks app feedback: send_app_feedback's refusals and limit, who sees which reports, the keepers'
-- answers, the pushes written, the screenshot bucket and the account-deletion clean-up, in the same
-- words and order as src/domain/feedback.ts.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000009a1', 'jeff@example.com', now()),  -- West Treasurer (keeper)
  ('00000000-0000-0000-0000-0000000009a2', 'rog@example.com', now()),   -- West President (board, not keeper)
  ('00000000-0000-0000-0000-0000000009a3', 'chair@example.com', now()), -- NEC Chairman (keeper)
  ('00000000-0000-0000-0000-0000000009a4', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-0000000009a5', 'paul@example.com', now()),  -- pending
  ('00000000-0000-0000-0000-0000000009a6', 'fam@example.com', now()),   -- Family
  ('00000000-0000-0000-0000-0000000009a7', 'ex@example.com', now());    -- a Treasurer seat that has ended

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'Jeff Keeper', 'El Jefe', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a2', 'west', 'Roger Pres', 'Rockhard', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a3', 'north', 'Charlie Chair', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a4', 'west', 'Nell Member', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000009a5', 'west', 'Paul Pending', null, 'full', 'pending'),
  ('00000000-0000-0000-0000-0000000009a6', 'west', 'Fran Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000009a7', 'north', 'Ed Ex', null, 'full', 'approved')
) as v(id, slug, name, road, status, approval)
join chapters c on c.slug = v.slug;
insert into member_private (member_id, email) select id, (select email from auth.users u where u.id = m.id) from members m;

insert into positions (member_id, chapter_id, role, started_on, ended_on)
select v.id::uuid, (select id from chapters where slug = v.slug), v.role::position_role, '2024-07-01', v.ended::date
from (values
  ('00000000-0000-0000-0000-0000000009a1', 'west', 'treasurer', null),
  ('00000000-0000-0000-0000-0000000009a2', 'west', 'president', null),
  ('00000000-0000-0000-0000-0000000009a3', null, 'nec_chair', null),
  ('00000000-0000-0000-0000-0000000009a7', 'north', 'treasurer', '2025-06-30')
) as v(id, slug, role, ended);

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

-- The bodies a signed-in user gets back from list_app_feedback(), in order.
create function pg_temp.list_as(who uuid) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  select coalesce(string_agg(body, ','), '') into out from (select body from public.list_app_feedback()) l;
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
  perform set_config('request.jwt.claim.sub', '', true);
  return -1;
end $$;

create function pg_temp.send_sql(kind text, body text, whr text, shot text) returns text language sql as $$
  select format('select public.send_app_feedback(%L, %L, %L, %L, %L, %L, %L)', kind, body, whr, shot, '0.1.0', '3f2a9c1d-0000-0000-0000-000000000000', 'Android 15 · SM-S938B');
$$;
create function pg_temp.answer_sql(id uuid, status text, reply text) returns text language sql as $$
  select format('select public.answer_app_feedback(%L, %L, %L)', id, status, reply);
$$;
create function pg_temp.upload(who uuid, name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('feedback-media', name, who, who::text);
$$;

\o
\echo 'App feedback: anyone approved in the app sends one, with the checks and five a day'
\o /dev/null
do $$
declare
  jeff constant uuid := '00000000-0000-0000-0000-0000000009a1';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a5';
  fam constant uuid := '00000000-0000-0000-0000-0000000009a6';
  ok text := pg_temp.send_sql('bug', 'The map is blank', 'Rides', null);
  r app_feedback%rowtype;
  i int;
begin
  assert pg_temp.try_as(null, ok) like 'permission denied%', 'anon can''t send';
  assert pg_temp.try_as(paul, ok) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(nell, 'insert into app_feedback (member_id, kind, body) values (auth.uid(), ''bug'', ''x'')') like 'permission denied%', 'no direct insert';

  assert pg_temp.try_as(nell, pg_temp.send_sql('rant', 'x', '', null)) = 'Pick what it is: something wrong, an idea or other.', 'bad kind';
  assert pg_temp.try_as(nell, pg_temp.send_sql(null, 'x', '', null)) = 'Pick what it is: something wrong, an idea or other.', 'no kind';
  assert pg_temp.try_as(nell, pg_temp.send_sql('bug', '  ', '', null)) = 'Tell us what happened.', 'empty';
  assert pg_temp.try_as(nell, pg_temp.send_sql('bug', repeat('x', 1001), '', null)) = 'Keep it to 1,000 characters.', 'long';
  assert pg_temp.try_as(nell, pg_temp.send_sql('bug', 'x', repeat('w', 61), null)) = 'Keep “where” to 60 characters.', 'long where';
  assert pg_temp.try_as(nell, pg_temp.send_sql('bug', 'x', '', 'someone-else/a.jpg')) = 'That screenshot didn’t upload. Try again.', 'not my upload';
  assert pg_temp.try_as(nell, pg_temp.send_sql('bug', 'x', '', nell || '/missing.jpg')) = 'That screenshot didn’t upload. Try again.', 'no such file';

  -- Stored trimmed, an empty where as null, tech strings cut to size, and a push to every keeper.
  perform pg_temp.upload(nell, nell || '/shot.jpg');
  assert pg_temp.try_as(nell, format('select public.send_app_feedback(%L, %L, %L, %L, %L, %L, %L)',
    'bug', '  The map is blank  ', '  ', nell || '/shot.jpg', repeat('v', 50), repeat('b', 90), repeat('d', 130))) is null, 'a good one';
  select * into r from app_feedback;
  assert r.member_id = nell and r.kind = 'bug' and r.body = 'The map is blank' and r.where_in_app is null
    and r.screenshot_path = nell || '/shot.jpg' and length(r.app_version) = 40 and length(r.build) = 80 and length(r.device) = 120
    and r.status = 'new' and r.reply is null, 'kept clean';
  assert (select count(*) from private.push_outbox where dedupe_key = 'feedback:' || r.id) = 2, 'both keepers hear';
  assert (select count(*) from private.push_outbox where dedupe_key = 'feedback:' || r.id and member_id = jeff) = 1, 'Jeff hears';
  assert (select body from private.push_outbox where dedupe_key = 'feedback:' || r.id and member_id = jeff) = 'Nell: The map is blank', 'with who and what';
  assert (select data->>'kind' from private.push_outbox where dedupe_key = 'feedback:' || r.id and member_id = jeff) = 'feedback-sent', 'tap opens the Board screen';
  delete from app_feedback;

  -- Family use the app too.
  assert pg_temp.try_as(fam, ok) is null, 'Family can send';
  -- Five a day each.
  for i in 1..4 loop
    assert pg_temp.try_as(nell, ok) is null, 'report ' || i;
  end loop;
  assert pg_temp.try_as(nell, ok) is null, 'the fifth';
  assert pg_temp.try_as(nell, ok) = 'That’s five today. Send more tomorrow, or message the treasurer.', 'the sixth';
  update app_feedback set created_at = now() - interval '25 hours' where member_id = nell;
  assert pg_temp.try_as(nell, ok) is null, 'yesterday''s don''t count';
  delete from app_feedback;
  delete from private.push_outbox;
end $$;

\o
\echo 'App feedback: a sender sees their own, a keeper the lot, in Board order'
\o /dev/null
do $$
declare
  jeff constant uuid := '00000000-0000-0000-0000-0000000009a1';
  rog constant uuid := '00000000-0000-0000-0000-0000000009a2';
  chair constant uuid := '00000000-0000-0000-0000-0000000009a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a5';
  ex constant uuid := '00000000-0000-0000-0000-0000000009a7';
begin
  insert into app_feedback (member_id, kind, body, status, created_at) values
    (nell, 'bug', 'A done', 'done', now() - interval '1 hour'),
    (nell, 'bug', 'B new', 'new', now() - interval '5 hours'),
    (rog, 'idea', 'C looking', 'looking', now() - interval '3 hours'),
    (nell, 'other', 'D new', 'new', now() - interval '4 hours'),
    (rog, 'bug', 'E new', 'new', now() - interval '2 days');
  assert pg_temp.list_as(jeff) = 'D new,B new,E new,C looking,A done', 'Jeff: ' || pg_temp.list_as(jeff);
  assert pg_temp.list_as(chair) = 'D new,B new,E new,C looking,A done', 'the Chairman too';
  assert pg_temp.list_as(nell) = 'D new,B new,A done', 'Nell: ' || pg_temp.list_as(nell);
  assert pg_temp.list_as(rog) = 'E new,C looking', 'a president sees only his own: ' || pg_temp.list_as(rog);
  assert pg_temp.list_as(ex) = '', 'an ended seat, nothing of their own';
  assert pg_temp.list_as(paul) = '', 'pending sees none';
  -- The sender's email only for keepers; the sender's name for everyone who sees it.
  perform set_config('request.jwt.claim.sub', jeff::text, true);
  set local role authenticated;
  assert (select member_email from public.list_app_feedback() where body = 'B new') = 'nell@example.com', 'a keeper gets the email';
  assert (select member_name from public.list_app_feedback() where body = 'B new') = 'Nell Member', 'and the name';
  reset role;
  perform set_config('request.jwt.claim.sub', nell::text, true);
  set local role authenticated;
  assert (select member_email from public.list_app_feedback() where body = 'B new') is null, 'a sender gets no email column';
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert pg_temp.try_as(null, 'select * from public.list_app_feedback()') like 'permission denied%', 'anon can''t list';
  assert pg_temp.count_as(rog, 'app_feedback') = 2, 'the table itself shows only your own';
  assert pg_temp.count_as(jeff, 'app_feedback') = 5, 'or the lot to a keeper';
  assert pg_temp.try_as(jeff, 'update public.app_feedback set status = ''done''') like 'permission denied%', 'no direct update';
  assert pg_temp.try_as(nell, 'delete from public.app_feedback') like 'permission denied%', 'no direct delete';
end $$;

\o
\echo 'App feedback: keepers set the status and reply, and the sender hears'
\o /dev/null
do $$
declare
  jeff constant uuid := '00000000-0000-0000-0000-0000000009a1';
  rog constant uuid := '00000000-0000-0000-0000-0000000009a2';
  chair constant uuid := '00000000-0000-0000-0000-0000000009a3';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a5';
  b uuid := (select id from app_feedback where body = 'B new');
  c uuid := (select id from app_feedback where body = 'C looking');
  r app_feedback%rowtype;
begin
  assert pg_temp.try_as(null, pg_temp.answer_sql(b, 'done', '')) like 'permission denied%', 'anon';
  assert pg_temp.try_as(paul, pg_temp.answer_sql(b, 'done', '')) = 'Only approved members can do that.', 'pending';
  assert pg_temp.try_as(rog, pg_temp.answer_sql(b, 'done', '')) = 'Only the app keepers can answer feedback.', 'board but not keeper';
  assert pg_temp.try_as(nell, pg_temp.answer_sql(b, 'done', '')) = 'Only the app keepers can answer feedback.', 'not your own either';
  assert pg_temp.try_as(jeff, pg_temp.answer_sql('00000000-0000-0000-0000-000000000000', 'done', '')) = 'No such report.', 'gone';
  assert pg_temp.try_as(jeff, pg_temp.answer_sql(b, 'fixed', '')) = 'Pick a status: new, looking into it or done.', 'bad status';
  assert pg_temp.try_as(jeff, pg_temp.answer_sql(b, 'done', repeat('x', 601))) = 'Keep the reply to 600 characters.', 'long reply';

  -- Looking, with a reply: the sender gets a push with the reply.
  assert pg_temp.try_as(jeff, pg_temp.answer_sql(b, 'looking', '  On it, mate. ')) is null, 'Jeff answers';
  select * into r from app_feedback where id = b;
  assert r.status = 'looking' and r.reply = 'On it, mate.' and r.replied_by = jeff and r.replied_at is not null, 'saved';
  assert (select count(*) from private.push_outbox where member_id = nell and dedupe_key = 'feedback-reply:' || b || ':1') = 1, 'the sender hears once';
  assert (select body from private.push_outbox where member_id = nell and dedupe_key = 'feedback-reply:' || b || ':1') = 'On it, mate.', 'with the reply';
  assert (select data->>'kind' from private.push_outbox where member_id = nell and dedupe_key = 'feedback-reply:' || b || ':1') = 'feedback', 'tap opens Feedback';
  -- A status change with an empty reply keeps the old reply and sends no reply push.
  assert pg_temp.try_as(chair, pg_temp.answer_sql(b, 'done', '')) is null, 'the Chairman closes it';
  select * into r from app_feedback where id = b;
  assert r.status = 'done' and r.reply = 'On it, mate.' and r.replied_by = jeff, 'reply kept, replier kept';
  assert (select count(*) from private.push_outbox where member_id = nell and dedupe_key like 'feedback-reply:' || b || '%') = 1, 'no second reply push';
  assert (select count(*) from private.push_outbox where member_id = nell and dedupe_key = 'feedback-done:' || b) = 1, 'but a done push';
  -- A second reply pushes again.
  assert pg_temp.try_as(jeff, pg_temp.answer_sql(b, 'done', 'Fixed in the next update.')) is null, 'a second reply';
  assert (select count(*) from private.push_outbox where member_id = nell and dedupe_key = 'feedback-reply:' || b || ':2') = 1, 'pushed again';
  assert (select count(*) from private.push_outbox where member_id = nell and dedupe_key = 'feedback-done:' || b) = 1, 'done push not repeated';
  -- Done straight away with no reply: one done push.
  assert pg_temp.try_as(jeff, pg_temp.answer_sql(c, 'done', '')) is null, 'close C';
  assert (select count(*) from private.push_outbox where member_id = rog and dedupe_key = 'feedback-done:' || c) = 1, 'Roger hears it''s done';
  assert pg_temp.list_as(jeff) = 'D new,E new,A done,C looking,B new', 'reordered: ' || pg_temp.list_as(jeff);
end $$;

\o
\echo 'App feedback: screenshots go in the sender''s folder, read by them and the keepers'
\o /dev/null
do $$
declare
  jeff constant uuid := '00000000-0000-0000-0000-0000000009a1';
  rog constant uuid := '00000000-0000-0000-0000-0000000009a2';
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  paul constant uuid := '00000000-0000-0000-0000-0000000009a5';
  fam constant uuid := '00000000-0000-0000-0000-0000000009a6';
  up text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('feedback-media', %L, auth.uid(), auth.uid()::text)$q$;
begin
  assert (select count(*) from storage.buckets where id = 'feedback-media' and not public) = 1, 'a private bucket';
  assert pg_temp.try_as(nell, format(up, nell || '/a.jpg')) is null, 'Nell uploads into her folder';
  assert pg_temp.try_as(fam, format(up, fam || '/a.jpg')) is null, 'Family too';
  assert pg_temp.try_as(nell, format(up, rog || '/b.jpg')) like '%row-level security%', 'not someone else''s folder';
  assert pg_temp.try_as(paul, format(up, paul || '/a.jpg')) like '%row-level security%', 'not pending';
  assert pg_temp.count_as(nell, format($q$storage.objects where bucket_id = 'feedback-media' and name = %L$q$, nell || '/a.jpg')) = 1, 'Nell reads her own';
  assert pg_temp.count_as(jeff, format($q$storage.objects where bucket_id = 'feedback-media' and name = %L$q$, nell || '/a.jpg')) = 1, 'the keeper reads it';
  assert pg_temp.count_as(rog, format($q$storage.objects where bucket_id = 'feedback-media' and name = %L$q$, nell || '/a.jpg')) = 0, 'the president doesn''t';
  -- Her own upload that never went on a report can be tidied; one on a report can't.
  perform pg_temp.upload(nell, nell || '/on-report.jpg');
  insert into app_feedback (member_id, kind, body, screenshot_path) values (nell, 'bug', 'With a shot', nell || '/on-report.jpg');
  assert pg_temp.try_as(nell, format($q$delete from storage.objects where bucket_id = 'feedback-media' and name = %L$q$, nell || '/a.jpg')) is null, 'tidy the stray one';
  assert (select count(*) from storage.objects where name = nell || '/a.jpg') = 0, 'gone';
  assert pg_temp.try_as(nell, format($q$delete from storage.objects where bucket_id = 'feedback-media' and name = %L$q$, nell || '/on-report.jpg')) is null, 'no error';
  assert (select count(*) from storage.objects where name = nell || '/on-report.jpg') = 1, 'but the one on a report stays';
end $$;

\o
\echo 'App feedback: deleting the account takes the reports and queues the screenshots'
\o /dev/null
do $$
declare
  nell constant uuid := '00000000-0000-0000-0000-0000000009a4';
  rog constant uuid := '00000000-0000-0000-0000-0000000009a2';
begin
  perform private.forget_member(nell, 'nell@example.com');
  assert (select count(*) from app_feedback where member_id = nell) = 0, 'her reports are gone';
  assert (select count(*) from app_feedback where member_id = rog) = 2, 'Roger''s stay';
  assert (select count(*) from private.storage_purge where bucket = 'feedback-media' and path = nell || '/on-report.jpg' and member_id = nell) = 1, 'her screenshot is queued';
  assert (select count(*) from private.storage_purge where bucket = 'feedback-media' and path = nell || '/shot.jpg' and member_id = nell) = 1, 'and the stray upload from earlier';
end $$;
