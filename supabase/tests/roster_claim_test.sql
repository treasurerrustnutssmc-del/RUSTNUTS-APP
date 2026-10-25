-- Checks the claimable roster: people on the club roster land on their own record at first sign-in.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'rockhard@example.com', now()),  -- on the roster
  ('00000000-0000-0000-0000-0000000000a2', 'jiggles@example.com', now()),   -- on the roster, seat already taken
  ('00000000-0000-0000-0000-0000000000a3', 'nobody@example.com', now()),    -- not on the roster
  ('00000000-0000-0000-0000-0000000000a4', 'sneaky@example.com', null),     -- on the roster, email not confirmed
  ('00000000-0000-0000-0000-0000000000a5', 'applied@example.com', now()),   -- on the roster, but already applied
  ('00000000-0000-0000-0000-0000000000a6', 'holder@example.com', now()),    -- holds North President already
  ('00000000-0000-0000-0000-0000000000a8', 'anon@example.com', now());      -- anonymous sign-in
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-0000000000a8';

insert into private.roster (email, chapter_id, full_name, road_name, status, joined_on, patched_on, on_hiatus, roles)
select v.email, c.id, v.full_name, v.road_name, v.status::member_status, v.joined::date, v.patched::date, v.hiatus,
       v.roles::position_role[]
from (values
  ('RockHard@Example.com', 'west',  'Rocky Hardy',  'RockHard', 'full', '2019-03-01', '2019-09-01', false, '{president}'),
  ('jiggles@example.com',  'north', 'Jim Iggles',   'Jiggles',  'full', '2020-01-01', '2020-06-01', true,  '{president}'),
  ('sneaky@example.com',   'west',  'Sam Neaky',    'Sneaky',   'fng',  '2026-01-01', null,         false, '{}'),
  ('applied@example.com',  'west',  'Al Plied',     'Applied',  'full', '2019-01-01', '2019-01-01', false, '{road_captain}'),
  ('anon@example.com',     'west',  'Ann On',       'Anon',     'full', '2019-01-01', '2019-01-01', false, '{}')
) as v(email, chapter, full_name, road_name, status, joined, patched, hiatus, roles)
join chapters c on c.slug = v.chapter;

-- North already has a President, and one person has already asked to join.
insert into members (id, chapter_id, full_name, status, approval)
select '00000000-0000-0000-0000-0000000000a6', id, 'Holder', 'full', 'approved' from chapters where slug = 'north';
insert into positions (member_id, chapter_id, role)
select '00000000-0000-0000-0000-0000000000a6', id, 'president' from chapters where slug = 'north';
insert into members (id, chapter_id, full_name, status, approval)
select '00000000-0000-0000-0000-0000000000a5', id, 'Al Plied', 'introduced', 'pending' from chapters where slug = 'west';

create function pg_temp.claim_as(who uuid) returns boolean language plpgsql as $$
declare result boolean;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role authenticated;
  result := public.claim_roster();
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return result;
end $$;

\o
\echo 'A roster member lands on their own record at first sign-in'
do $$
declare rock constant uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  assert pg_temp.claim_as(rock), 'claim links them';
  assert exists (
    select 1 from members m join chapters c on c.id = m.chapter_id
    where m.id = rock and m.full_name = 'Rocky Hardy' and m.road_name = 'RockHard' and m.status = 'full'
      and m.approval = 'approved' and c.slug = 'west' and m.patched_on = date '2019-09-01'
  ), 'approved Full member of West with their dates';
  assert exists (select 1 from member_private where member_id = rock and email = 'rockhard@example.com'), 'contact record with their email';
  assert exists (
    select 1 from positions p join chapters c on c.id = p.chapter_id
    where p.member_id = rock and p.role = 'president' and c.slug = 'west' and p.ended_on is null
  ), 'their position';
  assert not pg_temp.claim_as(rock), 'a second call does nothing';
  assert (select count(*) from positions where member_id = rock) = 1, 'no doubled positions';
end $$;

\echo 'A taken seat is skipped, hiatus is carried over'
do $$
declare jig constant uuid := '00000000-0000-0000-0000-0000000000a2';
begin
  assert pg_temp.claim_as(jig), 'still linked';
  assert (select on_hiatus from members where id = jig), 'on hiatus';
  assert not exists (select 1 from positions where member_id = jig), 'North President seat was taken, so skipped';
end $$;

