-- Acting in a role, until a date: a member acts in an empty seat, or covers an away board holder,
-- until a date, and the stint ends on its own at Melbourne midnight. Each section matches the
-- migration's (20270870000000_acting_roles.sql, §1 to §8). The fixtures are committed; each check
-- that changes rows runs inside begin … rollback, so every check starts from them.
-- See docs/superpowers/specs/2026-11-15-acting-roles-design.md.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- North: f1 Smokey (President), f2 Jet (VP), f3 Crank (Road Captain), f4 Lou (National
-- Secretary), f5 Ned and f6 Gus (no seat; seated where a case needs five board members).
-- West: f7 Rusty (President), f8 Torque (Secretary), f9 Penny (Treasurer), f10 Spanner and f11 Hal
-- (no seat), f12 Kim (National Auditor; a West VP row only in Auditor cases).
create function pg_temp.f(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid
$$;

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.f(n), 'f' || n || '@example.com', now() from generate_series(1, 12) n;

insert into members (id, chapter_id, full_name, status, approval)
select pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.name, 'full', 'approved'
from (values
  (1, 'north', 'Smokey Stone'), (2, 'north', 'Jet Black'), (3, 'north', 'Crank Shaw'),
  (4, 'north', 'Lou Reed'), (5, 'north', 'Ned Kelly'), (6, 'north', 'Gus Grime'),
  (7, 'west', 'Rusty Nail'), (8, 'west', 'Torque Wrench'), (9, 'west', 'Penny Farthing'),
  (10, 'west', 'Spanner Jones'), (11, 'west', 'Hal Moto'), (12, 'west', 'Kim Audit')
) as v(n, ch, name);

-- Each member's first seat is f(100 + n).
insert into positions (id, member_id, chapter_id, role, started_on)
select pg_temp.f(100 + v.n), pg_temp.f(v.n), (select id from chapters where slug = v.ch), v.role::position_role, '2026-08-01'
from (values
  (1, 'north', 'president'), (2, 'north', 'vice_president'), (3, 'north', 'road_captain'), (4, null, 'nec_secretary'),
  (7, 'west', 'president'), (8, 'west', 'secretary'), (9, 'west', 'treasurer'), (12, null, 'nec_auditor')
) as v(n, ch, role);

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
create function pg_temp.today() returns date language sql stable as $$ select private.club_date() $$;

-- Runs a statement as the owner. Null when it goes through; when it's refused, the name of the
-- constraint or index it broke, or the refusal's words. Any other error stops the run.
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare c text; m text;
begin
  execute stmt;
  return null;
exception when unique_violation or check_violation or raise_exception then
  get stacked diagnostics c = constraint_name, m = message_text;
  return coalesce(nullif(c, ''), m);
end $$;

-- The insert for an acting row (or, with no until, an elected one), as SQL text for pg_temp.refusal.
create function pg_temp.seat_sql(who int, ch uuid, r text, until date default null, why text default null,
  covers uuid default null, started date default null) returns text language sql stable as $$
  select format($q$insert into public.positions (member_id, chapter_id, role, started_on, acting_until, acting_why, covers)
    values (%L, %L, %L, %L, %L, %L, %L)$q$,
    pg_temp.f(who), ch, r, coalesce(started, private.club_date()), until, why, covers)
$$;

-- Seats someone as the owner and returns the new row's id.
create function pg_temp.seat(who int, ch uuid, r text, until date default null, why text default null,
  covers uuid default null, started date default null) returns uuid language plpgsql as $$
declare new_id uuid;
begin
  insert into public.positions (member_id, chapter_id, role, started_on, acting_until, acting_why, covers)
  values (pg_temp.f(who), ch, r::public.position_role, coalesce(started, private.club_date()), until, why, covers)
  returning id into new_id;
  return new_id;
end $$;

-- Ends a row as the owner, today (or on its start day), the way the writers do.
create function pg_temp.end_row(p uuid, reason text default 'stepped_down') returns void language plpgsql as $$
begin
  update public.positions set ended_on = greatest(private.club_date(), started_on), ended_reason = reason where id = p;
end $$;

-- Files a request as the owner and returns its id.
create function pg_temp.request(ch uuid, r text, who int, covers uuid, until date, why text, asked_by int,
  made timestamptz default now()) returns uuid language plpgsql as $$
declare new_id uuid;
begin
  insert into public.acting_requests (chapter_id, role, member_id, covers, until, why, requested_by, created_at)
  values (ch, r::public.position_role, pg_temp.f(who), covers, until, why, pg_temp.f(asked_by), made)
  returning id into new_id;
  return new_id;
end $$;

-- Moves the club clock (inside begin … rollback only): private.club_date() reads as if it were t,
-- and every other moment moves by the same amount.
create function pg_temp.clock_at(t timestamptz) returns void language plpgsql as $clock$
begin
  execute format($f$
    create or replace function private.club_date(at_time timestamptz default now())
    returns date language sql stable set search_path = '' as $b$
      select ((at_time + %L::interval) at time zone 'Australia/Melbourne')::date;
    $b$ $f$, t - now());
end $clock$;

-- Noon in Melbourne, n days before today: when a request was made, n days ago.
create function pg_temp.days_ago(n int) returns timestamptz language sql stable as $$
  select ((private.club_date() - n)::timestamp + time '12:00') at time zone 'Australia/Melbourne'
$$;

-- §1 Schema, views, locks and the lazy close ---------------------------------------------------------

\echo 'acting: an elected holder and an empty-seat acting row clash'
do $$ begin
  assert pg_temp.refusal(pg_temp.seat_sql(11, pg_temp.west(), 'secretary', pg_temp.today() + 20, 'No Secretary since the ACM'))
    = 'one_holder_per_board_seat', 'Hal can''t act in Torque''s seat';
end $$;
begin;
do $$ begin
  perform pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() + 20, 'No VP since the ACM');
  assert pg_temp.refusal(pg_temp.seat_sql(10, pg_temp.west(), 'vice_president'))
    = 'one_holder_per_board_seat', 'nobody is seated in full over Hal''s acting by a plain insert';
