-- Checks meetings, minutes, action items and votes: who sees what through club_business(), every
-- action allowed and refused (with the app's words), the electorate snapshot, secret ballots and
-- the close results. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- a1 West President and National Chairman, a2 West Secretary, a3 West Full (no seat), a4 West FNG,
-- a5 West Legacy, a6 North President (so NEC), a7 North Full, a8 applicant, a9 signed in, no record.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'a' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'west', 'Wes President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'west', 'Sue Secretary', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a3', 'west', 'Fred Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a4', 'west', 'Fran FNG', 'fng', 'approved'),
  ('00000000-0000-0000-0000-0000000000a5', 'west', 'Len Legacy', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000a6', 'north', 'Nora President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a7', 'north', 'Ned North', 'nomad', 'approved'),
  ('00000000-0000-0000-0000-0000000000a8', 'west', 'Al Applicant', 'introduced', 'pending')
) as v(id, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on)
values
  ('00000000-0000-0000-0000-0000000000a1', (select id from chapters where slug = 'west'), 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000a1', null, 'nec_chair', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000a2', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000a6', (select id from chapters where slug = 'north'), 'president', '2025-08-16');

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

-- Runs an expression as a user and returns its value (as text).
create function pg_temp.value_as(who uuid, expr text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  execute 'select (' || expr || ')::text' into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function pg_temp.business_as(who uuid) returns jsonb language sql as $$
  select pg_temp.value_as(who, 'public.club_business()')::jsonb
$$;

create function pg_temp.west() returns uuid language sql as $$ select id from chapters where slug = 'west' $$;
create function pg_temp.north() returns uuid language sql as $$ select id from chapters where slug = 'north' $$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000a' || n)::uuid $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.business_as(uuid),
  pg_temp.west(), pg_temp.north(), pg_temp.u(int) to anon, authenticated;

\o
\echo 'Nobody reaches the tables directly'
do $$
declare t text;
begin
  foreach t in array array['meetings', 'action_items', 'votes', 'vote_electors', 'vote_ballots'] loop
    assert pg_temp.try_as(pg_temp.u(1), format('select count(*) from public.%I', t)) is not null, 'read ' || t;
    assert pg_temp.try_as(null, format('select count(*) from public.%I', t)) is not null, 'anon read ' || t;
  end loop;
  assert pg_temp.try_as(pg_temp.u(1), $q$insert into public.meetings (kind, title, starts_at) values ('general', 'x', now())$q$) is not null,
    'write a meeting directly';
  assert pg_temp.try_as(null, $q$select public.club_business()$q$) is not null, 'anon can''t call club_business';
end $$;

\echo 'Meetings: saving, refusing, and who sees them'
do $$
declare
  board uuid; general uuid; nec uuid; r jsonb;
  agenda_in constant jsonb := '[{"title": "Treasurer''s report", "notes": null}, {"title": "  Christmas ride ", "notes": " Lunch? "}]';
begin
  -- Refusals, in the app's words.
  assert pg_temp.try_as(pg_temp.u(9), format($q$select public.save_meeting(null, %L, 'board', 'x', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'Only approved members can do that.', 'no record';
  assert pg_temp.try_as(pg_temp.u(8), format($q$select public.save_meeting(null, %L, 'board', 'x', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.save_meeting(null, %L, 'board', 'x', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'Only that chapter’s board can do that.', 'member';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.save_meeting(null, null, 'nec', 'x', now() + interval '1 day', null, '[]')$q$)
    = 'Only the NEC can do that.', 'chapter board, whole club';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting(null, %L, 'board', '  ', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'Give the meeting a title.', 'title';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting(null, %L, 'board', 'x', null, null, '[]')$q$, pg_temp.west()))
    = 'Pick a date and time.', 'start';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting(null, %L, 'nec', 'x', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'That kind of meeting doesn’t fit here.', 'nec in a chapter';
  assert pg_temp.try_as(pg_temp.u(6), $q$select public.save_meeting(null, null, 'board', 'x', now() + interval '1 day', null, '[]')$q$)
    = 'That kind of meeting doesn’t fit here.', 'board for the whole club';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting(null, %L, 'board', 'x', now() + interval '1 day', null, '[{"title": " ", "notes": "x"}]')$q$, pg_temp.west()))
    = 'Each agenda item needs a title.', 'agenda title';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_meeting(gen_random_uuid(), %L, 'board', 'x', now() + interval '1 day', null, '[]')$q$, pg_temp.west()))
    = 'No such meeting.', 'missing';

  board := pg_temp.value_as(pg_temp.u(2), format($q$public.save_meeting(null, %L, 'board', 'Board meeting', now() + interval '3 days', 'Clubhouse', %L)$q$, pg_temp.west(), agenda_in))::uuid;
  general := pg_temp.value_as(pg_temp.u(2), format($q$public.save_meeting(null, %L, 'general', 'General meeting', now() - interval '2 days', null, '[]')$q$, pg_temp.west()))::uuid;
  nec := pg_temp.value_as(pg_temp.u(6), $q$public.save_meeting(null, null, 'nec', 'NEC', now() + interval '5 days', null, '[]')$q$)::uuid;
  assert (select agenda from meetings where id = board) = '[{"title": "Treasurer''s report", "notes": null}, {"title": "Christmas ride", "notes": "Lunch?"}]'::jsonb,
    'agenda stored trimmed, in order';
  assert (select created_by from meetings where id = board) = pg_temp.u(2), 'created by';

  -- Editing keeps the scope rules: North's President can edit West's (NEC reaches every chapter); a West member can't.
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.save_meeting(%L, %L, 'board', 'Board meeting (moved)', now() + interval '4 days', null, '[]')$q$, board, pg_temp.west())) is null, 'NEC edits';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.save_meeting(%L, %L, 'board', 'Mine', now(), null, '[]')$q$, board, pg_temp.west()))
    = 'Only that chapter’s board can do that.', 'member edits';

  -- Who sees them.
  r := pg_temp.business_as(pg_temp.u(3))->'meetings';
  assert jsonb_array_length(r) = 1 and r->0->>'id' = general::text, 'a member sees only the general meeting';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(7))->'meetings') = 1, 'North sees West''s general meeting';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(5))->'meetings') = 1, 'Legacy too';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(8))->'meetings') = 0, 'applicants see nothing';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(2))->'meetings') = 2, 'the West board sees its own and general, not the NEC''s';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(1))->'meetings') = 3, 'the NEC sees all three';

  -- Cancelling.
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.cancel_meeting(%L)$q$, general)) = 'That meeting has already started.', 'started';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cancel_meeting(%L)$q$, board)) = 'Only that chapter’s board can do that.', 'member cancels';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.cancel_meeting(%L)$q$, nec)) = 'Only the NEC can do that.', 'chapter board cancels NEC';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.cancel_meeting(%L)$q$, nec)) is null, 'cancelled';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.cancel_meeting(%L)$q$, nec)) = 'That meeting was cancelled.', 'twice';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.save_minutes(%L, 'x')$q$, nec)) = 'That meeting was cancelled.', 'minutes on a cancelled meeting';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.save_meeting(%L, null, 'nec', 'NEC', now() + interval '5 days', null, '[]')$q$, nec))
    = 'That meeting was cancelled.', 'edit a cancelled meeting';
