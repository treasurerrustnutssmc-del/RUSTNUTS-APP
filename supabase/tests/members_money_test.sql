-- Checks Stage 4: check-ins, decisions and fees. Who can read what, nothing written except
-- through the actions, and the parts the shared parity cases don't reach (codes, repeat runs,
-- receipts, the continuation fee). Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'sec@example.com', now()),       -- West Secretary
  ('00000000-0000-0000-0000-0000000000a2', 'tre@example.com', now()),       -- West Treasurer
  ('00000000-0000-0000-0000-0000000000a3', 'rider@example.com', now()),     -- West Full
  ('00000000-0000-0000-0000-0000000000a4', 'north@example.com', now()),     -- North Full
  ('00000000-0000-0000-0000-0000000000a5', 'auditor@example.com', now()),   -- National Auditor
  ('00000000-0000-0000-0000-0000000000a6', 'applicant@example.com', now()), -- West applicant, introduced
  ('00000000-0000-0000-0000-0000000000a7', 'fng@example.com', now()),       -- West FNG, 12 months in
  ('00000000-0000-0000-0000-0000000000a8', 'stranger@example.com', now());  -- signed in, no record

insert into members (id, chapter_id, full_name, road_name, status, approval, fng_started_on)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state,
       case when v.status = 'fng' then (private.club_date() - interval '12 months')::date end
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Sue Secretary', 'Sec', 'full', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a2', 'Tom Treasurer', 'Tre', 'full', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a3', 'Rita Rider', 'Rita', 'full', 'approved', 'west'),
  ('00000000-0000-0000-0000-0000000000a4', 'Ned North', 'Ned', 'full', 'approved', 'north'),
  ('00000000-0000-0000-0000-0000000000a5', 'Audrey Auditor', 'Aud', 'full', 'approved', 'north'),
  ('00000000-0000-0000-0000-0000000000a6', 'Al Applicant', null, 'introduced', 'pending', 'west'),
  ('00000000-0000-0000-0000-0000000000a7', 'Fred Fng', 'Fred', 'fng', 'approved', 'west')
) as v(id, name, road, status, approval, chapter)
join chapters c on c.slug = v.chapter;

insert into positions (member_id, chapter_id, role, started_on)
select v.m::uuid, (select id from chapters where slug = v.ch), v.role::position_role, date '2025-01-01'
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'west', 'secretary'),
  ('00000000-0000-0000-0000-0000000000a2', 'west', 'treasurer'),
  ('00000000-0000-0000-0000-0000000000a5', null, 'nec_auditor')
) as v(m, ch, role);

insert into rides (id, source, starts_at, title, category) values
  ('00000000-0000-0000-0000-0000000000c1', 'app', now(), 'Today''s ride', 'west');

-- Runs a statement as a signed-in user (or anon when who is null) and returns its error, or null.
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

-- Runs a query that returns one value, as a signed-in user. Null when it's refused.
create function pg_temp.value_as(who uuid, query text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute query into v;
  exception when others then
    v := null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text) to anon, authenticated;

\o
\echo 'A board opens a meeting check-in; only its runners can read the code'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  rita constant uuid := '00000000-0000-0000-0000-0000000000a3';
  session uuid;
  code text;
begin
  session := pg_temp.value_as(sec, format($q$select public.open_checkin('meeting', null, (select id from public.chapters where slug = 'west'), 'Club meeting', %L)$q$, private.club_date()));
  assert session is not null, 'opened';
  code := pg_temp.value_as(sec, format('select public.checkin_code(%L)', session));
  assert code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$', 'a 6-character code from the easy-to-read letters';
  assert pg_temp.value_as(rita, format('select public.checkin_code(%L)', session)) is null, 'a member can''t get the code';
  assert pg_temp.value_as(rita, 'select count(*) from public.checkin_sessions') = '1', 'but sees the session';
  assert pg_temp.value_as(rita, 'select code from public.checkin_sessions') is null, 'not its code column';
  assert pg_temp.value_as(rita, 'select (public.members_money()->''sessions''->0) ? ''code''') = 'false', 'nor through members_money';
  update checkin_sessions set code = 'RN2026' where id = session;
