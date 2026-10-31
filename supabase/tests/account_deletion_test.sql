-- Checks Delete my account: the sign-in and personal details go, the club's records stay against a
-- nameless "Former member", and a seat holder steps down first. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'rusty@example.com'),  -- West member with a full history
  ('00000000-0000-0000-0000-0000000000d2', 'sec@example.com'),    -- West Secretary
  ('00000000-0000-0000-0000-0000000000d3', 'tre@example.com');    -- West Treasurer

insert into members (id, chapter_id, full_name, road_name, bio, status, approval, share_phone, on_hiatus)
select v.id::uuid, c.id, v.full_name, v.road_name, 'Rides a Shovel', 'full', 'approved', true, v.hiatus
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'Gary Kowalski', 'Rusty', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Sam Secretary', null, false),
  ('00000000-0000-0000-0000-0000000000d3', 'Tess Treasurer', null, false)
) as v(id, full_name, road_name, hiatus)
cross join chapters c where c.slug = 'west';

insert into member_private (member_id, email, phone)
select id, (select email from auth.users u where u.id = m.id), '0400 000 000' from members m;

insert into positions (member_id, chapter_id, role)
select '00000000-0000-0000-0000-0000000000d1'::uuid, id, 'tail_gunner'::position_role from chapters where slug = 'west'
union all select '00000000-0000-0000-0000-0000000000d2', id, 'secretary' from chapters where slug = 'west'
union all select '00000000-0000-0000-0000-0000000000d3', id, 'treasurer' from chapters where slug = 'west';

insert into bikes (id, member_id, make, model) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'Harley', 'Shovel');
insert into bike_registrations (bike_id, rego) values ('00000000-0000-0000-0000-0000000000b1', '1AB2CD');
insert into emergency_contacts (member_id, name, relationship, phone) values ('00000000-0000-0000-0000-0000000000d1', 'Mum', 'Mum', '0400 111 111');

-- The club's records: a charge, a check-in and a ballot.
insert into charges (member_id, chapter_id, fy, kind, amount_cents, due_on)
select '00000000-0000-0000-0000-0000000000d1', id, 2027, 'annual', 36000, date '2026-11-30' from chapters where slug = 'west';
insert into checkin_sessions (id, kind, chapter_id, title, held_on, code, opened_by)
select '00000000-0000-0000-0000-0000000000c1', 'meeting', id, 'West monthly meeting', date '2026-10-01', 'DEL123', '00000000-0000-0000-0000-0000000000d2'
from chapters where slug = 'west';
insert into attendance (session_id, member_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1');
insert into votes (id, chapter_id, question, electorate, threshold, quorum, closes_at, closed_at)
select '00000000-0000-0000-0000-0000000000e1', id, 'Buy a trailer?', 'chapter_patched', 'majority', 1, now(), now() from chapters where slug = 'west';
insert into vote_electors (vote_id, member_id, voted_at) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', now());
insert into vote_ballots (vote_id, member_id, choice) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'yes');

-- What they said and posted.
insert into conversation_members (conversation_id, member_id) select id, '00000000-0000-0000-0000-0000000000d1' from conversations where kind = 'club' on conflict do nothing;
insert into messages (conversation_id, author_id, body) values
  ((select id from conversations where kind = 'club'), '00000000-0000-0000-0000-0000000000d1', 'See you Sunday'),
  ((select id from conversations where kind = 'club'), '00000000-0000-0000-0000-0000000000d2', 'Bring the bus');