end $$;

\echo 'Minutes: drafted by the board, approved after the meeting, then locked and shared'
do $$
declare general uuid := (select id from meetings where kind = 'general'); board uuid := (select id from meetings where kind = 'board'); r jsonb;
begin
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.save_minutes(%L, 'x')$q$, general)) = 'Only that chapter’s board can do that.', 'member writes';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_minutes(%L)$q$, general)) = 'Write the minutes first.', 'blank';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_minutes(%L, 'All present. Christmas ride booked.')$q$, general)) is null, 'drafted';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_minutes(%L, 'Agenda notes')$q$, board)) is null, 'notes ahead of a meeting';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_minutes(%L)$q$, board)) = 'The meeting hasn’t happened yet.', 'too early';

  r := pg_temp.business_as(pg_temp.u(3))->'meetings'->0;
  assert r->'minutes' = 'null'::jsonb, 'members don''t see the draft';
  assert pg_temp.business_as(pg_temp.u(2))->'meetings' @> jsonb_build_array(jsonb_build_object('id', general, 'minutes', 'All present. Christmas ride booked.')),
    'the board does';

  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_minutes(%L)$q$, general)) is null, 'approved';
  assert (select minutes_approved_by from meetings where id = general) = pg_temp.u(2), 'approved by';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_minutes(%L, 'Changed')$q$, general)) = 'Those minutes are approved and locked.', 'locked';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.approve_minutes(%L)$q$, general)) = 'Those minutes are approved and locked.', 'approve twice';
  assert pg_temp.business_as(pg_temp.u(3))->'meetings'->0->>'minutes' = 'All present. Christmas ride booked.', 'members see approved minutes';