\echo 'Unconfirmed emails, strangers and people who already applied are left alone'
do $$
begin
  assert not pg_temp.claim_as('00000000-0000-0000-0000-0000000000a4'), 'unconfirmed email cannot claim';
  assert not exists (select 1 from members where id = '00000000-0000-0000-0000-0000000000a4'), 'no record made';
  assert not pg_temp.claim_as('00000000-0000-0000-0000-0000000000a3'), 'not on the roster';
  assert not pg_temp.claim_as('00000000-0000-0000-0000-0000000000a8'), 'an anonymous account cannot claim';
  assert not pg_temp.claim_as('00000000-0000-0000-0000-0000000000a5'), 'already applied';
  assert (select approval from members where id = '00000000-0000-0000-0000-0000000000a5') = 'pending', 'their application is untouched';
  assert (select claimed_by from private.roster where email = 'applied@example.com') is null, 'roster row stays open';
end $$;

\echo 'The roster cannot be read or changed through the app, and strangers cannot claim'
do $$
declare who text;
begin
  foreach who in array array['anon', 'authenticated'] loop
    execute format('set local role %I', who);
    begin
      perform 1 from private.roster;
      raise exception '% could read the roster', who;
    exception when insufficient_privilege then null;
    end;
    begin
      update private.roster set full_name = 'x';
      raise exception '% could change the roster', who;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  set local role anon;
  begin
    perform public.claim_roster();
    raise exception 'anon could run claim_roster';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

\echo 'A seat taken by someone claiming at the same moment is skipped, not fatal'
do $$
declare jig constant uuid := '00000000-0000-0000-0000-0000000000a2';
begin
  -- Simulate the race: the seat is free when checked but taken by the time of the insert.
  assert private.add_roster_position(jig, (select id from chapters where slug = 'north'), 'president') = false,
    'the clash is caught and skipped';
end $$;

\echo 'A member who left in good standing claims their record as Legacy, without a patch date'
do $$
declare hacker constant uuid := '00000000-0000-0000-0000-0000000000a9';
begin
  insert into auth.users (id, email, email_confirmed_at) values (hacker, 'hacker@example.com', now());
  insert into private.roster (email, chapter_id, full_name, road_name, status)
  select 'hacker@example.com', id, 'Justin Borg', 'Hacker', 'legacy' from chapters where slug = 'west';
  assert pg_temp.claim_as(hacker), 'claim links them';
  assert (select status from members where id = hacker) = 'legacy', 'status is Legacy';
  assert (select approval from members where id = hacker) = 'approved', 'approved';
  assert (select patched_on from members where id = hacker) is null, 'no patch date';
end $$;

\echo 'The board can move a member to Legacy when they leave in good standing'
do $$
declare rock constant uuid := '00000000-0000-0000-0000-0000000000a1';
declare holder constant uuid := '00000000-0000-0000-0000-0000000000a6';
begin
  -- Holder is North President, so on the NEC and board of every chapter.
  perform set_config('request.jwt.claim.sub', holder::text, true);
  set local role authenticated;
  begin
    perform public.set_member_status(rock, 'legacy');
    raise exception 'moved a sitting President to Legacy';
  exception when raise_exception then
    assert sqlerrm = 'End their positions first.', sqlerrm;
  end;
  reset role;
  update positions set ended_on = private.club_date() where member_id = rock;
  update members set on_hiatus = true where id = rock;
  set local role authenticated;
  perform public.set_member_status(rock, 'legacy');
  reset role;
  assert (select status from members where id = rock) = 'legacy', 'moved to Legacy once his term ended';
  assert not (select on_hiatus from members where id = rock), 'no longer on hiatus';
end $$;

\echo 'A Legacy roster row never seats its holder or puts them on hiatus, even if the sheet says so'
do $$
declare foggy constant uuid := '00000000-0000-0000-0000-0000000000aa';
begin
  insert into auth.users (id, email, email_confirmed_at) values (foggy, 'foggy@example.com', now());
  insert into private.roster (email, chapter_id, full_name, status, on_hiatus, roles)
  select 'foggy@example.com', id, 'Richard Fogden', 'legacy', true, '{tail_gunner,founder}' from chapters where slug = 'west';
  assert pg_temp.claim_as(foggy), 'claim links them';
  assert not (select on_hiatus from members where id = foggy), 'not on hiatus';
  assert not exists (select 1 from positions where member_id = foggy and role <> 'founder'), 'no seat';
  assert exists (select 1 from positions where member_id = foggy and role = 'founder'), 'an honour stays';
end $$;

