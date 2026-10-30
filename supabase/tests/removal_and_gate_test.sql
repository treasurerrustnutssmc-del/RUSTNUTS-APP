-- Checks the last two of Jeff's decisions from the 29 Oct 2026 launch audit (the report lists them
-- as M5 and L2): a role holder steps down whenever they like, but ending someone else's term needs
-- a carried removal vote of the right shape (9.3: two-thirds of the chapter's Full Members for a
-- board seat, a board majority for any other chapter role); and moving an FNG, Full Member or
-- Nomad to Supporter follows a decided 5.5 notice unless it's at the member's request, with every
-- status change recorded. See docs/superpowers/specs/2026-10-29-audit-decisions-design.md.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- f1 Nell Chair (North Full, National Chairman, no board seat), f2 Wes President (West),
-- f3 Nora President (North), f4 Fred Full (West, Founder honour), f5 Will Full (West, no seat),
-- f6 Ned North (North Full, no seat), f7 Tess Secretary (West), f8 Sam Supporter (West),
-- f9 Al Applicant (West, pending), f10 Tom Gunner (West Full, Tail Gunner), f11 Tina Treasurer
-- (West), f12 Ann Auditor (North Full, National Auditor), f13 Fay FNG (West), f14 Vic VP (West
-- Vice President). West's board: f2, f7, f11, f14. West's Full Members: f2, f4, f5, f7, f10, f11, f14.
create function pg_temp.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid
$$;

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.f(n), 'f' || n || '@example.com', now() from generate_series(1, 14) n;

insert into members (id, chapter_id, full_name, status, approval, fng_started_on)
select pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.name, v.status::member_status, v.approval::approval_state, v.fng::date
from (values
  (1, 'north', 'Nell Chair', 'full', 'approved', null),
  (2, 'west', 'Wes President', 'full', 'approved', null),
  (3, 'north', 'Nora President', 'full', 'approved', null),
  (4, 'west', 'Fred Full', 'full', 'approved', null),
  (5, 'west', 'Will Full', 'full', 'approved', null),
  (6, 'north', 'Ned North', 'full', 'approved', null),
  (7, 'west', 'Tess Secretary', 'full', 'approved', null),
  (8, 'west', 'Sam Supporter', 'supporter', 'approved', null),
  (9, 'west', 'Al Applicant', 'introduced', 'pending', null),
  (10, 'west', 'Tom Gunner', 'full', 'approved', null),
  (11, 'west', 'Tina Treasurer', 'full', 'approved', null),
  (12, 'north', 'Ann Auditor', 'full', 'approved', null),
  (13, 'west', 'Fay FNG', 'fng', 'approved', '2026-01-10'),
  (14, 'west', 'Vic VP', 'full', 'approved', null)
) as v(n, ch, name, status, approval, fng);

insert into positions (id, member_id, chapter_id, role, started_on)
select pg_temp.f(100 + v.n), pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.role::position_role, '2026-08-01'
from (values
  (1, null, 'nec_chair'),
  (2, 'west', 'president'),
  (3, 'north', 'president'),
  (7, 'west', 'secretary'),
  (10, 'west', 'tail_gunner'),
  (11, 'west', 'treasurer'),
  (12, null, 'nec_auditor'),
  (14, 'west', 'vice_president')
) as v(n, ch, role);
insert into positions (id, member_id, chapter_id, role, started_on) values (pg_temp.f(199), pg_temp.f(4), null, 'founder', '2019-09-14');

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

create function pg_temp.west() returns uuid language sql stable as $$ select id from chapters where slug = 'west' $$;
create function pg_temp.end_it(p uuid) returns text language sql stable as $$ select format('select public.end_position(%L)', p) $$;
-- A removal vote: the chapter's vote about a role holder (9.3).
create function pg_temp.removal(subject uuid, role text, electorate text, threshold text, quorum int) returns text language sql stable as $$
  select format($q$select public.open_vote(%L, null, %L, 'Remove them?', null, %L, %L, false, %s, now() + interval '7 days', %L)$q$,
    pg_temp.west(), subject, electorate, threshold, quorum, role)
$$;
create function pg_temp.vote_yes(v uuid, who uuid[]) returns void language plpgsql as $$
declare w uuid;
begin
  foreach w in array who loop
    assert pg_temp.try_as(w, format('select public.cast_ballot(%L, %L)', v, 'yes')) is null, 'a yes ballot from ' || w;
  end loop;
end $$;