end $$;

\echo 'Action items: added by the board, seen and ticked by their owner'
do $$
declare general uuid := (select id from meetings where kind = 'general'); item uuid;
begin
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.save_action_item(null, %L, null, 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(3)))
    = 'Only that chapter’s board can do that.', 'member adds';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(null, %L, gen_random_uuid(), 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(3)))
    = 'No such meeting.', 'missing meeting';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.save_action_item(null, null, %L, 'x', %L, null)$q$, general, pg_temp.u(7)))
    = 'No such meeting.', 'an item belongs to its meeting''s chapter';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(null, %L, null, ' ', %L, null)$q$, pg_temp.west(), pg_temp.u(3)))
    = 'Give the action item a title.', 'title';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(null, %L, null, 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(7)))
    = 'Pick an approved member of this chapter.', 'North owner';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(null, %L, null, 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(5)))
    = 'Pick an approved member of this chapter.', 'Legacy owner';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(null, %L, null, 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(8)))
    = 'Pick an approved member of this chapter.', 'applicant owner';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(gen_random_uuid(), %L, null, 'x', %L, null)$q$, pg_temp.west(), pg_temp.u(3)))
    = 'No such action item.', 'missing item';

  item := pg_temp.value_as(pg_temp.u(2), format($q$public.save_action_item(null, %L, %L, ' Book the hall ', %L, '2026-11-20')$q$, pg_temp.west(), general, pg_temp.u(3)))::uuid;
  assert (select title from action_items where id = item) = 'Book the hall', 'trimmed';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(3))->'action_items') = 1, 'the owner sees it';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(4))->'action_items') = 0, 'another member doesn''t';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(2))->'action_items') = 1, 'the board does';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(7))->'action_items') = 0, 'nor does North';

  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.set_action_done(%L, true)$q$, item)) = 'Only the owner or the board can tick this off.', 'other member';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.set_action_done(gen_random_uuid(), true)$q$)) = 'No such action item.', 'missing';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.set_action_done(%L, true)$q$, item)) is null, 'owner ticks';
  assert (select done_on from action_items where id = item) = private.club_date(), 'done today';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.set_action_done(%L, false)$q$, item)) is null, 'board unticks';
  assert (select done_on from action_items where id = item) is null, 'not done';
  -- Editing keeps the item's own chapter and meeting.
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.save_action_item(%L, null, null, 'Book the big hall', %L, null)$q$, item, pg_temp.u(4))) is null, 'edited';
  assert (select (title, owner_id, chapter_id, meeting_id) from action_items where id = item) = ('Book the big hall'::text, pg_temp.u(4), pg_temp.west(), general), 'kept its scope';
end $$;