end $$;
rollback;

\echo 'acting: a cover sits beside the holder; a second cover clashes'
begin;
do $$ begin
  assert pg_temp.refusal(pg_temp.seat_sql(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101))) is null,
    'Jet covers Smokey, who stays seated';
  assert pg_temp.refusal(pg_temp.seat_sql(3, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101)))
    = 'one_cover_per_board_seat', 'Crank can''t cover the same seat too';
end $$;
rollback;

\echo 'acting: one stint per member'
begin;
do $$
declare cover uuid;
begin
  cover := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
  assert pg_temp.refusal(pg_temp.seat_sql(2, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM'))
    = 'one_acting_per_member', 'Jet can''t act as Treasurer while covering Smokey';
  perform pg_temp.end_row(cover);
  assert pg_temp.refusal(pg_temp.seat_sql(2, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM')) is null,
    'once the cover ends, a new stint fits';
end $$;
rollback;

\echo 'acting: the checks'
begin;
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  smokey uuid := pg_temp.f(101);
begin
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', t - 1, 'No Treasurer since the ACM')) = 'acting_until_after_start', 'until before the start';
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', t + 20, repeat('x', 121))) = 'acting_why_short', 'a 121-character why';
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', t + 20, '   ')) = 'acting_why_short', 'a blank why';
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', t + 20, repeat('x', 120))) is null, '120 characters is fine';
  delete from positions where member_id = pg_temp.f(5);
  assert pg_temp.refusal(pg_temp.seat_sql(5, null, 'founder', t + 20, 'An honour')) = 'acting_in_a_chapter', 'never national or Founder';
  assert pg_temp.refusal(pg_temp.seat_sql(2, n, 'president', null, null, smokey)) = 'cover_is_acting', 'a cover has an until date';
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', t + 20, null)) = 'acting_has_why', 'an until date needs a why';
  assert pg_temp.refusal(pg_temp.seat_sql(5, n, 'treasurer', null, 'No Treasurer since the ACM')) = 'acting_has_why', 'a why needs an until date';
  assert pg_temp.refusal(format($q$insert into public.positions (member_id, chapter_id, role, started_on, ended_on, acting_until, acting_why)
    values (%L, %L, 'treasurer', %L, %L, %L, 'No Treasurer since the ACM')$q$, pg_temp.f(5), n, t - 10, t - 1, t + 20))
    = 'acting_end_has_reason', 'an ended stint says why it ended';
  assert pg_temp.refusal(format($q$insert into public.positions (member_id, chapter_id, role, acting_until, acting_why, ended_reason)
    values (%L, %L, 'treasurer', %L, 'No Treasurer since the ACM', 'lapsed')$q$, pg_temp.f(5), n, t + 20))
    = 'acting_end_has_reason', 'an open stint has no ending reason';
  assert pg_temp.refusal(format($q$update public.positions set ended_reason = 'fired' where id = %L$q$, smokey))
    = 'ended_reason_known', 'an ending reason from the list';
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by)
    values (%L, 'treasurer', %L, %L, %L, %L)$q$, n, pg_temp.f(5), t + 20, repeat('x', 121), pg_temp.f(1)))
    = 'request_why_short', 'a request''s 121-character why';
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by)
    values (%L, 'treasurer', %L, %L, ' ', %L)$q$, n, pg_temp.f(5), t + 20, pg_temp.f(1)))
    = 'request_why_short', 'a request''s blank why';
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by, closed_at, outcome)
    values (%L, 'treasurer', %L, %L, 'No Treasurer since the ACM', %L, now(), 'cancelled')$q$, n, pg_temp.f(5), t + 20, pg_temp.f(1)))
    = 'request_outcome_known', 'a request outcome from the list';
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by, closed_at)
    values (%L, 'treasurer', %L, %L, 'No Treasurer since the ACM', %L, now())$q$, n, pg_temp.f(5), t + 20, pg_temp.f(1)))
    = 'request_closed_has_outcome', 'a closed request has an outcome';
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by, outcome)
    values (%L, 'treasurer', %L, %L, 'No Treasurer since the ACM', %L, 'withdrawn')$q$, n, pg_temp.f(5), t + 20, pg_temp.f(1)))
    = 'request_closed_has_outcome', 'an open request has none';
end $$;
rollback;
begin;
do $$ begin
  perform pg_temp.request(pg_temp.north(), 'treasurer', 5, null, pg_temp.today() + 20, 'No Treasurer since the ACM', 1);
  assert pg_temp.refusal(format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by)
    values (%L, 'treasurer', %L, %L, 'No Treasurer since the ACM', %L)$q$, pg_temp.north(), pg_temp.f(6), pg_temp.today() + 20, pg_temp.f(3)))
    = 'one_open_request_per_seat', 'one open request per board seat';
  perform pg_temp.request(pg_temp.north(), 'tail_gunner', 5, null, pg_temp.today() + 20, 'Short a Tail Gunner', 1);
  perform pg_temp.request(pg_temp.north(), 'tail_gunner', 6, null, pg_temp.today() + 20, 'Short a Tail Gunner', 1);
