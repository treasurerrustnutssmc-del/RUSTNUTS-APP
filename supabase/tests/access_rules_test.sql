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
  assert exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000001'), 'Rusty shares his phone';
  assert not exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000007'), 'Gravel does not';
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
  assert exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000007'), 'board sees an unshared West phone';
  assert not exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000004'), 'but not North''s';
end $$;
select public.approve_member('00000000-0000-0000-0000-000000000005', 'introduced');
do $$ begin
  assert (select approval from members where id = '00000000-0000-0000-0000-000000000005') = 'approved', 'approved';
  assert (select joined_on from members where id = '00000000-0000-0000-0000-000000000005') = private.club_date(), 'joined today, Melbourne time';
end $$;
select public.set_member_status('00000000-0000-0000-0000-000000000005', 'fng');
do $$ begin
  assert (select fng_started_on from members where id = '00000000-0000-0000-0000-000000000005') = private.club_date(), 'FNG clock started';
  begin
    perform public.set_member_status('00000000-0000-0000-0000-000000000002', 'nomad');
    raise exception 'board changed own status';
  exception when raise_exception then
    if sqlerrm = 'board changed own status' then raise; end if;
  end;
end $$;
-- West board hands out West roles through the appoint action, which records who did it
select public.appoint_position('00000000-0000-0000-0000-000000000003', (select id from chapters where slug = 'west'), 'officer');
do $$ begin
  assert (select appointed_by from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'officer')
    = '00000000-0000-0000-0000-000000000002', 'appointment records who made it';
  assert (select started_on from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'officer')
    = private.club_date(), 'started today, Melbourne time';
  begin
    perform public.appoint_position('00000000-0000-0000-0000-000000000003', (select id from chapters where slug = 'west'), 'officer');
    raise exception 'same person appointed Officer twice';
  exception when raise_exception or unique_violation then
    if sqlerrm = 'same person appointed Officer twice' then raise; end if;
  end;
end $$;
select public.end_position((select id from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'officer'));
do $$ begin
  assert (select ended_by from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'officer')
    = '00000000-0000-0000-0000-000000000002', 'ending a term records who did it';
end $$;
rollback;

\echo 'Nobody writes positions directly (the board self-promotion hole)'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002'); -- West Secretary
set local role authenticated;
do $$ begin
  begin
    update positions set ended_on = current_date where role = 'president';
    raise exception 'Secretary ended the President''s term directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into positions (member_id, chapter_id, role)
      select auth.uid(), id, 'president' from chapters where slug = 'west';
    raise exception 'Secretary seated herself as President';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into positions (member_id, chapter_id, role)
      values ('00000000-0000-0000-0000-000000000003', null, 'nec_secretary');
    raise exception 'board created a national role';
  exception when insufficient_privilege then null;
  end;
  begin
    update positions set ended_on = null where member_id = auth.uid();
    raise exception 'Secretary reopened a term';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.appoint_position(auth.uid(), (select id from chapters where slug = 'west'), 'club_coach');
    raise exception 'Secretary appointed herself';
  exception when raise_exception then
    if sqlerrm = 'Secretary appointed herself' then raise; end if;
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
do $$ begin
  begin
    perform public.appoint_position('00000000-0000-0000-0000-000000000002', null, 'nec_secretary');
    raise exception 'a President handed out a national role';
  exception when raise_exception then
    if sqlerrm = 'a President handed out a national role' then raise; end if;
  end;
  begin
    insert into chapters (slug, name, area) values ('east', 'East', 'Eastern Melbourne');
    raise exception 'national added a chapter directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from chapters where slug = 'north';
    raise exception 'national deleted a chapter';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'A new sign-up can apply once, bike and all'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000006');
set local role authenticated;
do $$ begin
  begin
    perform public.apply_to_join((select id from chapters where slug = 'north'), 'Josh Tran', null, '0492 555 939', 'Jet',
      'Partner of a member', 'family', 'Triumph', 'Bonneville', 1234);
    raise exception 'a bike from 1234 was accepted';
  exception when raise_exception then
    if sqlerrm = 'a bike from 1234 was accepted' then raise; end if;
  end;
  assert (select count(*) from members where id = auth.uid()) = 0, 'a refused bike leaves no half application behind';
  begin
    perform public.apply_to_join((select id from chapters where slug = 'north'), 'Josh Tran', null, null, null,
      null, 'family', 'Triumph', null, null);
    raise exception 'a bike with no model was accepted';
  exception when raise_exception then
    if sqlerrm = 'a bike with no model was accepted' then raise; end if;
  end;