end $$;

\echo 'Checking in by code: typed, scanned, twice, and by an applicant'
do $$
declare
  rita constant uuid := '00000000-0000-0000-0000-0000000000a3';
  al constant uuid := '00000000-0000-0000-0000-0000000000a6';
begin
  assert pg_temp.try_as(rita, $q$select public.check_in(' rn 2026 ')$q$) is null, 'typed';
  assert pg_temp.try_as(rita, $q$select public.check_in('RUSTNUTS:RN2026')$q$) is null, 'scanned, the second time does nothing';
  assert (select count(*) from attendance where member_id = rita) = 1, 'checked in once';
  assert pg_temp.try_as(al, $q$select public.check_in('RN2026')$q$) is null, 'an applicant in their introduction phase';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a8', $q$select public.check_in('RN2026')$q$)
    = 'Only members and applicants can check in.', 'a stranger';
  assert pg_temp.try_as(null, $q$select public.check_in('RN2026')$q$) is not null, 'anon';
  assert pg_temp.try_as(rita, $q$select public.check_in('ZZZZZZ')$q$) = 'That code doesn’t match a check-in.', 'wrong code';
  update checkin_sessions set held_on = held_on - 1 where code = 'RN2026';
  assert pg_temp.try_as(rita, $q$select public.check_in('RN2026')$q$) = 'That check-in isn’t for today.', 'yesterday''s code';
  update checkin_sessions set held_on = held_on + 1 where code = 'RN2026';
end $$;

\echo 'Who sees attendance'
do $$
begin
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a4', 'select count(*) from public.attendance') = '0',
    'a meeting check-in is the member''s and the board''s, not other members'' (5.5)';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a3', 'select count(*) from public.attendance') = '1', 'Rita sees her own';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a1', 'select count(*) from public.attendance') = '2', 'the West board sees both';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a5', 'select count(*) from public.attendance') = '2', 'so does the Auditor (11.8)';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a6', 'select count(*) from public.attendance') = '1', 'the applicant sees their own';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a8', 'select count(*) from public.attendance') = '0', 'a stranger sees none';
  assert pg_temp.value_as(null, 'select count(*) from public.attendance') is null, 'anon is refused';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a8', 'select count(*) from public.checkin_sessions') = '0', 'nor sessions';
end $$;

\echo 'Ride check-ins, ticking off, closing'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  ride_session uuid;
begin
  ride_session := pg_temp.value_as(sec, $q$select public.open_checkin('ride', '00000000-0000-0000-0000-0000000000c1', null, null, null)$q$);
  assert (select held_on = private.club_date() and title = 'Today''s ride' and chapter_id = (select id from chapters where slug = 'west')
          from checkin_sessions where id = ride_session), 'takes the ride''s date, title and chapter';
  assert pg_temp.try_as(sec, $q$select public.open_checkin('ride', '00000000-0000-0000-0000-0000000000c1', null, null, null)$q$)
    = 'Check-in for this ride is already open.', 'one per ride';
  assert pg_temp.try_as(sec, format('select public.mark_attendance(%L, %L, true)', ride_session, '00000000-0000-0000-0000-0000000000a7')) is null, 'ticked';
  assert (select marked_by = sec from attendance where session_id = ride_session), 'marked by the secretary';
  assert pg_temp.try_as(sec, format('select public.mark_attendance(%L, %L, false)', ride_session, '00000000-0000-0000-0000-0000000000a7')) is null, 'un-ticked';
  assert not exists (select 1 from attendance where session_id = ride_session), 'gone again';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a3', format('select public.close_checkin(%L)', ride_session))
    = 'Only that chapter’s board can run this check-in.', 'a member can''t close it';
  assert pg_temp.try_as(sec, format('select public.close_checkin(%L)', ride_session)) is null, 'closed';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a3', format('select public.check_in(%L)', (select code from checkin_sessions where id = ride_session)))
    = 'That check-in has closed.', 'closed to check-ins';
end $$;