end $$;
rollback;

\echo 'acting: covers must point at the open, non-acting holder of the same seat'
begin;
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  words text := 'A cover must point at the open holder of the same seat.';
  old_secretary uuid;
  hal uuid;
  cover uuid;
begin
  insert into positions (member_id, chapter_id, role, started_on, ended_on) values (pg_temp.f(5), n, 'secretary', '2026-08-01', '2026-09-01')
    returning id into old_secretary;
  hal := pg_temp.seat(11, pg_temp.west(), 'vice_president', t + 20, 'No VP since the ACM');
  assert pg_temp.refusal(pg_temp.seat_sql(2, n, 'secretary', t + 20, 'Ned overseas', old_secretary)) = words, 'not an ended row';
  assert pg_temp.refusal(pg_temp.seat_sql(8, pg_temp.west(), 'vice_president', t + 20, 'Hal away', hal)) = words, 'not an acting row';
  assert pg_temp.refusal(pg_temp.seat_sql(2, n, 'treasurer', t + 20, 'Smokey overseas', pg_temp.f(101))) = words, 'not another seat''s row';
  assert pg_temp.refusal(pg_temp.seat_sql(8, pg_temp.west(), 'president', t + 20, 'Smokey overseas', pg_temp.f(101))) = words, 'not another chapter''s row';
  assert pg_temp.refusal(pg_temp.seat_sql(2, n, 'president', t + 20, 'Smokey overseas', pg_temp.f(101), '2026-07-31')) = words,
    'not a holder seated after the cover started';
  assert pg_temp.refusal(pg_temp.seat_sql(2, n, 'president', t + 20, 'Smokey overseas', gen_random_uuid())) = words, 'not a missing row';
  cover := pg_temp.seat(2, n, 'president', t + 20, 'Smokey overseas', pg_temp.f(101));
  assert pg_temp.refusal(format('update public.positions set covers = %L where id = %L', pg_temp.f(107), cover)) = words,
    'nor moved to another seat later';
end $$;
rollback;

\echo 'acting: ending the covered row ends the cover (left_board, logged)'
begin;
select set_config('request.jwt.claim.sub', pg_temp.f(1)::text, true);
do $$
declare cover uuid;
begin
  cover := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
  perform pg_temp.end_row(pg_temp.f(101));
  assert (select ended_on = pg_temp.today() and ended_reason = 'left_board' and ended_by is null from positions where id = cover),
    'Smokey''s seat ended, so Jet''s cover ended with it';
  assert (select count(*) from acting_changes where position_id = cover) = 1, 'one change logged';
  assert (select note = 'Holder’s seat ended' and old_until = pg_temp.today() + 20 and new_until is null
            and chapter_id = pg_temp.north() and changed_by = pg_temp.f(1)
          from acting_changes where position_id = cover), 'logged with the old date, by whoever ended the seat';
  assert (select ended_on is null from positions where id = pg_temp.f(102)), 'Jet keeps his VP seat';
end $$;
rollback;

\echo 'acting: ending the stand-in''s last board seat ends the cover (left_board); a second board seat keeps it'
begin;
do $$
declare cover uuid;
begin
  cover := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
  perform pg_temp.end_row(pg_temp.f(102));
  assert (select ended_on = pg_temp.today() and ended_reason = 'left_board' from positions where id = cover),
    'Jet left the board, so his cover ended';
  assert (select note from acting_changes where position_id = cover) = 'Stand-in left the board', 'logged';
  assert (select ended_on is null from positions where id = pg_temp.f(101)), 'Smokey stays seated';
end $$;
rollback;
begin;
do $$
declare
  secretary uuid;
  cover uuid;
begin
  secretary := pg_temp.seat(3, pg_temp.north(), 'secretary');
  cover := pg_temp.seat(3, pg_temp.north(), 'vice_president', pg_temp.today() + 20, 'Jet away', pg_temp.f(102));
  perform pg_temp.end_row(pg_temp.f(103));
  assert (select ended_on is null from positions where id = cover), 'Crank is still Secretary, so the cover stays';
  assert not exists (select 1 from acting_changes where position_id = cover), 'nothing logged';
  perform pg_temp.end_row(secretary);
  assert (select ended_reason = 'left_board' from positions where id = cover), 'his last board seat ended, so the cover did';
end $$;
rollback;
begin;
do $$
declare cover uuid;
begin
  perform pg_temp.seat(3, pg_temp.north(), 'tail_gunner');
  cover := pg_temp.seat(3, pg_temp.north(), 'vice_president', pg_temp.today() + 20, 'Jet away', pg_temp.f(102));
  perform pg_temp.end_row(pg_temp.f(103));
  assert (select ended_reason = 'left_board' from positions where id = cover), 'a Tail Gunner seat isn''t a board seat, so the cover ends';
end $$;
rollback;

