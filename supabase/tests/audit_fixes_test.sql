-- Checks the database repairs from the 29 Oct 2026 launch audit: no TRUNCATE for anyone with
-- the app, push tokens forgotten by their owner only, who added a sponsor kept to the board, the
-- stale public helpers gone, the chat helpers' search path pinned, national quorum with chapter
-- representation (10.6), no casting vote on a vote about a member (10.7) and the National
-- Secretary appointed after a two-thirds NEC vote about them for that seat (11.6).
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- f1 North Full and National Chairman (no President seat), f2 West President, f3 North President,
-- f4 and f5 West Full (no seat), f6 North Full (no seat), f7 West Treasurer, f8 West Supporter,
-- f9 West applicant (pending). Club Voting Members: f1 to f7, so a national quorum starts at 3.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, 'f' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000f1', 'north', 'Nell Chair', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', 'west', 'Wes President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', 'north', 'Nora President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f4', 'west', 'Fred Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f5', 'west', 'Will Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f6', 'north', 'Ned North', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f7', 'west', 'Tess Treasurer', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f8', 'west', 'Sam Supporter', 'supporter', 'approved'),
  ('00000000-0000-0000-0000-0000000000f9', 'west', 'Al Applicant', 'introduced', 'pending')
) as v(id, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on)
values
  ('00000000-0000-0000-0000-0000000000f1', null, 'nec_chair', '2026-08-01'),
  ('00000000-0000-0000-0000-0000000000f2', (select id from chapters where slug = 'west'), 'president', '2026-08-01'),
  ('00000000-0000-0000-0000-0000000000f3', (select id from chapters where slug = 'north'), 'president', '2026-08-01'),
  ('00000000-0000-0000-0000-0000000000f7', (select id from chapters where slug = 'west'), 'treasurer', '2026-08-01');

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

create function pg_temp.f(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;

\echo 'Nobody with the app can truncate a table, and the audit tables grant nothing directly'
do $$
begin
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and privilege_type = 'TRUNCATE' and grantee in ('anon', 'authenticated')
  ), 'no TRUNCATE for anon or authenticated anywhere in public';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('audit_requests', 'audit_reports') and grantee in ('anon', 'authenticated')
  ), 'the audit tables are reached through their functions only';
end $$;

\echo 'A push token is forgotten by its owner, signed in; nobody else touches it'
do $$
declare tok constant text := 'ExponentPushToken[auditfixes0001]';
begin
  assert pg_temp.try_as(pg_temp.f(4), format($q$select public.register_push_device(%L, 'android')$q$, tok)) is null, 'registered';
  assert pg_temp.try_as(null, format('select public.forget_push_device(%L)', tok)) is not null, 'anon can''t forget tokens';
  assert pg_temp.try_as(pg_temp.f(5), format('select public.forget_push_device(%L)', tok)) is null, 'another member''s call does nothing';
  assert (select count(*) from push_devices where token = tok) = 1, 'the token stays with its owner';
  assert pg_temp.try_as(pg_temp.f(4), format('select public.forget_push_device(%L)', tok)) is null, 'the owner forgets it';
  assert (select count(*) from push_devices where token = tok) = 0, 'and it''s gone';
end $$;

\echo 'Who added a sponsor is board business'
do $$
begin
  insert into sponsors (name, url, deal, added_by) values ('Tyre Shed', 'https://tyres.example', '10% off', pg_temp.f(7));
  assert pg_temp.value_as(null, 'select count(*) from public.list_sponsors()') = '1', 'anon sees the sponsor';
  assert pg_temp.value_as(null, 'select added_by from public.list_sponsors()') is null, 'not who added it';
  assert pg_temp.value_as(pg_temp.f(4), 'select added_by from public.list_sponsors()') is null, 'members neither';
  assert pg_temp.value_as(pg_temp.f(7), 'select added_by from public.list_sponsors()') = pg_temp.f(7)::text, 'the board does';
  delete from sponsors where name = 'Tyre Shed';
end $$;

\echo 'The stale public helpers and the hand-set continuation fee are gone'
do $$
begin
  assert (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_board_of', 'is_national', 'is_approved', 'member_phone', 'submit_application', 'set_continuation_fee')
  ) = 0, 'dropped';
  assert (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('media_json', 'ride_json', 'ride_last_day')
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
  ) = 3, 'the chat helpers pin their search path';
