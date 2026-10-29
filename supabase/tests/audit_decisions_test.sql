-- Checks the first three of Jeff's decisions from the 29 Oct 2026 launch audit (the report lists
-- them as M3, M6 and L5): national roles see every chapter's board records but act only where
-- they hold a seat; open chapter proposals and national contributions are board and NEC business
-- until decided; meeting check-ins and sign-ups are the member's, the board's and the organisers',
-- with the numbers for everyone. See docs/superpowers/specs/2026-10-29-audit-decisions-design.md.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- f1 Nell Chair (North Full, National Chairman, no board seat), f2 Wes President (West),
-- f3 Nora President (North), f4 Fred Full and f5 Will Full (West, no seat), f6 Ned North (North
-- Full, no seat), f7 Tess Treasurer (West), f8 Sam Supporter (West), f9 Al Applicant (West,
-- pending), f10 Nat Applicant (North, pending), f11 Vic VP (North Vice President), f12 Cal Charity
-- (West Full on the charity committee), f13 Ann Auditor (North Full, National Auditor, no board seat).
create function pg_temp.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid
$$;

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.f(n), 'f' || n || '@example.com', now() from generate_series(1, 13) n;

insert into members (id, chapter_id, full_name, status, approval)
select pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.name, v.status::member_status, v.approval::approval_state
from (values
  (1, 'north', 'Nell Chair', 'full', 'approved'),
  (2, 'west', 'Wes President', 'full', 'approved'),
  (3, 'north', 'Nora President', 'full', 'approved'),
  (4, 'west', 'Fred Full', 'full', 'approved'),
  (5, 'west', 'Will Full', 'full', 'approved'),
  (6, 'north', 'Ned North', 'full', 'approved'),
  (7, 'west', 'Tess Treasurer', 'full', 'approved'),
  (8, 'west', 'Sam Supporter', 'supporter', 'approved'),
  (9, 'west', 'Al Applicant', 'introduced', 'pending'),
  (10, 'north', 'Nat Applicant', 'introduced', 'pending'),
  (11, 'north', 'Vic VP', 'full', 'approved'),
  (12, 'west', 'Cal Charity', 'full', 'approved'),
  (13, 'north', 'Ann Auditor', 'full', 'approved')
) as v(n, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on)
select pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.role::position_role, '2026-08-01'
from (values
  (1, null, 'nec_chair'),
  (2, 'west', 'president'),
  (3, 'north', 'president'),
  (7, 'west', 'treasurer'),
  (11, 'north', 'vice_president'),
  (12, 'west', 'charity_committee'),
  (13, null, 'nec_auditor')
) as v(n, ch, role);

-- Ned's private records, kept by the North board.
insert into member_private (member_id, email, phone, licence_class) values (pg_temp.f(6), 'ned@example.com', '0400 000 006', null);
insert into emergency_contacts (member_id, name, relationship, phone) values (pg_temp.f(6), 'Nan North', 'mother', '0400 000 060');
insert into bikes (id, member_id, make, model) values (pg_temp.f(106), pg_temp.f(6), 'Harley-Davidson', 'Fat Boy');
insert into bike_registrations (bike_id, rego, rego_expiry) values (pg_temp.f(106), 'NED006', '2027-06-30');
insert into conduct_records (member_id, chapter_id, kind, summary, decided_on, notice_on, recorded_by)
values (pg_temp.f(6), (select id from chapters where slug = 'north'), 'vest', 'Rode without the vest', '2026-10-01', '2026-10-01', pg_temp.f(3));
insert into status_notices (member_id, chapter_id, about, record, proposal, given_on, respond_by, given_by, outcome, closed_on, closed_by)
values (pg_temp.f(6), (select id from chapters where slug = 'north'), 'attendance', 'Two meetings missed', 'Supporter', '2026-10-01', '2026-10-15', pg_temp.f(3), 'withdrawn', '2026-10-16', pg_temp.f(3));
insert into member_decisions (member_id, kind, outcome, status, decided_on, recorded_by)
values (pg_temp.f(6), 'application', 'approved', 'fng', '2025-02-01', pg_temp.f(3));