\echo 'Opening votes'
do $$
declare v uuid;
begin
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 1, now() + interval '1 day')$q$, pg_temp.west()))
    = 'Only that chapter’s board can do that.', 'member opens';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.open_vote(null, null, null, 'Q?', null, 'nec', 'majority', false, 1, now() + interval '1 day')$q$)
    = 'Only the NEC can do that.', 'chapter board opens a club vote';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, ' ', null, 'chapter_board', 'majority', false, 1, now() + interval '1 day')$q$, pg_temp.west()))
    = 'Ask a question.', 'question';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'nec', 'majority', false, 1, now() + interval '1 day')$q$, pg_temp.west()))
    = 'That electorate doesn’t fit here.', 'nec in a chapter';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.open_vote(null, null, null, 'Q?', null, 'chapter_patched', 'majority', false, 1, now() + interval '1 day')$q$)
    = 'That electorate doesn’t fit here.', 'chapter electorate for the club';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 3, now() + interval '1 day')$q$, pg_temp.west()))
    = 'Quorum must be between 2 and 2.', 'quorum too high';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 0, now() + interval '1 day')$q$, pg_temp.west()))
    = 'Quorum must be between 2 and 2.', 'quorum zero';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 2, now() - interval '1 minute')$q$, pg_temp.west()))
    = 'Pick a closing time in the future.', 'past';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 2, null)$q$, pg_temp.west()))
    = 'Pick a closing time in the future.', 'no closing time';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 2, now() + interval '61 days')$q$, pg_temp.west()))
    = 'Votes can stay open for 60 days at most.', 'too long';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, %L, 'Patch?', null, 'chapter_patched', 'unanimous', true, 1, now() + interval '1 day')$q$, pg_temp.west(), pg_temp.u(3)))
    = 'A patch vote is for an approved FNG of that chapter.', 'patch a Full member';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, %L, 'Patch?', null, 'chapter_patched', 'majority', false, 1, now() + interval '1 day')$q$, pg_temp.west(), pg_temp.u(4)))
    = 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.', 'patch by majority';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, %L, 'Patch?', null, 'chapter_patched', 'unanimous', false, 1, now() + interval '1 day')$q$, pg_temp.west(), pg_temp.u(4)))
    = 'A patch vote is a secret, unanimous vote of the chapter’s Full Members.', 'patch vote in the open';
  begin
    update members set fng_started_on = private.club_date() - interval '8 months' where id = pg_temp.u(4);
    assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, %L, 'Patch?', null, 'chapter_patched', 'unanimous', true, 1, now() + interval '1 day')$q$, pg_temp.west(), pg_temp.u(4)))
      = 'A patch vote can open only nine months into the FNG’s trial (4.7).', 'too early in the trial';
    update members set fng_started_on = private.club_date() - interval '9 months' where id = pg_temp.u(4);
    assert pg_temp.try_as(pg_temp.u(2), format($q$select public.open_vote(%L, null, %L, 'Patch?', null, 'chapter_patched', 'unanimous', true, 1, now() + interval '1 day')$q$, pg_temp.west(), pg_temp.u(4)))
      is null, 'nine months to the day';
    raise exception 'undo';
  exception when raise_exception then null;
  end;
  -- North has no board seats bar its President; take that away inside a sub-transaction.
  begin
    update positions set ended_on = '2026-01-01' where member_id = pg_temp.u(6);
    assert pg_temp.try_as(pg_temp.u(1), format($q$select public.open_vote(%L, null, null, 'Q?', null, 'chapter_board', 'majority', false, 1, now() + interval '1 day')$q$, pg_temp.north()))
      = 'Nobody can vote in that electorate yet.', 'empty electorate';
    raise exception 'undo';
  exception when raise_exception then null;
  end;

  -- Who gets a ballot (constitution 10.7, 11.2).
  assert (select array_agg(e order by e) from private.electors_for('chapter_patched', pg_temp.north()) e) = array[pg_temp.u(6)],
    'a Nomad doesn''t vote on chapter matters';
  assert pg_temp.u(7) = any(select private.electors_for('club_patched', null)), 'but does on national ones';
  assert (select array_agg(e order by e) from private.electors_for('nec', null) e) = array[pg_temp.u(6)],
    'the NEC: one vote per chapter, cast by its President; West''s President chairs the NEC and West has no VP (11.2)';
  begin
    insert into positions (member_id, chapter_id, role, started_on) values (pg_temp.u(3), pg_temp.west(), 'vice_president', '2026-01-01');
    assert (select array_agg(e order by e) from private.electors_for('nec', null) e) = array[pg_temp.u(3), pg_temp.u(6)],
      'then the Vice President casts West''s vote';
    raise exception 'undo';
  exception when raise_exception then null;
  end;

  -- The electorate is taken when the vote opens: West's Full Members are a1, a2, a3 (not the FNG or Legacy).
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, %L, ' Patch Fran? ', null, 'chapter_patched', 'unanimous', true, 2, now() + interval '7 days')$q$, pg_temp.west(), pg_temp.u(4)))::uuid;
  assert (select array_agg(member_id order by member_id) from vote_electors where vote_id = v) = array[pg_temp.u(1), pg_temp.u(2), pg_temp.u(3)], 'electors';
  assert (select question from votes where id = v) = 'Patch Fran?', 'trimmed';