\echo 'Stepping down is free; the honours and the Chairman''s seat are not ended here (9.3)'
do $$
begin
  assert pg_temp.try_as(pg_temp.f(14), pg_temp.end_it(pg_temp.f(114))) is null, 'the Vice President steps down';
  assert (select ended_on from positions where id = pg_temp.f(114)) = private.club_date(), 'ended today';
  assert (select ended_by from positions where id = pg_temp.f(114)) = pg_temp.f(14), 'by themselves';
  assert pg_temp.try_as(pg_temp.f(12), pg_temp.end_it(pg_temp.f(112))) is null, 'the Auditor steps down too';
  assert pg_temp.try_as(pg_temp.f(1), pg_temp.end_it(pg_temp.f(101)))
    = 'The National Chairman changes after the vote, and the club’s admin records it.', 'not the Chairman''s seat';
  assert pg_temp.try_as(pg_temp.f(4), pg_temp.end_it(pg_temp.f(199))) = 'Founder is an honour the club’s admin records.', 'not an honour';
  assert pg_temp.try_as(pg_temp.f(14), pg_temp.end_it(pg_temp.f(114))) = 'That term has already ended.', 'once';
end $$;

\echo 'Ending someone else''s chapter role takes a carried board majority vote (9.3)'
do $$
declare v uuid;
begin
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.end_it(pg_temp.f(110)))
    = 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).', 'no vote yet';
  assert pg_temp.try_as(pg_temp.f(3), pg_temp.end_it(pg_temp.f(110))) = 'Only that chapter’s board can end this term.', 'not North''s President';
  assert pg_temp.try_as(pg_temp.f(5), pg_temp.end_it(pg_temp.f(110))) = 'Only that chapter’s board can end this term.', 'not a plain member';
  -- The vote has to be the right shape, about someone who holds the role here.
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(10), 'tail_gunner', 'chapter_patched', 'two_thirds', 4))
    = 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).', 'wrong electorate';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(10), 'tail_gunner', 'chapter_board', 'two_thirds', 3))
    = 'Removing someone from a chapter role is a majority vote of the chapter board (9.3).', 'wrong threshold';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(4), 'secretary', 'chapter_patched', 'two_thirds', 4))
    = 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).', 'Fred isn''t Secretary';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(6), 'tail_gunner', 'chapter_board', 'majority', 3))
    = 'A removal vote is about a Full Member or Nomad who holds that role in this chapter (9.3).', 'Ned is North''s';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(null, 'tail_gunner', 'chapter_board', 'majority', 3))
    = 'A removal vote is the chapter’s vote about one of its own role holders (9.3).', 'a role needs its holder';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(10), 'nec_auditor', 'chapter_board', 'majority', 3))
    = 'A vote for a national seat is the NEC’s vote about a Full Member (11.6, 11.8).', 'national seats are the NEC''s';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.open_vote(null, null, %L, 'Remove?', null, 'nec', 'majority', false, 2, now() + interval '7 days', 'tail_gunner')$q$, pg_temp.f(10)))
    = 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).', 'the NEC doesn''t remove chapter roles';
  assert pg_temp.try_as(pg_temp.f(3), pg_temp.removal(pg_temp.f(10), 'tail_gunner', 'chapter_board', 'majority', 3))
    = 'Only that chapter’s board can do that.', 'another chapter''s President can''t open it';
  -- The right shape, carried by the board (f2, f7 and f11 now Vic has stepped down).
  v := pg_temp.value_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(10), 'tail_gunner', 'chapter_board', 'majority', 3))::uuid;
  assert (select count(*) from vote_electors where vote_id = v) = 3, 'the board votes';
  assert (select subject_role::text from votes where id = v) = 'tail_gunner', 'the vote names the role';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.has_carried_removal_vote(%L)', pg_temp.f(110))) = 'false', 'not carried yet';
  perform pg_temp.vote_yes(v, array[pg_temp.f(2), pg_temp.f(7), pg_temp.f(11)]);
  assert pg_temp.try_as(pg_temp.f(7), format('select public.close_vote(%L, null)', v)) is null, 'closed';
  assert (select result::text from votes where id = v) = 'carried', 'carried';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.has_carried_removal_vote(%L)', pg_temp.f(110))) = 'true', 'carried for this term';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.has_carried_removal_vote(%L)', pg_temp.f(111))) = 'false', 'not for another';
  assert pg_temp.try_as(pg_temp.f(5), pg_temp.end_it(pg_temp.f(110))) = 'Only that chapter’s board can end this term.', 'still the board''s to record';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.end_it(pg_temp.f(110))) is null, 'the board ends the term after the vote';
  assert (select ended_by from positions where id = pg_temp.f(110)) = pg_temp.f(7), 'recorded by Tess';