\echo 'acting: the views at Melbourne midnight'
begin;
select pg_temp.clock_at('2026-12-13 23:59:59 Australia/Melbourne');
create temp table ids as select
  pg_temp.seat(11, pg_temp.west(), 'vice_president', '2026-12-13', 'No VP since the ACM', null, '2026-12-01') as hal,
  pg_temp.seat(10, pg_temp.west(), 'sergeant_at_arms', '2026-12-12', 'No Sergeant since the ACM', null, '2026-12-01') as spanner,
  pg_temp.seat(2, pg_temp.north(), 'president', '2026-12-31', 'Smokey overseas', pg_temp.f(101), '2026-12-01') as jet,
  pg_temp.seat(8, pg_temp.west(), 'president', '2026-12-12', 'Rusty overseas', pg_temp.f(107), '2026-12-01') as torque;
do $$
declare r ids%rowtype;
begin
  select * into r from ids;
  assert pg_temp.today() = date '2026-12-13', 'the clock reads 13/12/2026';
  assert not exists (select 1 from private.held_positions where id = r.torque), 'Torque''s cover ran until yesterday: not held';
  assert (select ended_on is null from positions where id = r.torque), 'though nothing closed it';
  assert not exists (select 1 from private.duty_positions where id = r.torque), 'so it has no duties';
  assert exists (select 1 from private.duty_positions where id = pg_temp.f(107)), 'and Rusty has his duties back';
  assert exists (select 1 from private.held_positions where id = r.hal), 'until today: held';
  assert not exists (select 1 from private.held_positions where id = r.spanner), 'until yesterday: not held, though still open';
  assert (select ended_on is null from positions where id = r.spanner), 'nothing closed it';
  assert exists (select 1 from private.held_positions where id = pg_temp.f(101)), 'a covered row is held';
  assert not exists (select 1 from private.duty_positions where id = pg_temp.f(101)), 'but not a duty';
  assert exists (select 1 from private.duty_positions where id = r.jet), 'a cover is a duty';
  assert not exists (select 1 from private.clubwide_positions where id = r.jet), 'but not club-wide';
  assert exists (select 1 from private.clubwide_positions where id = pg_temp.f(102)), 'Jet''s own VP seat is club-wide';
  assert exists (select 1 from private.duty_positions where id = r.hal), 'empty-seat acting is a duty';
  assert not exists (select 1 from private.clubwide_positions where id = r.hal), 'and not club-wide';
end $$;
select pg_temp.clock_at('2026-12-14 00:00:00 Australia/Melbourne');
do $$
declare r ids%rowtype;
begin
  select * into r from ids;
  assert pg_temp.today() = date '2026-12-14', 'midnight in Melbourne';
  assert not exists (select 1 from private.held_positions where id = r.hal), 'Hal''s stint has lapsed at midnight';
  assert not exists (select 1 from private.duty_positions where id = r.hal), 'and has no duties';
end $$;
rollback;

\echo 'acting: the seat lock and the person locks'
begin;
do $$
declare
  mine bigint[];
begin
  perform private.lock_seat(pg_temp.north(), 'president');
  perform private.lock_seat(null, 'nec_chair');
  perform private.lock_people(array[pg_temp.f(2), pg_temp.f(1), pg_temp.f(2), null]);
  select array_agg((classid::bigint << 32) | objid::bigint) into mine
  from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
  assert cardinality(mine) = 4, 'two seats and two people, once each';
  assert hashtextextended(pg_temp.north()::text || ':president', 0) = any (mine), 'the seat';
  assert hashtextextended('national:nec_chair', 0) = any (mine), 'a national seat';
  assert hashtextextended('member:' || pg_temp.f(1)::text, 0) = any (mine), 'Smokey';
  assert hashtextextended('member:' || pg_temp.f(2)::text, 0) = any (mine), 'Jet';
end $$;
rollback;

\echo 'acting: close_lapsed_acting'
begin;
select set_config('request.jwt.claim.sub', pg_temp.f(7)::text, true);
create temp table ids as select
  pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10) as hal,
  pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), pg_temp.today() - 1, 'Smokey overseas', 3) as past_until,
  pg_temp.request(pg_temp.north(), 'treasurer', 5, null, pg_temp.today() + 10, 'No Treasurer since the ACM', 1, pg_temp.days_ago(28)) as old,
  pg_temp.request(pg_temp.north(), 'secretary', 6, null, pg_temp.today() + 10, 'No Secretary since the ACM', 1, pg_temp.days_ago(27)) as young,
  pg_temp.request(pg_temp.west(), 'sergeant_at_arms', 10, null, pg_temp.today() + 10, 'No Sergeant since the ACM', 7) as voted_down,
  pg_temp.request(pg_temp.west(), 'road_captain', 11, null, pg_temp.today() + 10, 'No Road Captain since the ACM', 7) as no_quorum,
  pg_temp.seat(5, pg_temp.north(), 'treasurer', pg_temp.today() - 1, 'No Treasurer since the ACM', null, pg_temp.today() - 10) as stepped_down,
  pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms', pg_temp.today(), 'No Sergeant since the ACM', null, pg_temp.today() - 10) as gus_today,
  pg_temp.request(pg_temp.west(), 'treasurer', 10, null, pg_temp.today(), 'No Treasurer since the ACM', 7) as until_today,
  pg_temp.request(pg_temp.north(), 'sergeant_at_arms', 6, null, pg_temp.today() - 1, 'No Sergeant since the ACM', 1, pg_temp.days_ago(5)) as withdrawn;