\echo 'Nothing is written except through the actions'
do $$
declare rita constant uuid := '00000000-0000-0000-0000-0000000000a3';
begin
  assert pg_temp.try_as(rita, $q$insert into attendance (session_id, member_id) select id, '00000000-0000-0000-0000-0000000000a4' from checkin_sessions limit 1$q$) is not null, 'attendance';
  assert pg_temp.try_as(rita, $q$update checkin_sessions set closed_at = null$q$) is not null, 'sessions';
  assert pg_temp.try_as(rita, $q$insert into charges (member_id, chapter_id, fy, kind, amount_cents, due_on) values (auth.uid(), (select id from chapters limit 1), 2026, 'other', 1, current_date)$q$) is not null, 'charges';
  assert pg_temp.try_as(rita, $q$update payments set state = 'confirmed'$q$) is not null, 'payments';
  assert pg_temp.try_as(rita, $q$insert into fee_rates values ((select id from chapters limit 1), 2026, 'full', 1, current_date)$q$) is not null, 'rates';
  assert pg_temp.try_as(rita, $q$insert into member_decisions (member_id, kind, outcome, decided_on) values (auth.uid(), 'application', 'approved', current_date)$q$) is not null, 'decisions';
end $$;

\echo 'Deciding an application records the tally; only the board sees it'
do $$
declare al constant uuid := '00000000-0000-0000-0000-0000000000a6';
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', format($q$select public.decide_application(%L, 'fng', 7, 0, 1, ' Good bloke ')$q$, al)) is null, 'approved as an FNG';
  assert (select approval = 'approved' and status = 'fng' and fng_started_on = private.club_date() from members where id = al), 'they''re in';
  assert (select votes_for = 7 and votes_against = 0 and votes_abstained = 1 and note = 'Good bloke' and outcome = 'approved'
          from member_decisions where member_id = al), 'tally kept';
  assert pg_temp.value_as(al, 'select count(*) from public.member_decisions') = '0', 'not even them: the tally and note are the board''s';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a3', 'select count(*) from public.member_decisions') = '0', 'other members don''t';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a5', 'select count(*) from public.member_decisions') = '1', 'the NEC does';
end $$;

\echo 'A 12-month review that says Continue raises the continuation fee, once'
do $$
declare
  sec constant uuid := '00000000-0000-0000-0000-0000000000a1';
  fred constant uuid := '00000000-0000-0000-0000-0000000000a7';
  west uuid := (select id from chapters where slug = 'west');
begin
  assert (select at_months from private.fng_due(fred)) = 12, 'the 12-month review is due';
  -- The continuation fee is half the Full fee (4.11; Jeff, 25 Oct 2026).
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a2', format($q$select public.set_fee_rate(%L, %s, 'full', 15000, %L)$q$, west, private.club_year_of(private.club_date()), private.club_date() + 30)) is null, 'Full fee set';
  assert pg_temp.try_as(sec, format($q$select public.record_fng_review(%L, 12, 'continue', 6, 0, 0, null)$q$, fred)) is null, 'reviewed';
  assert (select count(*) from charges where member_id = fred and kind = 'continuation' and amount_cents = 7500) = 1, 'half the Full fee raised';
  assert (select at_months from private.fng_due(fred)) = 15, 'next is the 15-month review';
  assert pg_temp.try_as(sec, format($q$select public.record_fng_review(%L, 12, 'continue', 6, 0, 0, null)$q$, fred))
    = 'Record the review that’s due.', 'not the same review twice';
end $$;

\echo 'Fees: raised once per member, claims, receipts in order, no overpaying'
do $$
declare
  tre constant uuid := '00000000-0000-0000-0000-0000000000a2';
  rita constant uuid := '00000000-0000-0000-0000-0000000000a3';
  west uuid := (select id from chapters where slug = 'west');
  fy int := private.club_year_of(private.club_date());
  c uuid;
  claim uuid;
  late_claim uuid;
  extra uuid;
  own_claim uuid;
