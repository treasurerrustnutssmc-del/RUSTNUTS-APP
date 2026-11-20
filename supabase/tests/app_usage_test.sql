-- Checks app usage counts: anyone with the app can send them (signed in or not), nothing about the
-- person is kept, bad names and kinds are dropped without a word, the visit and day caps hold, old
-- rows are swept after 90 days, and only the board reads the summary. Mirrors src/domain/appUsage.ts.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000ab1', 'wes@example.com', now()),   -- West President
  ('00000000-0000-0000-0000-000000000ab2', 'nell@example.com', now()),  -- Full, no seat
  ('00000000-0000-0000-0000-000000000ab3', 'fran@example.com', now());  -- Family

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, 'approved'
from (values
  ('00000000-0000-0000-0000-000000000ab1', 'west', 'Wes West', 'full'),
  ('00000000-0000-0000-0000-000000000ab2', 'west', 'Nell Member', 'full'),
  ('00000000-0000-0000-0000-000000000ab3', 'west', 'Fran Family', 'family')
) as v(id, slug, name, status)
join chapters c on c.slug = v.slug;

insert into positions (member_id, chapter_id, role, started_on)
values ('00000000-0000-0000-0000-000000000ab1', (select id from chapters where slug = 'west'), 'president', '2024-07-01');

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

create function pg_temp.summary_as(who uuid) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  out := public.app_usage_summary(30);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

\o
\echo 'App usage: anyone with the app can send counts; nothing about the person is kept'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-000000000ab1';
  nell constant uuid := '00000000-0000-0000-0000-000000000ab2';
  fran constant uuid := '00000000-0000-0000-0000-000000000ab3';