\echo 'Phone, emergency contact and bike from the sheet land in their profile'
do $$
declare cocky constant uuid := '00000000-0000-0000-0000-0000000000ab';
declare saint constant uuid := '00000000-0000-0000-0000-0000000000ac';
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (cocky, 'cocky@example.com', now()), (saint, 'saint@example.com', now());
  insert into private.roster (email, chapter_id, full_name, status, phone, emergency_name, emergency_relationship,
                              emergency_phone, bike_make, bike_model, bike_rego)
  select 'cocky@example.com', id, 'David Galea', 'fng', '0400 111 222', 'Lou H', null, '0400 333 444',
         'Yamaha', 'XVS650', '1ab-2cd' from chapters where slug = 'west';
  insert into private.roster (email, chapter_id, full_name, status, bike_make, bike_model)
  select 'saint@example.com', id, 'Nick Jarvis', 'fng', 'Honda', 'CMX' from chapters where slug = 'west';
  update private.roster set emergency_name = '  ', emergency_phone = '', bike_rego = ' ' where email = 'saint@example.com';

  assert pg_temp.claim_as(cocky), 'claim links them';
  assert (select phone from member_private where member_id = cocky) = '0400 111 222', 'their phone';
  assert exists (
    select 1 from emergency_contacts
    where member_id = cocky and name = 'Lou H' and phone = '0400 333 444' and relationship = 'Emergency contact'
  ), 'their emergency contact, labelled until they say how they know them';
  assert exists (
    select 1 from bikes b join bike_registrations r on r.bike_id = b.id
    where b.member_id = cocky and b.make = 'Yamaha' and b.model = 'XVS650' and r.rego = '1AB-2CD'
  ), 'their bike and rego';

  assert pg_temp.claim_as(saint), 'claim links them';
  assert (select phone from member_private where member_id = saint) is null, 'no phone given';
  assert not exists (select 1 from emergency_contacts where member_id = saint), 'blank contact is skipped';
  assert exists (select 1 from bikes where member_id = saint and make = 'Honda' and model = 'CMX'), 'their bike';
  assert not exists (select 1 from bike_registrations r join bikes b on b.id = r.bike_id where b.member_id = saint),
    'blank rego is skipped';
end $$;

\echo 'A relationship from the sheet is kept'
do $$
declare tigs constant uuid := '00000000-0000-0000-0000-0000000000ad';
begin
  insert into auth.users (id, email, email_confirmed_at) values (tigs, 'tigs@example.com', now());
  insert into private.roster (email, chapter_id, full_name, status, emergency_name, emergency_relationship, emergency_phone)
  select 'tigs@example.com', id, 'David Scales', 'full', 'Amy S', 'Wife', '0400 1' from chapters where slug = 'west';
  assert pg_temp.claim_as(tigs), 'claim links them';
  assert (select relationship from emergency_contacts where member_id = tigs) = 'Wife', 'their relationship';
end $$;

\echo 'The roster refuses half an emergency contact or half a bike'
do $$
declare west uuid := (select id from chapters where slug = 'west');
begin
  begin
    insert into private.roster (email, chapter_id, full_name, status, emergency_name) values ('h1@example.com', west, 'H', 'fng', 'Lou');
    raise exception 'took a contact with no number';
  exception when check_violation then null;
  end;
  begin
    insert into private.roster (email, chapter_id, full_name, status, bike_make) values ('h2@example.com', west, 'H', 'fng', 'Honda');
    raise exception 'took a bike with no model';
  exception when check_violation then null;
  end;
  begin
    insert into private.roster (email, chapter_id, full_name, status, bike_rego) values ('h3@example.com', west, 'H', 'fng', '1AB');
    raise exception 'took a rego with no bike';
  exception when check_violation then null;
  end;
  begin
    insert into private.roster (email, chapter_id, full_name, status, emergency_name, emergency_phone) values ('h4@example.com', west, 'H', 'fng', 'Lou', '  ');
    raise exception 'took a contact with a blank number';
  exception when check_violation then null;
  end;
  begin
    insert into private.roster (email, chapter_id, full_name, status, bike_make, bike_model) values ('h5@example.com', west, 'H', 'fng', 'Honda', '');
    raise exception 'took a bike with a blank model';
  exception when check_violation then null;
  end;
  begin
    insert into private.roster (email, chapter_id, full_name, status, emergency_relationship) values ('h6@example.com', west, 'H', 'fng', 'Wife');
    raise exception 'took a relationship with no contact';
  exception when check_violation then null;
  end;
end $$;
