-- Checks the board's road name edit (set_member_road_name): who can change it, the app's words
-- for a refusal (src/domain/access.ts setRoadNameProblem), trimming, and blank clearing it.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- r1 National Chairman, r2 West Secretary, r3 West Full (the target), r4 North President,
-- r5 North Road Captain, r6 Auditor, r7 pending West applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, 'e' || n || '@example.com', now()
from generate_series(1, 7) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, v.road, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000e1', 'west', 'Cal Chairman', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e2', 'west', 'Sue Secretary', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e3', 'west', 'Fred Full', 'Freddo', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e4', 'north', 'Pete President', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e5', 'north', 'Rob Captain', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e6', 'west', 'Audrey Auditor', null, 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000e7', 'west', 'Al Applicant', null, 'introduced', 'pending')
) as v(id, ch, name, road, status, approval);

insert into positions (member_id, chapter_id, role, started_on, ended_on) values
  ('00000000-0000-0000-0000-0000000000e1', null, 'nec_chair', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000e2', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000e4', (select id from chapters where slug = 'north'), 'president', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000e5', (select id from chapters where slug = 'north'), 'road_captain', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000e6', null, 'nec_auditor', '2025-08-16', null);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;

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

create function pg_temp.road() returns text language sql as $$ select road_name from members where id = pg_temp.u(3) $$;

\o
do $$
declare
  set_it constant text := 'select public.set_member_road_name(%L, %L)';
  board constant text := 'Only that member’s chapter board or the NEC can do that.';
begin
  -- Who can: the chapter board, the Chairman, another chapter's sitting President.
  assert pg_temp.try_as(pg_temp.u(2), format(set_it, pg_temp.u(3), '  Sprocket  ')) is null, 'the West Secretary';
  assert pg_temp.road() = 'Sprocket', 'trimmed and saved';
  assert pg_temp.try_as(pg_temp.u(1), format(set_it, pg_temp.u(3), 'Cog')) is null, 'the Chairman';
  assert pg_temp.road() = 'Cog';
  assert pg_temp.try_as(pg_temp.u(4), format(set_it, pg_temp.u(3), 'Chain')) is null, 'a sitting President is on the NEC';
  assert pg_temp.road() = 'Chain';

  -- Who can't, in the app's words.
  assert pg_temp.try_as(pg_temp.u(5), format(set_it, pg_temp.u(3), 'Nope')) = board, 'another chapter''s Road Captain';
  assert pg_temp.try_as(pg_temp.u(6), format(set_it, pg_temp.u(3), 'Nope')) = board, 'the Auditor';
  assert pg_temp.try_as(pg_temp.u(7), format(set_it, pg_temp.u(3), 'Nope')) = 'Only approved members can do that.', 'an applicant';
  assert pg_temp.try_as(null, format(set_it, pg_temp.u(3), 'Nope')) is not null, 'signed out';
  assert pg_temp.try_as(pg_temp.u(2), format(set_it, pg_temp.u(2), 'Me')) = 'Change your own road name in Edit profile.', 'yourself';
  assert pg_temp.try_as(pg_temp.u(2), format(set_it, pg_temp.u(7), 'Newbie')) = 'They’re not an approved member.', 'a pending applicant';
  assert pg_temp.try_as(pg_temp.u(2), format(set_it, gen_random_uuid(), 'Ghost')) = 'That member no longer exists.';
  assert pg_temp.road() = 'Chain', 'nothing refused changed it';

  -- Blank clears it.
  assert pg_temp.try_as(pg_temp.u(2), format(set_it, pg_temp.u(3), '   ')) is null;
  assert pg_temp.road() is null, 'blank clears the road name';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.set_member_road_name(%L, null)', pg_temp.u(3))) is null;
  assert pg_temp.road() is null;
end $$;

\echo 'All road name checks passed'