end $$;

\echo 'A national vote needs voters from at least 51% of the chapters (10.6)'
do $$
declare
  v uuid;
  open_it text := $q$public.open_vote(null, null, null, 'Spend the kitty?', null, 'club_patched', 'majority', false, 3, now() + interval '7 days')$q$;
  cast_it text := $q$select public.cast_ballot(%L, 'yes')$q$;
begin
  -- West turns out in force (4 of the 7 electors, over the quorum of 3); North stays home.
  v := pg_temp.value_as(pg_temp.f(1), open_it)::uuid;
  perform pg_temp.try_as(pg_temp.f(2), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(4), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(5), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(7), format(cast_it, v));
  update votes set closes_at = now() - interval '1 minute' where id = v;
  assert pg_temp.try_as(pg_temp.f(1), format('select public.close_vote(%L, null)', v)) is null, 'closes';
  assert (select result from votes where id = v) = 'no_quorum', 'one chapter of two is not 51%';
  assert (select yes_count from votes where id = v) = 4, 'the count is still recorded';

  -- One North voter is representation enough.
  v := pg_temp.value_as(pg_temp.f(1), open_it)::uuid;
  perform pg_temp.try_as(pg_temp.f(2), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(4), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(5), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(6), format(cast_it, v));
  update votes set closes_at = now() - interval '1 minute' where id = v;
  assert pg_temp.try_as(pg_temp.f(1), format('select public.close_vote(%L, null)', v)) is null, 'closes';
  assert (select result from votes where id = v) = 'carried', 'both chapters took part';

  -- A chapter vote never needs other chapters: West's board (f2 and f7) is two, so no board vote;
  -- its patched vote carries on West alone.
  v := pg_temp.value_as(pg_temp.f(2), format($q$public.open_vote(%L, null, null, 'West kitty?', null, 'chapter_patched', 'majority', false, 2, now() + interval '7 days')$q$, (select id from chapters where slug = 'west')))::uuid;
  perform pg_temp.try_as(pg_temp.f(2), format(cast_it, v));
  perform pg_temp.try_as(pg_temp.f(4), format(cast_it, v));
  update votes set closes_at = now() - interval '1 minute' where id = v;
  assert pg_temp.try_as(pg_temp.f(2), format('select public.close_vote(%L, null)', v)) is null, 'closes';
  assert (select result from votes where id = v) = 'carried', 'a chapter vote is its own business';
end $$;

\echo 'No casting vote on a vote about a member: a tie is lost (10.7)'
do $$
declare
  v uuid;
begin
  -- A reinstatement vote: the NEC's two Presidents split.
  v := pg_temp.value_as(pg_temp.f(1), format($q$public.open_vote(null, null, %L, 'Bring Sam back?', null, 'nec', 'majority', false, 2, now() + interval '7 days')$q$, pg_temp.f(8)))::uuid;
  perform pg_temp.try_as(pg_temp.f(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  perform pg_temp.try_as(pg_temp.f(3), format($q$select public.cast_ballot(%L, 'no')$q$, v));
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.close_vote(%L, 'yes')$q$, v))
    = 'No casting vote on a vote about a member (10.7): a tie is lost.', 'the Chairman can''t cast';
  assert pg_temp.try_as(pg_temp.f(1), format('select public.close_vote(%L, null)', v)) is null, 'it closes without one';
  assert (select (result, casting_vote) from votes where id = v) = ('lost'::vote_result, null::text), 'lost';

  -- Ordinary national business still gets the Chairman's casting vote.
  v := pg_temp.value_as(pg_temp.f(1), $q$public.open_vote(null, null, null, 'Tuesdays?', null, 'nec', 'majority', false, 2, now() + interval '7 days')$q$)::uuid;
  perform pg_temp.try_as(pg_temp.f(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  perform pg_temp.try_as(pg_temp.f(3), format($q$select public.cast_ballot(%L, 'no')$q$, v));
  assert pg_temp.try_as(pg_temp.f(1), format('select public.close_vote(%L, null)', v)) = 'It’s a tie. The chair gives a casting vote or lets it fall.', 'the chair decides';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.close_vote(%L, 'yes')$q$, v)) is null, 'and casts';
  assert (select (result, casting_vote) from votes where id = v) = ('carried'::vote_result, 'yes'::text), 'carried on the casting vote';
