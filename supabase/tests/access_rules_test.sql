-- Checks the row-level security does what the access rules promise.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- People (fixed ids so the checks below can name them)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'rusty@example.com'),   -- West President (NEC)
  ('00000000-0000-0000-0000-000000000002', 'torque@example.com'),  -- West Secretary
  ('00000000-0000-0000-0000-000000000003', 'spanner@example.com'), -- West member, Tail Gunner
  ('00000000-0000-0000-0000-000000000004', 'crank@example.com'),   -- North Road Captain
  ('00000000-0000-0000-0000-000000000005', 'dylan@example.com'),   -- West applicant
  ('00000000-0000-0000-0000-000000000006', 'newbie@example.com'),  -- signed up, not applied yet
  ('00000000-0000-0000-0000-000000000007', 'gravel@example.com');  -- West member, doesn't share phone

insert into members (id, chapter_id, full_name, road_name, status, approval, share_phone)
select v.id::uuid, c.id, v.full_name, v.road_name, v.status::member_status, v.approval::approval_state, v.share
from (values
  ('00000000-0000-0000-0000-000000000001', 'west',  'Gary Kowalski', 'Rusty',   'full',       'approved', true),
  ('00000000-0000-0000-0000-000000000002', 'west',  'Tania Walsh',   'Torque',  'full',       'approved', false),
  ('00000000-0000-0000-0000-000000000003', 'west',  'Mick Doherty',  'Spanner', 'full',       'approved', true),
  ('00000000-0000-0000-0000-000000000004', 'north', 'Craig Morrison','Crank',   'full',       'approved', false),
  ('00000000-0000-0000-0000-000000000005', 'west',  'Dylan Pryce',   null,      'introduced', 'pending',  false),
  ('00000000-0000-0000-0000-000000000007', 'west',  'Brett Hughes',  'Gravel',  'full',       'approved', false)
) as v(id, chapter, full_name, road_name, status, approval, share)
join chapters c on c.slug = v.chapter;

insert into member_private (member_id, email, phone, licence_expiry)
select id, (select email from auth.users u where u.id = m.id), '04' || right(id::text, 8), date '2028-01-01'
from members m;

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-000000000001', 'west',  'president'),
  ('00000000-0000-0000-0000-000000000002', 'west',  'secretary'),
  ('00000000-0000-0000-0000-000000000003', 'west',  'tail_gunner'),
  ('00000000-0000-0000-0000-000000000004', 'north', 'road_captain')
) as v(id, chapter, role)
join chapters c on c.slug = v.chapter;

insert into bikes (id, member_id, make, model, year) values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Harley-Davidson', 'Softail Slim', 2016),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'Harley-Davidson', 'Street Bob', 2019);
insert into bike_registrations (bike_id, rego, rego_expiry) values
  ('10000000-0000-0000-0000-000000000003', '3MD 5SS', date '2026-11-08');
insert into emergency_contacts (member_id, name, relationship, phone) values
  ('00000000-0000-0000-0000-000000000003', 'Jen Doherty', 'Wife', '0427 555 604');

-- A little helper to act as someone inside the current transaction.
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
$$;

-- Counts a query as the current user, swallowing permission errors as -1.
create function pg_temp.visible(q text) returns int language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || q || ') x' into n;
  return n;
exception when insufficient_privilege then
  return -1;
end;
$$;

\echo 'Public (not signed in)'
begin;
set local role anon;
do $$ begin
  assert (select count(*) from chapters) = 2, 'public can read chapter names';
  assert pg_temp.visible('select * from members') = -1, 'public cannot read members';
  assert pg_temp.visible('select * from bikes') = -1, 'public cannot read bikes';
end $$;
rollback;

\echo 'Applicant (pending) sees only themselves'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000005');
set local role authenticated;
do $$ begin
  assert (select count(*) from members) = 1, 'applicant sees only own row';
  assert (select count(*) from positions) = 0, 'applicant sees no positions';
  assert (select count(*) from bikes) = 1, 'applicant sees only own bike';
  assert (select count(*) from member_private) = 1, 'applicant sees own private details only';
end $$;
rollback;

\echo 'Member sees the directory but not private details'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
set local role authenticated;
do $$ begin
  assert (select count(*) from members) = 5, 'member sees the 5 approved members, not the applicant';
  assert (select count(*) from member_private) = 1, 'member sees only own private row';
  assert (select count(*) from emergency_contacts) = 1, 'member sees own emergency contact';
  assert (select count(*) from bikes) = 1, 'member sees approved bikes only (not the applicant''s)';
  assert (select count(*) from positions) = 4, 'member sees who holds what';
  assert public.member_phone('00000000-0000-0000-0000-000000000001') is not null, 'Rusty shares his phone';
  assert public.member_phone('00000000-0000-0000-0000-000000000007') is null, 'Gravel does not';
end $$;
-- can edit own sharing but not own status
update members set share_phone = false where id = '00000000-0000-0000-0000-000000000003';
do $$ begin
  assert pg_temp.visible($q$select 1 from members where id = auth.uid() and share_phone = false$q$) = 1, 'own update applied';