-- A whole-club ride with a hub and a charity sign-up list, and two check-ins: the North monthly
-- meeting and the ride. Ned checked in to both; Ned and Fred registered and signed up.
insert into rides (id, source, starts_at, title, category) values (pg_temp.f(200), 'app', now() + interval '7 days', 'Club run', 'club');
insert into ride_hubs (ride_id, members_only, beds) values (pg_temp.f(200), true, 10);
insert into hub_registrations (ride_id, member_id, staying, pillion) values (pg_temp.f(200), pg_temp.f(6), 'group', true), (pg_temp.f(200), pg_temp.f(4), 'own', true);
insert into charity_rides (ride_id, cause, places, jobs) values (pg_temp.f(200), 'Kids in care', 10, '{marshal}');
insert into charity_signups (ride_id, member_id, riding, job) values (pg_temp.f(200), pg_temp.f(6), true, null), (pg_temp.f(200), pg_temp.f(4), false, 'marshal');
insert into checkin_sessions (id, kind, chapter_id, title, held_on, code, opened_by, meeting_type)
values (pg_temp.f(300), 'meeting', (select id from chapters where slug = 'north'), 'North monthly meeting', '2026-10-20', 'NORTH1', pg_temp.f(3), 'ordinary');
insert into checkin_sessions (id, kind, ride_id, title, held_on, code, opened_by)
values (pg_temp.f(301), 'ride', pg_temp.f(200), 'Club run', '2026-10-25', 'RIDE01', pg_temp.f(2));
insert into attendance (session_id, member_id) values (pg_temp.f(300), pg_temp.f(6)), (pg_temp.f(301), pg_temp.f(6));

-- Runs a statement as a signed-in member (or as anon when who is null) and returns its error, or null.
create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

-- Evaluates an expression as that member (or anon) and returns it as text.
create function pg_temp.value_as(who uuid, expr text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute 'select (' || expr || ')::text' into out;
  reset role;
  return out;
end $$;

-- Evaluates an expression with that member signed in but without leaving the superuser role, for
-- the private helpers the app can't call.
create function pg_temp.helper_as(who uuid, expr text) returns text language plpgsql as $$
declare out text;
begin
  perform set_config('request.jwt.claim.sub', who::text, true);
  execute 'select (' || expr || ')::text' into out;
  return out;
end $$;

create function pg_temp.north() returns uuid language sql stable as $$ select id from chapters where slug = 'north' $$;
create function pg_temp.west() returns uuid language sql stable as $$ select id from chapters where slug = 'west' $$;

\echo 'The board helper is split: seeing a chapter''s board records and acting as its board (M3)'
do $$
begin
  assert pg_temp.helper_as(pg_temp.f(2), format('private.sees_board_of(%L)', pg_temp.north())) = 'true', 'a President sees North''s board records';
  assert pg_temp.helper_as(pg_temp.f(2), format('private.is_board_of(%L)', pg_temp.north())) = 'false', 'but isn''t North''s board';
  assert pg_temp.helper_as(pg_temp.f(2), format('private.is_board_of(%L)', pg_temp.west())) = 'true', 'they are West''s';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.sees_board_of(%L)', pg_temp.west())) = 'true', 'the Chairman sees every chapter''s';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.is_board_of(%L)', pg_temp.north())) = 'false', 'and acts as nobody''s board without a seat';
  assert pg_temp.helper_as(pg_temp.f(3), format('private.is_board_of(%L)', pg_temp.north())) = 'true', 'North''s President is North''s board';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.sees_board_of(%L)', pg_temp.north())) = 'false', 'a West board seat sees West only';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.is_any_board()') = 'true', 'club-wide keeping still counts national roles';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.runs_scope(null)') = 'true', 'the Chairman runs the national scope';
  assert pg_temp.helper_as(pg_temp.f(2), format('private.runs_scope(%L)', pg_temp.north())) = 'false', 'a President doesn''t run another chapter''s';
  -- A scope's private business reads the same way.
  assert pg_temp.helper_as(pg_temp.f(2), format('private.sees_scope(%L)', pg_temp.north())) = 'true', 'but sees North''s business';
  assert pg_temp.helper_as(pg_temp.f(2), format('private.reviews_scope(%L)', pg_temp.north())) = 'true', 'and reviews it';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.sees_scope(%L)', pg_temp.north())) = 'false', 'a West seat sees West''s only';
  assert pg_temp.helper_as(pg_temp.f(7), 'private.sees_scope(null)') = 'false', 'and not the club''s';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.sees_scope(null)') = 'true', 'the Chairman sees the club''s';
  assert pg_temp.helper_as(pg_temp.f(3), format('private.sees_scope(%L)', pg_temp.north())) = 'true', 'North''s President sees North''s';