end $$;
select public.apply_to_join((select id from chapters where slug = 'north'), 'Josh Tran', null, '0492 555 939', 'Jet',
  'Partner of a member', 'family', 'Triumph', 'Bonneville', 2020);
do $$ begin
  assert (select approval from members where id = auth.uid()) = 'pending', 'lands as pending';
  assert (select applied_on from members where id = auth.uid()) = private.club_date(), 'applied today, Melbourne time';
  assert (select email from member_private where member_id = auth.uid()) = 'newbie@example.com', 'email copied from sign-up';
  assert (select count(*) from bikes where member_id = auth.uid() and model = 'Bonneville') = 1, 'bike saved with the application';
  begin
    perform public.apply_to_join((select id from chapters where slug = 'north'), 'Josh Again');
    raise exception 'applied twice';
  exception when raise_exception then
    if sqlerrm = 'applied twice' then raise; end if;
  end;
  begin
    update members set approval = 'approved' where id = auth.uid();
    raise exception 'applicant approved themselves';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'Saving a bike and its rego is one step'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); -- Spanner
set local role authenticated;
do $$
declare new_bike uuid;
begin
  new_bike := public.save_bike(null, 'Triumph', 'Bonneville', 2020, null, false, 'abc 123', date '2027-01-01');
  assert (select rego from bike_registrations where bike_id = new_bike) = 'ABC 123', 'rego saved with the bike';
  begin
    perform public.save_bike(null, 'Triumph', 'Bonneville', 1234, null, false, 'XYZ', null);
    raise exception 'a bike from 1234 was accepted';
  exception when raise_exception then
    if sqlerrm = 'a bike from 1234 was accepted' then raise; end if;
  end;
  assert (select count(*) from bikes where member_id = auth.uid()) = 2, 'the refused bike left nothing behind';
  begin
    perform public.save_bike('10000000-0000-0000-0000-000000000005', 'Hacked', 'Bike', null, null, false, null, null);
    raise exception 'edited someone else''s bike';
  exception when raise_exception then
    if sqlerrm = 'edited someone else''s bike' then raise; end if;
  end;
  begin
    truncate bikes;
    raise exception 'a member emptied the bikes table';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'Saving a profile is one step; contacts only change for their owner'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); -- Spanner
set local role authenticated;
select public.save_profile('Mick Doherty', 'Spanner', 'Softail man', false, true,
  'mick@example.com', '0400 111 222', 'full_open', date '2029-02-01', null);
do $$ begin
  assert (select bio from members where id = auth.uid()) = 'Softail man', 'profile saved';
  assert (select phone from member_private where member_id = auth.uid()) = '0400 111 222', 'private details saved with it';
end $$;
select public.save_profile('Mick Doherty', 'Spanner', 'Softail man', true, false, null, null, null, null, null);
do $$ begin
  assert (select share_phone from members where id = auth.uid()), 'sharing switched on';
  assert (select phone from member_private where member_id = auth.uid()) = '0400 111 222', 'private details untouched when not included';
end $$;
-- remember Spanner's contact, then try to change it as Gravel (who can't even see it)
select set_config('test.contact', (select id::text from emergency_contacts where member_id = auth.uid() limit 1), true);
select pg_temp.act_as('00000000-0000-0000-0000-000000000007'); -- Gravel
do $$ begin
  begin
    perform public.save_contact(current_setting('test.contact')::uuid, 'Hacked', 'None', '000');
    raise exception 'edited someone else''s contact';
  exception when raise_exception then
    if sqlerrm = 'edited someone else''s contact' then raise; end if;
  end;
end $$;
rollback;

\echo 'Phones in the directory follow the share setting'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); -- Spanner, a member
set local role authenticated;
do $$ begin
  assert (select count(*) from public.shared_phones()) = 2, 'own number plus Rusty, who shares';
  assert not exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000007'), 'not Gravel''s';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002'); -- West Secretary