end $$;

\echo 'Removing a board member takes two-thirds of the chapter''s Full Members (9.3)'
do $$
declare v uuid;
begin
  assert pg_temp.try_as(pg_temp.f(2), pg_temp.end_it(pg_temp.f(111)))
    = 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).', 'no vote yet';
  assert pg_temp.try_as(pg_temp.f(2), pg_temp.removal(pg_temp.f(11), 'treasurer', 'chapter_board', 'majority', 3))
    = 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).', 'not the board alone';
  assert pg_temp.try_as(pg_temp.f(2), pg_temp.removal(pg_temp.f(11), 'treasurer', 'chapter_patched', 'majority', 4))
    = 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).', 'not a bare majority';
  v := pg_temp.value_as(pg_temp.f(2), pg_temp.removal(pg_temp.f(11), 'treasurer', 'chapter_patched', 'two_thirds', 4))::uuid;
  assert (select count(*) from vote_electors where vote_id = v) = 7, 'every West Full Member votes, Tina included';
  perform pg_temp.vote_yes(v, array[pg_temp.f(2), pg_temp.f(4), pg_temp.f(5), pg_temp.f(7), pg_temp.f(10), pg_temp.f(14)]);
  assert pg_temp.try_as(pg_temp.f(11), format('select public.cast_ballot(%L, %L)', v, 'no')) is null, 'Tina votes no';
  assert pg_temp.try_as(pg_temp.f(2), format('select public.close_vote(%L, null)', v)) is null, 'closed';
  assert (select result::text from votes where id = v) = 'carried', 'six of seven';
  assert (select yes_count || '/' || no_count from votes where id = v) = '6/1', 'a removal vote keeps its counts; only a patch vote hides them (4.9)';
  assert pg_temp.try_as(pg_temp.f(1), pg_temp.end_it(pg_temp.f(111))) = 'Only that chapter’s board can end this term.', 'the Chairman doesn''t record a chapter''s removal';
  assert pg_temp.try_as(pg_temp.f(2), pg_temp.end_it(pg_temp.f(111))) is null, 'the President records it';
end $$;

\echo 'A President goes after the same vote, recorded by the board or an NEC officer (9.3)'
do $$
declare v uuid;
begin
  assert pg_temp.try_as(pg_temp.f(1), pg_temp.end_it(pg_temp.f(102)))
    = 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).', 'the Chairman needs the vote';
  assert pg_temp.try_as(pg_temp.f(7), pg_temp.end_it(pg_temp.f(102)))
    = 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).', 'so does the board';
  assert pg_temp.try_as(pg_temp.f(5), pg_temp.end_it(pg_temp.f(102)))
    = 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.', 'not a plain member';
  assert pg_temp.try_as(pg_temp.f(3), pg_temp.end_it(pg_temp.f(102)))
    = 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.', 'not another President';
  v := pg_temp.value_as(pg_temp.f(7), pg_temp.removal(pg_temp.f(2), 'president', 'chapter_patched', 'two_thirds', 4))::uuid;
  perform pg_temp.vote_yes(v, array[pg_temp.f(4), pg_temp.f(5), pg_temp.f(7), pg_temp.f(10), pg_temp.f(11), pg_temp.f(14)]);
  assert pg_temp.try_as(pg_temp.f(2), format('select public.cast_ballot(%L, %L)', v, 'abstain')) is null, 'Wes abstains';
  assert pg_temp.try_as(pg_temp.f(7), format('select public.close_vote(%L, null)', v)) is null, 'closed';
  assert (select result::text from votes where id = v) = 'carried', 'carried';
  assert pg_temp.try_as(pg_temp.f(1), pg_temp.end_it(pg_temp.f(102))) is null, 'the Chairman records it';
  assert (select ended_on from positions where id = pg_temp.f(102)) = private.club_date(), 'ended today';
end $$;

\echo 'Moving to Supporter follows a decided 5.5 notice, unless it''s at the member''s request (L2)'
do $$
declare
  set_it text := 'select public.set_member_status(%L, %L)';
  set_req text := 'select public.set_member_status(%L, %L, true)';
  gate text := 'Moving them to Supporter follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
  n_old uuid := gen_random_uuid();
  n_new uuid := gen_random_uuid();