end $$;

-- A draft merch item of North's: its board and the national roles see it, as before; a West seat doesn't.
insert into merch_items (id, chapter_id, name, price_cents, status, proposed_by)
values (pg_temp.f(500), pg_temp.north(), 'North hoodie', 6500, 'proposed', pg_temp.f(3));
do $$
begin
  assert pg_temp.helper_as(pg_temp.f(2), format('private.sees_merch_item((select i from merch_items i where i.id = %L))', pg_temp.f(500))) = 'true', 'a President sees a North draft';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.sees_merch_item((select i from merch_items i where i.id = %L))', pg_temp.f(500))) = 'true', 'so does the Chairman';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.sees_merch_item((select i from merch_items i where i.id = %L))', pg_temp.f(500))) = 'false', 'a West seat doesn''t';
  assert pg_temp.helper_as(pg_temp.f(6), format('private.sees_merch_item((select i from merch_items i where i.id = %L))', pg_temp.f(500))) = 'false', 'nor a North member';
  assert pg_temp.value_as(pg_temp.f(2), format($q$select count(*) from jsonb_array_elements(public.club_admin()->'merch_items') i where i->>'id' = %L$q$, pg_temp.f(500))) = '1', 'the admin read lists it for the President';
  assert pg_temp.value_as(pg_temp.f(7), format($q$select count(*) from jsonb_array_elements(public.club_admin()->'merch_items') i where i->>'id' = %L$q$, pg_temp.f(500))) = '0', 'and not for a West seat';
end $$;