end $$;
savepoint s1;
do $$ begin
  begin
    update members set status = 'nomad' where id = auth.uid();
    raise exception 'member was able to change own status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_member_status('00000000-0000-0000-0000-000000000007', 'supporter');
    raise exception 'member was able to change someone else''s status';
  exception when raise_exception then
    if sqlerrm like 'member was able%' then raise; end if;
  end;
  -- editing someone else's row silently matches nothing
  update members set road_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000007';
  assert not found, 'member cannot edit another member';
end $$;
rollback;

\echo 'West board sees West applicants and private details, not North''s'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$ begin
  assert (select count(*) from members) = 6, 'board sees approved members plus the West applicant';
  assert (select count(*) from member_private) = 5, 'West board sees West private rows only';
  assert (select count(*) from bike_registrations) = 1, 'West board sees West regos';
  assert (select count(*) from emergency_contacts) = 1, 'West board sees West emergency contacts';
  assert public.member_phone('00000000-0000-0000-0000-000000000007') is not null, 'board sees an unshared West phone';
  assert public.member_phone('00000000-0000-0000-0000-000000000004') is null, 'but not North''s';
end $$;
select public.approve_member('00000000-0000-0000-0000-000000000005', 'introduced');
do $$ begin
  assert (select approval from members where id = '00000000-0000-0000-0000-000000000005') = 'approved', 'approved';
  assert (select joined_on from members where id = '00000000-0000-0000-0000-000000000005') = current_date, 'joined today';
end $$;
select public.set_member_status('00000000-0000-0000-0000-000000000005', 'fng');
do $$ begin
  assert (select fng_started_on from members where id = '00000000-0000-0000-0000-000000000005') = current_date, 'FNG clock started';
  begin
    perform public.set_member_status('00000000-0000-0000-0000-000000000002', 'nomad');
    raise exception 'board changed own status';
  exception when raise_exception then
    if sqlerrm = 'board changed own status' then raise; end if;
  end;
end $$;
-- West board can hand out West roles, not national ones
insert into positions (member_id, chapter_id, role)
  select '00000000-0000-0000-0000-000000000003', id, 'officer' from chapters where slug = 'west';
savepoint s2;
do $$ begin
  begin
    insert into positions (member_id, chapter_id, role)
      values ('00000000-0000-0000-0000-000000000003', null, 'nec_secretary');
    raise exception 'board created a national role';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into positions (member_id, chapter_id, role)
      select '00000000-0000-0000-0000-000000000004', id, 'officer' from chapters where slug = 'north';
    raise exception 'West board appointed in North';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'North board cannot approve a West applicant'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000004');
set local role authenticated;
do $$ begin
  assert (select count(*) from members where approval = 'pending') = 0, 'North board cannot see West applicant';
  begin
    perform public.approve_member('00000000-0000-0000-0000-000000000005', 'fng');
    raise exception 'North approved a West applicant';
  exception when raise_exception then
    if sqlerrm = 'North approved a West applicant' then raise; end if;
  end;
end $$;
rollback;

\echo 'NEC (a sitting President) reaches every chapter'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
  assert (select count(*) from member_private) = 6, 'NEC sees every private row';
end $$;
insert into positions (member_id, chapter_id, role)
  values ('00000000-0000-0000-0000-000000000002', null, 'nec_secretary');
rollback;

\echo 'A new sign-up can apply once'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000006');
set local role authenticated;
select public.submit_application((select id from chapters where slug = 'north'), 'Josh Tran', null, '0492 555 939', 'Jet', 'Partner of a member', 'family');
do $$ begin
  assert (select approval from members where id = auth.uid()) = 'pending', 'lands as pending';
  assert (select email from member_private where member_id = auth.uid()) = 'newbie@example.com', 'email copied from sign-up';
  begin
    perform public.submit_application((select id from chapters where slug = 'north'), 'Josh Again');
    raise exception 'applied twice';
  exception when raise_exception then
    if sqlerrm = 'applied twice' then raise; end if;
  end;
end $$;
rollback;

\echo 'One holder per board seat'
do $$ begin
  begin
    insert into positions (member_id, chapter_id, role)
      select '00000000-0000-0000-0000-000000000007', id, 'secretary' from chapters where slug = 'west';
    raise exception 'two West secretaries';
  exception when unique_violation then null;
  end;
end $$;

\echo 'Founder is a national title with no powers; new club roles sit in a chapter'
do $$ begin
  insert into positions (member_id, chapter_id, role)
    values ('00000000-0000-0000-0000-000000000007', null, 'founder');
  insert into positions (member_id, chapter_id, role)
    select '00000000-0000-0000-0000-000000000007', id, 'ride_committee' from chapters where slug = 'west';
  insert into positions (member_id, chapter_id, role)
    select '00000000-0000-0000-0000-000000000007', id, 'assistant_tail_gunner' from chapters where slug = 'west';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
  assert not public.is_national(), 'Founder title alone grants no national powers';
  begin
    insert into positions (member_id, chapter_id, role)
      select '00000000-0000-0000-0000-000000000007', id, 'founder' from chapters where slug = 'west';
    raise exception 'founder tied to a chapter';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from positions where member_id = '00000000-0000-0000-0000-000000000007';
end $$;

\echo 'A patched member can be on hiatus'
do $$ begin
  assert (select on_hiatus from members where id = '00000000-0000-0000-0000-000000000007') = false, 'off by default';
end $$;

\echo 'ALL ACCESS CHECKS PASSED'
