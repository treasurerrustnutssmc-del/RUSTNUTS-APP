-- Checks Ask the club's database side: who may ask, switched off, the daily limit, the monthly
-- budget, the service-role-only spend, old day counts cleared, and the status. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'rusty@example.com'),   -- West Full member
  ('00000000-0000-0000-0000-0000000000a2', 'bolts@example.com'),   -- West Full member
  ('00000000-0000-0000-0000-0000000000a3', 'fam@example.com'),     -- Family
  ('00000000-0000-0000-0000-0000000000a4', 'newbie@example.com'),  -- waiting for approval
  ('00000000-0000-0000-0000-0000000000a5', 'chair@example.com');   -- National Chairman

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.full_name, v.road_name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Gary Kowalski', 'Rusty', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'Bob Bolt', 'Bolts', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a3', 'Fay Family', null, 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000a4', 'Ned Newbie', null, 'introduced', 'pending'),
  ('00000000-0000-0000-0000-0000000000a5', 'Cheryl Chair', 'El Jefe', 'full', 'approved')
) as v(id, full_name, road_name, status, approval)
cross join chapters c where c.slug = 'west';
insert into positions (member_id, chapter_id, role) values ('00000000-0000-0000-0000-0000000000a5', null, 'nec_chair');

-- The texts it answers from: a constitution with two versions, and two Road Rules versions.
insert into documents (id, kind, title) values ('00000000-0000-0000-0000-0000000000d1', 'constitution', 'Constitution');
insert into document_versions (document_id, number, label, body) values
  ('00000000-0000-0000-0000-0000000000d1', 1, 'v3', 'Old rules.'),
  ('00000000-0000-0000-0000-0000000000d1', 2, 'v4', '4.9 Full membership needs a patch vote.');
insert into road_rules_versions (number, body, fresh) values (1, 'Ride left.', true), (2, 'Ride staggered.', false);