end $$;

\echo 'The National Secretary is appointed after a two-thirds NEC vote (11.6)'
do $$
declare
  v uuid;
  needs_vote constant text := 'Appointing the National Secretary needs a carried two-thirds NEC vote about them in the last 90 days (11.6).';
  vote_rule constant text := 'A vote to appoint the National Secretary is an NEC two-thirds vote on a Full Member who isn’t already National Chairman, Secretary or Auditor (11.6).';
  auditor_rule constant text := 'A vote to appoint the National Auditor is an NEC two-thirds vote on a Full Member who isn’t a President, Treasurer or NEC officer (11.8).';
  open_on text := $q$select public.open_vote(null, null, %L, 'Secretary?', null, 'nec', %L, false, 2, now() + interval '7 days', %L)$q$;
begin
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.appoint_position(%L, null, 'nec_secretary')$q$, pg_temp.f(4))) = needs_vote, 'no vote, no seat';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(4), 'two_thirds', null))
    = 'Say which seat the vote is for: National Auditor or National Secretary (11.6, 11.8).', 'a vote about a Full Member names its seat';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(4), 'two_thirds', 'president'))
    = 'The NEC votes people into the National Auditor and Secretary seats only (11.6, 11.8).', 'a national seat';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(8), 'two_thirds', 'nec_secretary'))
    = 'Only a Full Member can be voted into a national seat (9.1).', 'a Full Member';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(4), 'majority', 'nec_secretary')) = vote_rule, 'two-thirds, not a majority';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(1), 'two_thirds', 'nec_secretary')) = vote_rule, 'not on the sitting Chairman';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(7), 'two_thirds', 'nec_secretary')) is null, 'a Treasurer can be voted on for Secretary';
  assert pg_temp.try_as(pg_temp.f(1), format(open_on, pg_temp.f(7), 'two_thirds', 'nec_auditor')) = auditor_rule, 'never for Auditor (11.8)';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.appoint_position(%L, null, 'nec_auditor')$q$, pg_temp.f(7)))
    = 'The National Auditor can’t also be a President or Treasurer (11.8).', 'the seat check still keeps a Treasurer out of the Auditor''s chair';

  v := pg_temp.value_as(pg_temp.f(1), format($q$public.open_vote(null, null, %L, 'Secretary?', null, 'nec', 'two_thirds', false, 2, now() + interval '7 days', 'nec_secretary')$q$, pg_temp.f(4)))::uuid;
  assert (select subject_role from votes where id = v) = 'nec_secretary', 'the vote records its seat';
  perform pg_temp.try_as(pg_temp.f(2), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  perform pg_temp.try_as(pg_temp.f(3), format($q$select public.cast_ballot(%L, 'yes')$q$, v));
  assert pg_temp.try_as(pg_temp.f(1), format('select public.close_vote(%L, null)', v)) is null, 'closes once everyone has voted';
  assert (select result from votes where id = v) = 'carried', 'carried';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.appoint_position(%L, null, 'nec_secretary')$q$, pg_temp.f(4))) is null, 'seated after the vote';
  assert (select count(*) from positions where member_id = pg_temp.f(4) and role = 'nec_secretary' and ended_on is null) = 1, 'in the seat';

  -- One vote seats them once, in that seat: after the term ends, a fresh vote is needed, and the
  -- Secretary vote never made them Auditor.
  update positions set ended_on = private.club_date(), started_on = private.club_date() where member_id = pg_temp.f(4) and role = 'nec_secretary';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.appoint_position(%L, null, 'nec_secretary')$q$, pg_temp.f(4))) = needs_vote, 'the old vote doesn''t seat them again';
  assert pg_temp.try_as(pg_temp.f(1), format($q$select public.appoint_position(%L, null, 'nec_auditor')$q$, pg_temp.f(4)))
    = 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).', 'nor in the other seat';
end $$;

\echo 'AUDIT FIXES CHECKS PASSED'