-- Ned stepped down five days ago, before his until date (yesterday) came; the Sergeant request
-- was withdrawn two days ago, before its until date passed.
update positions set ended_on = pg_temp.today() - 5, ended_by = pg_temp.f(5), ended_reason = 'stepped_down'
where id = (select stepped_down from ids);
update acting_requests set closed_at = now() - interval '2 days', outcome = 'withdrawn' where id = (select withdrawn from ids);
-- A lost vote and an open one on voted_down; a vote without quorum on no_quorum.
insert into votes (chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result, acting_request)
select pg_temp.west(), 'Spanner acts as Sergeant at Arms (West)?', 'chapter_board'::electorate, 'majority'::vote_threshold, 3, now() - interval '3 days', now() - interval '1 day', now() - interval '1 day', 'lost'::vote_result, voted_down from ids
union all
select pg_temp.west(), 'Spanner acts as Sergeant at Arms (West)?', 'chapter_board', 'majority', 3, now(), now() + interval '3 days', null, null, voted_down from ids
union all
select pg_temp.west(), 'Hal acts as Road Captain (West)?', 'chapter_board', 'majority', 3, now() - interval '3 days', now() - interval '1 day', now() - interval '1 day', 'no_quorum', no_quorum from ids;
do $$
declare r ids%rowtype;
begin
  select * into r from ids;
  assert pg_temp.refusal(pg_temp.seat_sql(10, pg_temp.west(), 'vice_president')) = 'one_holder_per_board_seat',
    'a lapsed but open row still fills the index';
  perform private.close_lapsed_acting();
  assert (select ended_on = acting_until + 1 and ended_on = pg_temp.today() and ended_reason = 'lapsed' and ended_by is null
          from positions where id = r.hal), 'closed the day after its until date, by nobody';
  assert pg_temp.refusal(pg_temp.seat_sql(10, pg_temp.west(), 'vice_president')) is null, 'an elected VP then fits';
  assert (select outcome = 'lapsed' and closed_at is not null from acting_requests where id = r.past_until), 'past its until date: lapsed';
  assert (select outcome = 'lapsed' from acting_requests where id = r.old), '28 days old: lapsed';
  assert (select outcome is null and closed_at is null from acting_requests where id = r.young), '27 days old: still open';
  assert (select outcome = 'rejected' and closed_at is not null from acting_requests where id = r.voted_down), 'a lost vote rejects it, even beside an open one';
  assert (select outcome is null from acting_requests where id = r.no_quorum), 'a vote without quorum leaves it open';
  assert (select ended_on = pg_temp.today() - 5 and ended_reason = 'stepped_down' and ended_by = pg_temp.f(5)
          from positions where id = r.stepped_down), 'a stint ended early keeps its own end, though its until has passed';
  assert (select ended_on is null from positions where id = r.gus_today), 'a stint until today stays open';
  assert (select outcome is null and closed_at is null from acting_requests where id = r.until_today), 'a request until today stays open';
  assert (select outcome = 'withdrawn' and closed_at = now() - interval '2 days' from acting_requests where id = r.withdrawn),
    'a withdrawn request stays withdrawn, though its until has passed';
end $$;
create temp table before_rerun as select
  (select md5(string_agg(p::text, ',' order by p.id)) from positions p) as positions,
  (select md5(string_agg(r::text, ',' order by r.id)) from acting_requests r) as requests;
select private.close_lapsed_acting();
do $$ begin
  assert (select positions = (select md5(string_agg(p::text, ',' order by p.id)) from positions p)
            and requests = (select md5(string_agg(r::text, ',' order by r.id)) from acting_requests r)
          from before_rerun), 'a second run changes nothing';
end $$;
rollback;

\echo 'acting: a no-vote Acting President''s VP row ending ends the stint (left_board); a voted one stays'
begin;
do $$
declare stint uuid;
begin
  perform pg_temp.end_row(pg_temp.f(101));
  stint := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'No President since Smokey stepped down');
  perform pg_temp.end_row(pg_temp.f(102));
  assert (select ended_on = pg_temp.today() and ended_reason = 'left_board' from positions where id = stint),
    'Jet acted as President as the sitting VP, so it ends with his VP seat';
  assert (select note from acting_changes where position_id = stint) = 'Stand-in left the board', 'logged';
end $$;
rollback;
begin;
do $$
declare
  vote uuid;
  stint uuid;
begin
  perform pg_temp.end_row(pg_temp.f(101));
  insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result)
  values (pg_temp.north(), pg_temp.f(2), 'president', 'Jet acts as President (North)?', 'chapter_board', 'majority', 2,
    now() - interval '4 days', now() - interval '1 day', now() - interval '1 day', 'carried')
  returning id into vote;
  stint := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'No President since Smokey stepped down');
  update positions set acting_vote = vote where id = stint;
  perform pg_temp.end_row(pg_temp.f(102));
  assert (select ended_on is null from positions where id = stint), 'a carried board vote put Jet there, so it stays';
end $$;
rollback;

\echo 'acting: a cover asked by Crank pushes Smokey once a day, however often re-filed; Smokey''s own request doesn''t, its confirm does'
begin;
create function pg_temp.asks() returns bigint language sql stable as $$
  select count(*) from private.push_outbox where member_id = pg_temp.f(1) and dedupe_key like 'acting-ask:%'
$$;
create function pg_temp.withdraw_all() returns void language sql as $$
  update public.acting_requests set closed_at = now(), outcome = 'withdrawn' where closed_at is null