begin
  assert (select count(*) from pg_proc where proname = 'set_member_status' and pronamespace = 'public'::regnamespace) = 1, 'one set_member_status';
  assert pg_temp.try_as(pg_temp.f(7), format(set_it, pg_temp.f(5), 'supporter')) = gate, 'a Full Member, no notice';
  assert pg_temp.try_as(pg_temp.f(7), format(set_it, pg_temp.f(13), 'supporter')) = gate, 'an FNG, no notice';
  assert pg_temp.try_as(pg_temp.f(7), format(set_req, pg_temp.f(5), 'supporter')) is null, 'at Will''s request';
  assert (select status::text from members where id = pg_temp.f(5)) = 'supporter', 'Will is a Supporter';
  assert (select by_request || '/' || coalesce(notice_id::text, 'none') || '/' || from_status || '/' || to_status
          from status_changes where member_id = pg_temp.f(5)) = 'true/none/full/supporter', 'recorded as his request';
  -- A decided notice in the last 90 days opens the gate; an old one doesn't.
  insert into status_notices (id, member_id, chapter_id, about, record, proposal, given_on, respond_by, given_by, outcome, closed_on, closed_by)
  values (n_new, pg_temp.f(4), pg_temp.west(), 'attendance', 'Missed the year', 'Supporter', private.club_date() - 30, private.club_date() - 16, pg_temp.f(7), 'decided', private.club_date() - 10, pg_temp.f(7)),
         (n_old, pg_temp.f(10), pg_temp.west(), 'dues', 'Unpaid', 'Supporter', private.club_date() - 130, private.club_date() - 116, pg_temp.f(7), 'decided', private.club_date() - 100, pg_temp.f(7));
  assert pg_temp.try_as(pg_temp.f(7), format(set_it, pg_temp.f(4), 'supporter')) is null, 'after the notice';
  assert (select notice_id from status_changes where member_id = pg_temp.f(4)) = n_new, 'the notice is on the record';
  assert pg_temp.try_as(pg_temp.f(7), format(set_it, pg_temp.f(10), 'supporter')) = gate, 'a 100-day-old notice is stale';
  -- Other moves aren't gated, and are recorded too.
  assert pg_temp.try_as(pg_temp.f(7), format(set_it, pg_temp.f(8), 'fng')) is null, 'a Supporter becomes an FNG';
  assert (select by_request || '/' || from_status || '/' || to_status from status_changes where member_id = pg_temp.f(8)) = 'false/supporter/fng', 'recorded';
  assert pg_temp.try_as(pg_temp.f(1), format(set_it, pg_temp.f(5), 'supporter')) = 'Only that chapter’s board can change this member’s status.', 'the gate sits behind the board gate';
end $$;

\echo 'Status changes are read by the member, their board, the national roles and the Auditor'
do $$
declare who uuid;
begin
  assert pg_temp.value_as(pg_temp.f(5), 'select count(*) from status_changes') = '1', 'Will sees his own';
  assert pg_temp.value_as(pg_temp.f(4), 'select count(*) from status_changes') = '1', 'Fred his';
  assert pg_temp.value_as(pg_temp.f(6), 'select count(*) from status_changes') = '0', 'a North member sees none of West''s';
  assert pg_temp.value_as(pg_temp.f(12), 'select count(*) from status_changes') = '0', 'Ann, who stepped down as Auditor, sees none';
  -- Ann is seated as Auditor again (the admin records it), so the Auditor's read is checked.
  insert into positions (id, member_id, chapter_id, role, started_on) values (pg_temp.f(198), pg_temp.f(12), null, 'nec_auditor', private.club_date());
  foreach who in array array[pg_temp.f(7), pg_temp.f(1), pg_temp.f(3), pg_temp.f(12)] loop
    assert pg_temp.value_as(who, 'select count(*) from status_changes') = '3', 'the board, the national roles and the Auditor see all three';
  end loop;
  assert pg_temp.value_as(pg_temp.f(2), 'select count(*) from status_changes') = '0', 'Wes, off the board since the vote, sees none';
  assert pg_temp.try_as(null, 'select count(*) from status_changes') is not null, 'anon is refused';
  assert pg_temp.try_as(pg_temp.f(2), format($q$insert into status_changes (member_id, chapter_id, from_status, to_status) values (%L, (select id from public.chapters where slug = 'west'), 'full', 'supporter')$q$, pg_temp.f(5)))
    = 'permission denied for table status_changes', 'no direct writes';
end $$;

\echo 'REMOVAL AND GATE CHECKS PASSED'