do $$ begin
  assert exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000007'), 'West board sees Gravel''s';
  assert not exists (select 1 from public.shared_phones() where member_id = '00000000-0000-0000-0000-000000000004'), 'but not North''s';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000000005'); -- applicant
do $$ begin
  assert (select count(*) from public.shared_phones()) = 1, 'an applicant sees only their own';
end $$;
rollback;
begin;
set local role anon;
do $$ begin
  perform public.shared_phones();
  raise exception 'the public read phone numbers';
exception when insufficient_privilege then null;
end $$;
rollback;

\echo 'Dates follow the club''s clock in Melbourne, not UTC'
do $$ begin
  assert private.club_date(timestamptz '2026-10-24 22:30:00+00') = date '2026-10-25', '9:30am Sunday in Melbourne (daylight time)';
  assert private.club_date(timestamptz '2026-06-30 13:59:00+00') = date '2026-06-30', '11:59pm in winter';
  assert private.club_date(timestamptz '2026-06-30 14:00:00+00') = date '2026-07-01', 'midnight in winter';
end $$;

\echo 'Every date the server writes comes from the club clock'
begin;
-- Pretend the club clock says 1 July 2031, whatever the real date is.
create or replace function private.club_date(at_time timestamptz default now())
returns date language sql stable set search_path = '' as $$ select date '2031-07-01'; $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002'); -- West Secretary
set local role authenticated;
select public.approve_member('00000000-0000-0000-0000-000000000005', 'introduced');
select public.set_member_status('00000000-0000-0000-0000-000000000005', 'fng');
select public.appoint_position('00000000-0000-0000-0000-000000000007', (select id from chapters where slug = 'west'), 'officer');
select public.end_position((select id from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'tail_gunner'));
select pg_temp.act_as('00000000-0000-0000-0000-000000000006'); -- a new sign-up
select public.apply_to_join((select id from chapters where slug = 'west'), 'New Person');
reset role;
do $$ begin
  assert (select joined_on from members where id = '00000000-0000-0000-0000-000000000005') = date '2031-07-01', 'approval date';
  assert (select fng_started_on from members where id = '00000000-0000-0000-0000-000000000005') = date '2031-07-01', 'FNG start';
  assert (select started_on from positions where member_id = '00000000-0000-0000-0000-000000000007' and role = 'officer') = date '2031-07-01', 'appointment date';
  assert (select ended_on from positions where member_id = '00000000-0000-0000-0000-000000000003' and role = 'tail_gunner') = date '2031-07-01', 'term end date';
  assert (select applied_on from members where id = '00000000-0000-0000-0000-000000000006') = date '2031-07-01', 'application date';
end $$;
rollback;

\echo 'Bike rules hold even for direct table writes'
begin;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); -- Spanner
set local role authenticated;
do $$ begin
  begin
    insert into bikes (member_id, make, model, year) values (auth.uid(), 'Triumph', 'Bonneville', 2099);
    raise exception 'a bike from 2099 went straight in';
  exception when raise_exception then
    if sqlerrm = 'a bike from 2099 went straight in' then raise; end if;
  end;
  begin
    update bikes set make = ' ' where member_id = auth.uid();
    raise exception 'a bike lost its make';
  exception when raise_exception then
    if sqlerrm = 'a bike lost its make' then raise; end if;
  end;
end $$;
rollback;

\echo 'Saving private details says so when there is nothing to save into'
begin;
delete from member_private where member_id = '00000000-0000-0000-0000-000000000003';
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); -- Spanner, private row missing
set local role authenticated;
do $$ begin
  begin
    perform public.save_profile('Mick Doherty', 'Spanner', null, true, true, 'mick@example.com', '0400 111 222', null, null, null);
    raise exception 'private details vanished without a word';
  exception when raise_exception then
    if sqlerrm = 'private details vanished without a word' then raise; end if;
  end;
end $$;
rollback;

\echo 'Admin tools (service key) can add records without naming the date'
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000099', 'admin-added@example.com');
set local role service_role;
insert into members (id, chapter_id, full_name, approval) select '00000000-0000-0000-0000-000000000099', id, 'Added By Admin', 'approved' from chapters where slug = 'west';
insert into positions (member_id, chapter_id, role) select '00000000-0000-0000-0000-000000000099', id, 'officer' from chapters where slug = 'west';
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

\echo 'ALL ACCESS CHECKS PASSED'