\echo 'A President reads another chapter''s board records (M3)'
do $$
declare who uuid;
begin
  foreach who in array array[pg_temp.f(2), pg_temp.f(1), pg_temp.f(3)] loop
    assert pg_temp.value_as(who, format('select count(*) from member_private where member_id = %L', pg_temp.f(6))) = '1', 'private details';
    assert pg_temp.value_as(who, format('select count(*) from emergency_contacts where member_id = %L', pg_temp.f(6))) = '1', 'emergency contact';
    assert pg_temp.value_as(who, format('select count(*) from bike_registrations r join bikes b on b.id = r.bike_id where b.member_id = %L', pg_temp.f(6))) = '1', 'rego';
    assert pg_temp.value_as(who, format('select count(*) from status_notices where member_id = %L', pg_temp.f(6))) = '1', '5.5 notice';
    assert pg_temp.value_as(who, format('select count(*) from member_decisions where member_id = %L', pg_temp.f(6))) = '1', 'decision';
    assert pg_temp.value_as(who, format('select count(*) from members where id = %L', pg_temp.f(10))) = '1', 'pending applicant';
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''conduct'')') = '1', 'conduct record';
    assert pg_temp.value_as(who, format('select count(*) from public.shared_phones() where member_id = %L', pg_temp.f(6))) = '1', 'phone';
    -- And they still read and post in the other chapter's board chat.
    assert pg_temp.try_as(who, format('select public.send_message(%L, %L, %L::jsonb, %L)',
      (select c.id from conversations c where c.kind = 'board' and c.chapter_id = pg_temp.north()), 'Reading along', '[]', null)) is null, 'posts in North''s board chat';
  end loop;
  assert pg_temp.try_as(pg_temp.f(7), format('select public.send_message(%L, %L, %L::jsonb, %L)',
    (select c.id from conversations c where c.kind = 'board' and c.chapter_id = pg_temp.north()), 'x', '[]', null)) = 'That chat is for the North board.', 'a West seat doesn''t';
  -- A West board seat and a plain West member see none of it, as before.
  foreach who in array array[pg_temp.f(7), pg_temp.f(4)] loop
    assert pg_temp.value_as(who, format('select count(*) from member_private where member_id = %L', pg_temp.f(6))) = '0', 'no private details';
    assert pg_temp.value_as(who, format('select count(*) from emergency_contacts where member_id = %L', pg_temp.f(6))) = '0', 'no emergency contact';
    assert pg_temp.value_as(who, format('select count(*) from status_notices where member_id = %L', pg_temp.f(6))) = '0', 'no notice';
    assert pg_temp.value_as(who, format('select count(*) from members where id = %L', pg_temp.f(10))) = '0', 'no pending applicant';
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''conduct'')') = '0', 'no conduct record';
  end loop;
end $$;