begin
  assert pg_temp.try_as(null, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000001', 'android', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Welcome"},{"seq":2,"kind":"screen","name":"SignIn"}]'::jsonb)$q$) is null, 'signed out can send';
  assert pg_temp.try_as(nell, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000002', 'ios', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Home"},{"seq":2,"kind":"screen","name":"Rides"},{"seq":3,"kind":"error","name":"Rides","detail":"connection"}]'::jsonb)$q$) is null, 'a member can send';
  assert pg_temp.try_as(fran, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000003', 'android', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Home"}]'::jsonb)$q$) is null, 'family can send';
  assert pg_temp.try_as(wes, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000004', 'web', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Board"}]'::jsonb)$q$) is null, 'board can send';

  assert (select tier from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000001' limit 1) = 'public';
  assert (select tier from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000002' limit 1) = 'member';
  assert (select tier from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000003' limit 1) = 'family';
  assert (select tier from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000004' limit 1) = 'board';

  assert pg_temp.try_as(nell, 'select * from app_usage_events') like 'permission denied%', 'no direct read';
  assert pg_temp.try_as(nell, $q$insert into app_usage_events (visit_id, seq, kind, name, tier, platform, app_version)
    values (gen_random_uuid(), 1, 'screen', 'Home', 'board', 'ios', '1')$q$) like 'permission denied%', 'no direct insert';

  -- Nothing that points at a person.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_usage_events'
      and column_name in ('member_id', 'user_id', 'email', 'ip', 'device_id', 'created_by')
  ), 'no column about who';
end $$;

\o
\echo 'App usage: bad names, kinds and platforms are dropped; an error keeps only its kind, never words'
\o /dev/null
do $$
declare
  nell constant uuid := '00000000-0000-0000-0000-000000000ab2';
  v constant uuid := '10000000-0000-0000-0000-000000000010';
begin
  assert pg_temp.try_as(nell, format($q$select public.app_usage_record(%L, 'android', '1.0.0', %L::jsonb)$q$, v, jsonb_build_array(
    jsonb_build_object('seq', 1, 'kind', 'screen', 'name', 'home page'),
    jsonb_build_object('seq', 2, 'kind', 'tap', 'name', 'Home'),
    jsonb_build_object('seq', 3, 'kind', 'screen', 'name', repeat('a', 61)),
    jsonb_build_object('seq', 4, 'kind', 'screen', 'name', 'Home', 'detail', 'other'),
    jsonb_build_object('seq', 5, 'kind', 'error', 'name', 'Home', 'detail', 'form'),
    jsonb_build_object('seq', 6, 'kind', 'error', 'name', 'Home', 'detail', 'No from Dave Smith'),
    jsonb_build_object('seq', 7, 'kind', 'error', 'name', 'Home'),
    jsonb_build_object('seq', 1e12, 'kind', 'screen', 'name', 'Home'),
    jsonb_build_object('seq', -1, 'kind', 'screen', 'name', 'Home'),
    jsonb_build_object('kind', 'screen', 'name', 'Rides')
  ))) is null, 'a bad event never errors';
  assert (select count(*) from app_usage_events where visit_id = v) = 2, 'only the good screen and error kept';
  assert (select detail from app_usage_events where visit_id = v and kind = 'screen') is null, 'screens keep no detail';
  assert (select detail from app_usage_events where visit_id = v and kind = 'error') = 'form', 'an error keeps its kind';
  assert not exists (select 1 from app_usage_events where detail not in ('connection', 'not-allowed', 'form', 'other')), 'never words';

  assert pg_temp.try_as(nell, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000011', 'blackberry', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Home"}]'::jsonb)$q$) is null;
  assert (select platform from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000011') = 'other';
  assert pg_temp.try_as(nell, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000012', 'ios', '1.0.0', '"nope"'::jsonb)$q$) is null, 'not a list: nothing kept, no error';
  assert pg_temp.try_as(nell, $q$select public.app_usage_record(null, 'ios', '1.0.0', '[{"seq":1,"kind":"screen","name":"Home"}]'::jsonb)$q$) is null;
  assert not exists (select 1 from app_usage_events where visit_id is null);

  -- A huge list: only the first 50 are even looked at.
  assert pg_temp.try_as(null, format($q$select public.app_usage_record('10000000-0000-0000-0000-000000000013', 'ios', '1.0.0', %L::jsonb)$q$,
    (select jsonb_agg(case when n <= 50 then jsonb_build_object('seq', n, 'kind', 'screen', 'name', 'Bad name')
                           else jsonb_build_object('seq', n, 'kind', 'screen', 'name', 'Welcome') end) from generate_series(1, 5000) n))) is null;
  assert not exists (select 1 from app_usage_events where visit_id = '10000000-0000-0000-0000-000000000013'), 'past the first 50 ignored';
end $$;

\o
\echo 'App usage: a visit keeps 200 events, 50 a call; old rows go after 90 days'
\o /dev/null
do $$
declare
  nell constant uuid := '00000000-0000-0000-0000-000000000ab2';
  v constant uuid := '10000000-0000-0000-0000-000000000020';
  i int;
  batch jsonb;
begin
  batch := (select jsonb_agg(jsonb_build_object('seq', n, 'kind', 'screen', 'name', 'Home')) from generate_series(1, 80) n);
  perform pg_temp.try_as(nell, format($q$select public.app_usage_record(%L, 'ios', '1.0.0', %L::jsonb)$q$, v, batch));
  assert (select count(*) from app_usage_events where visit_id = v) = 50, 'a call keeps 50';
  for i in 1..5 loop
    batch := (select jsonb_agg(jsonb_build_object('seq', 100 * i + n, 'kind', 'screen', 'name', 'Rides')) from generate_series(1, 50) n);
    perform pg_temp.try_as(nell, format($q$select public.app_usage_record(%L, 'ios', '1.0.0', %L::jsonb)$q$, v, batch));
  end loop;
  assert (select count(*) from app_usage_events where visit_id = v) = 200, 'a visit stops at 200';

  insert into app_usage_events (at, visit_id, seq, kind, name, tier, platform, app_version)
  values (now() - interval '91 days', gen_random_uuid(), 1, 'screen', 'Home', 'member', 'ios', '0.9.0');
  perform pg_temp.try_as(nell, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000021', 'ios', '1.0.0',
    '[{"seq":1,"kind":"screen","name":"Home"}]'::jsonb)$q$);
  assert not exists (select 1 from app_usage_events where at < now() - interval '90 days'), 'swept';
end $$;

\o
\echo 'App usage: only the board reads the summary, visits in order and errors counted'
\o /dev/null
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-000000000ab1';
  nell constant uuid := '00000000-0000-0000-0000-000000000ab2';
  fran constant uuid := '00000000-0000-0000-0000-000000000ab3';
  s jsonb;
  visit jsonb;
begin
  assert pg_temp.try_as(null, 'select public.app_usage_summary(30)') like 'permission denied%', 'signed out';
  assert pg_temp.try_as(nell, 'select public.app_usage_summary(30)') = 'Only the board can see app usage.';
  assert pg_temp.try_as(fran, 'select public.app_usage_summary(30)') = 'Only approved members can do that.';

  -- Sent out of order: the summary puts a visit's screens back in order.
  perform pg_temp.try_as(nell, $q$select public.app_usage_record('10000000-0000-0000-0000-000000000030', 'ios', '1.0.0',
    '[{"seq":2,"kind":"screen","name":"ShopCheckout"},{"seq":1,"kind":"screen","name":"ShopCart"},{"seq":3,"kind":"error","name":"ShopCheckout","detail":"form"}]'::jsonb)$q$);
  s := pg_temp.summary_as(wes);
  select v into visit from jsonb_array_elements(s -> 'visits') v
  where v -> 'screens' -> 0 = '"ShopCart"' limit 1;
  assert visit = '{"screens":["ShopCart","ShopCheckout"]}'::jsonb, coalesce(visit::text, 'no visit');
  assert not exists (select 1 from jsonb_array_elements(s -> 'errors') e where e - 'screen' - 'detail' - 'hits' <> '{}'::jsonb),
    'no times, tiers or platforms that could point at someone';
  assert exists (
    select 1 from jsonb_array_elements(s -> 'errors') e
    where e ->> 'screen' = 'ShopCheckout' and e ->> 'detail' = 'form' and (e ->> 'hits')::int = 1
  ), 'error counted';
  assert exists (
    select 1 from jsonb_array_elements(s -> 'errors') e
    where e ->> 'screen' = 'Rides' and e ->> 'detail' = 'connection'
  );
  assert not (s::text like '%Nell%' or s::text like '%nell@%'), 'nothing about who';
end $$;

\o
\echo 'App usage: signed-out visits share a smaller daily allowance, so a script can''t crowd out members'
\o /dev/null
do $$
declare
  nell constant uuid := '00000000-0000-0000-0000-000000000ab2';
  i int;
  batch jsonb := (select jsonb_agg(jsonb_build_object('seq', n, 'kind', 'screen', 'name', 'Welcome')) from generate_series(1, 50) n);
begin
  delete from app_usage_events;
  for i in 1..25 loop
    perform pg_temp.try_as(null, format($q$select public.app_usage_record(%L, 'web', '1.0.0', %L::jsonb)$q$, gen_random_uuid(), batch));
  end loop;
  assert (select count(*) from app_usage_events where tier = 'public') = 1000, 'signed out stops at 1,000 a day';
  perform pg_temp.try_as(nell, format($q$select public.app_usage_record(%L, 'ios', '1.0.0', %L::jsonb)$q$, gen_random_uuid(), batch));
  assert (select count(*) from app_usage_events where tier = 'member') = 50, 'members still count';
end $$;

\o
\echo 'App usage checks passed'