$$;
do $$
declare
  until date := pg_temp.today() + 28;
  cover uuid;
begin
  perform pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), until, 'Smokey overseas', 1);
  assert pg_temp.asks() = 0, 'Smokey asked himself, so he isn''t told';
  perform pg_temp.withdraw_all();
  perform pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), until, 'Smokey can''t be reached', 3);
  assert pg_temp.asks() = 1, 'Crank asked, so Smokey hears';
  assert (select title = 'Cover asked for your seat'
            and body = 'Crank asked for Jet to act as President (North) for you until ' || to_char(until, 'DD/MM/YYYY')
                        || '. If you’re available, tap I’m back.'
          from private.push_outbox where member_id = pg_temp.f(1) and dedupe_key like 'acting-ask:%'), 'the words';
  assert (select dedupe_key = 'acting-ask:' || pg_temp.f(101) || ':' || to_char(pg_temp.today(), 'YYYY-MM-DD')
          from private.push_outbox where member_id = pg_temp.f(1) and dedupe_key like 'acting-ask:%'), 'once per seat per day';
  perform pg_temp.withdraw_all();
  perform pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), until, 'Smokey can''t be reached', 3);
  perform pg_temp.withdraw_all();
  perform pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), until, 'Smokey can''t be reached', 3);
  assert pg_temp.asks() = 1, 're-filed the same day: no second push';
  assert not exists (select 1 from private.push_outbox where member_id <> pg_temp.f(1) and dedupe_key like 'acting-%'), 'only the holder hears';
  cover := pg_temp.seat(2, pg_temp.north(), 'president', until, 'Smokey overseas', pg_temp.f(101));
  assert (select title = 'Your seat is covered'
            and body = 'Jet is acting as President (North) for you until ' || to_char(until, 'DD/MM/YYYY')
                        || '. If you’re available, tap I’m back.'
          from private.push_outbox where member_id = pg_temp.f(1) and dedupe_key = 'acting-on:' || cover), 'the confirm always tells him';
end $$;
select pg_temp.clock_at(now() + interval '1 day');
do $$ begin
  perform pg_temp.withdraw_all();
  perform pg_temp.request(pg_temp.north(), 'president', 3, pg_temp.f(101), pg_temp.today() + 28, 'Smokey can''t be reached', 2);
  assert pg_temp.asks() = 2, 'the next day, a re-filed request pushes again';
end $$;
rollback;

\echo 'acting: who reads requests and changes'
begin;
do $$
declare
  stint uuid;
  who uuid;
begin
  perform pg_temp.request(pg_temp.north(), 'treasurer', 5, null, pg_temp.today() + 20, 'No Treasurer since the ACM', 1);
  stint := pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms', pg_temp.today() + 20, 'No Sergeant since the ACM');
  insert into acting_changes (position_id, chapter_id, old_until, new_until, changed_by)
  values (stint, pg_temp.north(), pg_temp.today() + 20, pg_temp.today() + 10, pg_temp.f(6));
  foreach who in array array[pg_temp.f(1), pg_temp.f(3), pg_temp.f(5)] loop
    assert pg_temp.value_as(who, 'select count(*) from public.acting_requests') = '1', 'North''s board and the stand-in read the request';
  end loop;
  foreach who in array array[pg_temp.f(10), pg_temp.f(7), pg_temp.f(4), pg_temp.f(12)] loop
    assert pg_temp.value_as(who, 'select count(*) from public.acting_requests') = '0', 'nobody else does';
  end loop;
  foreach who in array array[pg_temp.f(1), pg_temp.f(6), pg_temp.f(12)] loop
    assert pg_temp.value_as(who, 'select count(*) from public.acting_changes') = '1', 'North''s board (Gus through his stint) and the Auditor read changes';
  end loop;
  foreach who in array array[pg_temp.f(5), pg_temp.f(10), pg_temp.f(7)] loop
    assert pg_temp.value_as(who, 'select count(*) from public.acting_changes') = '0', 'nobody else does';
  end loop;
  assert pg_temp.try_as(pg_temp.f(1), format($q$insert into public.acting_requests (chapter_id, role, member_id, until, why, requested_by)
    values (%L, 'secretary', %L, %L, 'No Secretary since the ACM', %L)$q$, pg_temp.north(), pg_temp.f(6), pg_temp.today() + 20, pg_temp.f(1)))
    = 'permission denied for table acting_requests', 'no direct writes to requests';
  assert pg_temp.try_as(pg_temp.f(1), 'delete from public.acting_changes') = 'permission denied for table acting_changes', 'nor to changes';
  assert pg_temp.try_as(null, 'select count(*) from public.acting_requests') = 'permission denied for table acting_requests', 'anon reads nothing';
end $$;
rollback;
do $$
declare t text;
begin
  foreach t in array array['public.acting_requests', 'public.acting_changes'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), t || ' has row-level security';
    assert not has_table_privilege('anon', t, 'select, insert, update, delete, truncate, references, trigger'), t || ': no anon grant';
    assert has_table_privilege('authenticated', t, 'select'), t || ': members can select';
    assert not has_table_privilege('authenticated', t, 'insert, update, delete, truncate, references, trigger'), t || ': and do nothing else';
  end loop;
end $$;

\echo 'acting: grants'
do $$
declare
  fn regprocedure;
  v text;