end $$;

\echo 'Casting ballots on an open vote'
do $$
declare v uuid := (select id from votes where question = 'Patch Fran?'); r jsonb;
begin
  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) = 'You’re not on this vote.', 'the FNG';
  assert pg_temp.try_as(pg_temp.u(3), $q$select public.cast_ballot(gen_random_uuid(), 'yes')$q$) = 'No such vote.', 'missing';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) is null, 'a3 votes';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cast_ballot(%L, 'no')$q$, v)) = 'You’ve already voted.', 'twice';
  assert (select member_id from vote_ballots where vote_id = v) is null, 'a patch vote is secret (4.9)';

  -- A change of status after opening doesn't take the ballot away.
  update members set status = 'legacy' where id = pg_temp.u(1);
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) is null, 'a1 still votes';
  update members set status = 'full' where id = pg_temp.u(1);

  r := pg_temp.business_as(pg_temp.u(3))->'votes'->0;
  assert (r->>'my_voted')::boolean, 'I voted';
  assert jsonb_array_length(r->'voted_ids') = 2 and jsonb_array_length(r->'elector_ids') = 3, 'two of three';
  assert r->'tally' = 'null'::jsonb and r->'ballots' = '[]'::jsonb, 'no counts while open';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(4))->'votes') = 0, 'the subject doesn''t see it';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(7))->'votes') = 0, 'nor does North';
  assert jsonb_array_length(pg_temp.business_as(pg_temp.u(6))->'votes') = 1, 'the NEC does';

  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.close_vote(%L, null)$q$, v)) = 'Only that chapter’s board can do that.', 'member closes';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) = 'Wait until it closes, or until everyone has voted.', 'too early';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'abstain')$q$, v)) is null, 'a2 abstains';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.close_vote(%L, 'yes')$q$, v)) = 'There’s no tie, so no casting vote.', 'casting without a tie';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) is null, 'closed early: everyone voted';
  assert (select result from votes where id = v) = 'lost', 'an abstention isn''t a yes (4.9)';
  assert (select yes_count is null and no_count is null and abstain_count is null from votes where id = v), 'only the outcome is recorded (4.9)';
  assert not exists (select 1 from vote_ballots where vote_id = v), 'and no ballots are kept';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) = 'That vote has already closed.', 'close twice';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) = 'You’ve already voted.', 'already voted beats closed';

  r := pg_temp.business_as(pg_temp.u(3))->'votes'->0;
  assert r->'tally' = 'null'::jsonb, 'no count for a patch vote, even after closing';
  assert r->'ballots' = '[]'::jsonb, 'never who voted which way';

  -- An open vote names its voters once it closes, and unanimous carries on every elector's yes.
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, null, 'Board dinner?', null, 'chapter_board', 'unanimous', false, 2, now() + interval '7 days')$q$, pg_temp.west()))::uuid;
  perform pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  assert (select member_id from vote_ballots where vote_id = v) = pg_temp.u(1), 'an open ballot names its voter';
  perform pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) is null, 'closed';
  assert (select result from votes where id = v) = 'carried', 'every elector said yes';
  r := (select x from jsonb_array_elements(pg_temp.business_as(pg_temp.u(2))->'votes') x where x->>'id' = v::text);
  assert jsonb_array_length(r->'ballots') = 2 and r->'ballots' @> jsonb_build_array(jsonb_build_object('member_id', pg_temp.u(1), 'choice', 'yes')),
    'open ballots after closing';
