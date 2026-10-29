-- Checks the family view: an approved Family person gets the ride calendar and their own record,
-- and nothing members-only. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'mick@example.com'),   -- West member, shares his phone
  ('00000000-0000-0000-0000-0000000000f2', 'kerry@example.com');  -- Family

insert into members (id, chapter_id, full_name, road_name, status, approval, share_phone)
select v.id::uuid, c.id, v.full_name, v.road_name, v.status::member_status, 'approved', v.share
from (values
  ('00000000-0000-0000-0000-0000000000f1', 'Mick Doherty', 'Spanner', 'full', true),
  ('00000000-0000-0000-0000-0000000000f2', 'Kerry Mercer', null, 'family', false)
) as v(id, full_name, road_name, status, share)
cross join chapters c where c.slug = 'west';

insert into member_private (member_id, email, phone)
select id, (select email from auth.users u where u.id = m.id), '0400 000 00' || right(id::text, 1) from members m;

insert into positions (member_id, chapter_id, role)
select '00000000-0000-0000-0000-0000000000f1', id, 'tail_gunner' from chapters where slug = 'west';

insert into rides (id, source, starts_at, title, location, notes, category) values
  ('00000000-0000-0000-0000-0000000000a1', 'app', now() + interval '3 days', 'West family day', 'The clubhouse', 'Bring a plate.', 'west'),
  ('00000000-0000-0000-0000-0000000000a2', 'app', now() - interval '30 days', 'Last month’s run', null, null, 'club');
insert into rsvps (ride_id, member_id, answer) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'going');

insert into treasurer_meeting_reports (from_on, to_on, presented_at) values (date '2026-10-01', date '2026-10-31', now());

\o
\echo 'Family get the ride calendar from today on, with no answers'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
set role authenticated;
do $$
declare r jsonb := public.family_rides();
begin
  assert jsonb_array_length(r) = 1, 'only the ride from today on';
  assert r -> 0 ->> 'title' = 'West family day';
  assert r -> 0 ->> 'location' = 'The clubhouse';
  assert r -> 0 ->> 'notes' = 'Bring a plate.';
  assert not (r -> 0 ? 'rsvps'), 'no answers';
  assert jsonb_array_length(public.ride_calendar() -> 'rides') = 0, 'the members’ calendar stays closed';
  assert (select count(*) from public.rsvps) = 0, 'no answers by the table either';
  assert (select count(*) from public.rides) = 0, 'rides come through family_rides only';
end $$;

\echo 'Family see their own record and nobody else, with no phones or positions'
do $$
begin
  assert (select count(*) from public.members) = 1, 'only themselves';
  assert (select id from public.members) = '00000000-0000-0000-0000-0000000000f2';
  assert (select count(*) from public.shared_phones() where member_id <> '00000000-0000-0000-0000-0000000000f2') = 0, 'nobody else’s shared phone number';
  assert (select count(*) from public.positions) = 0, 'no positions';
  assert (select count(*) from public.member_private) = 1, 'their own private details';
end $$;

\echo 'Family get no chats, business or Treasurer’s Reports'
do $$
begin
  assert (select count(*) from public.conversations) = 0, 'no chats';
  assert public.meeting_reports() = '[]'::jsonb, 'no presented Treasurer’s Reports';
  assert jsonb_array_length(public.club_ledger() -> 'reports') = 0, 'no report totals';
end $$;

\echo 'Family can’t answer a ride, but can keep their own profile and emergency contacts'
do $$
begin
  begin
    perform public.set_rsvp('00000000-0000-0000-0000-0000000000a1', 'going');
    assert false, 'family can’t answer';
  exception when raise_exception then
    assert sqlerrm = 'Only approved members can do that.', sqlerrm;
  end;
  update public.members set bio = 'Diesel’s other half.' where id = '00000000-0000-0000-0000-0000000000f2';
  assert (select bio from public.members) = 'Diesel’s other half.';
  insert into public.emergency_contacts (member_id, name, relationship, phone)
  values ('00000000-0000-0000-0000-0000000000f2', 'Dean Mercer', 'Partner', '0400 111 222');
  assert (select count(*) from public.emergency_contacts) = 1;
end $$;
reset role;

\echo 'Members still see family, get their reports, and can’t open a private chat with them'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
set role authenticated;
do $$
begin
  assert (select count(*) from public.members) = 2, 'members see the Family person';
  assert jsonb_array_length(public.meeting_reports()) = 1, 'members still get presented reports';
  assert jsonb_array_length(public.ride_calendar() -> 'rides') = 1;
  assert jsonb_array_length(public.family_rides()) = 0, 'members use ride_calendar';
  begin
    perform public.open_direct_chat('00000000-0000-0000-0000-0000000000f2');
    assert false, 'no private chat with family';
  exception when raise_exception then
    assert sqlerrm = 'Family don’t use the club chats.', sqlerrm;
  end;
end $$;
reset role;

\echo 'Signed out gets nothing'
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  assert not has_function_privilege('anon', 'public.family_rides()', 'execute');
end $$;

\echo 'All family view checks passed'