begin
  -- Every function this job adds. Later tasks add theirs here.
  for fn in select x::regprocedure from (values
    ('private.role_label(public.position_role)'),
    ('private.lock_seat(uuid, public.position_role)'),
    ('private.lock_people(uuid[])'),
    ('private.close_lapsed_acting()'),
    ('private.check_covers()'),
    ('private.on_position_end()'),
    ('private.push_acting_holder()')
  ) as l(x) loop
    assert not has_function_privilege('anon', fn, 'execute'), fn || ': not for anon';
    if (select pronamespace = 'public'::regnamespace from pg_proc where oid = fn) then
      assert has_function_privilege('authenticated', fn, 'execute'), fn || ': an RPC members call';
    else
      assert not has_function_privilege('authenticated', fn, 'execute'), fn || ': private';
    end if;
  end loop;
  foreach v in array array['private.held_positions', 'private.duty_positions', 'private.clubwide_positions'] loop
    assert not has_table_privilege('anon', v, 'select'), v || ': not for anon';
    assert not has_table_privilege('authenticated', v, 'select'), v || ': nor members';
  end loop;
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
          where oid = any (array['private.lock_seat(uuid, public.position_role)', 'private.lock_people(uuid[])',
            'private.close_lapsed_acting()', 'private.check_covers()', 'private.on_position_end()',
            'private.push_acting_holder()']::regprocedure[]::oid[])),
    'the locks, the lazy close and the triggers run as their owner with an empty search path';
end $$;

\echo 'acting: unchanged rows'
do $$ begin
  assert not exists (select 1 from positions where acting_until is not null or covers is not null or acting_why is not null
                       or acting_vote is not null or acting_request is not null or ended_reason is not null),
    'rows written the old way have no acting columns';
  assert pg_temp.refusal(pg_temp.seat_sql(10, pg_temp.west(), 'secretary')) = 'one_holder_per_board_seat', 'two elected West Secretaries still clash';
end $$;

-- §2 Readers: board member and held ----------------------------------------------------------------

-- Which board-member helpers answer yes for member n in that chapter, by name, in this order. It
-- makes a ride in the chapter's category and a new applicant to the chapter, so call it only inside
-- begin … rollback.
create function pg_temp.board_helpers(n int, slug text) returns text[] language plpgsql as $$
declare
  ch uuid := (select id from public.chapters c where c.slug = board_helpers.slug);
  who uuid := pg_temp.f(n);
  ride uuid;
  applicant uuid := gen_random_uuid();
  yes text[] := '{}';
  h record;
begin
  insert into public.rides (source, starts_at, title, category)
  values ('app', now() + interval '7 days', 'Chapter run', slug::public.ride_category) returning id into ride;
  for h in select * from (values
    ('is_board_of', format('private.is_board_of(%L)', ch)),
    ('holds_board_seat', format('private.holds_board_seat(%L)', ch)),
    ('is_any_board', 'private.is_any_board()'),
    ('manages_bus', 'private.manages_bus()'),
    ('can_run_checkin', format('private.can_run_checkin(%L)', ch)),
    ('can_run_checkin(club)', 'private.can_run_checkin(null)'),
    ('sees_site_enquiry', format('private.sees_site_enquiry(%L)', slug)),
    ('sees_site_enquiry(either)', 'private.sees_site_enquiry(''either'')'),
    ('is_ride_leader', format('private.is_ride_leader(%L)', who)),
    ('manages_ride', format('private.manages_ride(%L)', ride)),
    ('manages_chapter_rides', format('private.manages_chapter_rides(%L)', ch)),
    ('manages_chapter_rides(club)', 'private.manages_chapter_rides(null)'),
    ('manages_ride_category', format('private.manages_ride_category(%L)', slug)),
    ('can_set_fees', format('private.can_set_fees(%L)', ch))
  ) as v(name, expr) loop
    if pg_temp.helper_as(who, h.expr)::boolean then yes := yes || h.name::text; end if;
  end loop;
  if who in (select private.electors_for('chapter_board', ch)) then yes := yes || 'electors_for'::text; end if;
  insert into auth.users (id, email, email_confirmed_at) values (applicant, applicant || '@example.com', now());
  insert into public.members (id, chapter_id, full_name, status, approval) values (applicant, ch, 'Pete Pending', 'introduced', 'pending');
  if exists (select 1 from private.push_outbox where member_id = who and dedupe_key = 'applicant:' || applicant) then
    yes := yes || 'push_applicant'::text;
  end if;
  return yes;
end $$;

create function pg_temp.every_board_helper() returns text[] language sql immutable as $$
  select array['is_board_of', 'holds_board_seat', 'is_any_board', 'manages_bus', 'can_run_checkin', 'can_run_checkin(club)',
    'sees_site_enquiry', 'sees_site_enquiry(either)', 'is_ride_leader', 'manages_ride', 'manages_chapter_rides',
    'manages_chapter_rides(club)', 'manages_ride_category', 'can_set_fees', 'electors_for', 'push_applicant']
$$;

\echo 'board member: a covered President keeps every board-member helper above'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$
declare got text[] := pg_temp.board_helpers(1, 'north');
begin
  assert got = pg_temp.every_board_helper(), 'Jet covers Smokey, who is still on North''s board: ' || got::text;
end $$;
rollback;