\echo 'But only that chapter''s board acts there (M3)'
do $$
declare who uuid; today date := private.club_date();
begin
  -- The West President and the Chairman inside North: every action refuses them.
  foreach who in array array[pg_temp.f(2), pg_temp.f(1)] loop
    assert pg_temp.try_as(who, format($q$select public.approve_member(%L, 'fng')$q$, pg_temp.f(10))) like 'Only the North board%', 'approve';
    assert pg_temp.try_as(who, format('select public.decline_member(%L)', pg_temp.f(10))) like 'Only that chapter%', 'decline';
    assert pg_temp.try_as(who, format($q$select public.set_member_status(%L, 'supporter')$q$, pg_temp.f(6))) like 'Only that chapter%', 'status';
    assert pg_temp.try_as(who, format($q$select public.give_status_notice(%L, 'attendance', 'Record', 'Supporter', %L)$q$, pg_temp.f(6), today + 21)) like 'Only their chapter%', 'notice';
    assert pg_temp.try_as(who, format($q$select public.record_conduct(%L, 'vest', 'No vest', null, %L, %L, null)$q$, pg_temp.f(6), today, today)) = 'Only that member’s chapter board can do that.', 'conduct';
    assert pg_temp.try_as(who, format($q$select public.set_exemption(%L, %L, 'work')$q$, pg_temp.f(300), pg_temp.f(11))) like 'Only their chapter%', 'exemption';
    assert pg_temp.try_as(who, format('select public.mark_attendance(%L, %L, true)', pg_temp.f(300), pg_temp.f(11))) like 'Only that chapter%', 'attendance';
    assert pg_temp.try_as(who, format($q$select public.appoint_position(%L, %L, 'secretary')$q$, pg_temp.f(6), pg_temp.north())) like 'Only that chapter%', 'appoint';
    assert pg_temp.try_as(who, format('select public.end_position(%L)', (select id from positions where member_id = pg_temp.f(11)))) like 'Only that chapter%', 'end term';
    assert pg_temp.try_as(who, format($q$select public.open_checkin('meeting', null, %L, 'North meeting', %L, 'ordinary')$q$, pg_temp.north(), today)) like 'Only that chapter%', 'check-in';
    assert pg_temp.try_as(who, format($q$select public.open_vote(%L, null, null, 'Move the meeting?', null, 'chapter_board', 'majority', false, 3, now() + interval '1 day')$q$, pg_temp.north())) = 'Only that chapter’s board can do that.', 'vote';
  end loop;
  -- North's President does all of it.
  assert pg_temp.try_as(pg_temp.f(3), format($q$select public.give_status_notice(%L, 'attendance', 'Record', 'Supporter', %L)$q$, pg_temp.f(6), today + 21)) is null, 'Nora gives notice';
  assert pg_temp.try_as(pg_temp.f(3), format($q$select public.record_conduct(%L, 'vest', 'No vest again', null, %L, %L, null)$q$, pg_temp.f(6), today, today)) is null, 'Nora records conduct';
  assert pg_temp.try_as(pg_temp.f(3), format('select public.mark_attendance(%L, %L, true)', pg_temp.f(300), pg_temp.f(11))) is null, 'Nora marks attendance';
  assert pg_temp.try_as(pg_temp.f(3), format($q$select public.appoint_position(%L, %L, 'secretary')$q$, pg_temp.f(6), pg_temp.north())) is null, 'Nora seats a Secretary';
  assert pg_temp.try_as(pg_temp.f(3), format($q$select public.approve_member(%L, 'fng')$q$, pg_temp.f(10))) is null, 'Nora approves the applicant';
  -- National powers stay national: the Chairman opens an NEC vote, a President doesn't run the national scope.
  assert pg_temp.try_as(pg_temp.f(1), $q$select public.open_vote(null, null, null, 'Buy the van?', null, 'nec', 'majority', false, 2, now() + interval '1 day')$q$) is null, 'the Chairman opens an NEC vote';
  -- The Chairman, a North Full Member with no board seat, can't act inside North either.
  assert pg_temp.try_as(pg_temp.f(1), format('select public.decline_member(%L)', pg_temp.f(9))) like 'Only that chapter%', 'nor inside West';
  -- Bringing someone back to Full or Nomad stays the NEC's (5.6): the Chairman reaches the NEC rule for a
  -- West Supporter without a West seat, and West's Treasurer can't do it at all.
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.set_member_status(%L, 'full')$q$, pg_temp.f(8))) = 'Coming back to Full or Nomad needs a carried NEC vote (5.6).', 'the Chairman needs the vote, not a seat';
  assert pg_temp.try_as(pg_temp.f(7), format($q$select public.set_member_status(%L, 'full')$q$, pg_temp.f(8))) = 'Only the NEC can bring someone back to Full or Nomad (5.6).', 'the Treasurer can''t';
  assert pg_temp.try_as(pg_temp.f(7), format($q$select public.set_member_status(%L, 'fng')$q$, pg_temp.f(8))) is null, 'but makes every other change';
  assert pg_temp.try_as(pg_temp.f(7), format($q$select public.set_member_status(%L, 'supporter')$q$, pg_temp.f(8))) is null, 'and back';
end $$;