begin
  assert pg_temp.try_as(tre, format($q$select public.set_fee_rate(%L, %s, 'full', 25000, %L)$q$, west, fy, private.club_date() + 30)) is null, 'full rate';
  assert pg_temp.try_as(tre, format($q$select public.set_fee_rate(%L, %s, 'fng', 15000, %L)$q$, west, fy, private.club_date() + 30)) is null, 'fng rate';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', format($q$select public.set_fee_rate(%L, %s, 'supporter', 5000, %L)$q$, west, fy, private.club_date() + 30)) is null, 'the chapter board sets fees';
  assert pg_temp.try_as(rita, format($q$select public.set_fee_rate(%L, %s, 'full', 1, %L)$q$, west, fy, private.club_date() + 30)) = 'Only that chapter’s board sets its fees.', 'not a member';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a5', format($q$select public.set_fee_rate(%L, %s, 'full', 1, %L)$q$, west, fy, private.club_date() + 30)) = 'Only that chapter’s board sets its fees.', 'not the auditor';
  -- Someone on hiatus doesn't pay.
  insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000b1', 'hank@example.com', now());
  insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus)
  values ('00000000-0000-0000-0000-0000000000b1', west, 'Hank Hiatus', 'Hank', 'full', 'approved', true);
  assert pg_temp.value_as(tre, format('select public.raise_fees(%L, %s)', west, fy)) = '5', 'sec, tre, rita, al and fred, not Hank on hiatus';
  assert pg_temp.value_as(tre, format('select public.raise_fees(%L, %s)', west, fy)) = '0', 'running it again adds nobody';
  select id into c from charges where member_id = rita and kind = 'annual';

  assert pg_temp.value_as(rita, 'select count(*) from public.charges') = '1', 'a member sees their own charges';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a4', 'select count(*) from public.charges') = '0', 'not other members''';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a1', 'select count(*) from public.charges') = '6', 'the board sees the chapter''s';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a5', 'select count(*) from public.charges') = '6', 'so does the auditor';

  claim := pg_temp.value_as(rita, format($q$select public.claim_payment(%L, 10000, %L, 'payid', 'RITA FEES')$q$, c, private.club_date()));
  assert claim is not null, 'claimed $100';
  late_claim := pg_temp.value_as(rita, format($q$select public.claim_payment(%L, 15000, %L, 'payid', 'RITA FEES')$q$, c, private.club_date()));
  assert late_claim is not null, 'claimed the other $150';
  assert pg_temp.try_as(tre, format('select public.confirm_payment(%L)', claim)) is null, 'confirmed';
  assert (select receipt_no from payments where id = claim) = 'W' || lpad((fy % 100)::text, 2, '0') || '-0001', 'first receipt';
  assert pg_temp.try_as(tre, format($q$select public.record_payment(%L, 15000, %L, 'cash', null)$q$, c, private.club_date())) is null, 'the rest in cash';
  assert (select max(receipt_no) from payments where charge_id = c) = 'W' || lpad((fy % 100)::text, 2, '0') || '-0002', 'second receipt';
  -- Money records outlive the person: deleting their account leaves the books whole, against
  -- "Former member" (Delete my account). Undone straight after, as the checks below need Rita.
  begin
    delete from auth.users where id = rita;
    assert (select full_name from members where id = rita) = 'Former member';
    assert (select count(*) from charges where member_id = rita) > 0, 'the charges stay';
    assert (select count(*) from payments where charge_id = c) > 0, 'and the payments';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  -- Nobody deals with money on their own fees.
  assert pg_temp.try_as(tre, format('select public.waive_charge(%L)', (select id from charges where member_id = tre and kind = 'annual'))) = 'Someone else with money rights has to handle your own fees.', 'no self-waive';
  assert pg_temp.try_as(tre, format($q$select public.record_payment(%L, 100, %L, 'cash', null)$q$, (select id from charges where member_id = tre and kind = 'annual'), private.club_date())) = 'Someone else with money rights has to handle your own fees.', 'no self-record';
  own_claim := pg_temp.value_as(tre, format($q$select public.claim_payment(%L, 100, %L, 'payid', 'TRE FEES')$q$, (select id from charges where member_id = tre and kind = 'annual'), private.club_date()));
  assert pg_temp.try_as(tre, format('select public.confirm_payment(%L)', own_claim)) = 'Someone else with money rights has to handle your own fees.', 'no self-confirm';
  assert pg_temp.try_as(tre, format('select public.reject_payment(%L)', own_claim)) = 'Someone else with money rights has to handle your own fees.', 'no self-reject';
  -- Numbers carry on from the highest issued, so a gap in the book can never cause a repeat.
  update payments set receipt_no = replace(receipt_no, '-0001', '-0007') where receipt_no like '%-0001';
  extra := pg_temp.value_as(tre, format($q$select public.raise_charge(%L, 'Patches', 2000, %L)$q$, '00000000-0000-0000-0000-0000000000a1', private.club_date() + 30));
  assert pg_temp.try_as(tre, format($q$select public.record_payment(%L, 2000, %L, 'cash', null)$q$, extra, private.club_date())) is null, 'patches paid';
  assert (select receipt_no from payments where charge_id = extra) = 'W' || lpad((fy % 100)::text, 2, '0') || '-0008', 'after the highest, not a repeat';
  assert pg_temp.try_as(tre, format('select public.confirm_payment(%L)', late_claim)) = 'That’s more than they owe.', 'the old claim would overpay';
  assert pg_temp.try_as(tre, format('select public.reject_payment(%L)', late_claim)) is null, 'so it''s rejected';
  assert private.owing(c) = 0, 'paid in full';
  assert pg_temp.value_as(rita, 'select count(*) from public.payments') = '3', 'the member sees their payments';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a4', 'select count(*) from public.payments') = '0', 'others don''t';
  assert pg_temp.value_as(rita, $q$select jsonb_array_length(public.members_money()->'charges')$q$) = '1', 'members_money follows the same rules';
end $$;

\echo 'Fee rates and PayID details are for members only'
do $$
begin
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a2', $q$select public.set_payment_details((select id from public.chapters where slug = 'west'), ' rustnuts@example.com ', 'Rustnuts SMC', null, null)$q$) is null, 'set';
  assert (select payid from payment_details) = 'rustnuts@example.com', 'trimmed';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a4', 'select count(*) from public.payment_details') = '1', 'a member sees them';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a8', 'select count(*) from public.payment_details') = '0', 'a stranger doesn''t';
  assert pg_temp.value_as(null, 'select count(*) from public.fee_rates') is null, 'nor the public';
  assert pg_temp.value_as(null, 'select public.members_money()') is null, 'anon can''t call members_money';
end $$;

\echo 'Fees run AGM to AGM; a Full member patched partway through pays pro rata'
do $$
declare
  west uuid := (select id from chapters where slug = 'west');
  north uuid := (select id from chapters where slug = 'north');
  chair uuid := '00000000-0000-0000-0000-0000000000c1';
  yr int := private.club_year_of(private.club_date());
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (chair, 'chair@example.com', now()),
    ('00000000-0000-0000-0000-0000000000c2', 'newbie@example.com', now()),
    ('00000000-0000-0000-0000-0000000000c3', 'nomad@example.com', now()),
    ('00000000-0000-0000-0000-0000000000c4', 'resting@example.com', now());
  insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus) values
    (chair, west, 'Charlie Chair', 'Chair', 'full', 'approved', false),
    ('00000000-0000-0000-0000-0000000000c2', north, 'Nell Newbie', 'Nell', 'fng', 'approved', false),
    ('00000000-0000-0000-0000-0000000000c3', north, 'Norm Nomad', 'Norm', 'nomad', 'approved', false),
    ('00000000-0000-0000-0000-0000000000c4', north, 'Rhys Resting', 'Rhys', 'fng', 'approved', true);
  insert into positions (member_id, chapter_id, role, started_on) values (chair, null, 'nec_chair', date '2025-01-01');

  -- The club year, assuming 1 August until an AGM is recorded.
  assert private.agm_on(2030) = date '2030-08-01', 'assumed 1 August';
  assert private.club_year_of(date '2030-07-31') = 2029 and private.club_year_of(date '2030-08-01') = 2030, 'by the assumed AGM';
  assert pg_temp.try_as('00000000-0000-0000-0000-0000000000a2', $q$select public.record_agm('2031-08-20')$q$) = 'Only the National Chairman or Secretary records the AGM.', 'not a treasurer';
  assert pg_temp.try_as(chair, $q$select public.record_agm('2031-08-20')$q$) is null, 'the chairman records it';
  assert pg_temp.try_as(chair, $q$select public.record_agm('2031-08-25')$q$) is null, 'and can correct it';
  assert (select count(*) from agms where year = 2031) = 1 and private.agm_on(2031) = date '2031-08-25', 'one AGM a year, corrected';
  assert private.club_year_of(date '2031-08-24') = 2030 and private.club_year_of(date '2031-08-25') = 2031, 'by the recorded AGM';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a4', $q$select jsonb_array_length(public.members_money()->'agms')$q$) = '1', 'members see it';
  assert pg_temp.value_as('00000000-0000-0000-0000-0000000000a8', 'select count(*) from public.agms') = '0', 'a stranger doesn''t';

  -- Pro rata: whole months left, counting the month patched, to the nearest dollar.
  assert private.pro_rata_months(date '2031-10-15', 2031) = 10, 'October to August';
  assert private.pro_rata_months(date '2031-08-25', 2031) = 12 and private.pro_rata_months(date '2031-08-28', 2031) = 12, 'the AGM day and month are a full year';
  assert private.pro_rata_months(date '2020-01-01', 2031) = 12, 'patched before the year';
  assert private.pro_rata_months(date '2032-08-05', 2031) = 0, 'patched after the year ended';
  insert into agms (year, held_on) values (2032, date '2032-07-25');
  assert private.pro_rata_months(date '2031-08-28', 2031) = 12 and private.pro_rata_months(date '2031-10-15', 2031) = 9, 'an earlier next AGM';
  assert pg_temp.try_as(chair, $q$select public.record_agm('2033-06-30')$q$) = 'The AGM is held between July and December.', 'not before July';
  assert private.pro_rata_cents(36000, 10) = 30000 and private.pro_rata_cents(10000, 10) = 8300 and private.pro_rata_cents(36000, 12) = 36000, 'cents';

  -- Raising fees: pro rata for someone patched this club year, the full year for everyone else.
  update members set patched_on = make_date(yr, 10, 15) where id = '00000000-0000-0000-0000-0000000000a4';
  assert pg_temp.try_as(chair, format($q$select public.set_fee_rate(%L, %s, 'full', 36000, %L)$q$, north, yr, make_date(yr, 12, 31))) is null, 'north full rate';
  assert pg_temp.value_as(chair, format('select public.raise_fees(%L, %s)', north, yr)) = '2', 'Ned and Audrey, not Norm (no Nomad rate)';
  assert (select (amount_cents, description) = (30000, 'Pro rata, 10 of 12 months') from charges where member_id = '00000000-0000-0000-0000-0000000000a4' and fy = yr), 'Ned, pro rata';
  assert (select (amount_cents, description) is not distinct from (36000, null::text) from charges where member_id = '00000000-0000-0000-0000-0000000000a5' and fy = yr), 'Audrey, the full year';

  -- Being patched in later adds the fee once; not from Nomad, and not on hiatus.
  update members set status = 'full', patched_on = make_date(yr, 10, 15) where id = '00000000-0000-0000-0000-0000000000c2';
  -- From the day they become Full, whatever patched_on says (a reinstated member keeps their old one).
  assert (select (amount_cents, description is not distinct from private.pro_rata_note(private.pro_rata_months(private.club_date(), yr)), due_on >= private.club_date() + 30)
                 = (private.pro_rata_cents(36000, private.pro_rata_months(private.club_date(), yr)), true, true)
          from charges where member_id = '00000000-0000-0000-0000-0000000000c2' and fy = yr and kind = 'annual'), 'patch-in fee, pro rata from today';
  update members set status = 'supporter' where id = '00000000-0000-0000-0000-0000000000c2';
  update members set status = 'full' where id = '00000000-0000-0000-0000-0000000000c2';
  assert (select count(*) from charges where member_id = '00000000-0000-0000-0000-0000000000c2') = 1, 'once';
  update members set status = 'full' where id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4');
  assert (select count(*) from charges where member_id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4')) = 0, 'not from Nomad or on hiatus';
end $$;