end $$;

\echo 'A secret ballot can''t be linked to its voter'
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, null, 'New patch design?', null, 'chapter_patched', 'two_thirds', true, 2, now() + interval '7 days')$q$, pg_temp.west()))::uuid;
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cast_ballot(%L, 'no')$q$, v)) is null, 'cast';
  assert (select member_id from vote_ballots where vote_id = v) is null, 'no voter on the ballot';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vote_ballots' and data_type like 'timestamp%'), 'no timestamp to match on';
  assert pg_temp.try_as(pg_temp.u(3), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) = 'You’ve already voted.', 'still only once';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) is null, 'a1';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) is null, 'a2';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) is null, 'closed';
  r := (select x from jsonb_array_elements(pg_temp.business_as(pg_temp.u(3))->'votes') x where x->>'id' = v::text);
  assert r->'tally' = '{"yes": 2, "no": 1, "abstain": 0}'::jsonb, 'counts shown';
  assert r->>'result' = 'carried', 'two of three is two-thirds';
  assert r->'ballots' = '[]'::jsonb, 'but never the ballots';
end $$;

\echo 'Ties, the chair''s casting vote, quorum and closing time'
do $$
declare v uuid;
begin
  -- West board: a1 (President, the chair) and a2. One yes, one no.
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, null, 'Tie?', null, 'chapter_board', 'majority', false, 2, now() + interval '7 days')$q$, pg_temp.west()))::uuid;
  perform pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  perform pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'no')$q$, v));
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) = 'It’s a tie. The chair closes it with the casting vote.', 'needs the chair';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, 'yes')$q$, v)) = 'It’s a tie. The chair closes it with the casting vote.', 'not the chair';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.close_vote(%L, null)$q$, v)) = 'It’s a tie. The chair closes it with the casting vote.', 'chair without a vote';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.close_vote(%L, 'yes')$q$, v)) is null, 'chair casts';
  assert (select (result, casting_vote) from votes where id = v) = ('carried'::vote_result, 'yes'::text), 'carried on the casting vote';

  -- Under quorum, once the closing time has passed.
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, null, 'Quorum?', null, 'chapter_board', 'majority', false, 2, now() + interval '7 days')$q$, pg_temp.west()))::uuid;
  perform pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  update votes set closes_at = now() - interval '1 minute' where id = v;
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v)) = 'That vote has closed.', 'past closing time';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) is null, 'closed after its time';
  assert (select result from votes where id = v) = 'no_quorum', 'no quorum';

  -- With nobody in the chair, a tie is lost.
  v := pg_temp.value_as(pg_temp.u(2), format($q$public.open_vote(%L, null, null, 'No chair?', null, 'chapter_board', 'majority', false, 2, now() + interval '7 days')$q$, pg_temp.west()))::uuid;
  perform pg_temp.try_as(pg_temp.u(1), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  perform pg_temp.try_as(pg_temp.u(2), format($q$select public.cast_ballot(%L, 'no')$q$, v));
  update positions set ended_on = '2026-01-01' where member_id = pg_temp.u(1) and role = 'president';
  begin
    insert into positions (member_id, chapter_id, role, started_on) values (pg_temp.u(3), pg_temp.west(), 'vice_president', '2026-01-01');
    assert private.chair_of(pg_temp.west()) = pg_temp.u(3), 'the Vice President chairs when there''s no President (10.9)';
    raise exception 'undo';
  exception when raise_exception then null;
  end;
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, 'yes')$q$, v)) = 'Nobody’s in the chair, so a tie is lost. Close it without a casting vote.', 'no casting vote without a chair';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.close_vote(%L, null)$q$, v)) is null, 'closes without a chair';
  assert (select result from votes where id = v) = 'lost', 'tie lost';
  update positions set ended_on = null where member_id = pg_temp.u(1) and role = 'president';
end $$;