\echo 'Open chapter proposals and national contributions are board and NEC business until decided (M6)'
do $$
declare who uuid;
begin
  insert into chapter_proposals (id, name, area, state, plan, founder_ids, president_id, saa_id, proposed_by)
  values (pg_temp.f(400), 'Gippsland', 'Gippsland', 'VIC', '{}'::jsonb, array[pg_temp.f(4), pg_temp.f(5), pg_temp.f(6), pg_temp.f(11), pg_temp.f(12)], pg_temp.f(4), pg_temp.f(5), pg_temp.f(4));
  insert into national_contributions (id, title, purpose, total_cents, shares, proposed_by)
  values (pg_temp.f(401), 'Van service', 'The Rusty Bus', 100000, '[]'::jsonb, pg_temp.f(1));
  -- A Supporter with no part in it sees neither while they're open.
  assert pg_temp.value_as(pg_temp.f(8), 'select jsonb_array_length(public.club_admin()->''chapter_proposals'')') = '0', 'no proposal for Sam';
  assert pg_temp.value_as(pg_temp.f(8), 'select jsonb_array_length(public.club_admin()->''contributions'')') = '0', 'no contribution for Sam';
  -- The founders and whoever put it forward see the proposal, not the contribution (Ned, a founder
  -- too, is North's Secretary by now, so he sees both as a board member).
  foreach who in array array[pg_temp.f(4), pg_temp.f(5), pg_temp.f(12)] loop
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''chapter_proposals'')') = '1', 'a founder sees their proposal';
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''contributions'')') = '0', 'not the contribution';
  end loop;
  -- Chapter boards and national roles see both.
  foreach who in array array[pg_temp.f(7), pg_temp.f(2), pg_temp.f(1), pg_temp.f(3), pg_temp.f(6)] loop
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''chapter_proposals'')') = '1', 'the board sees the proposal';
    assert pg_temp.value_as(who, 'select jsonb_array_length(public.club_admin()->''contributions'')') = '1', 'and the contribution';
  end loop;
  -- The Auditor isn't a board: the decided record is their work (13.8), so nothing while they're open.
  assert pg_temp.value_as(pg_temp.f(13), 'select jsonb_array_length(public.club_admin()->''chapter_proposals'')') = '0', 'no open proposal for the Auditor';
  assert pg_temp.value_as(pg_temp.f(13), 'select jsonb_array_length(public.club_admin()->''contributions'')') = '0', 'no open contribution for the Auditor';
  -- Once decided, everyone does.
  update chapter_proposals set status = 'not_approved', decided_by = pg_temp.f(1), decided_at = now() where id = pg_temp.f(400);
  update national_contributions set status = 'approved', settled_at = now() where id = pg_temp.f(401);
  assert pg_temp.value_as(pg_temp.f(8), 'select jsonb_array_length(public.club_admin()->''chapter_proposals'')') = '1', 'Sam sees the decided proposal';
  assert pg_temp.value_as(pg_temp.f(8), 'select jsonb_array_length(public.club_admin()->''contributions'')') = '1', 'and the settled contribution';
  assert pg_temp.value_as(pg_temp.f(13), 'select jsonb_array_length(public.club_admin()->''chapter_proposals'') + jsonb_array_length(public.club_admin()->''contributions'')') = '2', 'the Auditor too';
end $$;

\echo 'Meeting check-ins are the member''s and the board''s; ride check-ins stay everyone''s (L5)'
do $$
declare who uuid;
begin
  -- Plain members of either chapter, a Supporter and a West board seat: the ride, not the meeting.
  foreach who in array array[pg_temp.f(4), pg_temp.f(5), pg_temp.f(8), pg_temp.f(7), pg_temp.f(12)] loop
    assert pg_temp.value_as(who, format('select count(*) from attendance where member_id = %L and session_id = %L', pg_temp.f(6), pg_temp.f(300))) = '0', 'no meeting row';
    assert pg_temp.value_as(who, format('select count(*) from attendance where member_id = %L and session_id = %L', pg_temp.f(6), pg_temp.f(301))) = '1', 'the ride row';
  end loop;
  -- Ned himself, North's board, the national roles and the Auditor: both.
  foreach who in array array[pg_temp.f(6), pg_temp.f(3), pg_temp.f(11), pg_temp.f(2), pg_temp.f(1), pg_temp.f(13)] loop
    assert pg_temp.value_as(who, format('select count(*) from attendance where member_id = %L', pg_temp.f(6))) = '2', 'both rows';
  end loop;
  assert pg_temp.try_as(null, 'select count(*) from attendance') is not null, 'anon is refused outright';
end $$;

