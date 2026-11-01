-- Checks Catch me up's database side: who may, a chat they can't read, switched off, too few
-- messages, blocked and removed messages left out, the count's bounds, and the daily limit it shares
-- with Ask the club. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'torque@example.com'),  -- West, the reader
  ('00000000-0000-0000-0000-0000000000c2', 'spanner@example.com'), -- West
  ('00000000-0000-0000-0000-0000000000c3', 'sparks@example.com'),  -- West, blocked by the reader
  ('00000000-0000-0000-0000-0000000000c4', 'fam@example.com'),     -- West Family
  ('00000000-0000-0000-0000-0000000000c5', 'northie@example.com'); -- North

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.full_name, v.road_name, v.status::member_status, 'approved'
from (values
  ('00000000-0000-0000-0000-0000000000c1', 'west', 'Tania Walsh', 'Torque', 'full'),
  ('00000000-0000-0000-0000-0000000000c2', 'west', 'Mick Doherty', 'Spanner', 'full'),
  ('00000000-0000-0000-0000-0000000000c3', 'west', 'Lisa Romano', 'Sparks', 'full'),
  ('00000000-0000-0000-0000-0000000000c4', 'west', 'Fay Family', null, 'family'),
  ('00000000-0000-0000-0000-0000000000c5', 'north', 'Nora North', null, 'full')
) as v(id, slug, full_name, road_name, status)
join chapters c on c.slug = v.slug;

-- West's chapter chat already exists; give it a known id for the checks.
create temp table west_chat as select c.id from conversations c join chapters ch on ch.id = c.chapter_id where c.kind = 'chapter' and ch.slug = 'west';
grant select on west_chat to authenticated;
insert into member_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3');

-- Two from Spanner so far: not enough to catch up on.
insert into messages (conversation_id, author_id, body, created_at) values
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', 'Sunday ride KSU 9 from Laverton', now() - interval '50 minutes'),
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c3', 'Blocked words', now() - interval '45 minutes'),
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c1', 'I’m in', now() - interval '40 minutes'),
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', 'Torque bring the first aid kit', now() - interval '35 minutes');

create function pg_temp.as_member(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.start_error(p uuid, p_count int) returns text language plpgsql as $$
begin
  perform pg_temp.as_member(p);
  set local role authenticated;
  perform public.catchup_start((select id from west_chat), p_count);
  reset role;
  return null;
exception when raise_exception then
  reset role;
  return sqlerrm;
end $$;

\o
\echo 'Family and people from another chapter can’t'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000c4', 20) = 'Only approved members can ask the club.';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000c5', 20) = 'That chat isn’t one of yours.';
end $$;

\echo 'Switched off until Ask the club is on'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000c1', 20) = 'Ask the club isn’t switched on yet.';
end $$;
insert into private.app_settings (key, value) values ('assistant_on', 'true');

\echo 'Too few messages from other people (blocked ones don’t count), and it isn’t counted'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000c1', 20) = 'Nothing much to catch up on.';
  assert not exists (select 1 from private.assistant_days), 'not counted';
end $$;

insert into messages (conversation_id, author_id, body, created_at) values
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', 'Removed one', now() - interval '30 minutes'),
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', 'Coffee at Bacchus Marsh', now() - interval '20 minutes'),
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', null, now() - interval '10 minutes');
update messages set removed_at = now() where body = 'Removed one';
insert into message_media (message_id, conversation_id, kind, path)
select id, conversation_id, 'photo', 'p/' || n from messages, generate_series(1, 2) n where body is null;
insert into message_media (message_id, conversation_id, kind, path)
select id, conversation_id, 'voice', 'v/1' from messages where body is null;

\echo 'The newest messages, oldest first, without blocked or removed ones, and it’s counted'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000c1') \g /dev/null
set role authenticated;
do $$
declare
  got jsonb := public.catchup_start((select id from west_chat), 2);
  texts text[];
begin
  assert got ->> 'kind' = 'chapter', got::text;
  assert got -> 'me' = '{"name": "Tania Walsh", "roadName": "Torque"}'::jsonb, got::text;
  select array_agg(coalesce(m ->> 'text', '-') order by ord) into texts from jsonb_array_elements(got -> 'messages') with ordinality as t(m, ord);
  -- Asking for 2 still gets the window of 8: everything that isn't removed or blocked.
  assert texts = array['Sunday ride KSU 9 from Laverton', 'I’m in', 'Torque bring the first aid kit', 'Coffee at Bacchus Marsh', '-'], texts::text;
  assert got #>> '{messages,0,who}' = 'Mick Doherty (Spanner)', got::text;
  assert got #>> '{messages,1,who}' = 'you', got::text;
  assert got #>> '{messages,4,media}' = '2 photos, 1 voice note', got::text;
end $$;
reset role;
do $$
begin
  assert (select questions from private.assistant_days where member_id = '00000000-0000-0000-0000-0000000000c1' and day = private.club_date()) = 1;
end $$;

\echo 'It shares the day’s limit with Ask the club'
do $$
begin
  update private.assistant_days set questions = 15 where member_id = '00000000-0000-0000-0000-0000000000c1';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000c1', 20) = 'You’ve asked 15 today. More tomorrow.';
  assert (select questions from private.assistant_days where member_id = '00000000-0000-0000-0000-0000000000c1' and day = private.club_date()) = 15,
    'a refused catch-up rolls its count back';
  update private.assistant_days set questions = 0 where member_id = '00000000-0000-0000-0000-0000000000c1';
end $$;

\echo 'A busy chat: at most 300 asked for, each message cut to 1,000 characters, about 40,000 in all, newest kept, empty ones left out'
insert into messages (conversation_id, author_id, body, created_at)
select (select id from west_chat), '00000000-0000-0000-0000-0000000000c2', n || ' ' || repeat('x', 1500), now() + n * interval '1 second'
from generate_series(1, 80) n;
insert into messages (conversation_id, author_id, body, created_at) values
  ((select id from west_chat), '00000000-0000-0000-0000-0000000000c2', '   ', now() + interval '2 minutes');
select pg_temp.as_member('00000000-0000-0000-0000-0000000000c1') \g /dev/null
set role authenticated;
do $$
declare
  got jsonb := public.catchup_start((select id from west_chat), 5000);
  total int;
  longest int;
  n int;
begin
  select coalesce(sum(length(m ->> 'text')), 0), max(length(m ->> 'text')), count(*)
  into total, longest, n from jsonb_array_elements(got -> 'messages') m;
  assert longest <= 1000, longest::text;
  assert total <= 40000 and total > 30000, total::text;
  assert n between 30 and 40, n::text;
  assert got #>> '{messages,-1,text}' like '80 x%', 'the newest is kept: ' || (got #>> '{messages,-1,text}');
  assert not exists (select 1 from jsonb_array_elements(got -> 'messages') m where m ->> 'text' is null and m ->> 'media' is null), 'no empty lines';
end $$;
reset role;

\echo 'Only signed-in people can call it'
do $$
begin
  assert not has_function_privilege('anon', 'public.catchup_start(uuid, int)', 'execute');
  assert has_function_privilege('authenticated', 'public.catchup_start(uuid, int)', 'execute');
end $$;
