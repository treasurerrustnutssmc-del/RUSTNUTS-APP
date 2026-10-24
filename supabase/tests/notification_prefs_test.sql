-- Checks notification settings: each member reads and saves only their own, and only approved
-- members can save. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'rita@example.com', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'tom@example.com', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'pete@example.com', now());

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, c.id, v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000f1', 'Rita Rider', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', 'Tom Gunner', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', 'Pete Pending', 'introduced', 'pending')
) as v(id, name, status, approval)
cross join (select id from chapters where slug = 'west') c;

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

create function pg_temp.count_as(who uuid, query text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute format('select count(*) from (%s) q', query) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return -1;
end $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.count_as(uuid, text) to anon, authenticated;

\o
\echo 'Notification settings: your own only, saved by approved members'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000f1';
  tom constant uuid := '00000000-0000-0000-0000-0000000000f2';
  pete constant uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  assert pg_temp.count_as(rita, 'select 1 from public.notification_prefs') = 0, 'nothing saved yet: the app uses the defaults';
  assert pg_temp.try_as(rita, 'select public.save_notification_prefs(false, true, true, false)') is null, 'Rita saves hers';
  assert pg_temp.try_as(rita, 'select public.save_notification_prefs(false, true, true, true)') is null, 'and changes it';
  assert (select approvals and not ride_reminders and new_rides from public.notification_prefs where member_id = rita),
    'the second save replaced the first';
  assert pg_temp.count_as(rita, 'select 1 from public.notification_prefs where not ride_reminders') = 1, 'she reads hers';
  assert pg_temp.count_as(tom, 'select 1 from public.notification_prefs') = 0, 'Tom can''t read hers';
  assert pg_temp.count_as(null, 'select 1 from public.notification_prefs') = -1, 'signed out reads nothing';
  assert pg_temp.try_as(tom, format('insert into public.notification_prefs (member_id) values (%L)', tom)) is not null,
    'nobody writes the table directly';
  assert pg_temp.try_as(pete, 'select public.save_notification_prefs(true, true, false, true)')
    = 'Only approved members can do that.', 'a pending member can''t save';
  assert pg_temp.try_as(null, 'select public.save_notification_prefs(true, true, false, true)') is not null, 'signed out can''t';
end $$;

\echo 'NOTIFICATION SETTINGS CHECKS PASSED'