\echo 'Sign-ups are the member''s, the board''s and the organisers''; the numbers are everyone''s (L5)'
do $$
declare who uuid;
begin
  -- A member with no sign-up sees none, and so does the Auditor (the numbers are enough for 13.8);
  -- one who signed up sees their own.
  foreach who in array array[pg_temp.f(5), pg_temp.f(8), pg_temp.f(13)] loop
    assert pg_temp.value_as(who, format('select count(*) from hub_registrations where ride_id = %L', pg_temp.f(200))) = '0', 'no registrations';
    assert pg_temp.value_as(who, format('select count(*) from charity_signups where ride_id = %L', pg_temp.f(200))) = '0', 'no sign-ups';
  end loop;
  assert pg_temp.value_as(pg_temp.f(4), format('select count(*) from hub_registrations where ride_id = %L and member_id = %L', pg_temp.f(200), pg_temp.f(4))) = '1', 'Fred''s own registration';
  assert pg_temp.value_as(pg_temp.f(4), format('select count(*) from hub_registrations where ride_id = %L', pg_temp.f(200))) = '1', 'and only that';
  assert pg_temp.value_as(pg_temp.f(4), format('select count(*) from charity_signups where ride_id = %L', pg_temp.f(200))) = '1', 'same for the charity list';
  -- The board (who manage a whole-club ride), the national roles and the charity committee see the lists.
  foreach who in array array[pg_temp.f(7), pg_temp.f(2), pg_temp.f(1), pg_temp.f(3)] loop
    assert pg_temp.value_as(who, format('select count(*) from hub_registrations where ride_id = %L', pg_temp.f(200))) = '2', 'the hub list';
    assert pg_temp.value_as(who, format('select count(*) from charity_signups where ride_id = %L', pg_temp.f(200))) = '2', 'the charity list';
  end loop;
  assert pg_temp.value_as(pg_temp.f(12), format('select count(*) from charity_signups where ride_id = %L', pg_temp.f(200))) = '2', 'the charity committee sees the charity list';
  assert pg_temp.value_as(pg_temp.f(12), format('select count(*) from hub_registrations where ride_id = %L', pg_temp.f(200))) = '0', 'not the hub list';
  -- The numbers, for anyone approved.
  assert pg_temp.value_as(pg_temp.f(13), format('select count(*) from public.signup_counts() where ride_id = %L', pg_temp.f(200))) = '1', 'the Auditor has the numbers';
  assert pg_temp.value_as(pg_temp.f(5), format($q$select hub_riders || '/' || hub_pillions || '/' || hub_group || '/' || hub_own || '/' || hub_camping || '/' || hub_day || '/' || hub_group_beds from public.signup_counts() where ride_id = %L$q$, pg_temp.f(200))) = '2/2/1/1/0/0/2', 'hub counts';
  assert pg_temp.value_as(pg_temp.f(8), format($q$select charity_riding || '/' || charity_pillions || '/' || charity_guests || '/' || charity_helping || '/' || charity_people from public.signup_counts() where ride_id = %L$q$, pg_temp.f(200))) = '1/0/0/1/1', 'charity counts';
  update charity_signups set guests = 2 where ride_id = pg_temp.f(200) and member_id = pg_temp.f(4);
  assert pg_temp.value_as(pg_temp.f(8), format($q$select charity_guests || '/' || charity_people from public.signup_counts() where ride_id = %L$q$, pg_temp.f(200))) = '2/3', 'a helper''s guests ride too, as the app counts them';
  -- Withdrawn rows don't count.
  update charity_signups set withdrawn_at = now() where ride_id = pg_temp.f(200) and member_id = pg_temp.f(6);
  update hub_registrations set withdrawn_at = now() where ride_id = pg_temp.f(200) and member_id = pg_temp.f(4);
  assert pg_temp.value_as(pg_temp.f(5), format('select hub_riders || ''/'' || charity_riding from public.signup_counts() where ride_id = %L', pg_temp.f(200))) = '1/0', 'after withdrawing';
  assert pg_temp.try_as(null, 'select * from public.signup_counts()') is not null, 'not for anon';
  assert pg_temp.value_as(pg_temp.f(9), 'select count(*) from public.signup_counts()') = '0', 'nothing for an applicant';
end $$;

\echo 'AUDIT DECISIONS CHECKS PASSED'