create function pg_temp.as_member(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.start_error(p uuid) returns text language plpgsql as $$
begin
  perform pg_temp.as_member(p);
  set local role authenticated;
  perform public.assistant_start();
  reset role;
  return null;
exception when raise_exception then
  reset role;
  return sqlerrm;
end $$;

\o
\echo 'Family and people not yet approved can’t ask'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a3') = 'Only approved members can ask the club.', 'family';
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a4') = 'Only approved members can ask the club.', 'pending';
end $$;

\echo 'Switched off until assistant_on is true'
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a1') = 'Ask the club isn’t switched on yet.';
  assert not exists (select 1 from private.assistant_days), 'a refused question isn’t counted';
end $$;
insert into private.app_settings (key, value) values ('assistant_on', 'true');

\echo 'A member gets the latest constitution and Road Rules, and the question is counted'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a1') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.assistant_start();
begin
  assert got #>> '{constitution,label}' = 'v4', got::text;
  assert got #>> '{constitution,body}' = '4.9 Full membership needs a patch vote.', got::text;
  assert (got #>> '{road_rules,number}')::int = 2, got::text;
  assert got #>> '{road_rules,body}' = 'Ride staggered.', got::text;
end $$;
reset role;
do $$
begin
  assert (select questions from private.assistant_days where member_id = '00000000-0000-0000-0000-0000000000a1' and day = private.club_date()) = 1;
  assert (select questions from private.assistant_months where month = date_trunc('month', private.club_date())::date) = 1;
end $$;

\echo 'The 16th question of the day is refused; someone else can still ask'
update private.assistant_days set questions = 15 where member_id = '00000000-0000-0000-0000-0000000000a1';
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a1') = 'You’ve asked 15 today. More tomorrow.',
    pg_temp.start_error('00000000-0000-0000-0000-0000000000a1');
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a2') is null, 'Bolts can ask';
end $$;

\echo 'The daily limit is a setting'
insert into private.app_settings (key, value) values ('assistant_daily_limit', '20');
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a1') is null, 'under the new limit';
end $$;

\echo 'Only the service role records spend'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a1') \g /dev/null
set role authenticated;
do $$
begin
  perform public.assistant_spent(5);
  assert false, 'a member recorded spend';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin perform public.assistant_spent(1500000); end $$;
reset role;
do $$
begin
  assert (select spent_microusd from private.assistant_months where month = date_trunc('month', private.club_date())::date) = 1500000;
end $$;

\echo 'Once the month’s budget is spent, Ask the club rests until next month'
set role service_role;
do $$ begin perform public.assistant_spent(18500000); end $$;
reset role;
do $$
declare
  words text := pg_temp.start_error('00000000-0000-0000-0000-0000000000a2');
  next_month text := to_char((date_trunc('month', private.club_date()) + interval '1 month')::date, 'DD/MM/YYYY');
begin
  assert words = 'Ask the club is resting until ' || next_month || ': this month’s budget is used.', words;
end $$;
\echo 'The status says when it’s back, as DD/MM/YYYY'
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a2') \g /dev/null
set role authenticated;
do $$
declare
  got jsonb := public.assistant_status();
  next_month text := to_char((date_trunc('month', private.club_date()) + interval '1 month')::date, 'DD/MM/YYYY');
begin
  assert got ->> 'resting_until' = next_month, got::text;
end $$;
reset role;

\echo 'Last month’s spend doesn’t count against this month'
update private.assistant_months set month = (date_trunc('month', private.club_date()) - interval '1 month')::date;
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a2') is null, 'a fresh month';
end $$;

\echo 'Day counts older than yesterday are cleared as questions come in'
insert into private.assistant_days (member_id, day, questions) values
  ('00000000-0000-0000-0000-0000000000a2', private.club_date() - 2, 4),
  ('00000000-0000-0000-0000-0000000000a2', private.club_date() - 1, 3);
do $$
begin
  assert pg_temp.start_error('00000000-0000-0000-0000-0000000000a1') is null;
  assert not exists (select 1 from private.assistant_days where day < private.club_date() - 1), 'old counts linger';
  assert exists (select 1 from private.assistant_days where day = private.club_date() - 1), 'yesterday stays';
end $$;

\echo 'The status: a member sees what’s left, the NEC also sees the spend'
create temp table bolts_asked as select questions from private.assistant_days
  where member_id = '00000000-0000-0000-0000-0000000000a2' and day = private.club_date();
grant select on bolts_asked to authenticated;
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a2') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.assistant_status();
begin
  assert (got ->> 'on')::boolean, got::text;
  assert (got ->> 'daily_limit')::int = 20, got::text;
  assert (got ->> 'left_today')::int = 20 - (select questions from bolts_asked), got::text;
  assert got ->> 'resting_until' is null, got::text;
  assert not got ? 'spent_microusd', 'a member sees the spend';
end $$;
reset role;
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a5') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.assistant_status();
begin
  assert (got ->> 'budget_microusd')::bigint = 20000000, got::text;
  assert (got ->> 'spent_microusd')::bigint = 0, got::text;
  assert (got ->> 'questions')::int >= 1, got::text;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a3') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.assistant_status();
begin
  assert not (got ->> 'on')::boolean, 'family sees it on';
end $$;
reset role;

\echo 'A setting that isn’t a number falls back to the default instead of breaking every question'
update private.app_settings set value = 'lots' where key = 'assistant_daily_limit';
select pg_temp.as_member('00000000-0000-0000-0000-0000000000a2') \g /dev/null
set role authenticated;
do $$
declare got jsonb := public.assistant_status();
begin
  assert (got ->> 'daily_limit')::int = 15, got::text;
end $$;
reset role;

\echo 'Nobody signed out or anonymous gets in'
set role anon;
do $$
begin
  perform public.assistant_start();
  assert false, 'anon can ask';
exception when insufficient_privilege then null;
end $$;
reset role;

\echo 'Ask the club checks passed'