insert into listings (seller_id, kind, title, price_dollars) values ('00000000-0000-0000-0000-0000000000d1', 'sell', 'Shovel heads', 200);
-- A message someone reported, a bragging rights nomination and a role that starts next month.
insert into messages (id, conversation_id, author_id, body) select '00000000-0000-0000-0000-0000000000f1', id, '00000000-0000-0000-0000-0000000000d1', 'Something rude' from conversations where kind = 'club';
insert into message_reports (message_id, reporter_id, reason, body) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d2', 'Rude', 'Something rude');
insert into brag_awards (id, kind, title, year, nominations_close, voting_close)
values ('00000000-0000-0000-0000-0000000000a9', (enum_range(null::brag_kind))[1], 'Ride of the year', 2026, current_date + 30, current_date + 60);
insert into brag_nominations (award_id, nominated_by, title, story) values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000d1', 'Great Ocean Road', 'Rained all day');
insert into positions (member_id, chapter_id, role, started_on)
select '00000000-0000-0000-0000-0000000000d1'::uuid, id, 'officer'::position_role, current_date + 30 from chapters where slug = 'west';
-- Their place on the roster (the board's sheet), already claimed, with a seat on it.
insert into private.roster (email, chapter_id, full_name, status, roles, claimed_by, phone, emergency_name, emergency_relationship, emergency_phone, bike_make, bike_model, bike_rego)
select 'Rusty@example.com', id, 'Gary Kowalski', 'full', '{road_captain}', '00000000-0000-0000-0000-0000000000d1', '0400 000 000', 'Mum', 'Mum', '0400 111 111', 'Harley', 'Shovel', '1AB2CD'
from chapters where slug = 'west';

\o
\echo 'Nobody signed in can delete an account'
set role anon;
do $$
begin
  perform public.delete_my_account();
  assert false, 'anon can run delete_my_account';
exception when insufficient_privilege then null;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role authenticated;
do $$
begin
  perform public.delete_my_account();
  assert false, 'signed out, an account was deleted';
exception when raise_exception then
  assert sqlerrm = 'Sign in first.', sqlerrm;
end $$;
reset role;

\echo 'A sitting board seat holder steps down first, and nothing changes'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
set role authenticated;
do $$
begin
  perform public.delete_my_account();
  assert false, 'the Secretary deleted their account without stepping down';
exception when raise_exception then
  assert sqlerrm = 'Step down from your seat first, so the club can fill it. Then you can delete your account.', sqlerrm;
end $$;
reset role;
do $$
begin
  assert exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d2'), 'their sign-in stays';
  assert (select full_name from members where id = '00000000-0000-0000-0000-0000000000d2') = 'Sam Secretary';
end $$;

\echo 'A member deletes their account: sign-in and personal details go, the club’s records stay against "Former member"'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
do $$ begin perform public.delete_my_account(); end $$;
reset role;
do $$
declare
  rusty constant uuid := '00000000-0000-0000-0000-0000000000d1';
  m members;
begin
  assert not exists (select 1 from auth.users where id = rusty), 'the sign-in is gone';
  select * into m from members where id = rusty;
  assert m.id is not null, 'the member row stays, so the records still join';
  assert m.full_name = 'Former member', m.full_name;
  assert m.road_name is null and m.bio is null, 'road name and bio are cleared';
  assert not m.share_phone and not m.on_hiatus;
  assert m.approval = 'declined', 'out of the directory and every member check';
  assert m.account_deleted_on = private.club_date();
  assert not exists (select 1 from member_private where member_id = rusty), 'contact details';
  assert not exists (select 1 from bikes where member_id = rusty), 'bikes';
  assert not exists (select 1 from bike_registrations where bike_id = '00000000-0000-0000-0000-0000000000b1'), 'regos';
  assert not exists (select 1 from emergency_contacts where member_id = rusty), 'emergency contacts';
  assert not exists (select 1 from messages where author_id = rusty and body = 'See you Sunday'), 'their chat messages';
  assert exists (select 1 from messages where body = 'Bring the bus'), 'other people’s messages stay';
  assert not exists (select 1 from conversation_members where member_id = rusty), 'chat memberships';
  assert not exists (select 1 from listings where seller_id = rusty), 'swap and sell listings';
  assert exists (select 1 from charges where member_id = rusty), 'the books keep the charge';
  assert exists (select 1 from attendance where member_id = rusty), 'attendance stays';
  assert exists (select 1 from vote_ballots where member_id = rusty), 'the ballot stays';
  assert (select ended_on from positions where member_id = rusty and role = 'tail_gunner') = private.club_date(), 'a role that isn’t a seat ends today';
  assert not exists (select 1 from positions where member_id = rusty and role = 'officer'), 'a role that hadn’t started is gone';
  assert exists (select 1 from messages where id = '00000000-0000-0000-0000-0000000000f1'), 'a reported message stays for the board';
  assert exists (select 1 from message_reports where message_id = '00000000-0000-0000-0000-0000000000f1'), 'and so does the report';
  assert not exists (select 1 from brag_nominations where nominated_by = rusty), 'bragging rights nominations';
  assert (select phone is null and emergency_name is null and emergency_phone is null and bike_make is null and bike_rego is null and roles = '{}'
          from private.roster where email = 'Rusty@example.com'), 'the roster copy loses their details and seats';
end $$;

\echo 'A deleted member can’t act any more, even with an old login'
set role authenticated;
do $$
begin
  begin
    perform public.save_contact(null, 'Dad', 'Dad', '0400 222 222');
    assert false, 'an old login added an emergency contact';
  exception when raise_exception then null;
  end;
  begin
    update public.members set full_name = 'Gary Kowalski' where id = '00000000-0000-0000-0000-0000000000d1';
    assert false, 'an old login put the name back';
  exception when raise_exception then
    assert sqlerrm = 'This account has been deleted.', sqlerrm;
  end;
  begin
    insert into public.bikes (member_id, make, model) values ('00000000-0000-0000-0000-0000000000d1', 'Honda', 'CB');
    assert false, 'an old login added a bike';
  exception when raise_exception then null;
  end;
  assert (select count(*) from public.members where approval = 'approved') = 0, 'the old login sees no members';
  assert (select count(*) from public.member_private) = 0;
end $$;
reset role;

\echo 'Deleting someone from the dashboard does the same, and ends their seat'
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d3';
do $$
begin
  assert (select full_name from members where id = '00000000-0000-0000-0000-0000000000d3') = 'Former member';
  assert not exists (select 1 from member_private where member_id = '00000000-0000-0000-0000-0000000000d3');
  assert (select ended_on from positions where member_id = '00000000-0000-0000-0000-0000000000d3') = private.club_date(), 'the Treasurer seat ends';
end $$;

\echo 'A deleted member drops out of the club counts and the Secretary’s view of the chapter'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
set role authenticated;
do $$
begin
  assert (select count(*) from public.members where approval = 'approved') = 1, 'only the Secretary is still a member';
  assert (select count(*) from public.member_private) = 1, 'no private details are left for anyone else';
end $$;
reset role;

\echo 'ACCOUNT DELETION CHECKS PASSED'