\echo 'board member: North still has three chapter_board electors under a cover'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$ begin
  assert (select array_agg(e order by e) from private.electors_for('chapter_board', pg_temp.north()) e)
    = array[pg_temp.f(1), pg_temp.f(2), pg_temp.f(3)], 'Smokey, Jet (once, with two rows) and Crank';
end $$;
rollback;

\echo 'board member: empty-seat acting makes a board member'
begin;
select pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() + 20, 'No VP since the ACM');
do $$
declare got text[] := pg_temp.board_helpers(11, 'west');
begin
  assert got = pg_temp.every_board_helper(), 'Hal acts in West''s empty VP seat, so he''s on West''s board: ' || got::text;
  assert pg_temp.board_helpers(10, 'west') = '{}', 'Spanner, with no seat, has none';
end $$;
rollback;

\echo 'board member: a lapsed but open row loses it'
begin;
select pg_temp.clock_at('2026-12-13 23:59:59 Australia/Melbourne');
select pg_temp.seat(11, pg_temp.west(), 'vice_president', '2026-12-13', 'No VP since the ACM', null, '2026-12-01');
do $$
declare got text[] := pg_temp.board_helpers(11, 'west');
begin
  assert got = pg_temp.every_board_helper(), 'until today, Hal is on West''s board: ' || got::text;
end $$;
select pg_temp.clock_at('2026-12-14 00:00:00 Australia/Melbourne');
do $$
declare got text[] := pg_temp.board_helpers(11, 'west');
begin
  assert (select ended_on is null from positions where member_id = pg_temp.f(11)), 'nothing closed Hal''s stint';
  assert got = '{}', 'from Melbourne midnight Hal has no board-member helper, no ballot and no applicant push: ' || got::text;
end $$;
rollback;

\echo 'board member: the ride_committee branch is unchanged'
begin;
select pg_temp.seat(10, pg_temp.west(), 'ride_committee');
select pg_temp.seat(5, pg_temp.north(), 'ride_committee', pg_temp.today(), 'Short on the Ride Committee', null, pg_temp.today() - 10);
select pg_temp.seat(6, pg_temp.north(), 'ride_committee', pg_temp.today() - 1, 'Short on the Ride Committee', null, pg_temp.today() - 10);
do $$
declare
  rides constant text[] := array['manages_ride', 'manages_chapter_rides', 'manages_chapter_rides(club)', 'manages_ride_category'];
  got text[];
begin
  got := pg_temp.board_helpers(10, 'west');
  assert got = rides, 'Spanner, on West''s Ride Committee, manages West''s rides and no more: ' || got::text;
  got := pg_temp.board_helpers(10, 'north');
  assert got = array['manages_chapter_rides(club)'], 'but not North''s: ' || got::text;
  assert pg_temp.helper_as(pg_temp.f(10), 'private.manages_ride_category(''club'')') = 'true', 'and any club ride';
  got := pg_temp.board_helpers(5, 'north');
  assert got = rides, 'Ned acting on North''s Ride Committee until today manages its rides: ' || got::text;
  got := pg_temp.board_helpers(6, 'north');
  assert got = '{}', 'Gus''s stint there ran until yesterday, so he doesn''t: ' || got::text;
end $$;
rollback;

\echo 'board member: can_set_fees = can_manage_fees or is_board_of'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
select pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() + 20, 'No VP since the ACM');
select pg_temp.seat(6, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM');
select pg_temp.seat(10, pg_temp.west(), 'sergeant_at_arms', pg_temp.today() - 1, 'No Sergeant since the ACM', null, pg_temp.today() - 10);
do $$
declare
  n int;
  ch uuid;
begin
  for n in 1..12 loop
    foreach ch in array array[pg_temp.north(), pg_temp.west()] loop
      assert pg_temp.helper_as(pg_temp.f(n), format('private.can_set_fees(%L)', ch))
        = pg_temp.helper_as(pg_temp.f(n), format('private.can_manage_fees(%L) or private.is_board_of(%L)', ch, ch)),
        'f' || n || ' in ' || ch;
    end loop;
  end loop;
  assert pg_temp.helper_as(pg_temp.f(4), format('private.can_set_fees(%L)', pg_temp.west())) = 'true', 'Lou, as National Secretary, handles money';
  assert pg_temp.helper_as(pg_temp.f(10), format('private.can_set_fees(%L)', pg_temp.west())) = 'false', 'Spanner''s lapsed stint doesn''t';
end $$;
rollback;

\echo 'held: hold_problem sees a covered Treasurer as Treasurer and ignores a lapsed stint'
begin;
select pg_temp.seat(8, pg_temp.west(), 'treasurer', pg_temp.today() + 20, 'Penny overseas', pg_temp.f(109));
select pg_temp.seat(6, pg_temp.north(), 'treasurer', pg_temp.today() - 1, 'No Treasurer since the ACM', null, pg_temp.today() - 10);
do $$ begin
  assert private.hold_problem(pg_temp.f(9), 'nec_auditor') = 'The National Auditor can’t also be a President or Treasurer (11.8).',
    'Torque covers Penny, who is still West''s Treasurer';
  assert private.hold_problem(pg_temp.f(6), 'nec_auditor') is null, 'Gus''s Treasurer stint ran until yesterday';
  assert private.hold_problem(pg_temp.f(12), 'treasurer') = 'The National Auditor can’t also be a President or Treasurer (11.8).',
    'Kim is still the Auditor';
end $$;
rollback;

\echo 'ACTING CHECKS PASSED'
