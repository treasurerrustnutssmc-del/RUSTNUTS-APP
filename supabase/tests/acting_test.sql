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
    ('private.push_acting_holder()'),
    ('private.sees_every_chapter()'),
    ('private.nec_voter_before(uuid, date)'),
    ('public.appoint_acting(uuid, uuid, public.position_role, date, text)'),
    ('public.request_cover(uuid, uuid, date, text)'),
    ('public.request_acting(uuid, uuid, public.position_role, uuid, date, text)'),
    ('public.withdraw_acting_request(uuid)'),
    ('public.confirm_acting(uuid)'),
    ('public.set_acting_until(uuid, date)'),
    ('private.acting_problem(uuid, uuid, public.position_role, uuid, date)'),
    ('private.acting_cap(uuid, public.position_role, boolean, date)'),
    ('private.ended_by_vote(uuid, uuid, public.position_role)'),
    ('private.acting_needs_vote(uuid, uuid, public.position_role)'),
    ('private.request_needs_vote(uuid)'),
    ('private.has_carried_acting_vote(uuid)'),
    ('private.auditor_stays_out(public.position_role)'),
    ('private.acting_electors(uuid, public.position_role, uuid, uuid)'),
    ('public.open_acting_vote(uuid, integer, timestamp with time zone, uuid)')
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
  assert (select bool_and(prosecdef and provolatile = 's' and proconfig @> array['search_path=""']) from pg_proc
          where oid = any (array['private.sees_every_chapter()', 'private.nec_voter_before(uuid, date)',
            'private.acting_problem(uuid, uuid, public.position_role, uuid, date)',
            'private.acting_cap(uuid, public.position_role, boolean, date)',
            'private.ended_by_vote(uuid, uuid, public.position_role)',
            'private.acting_needs_vote(uuid, uuid, public.position_role)', 'private.request_needs_vote(uuid)',
            'private.has_carried_acting_vote(uuid)', 'private.auditor_stays_out(public.position_role)',
            'private.acting_electors(uuid, public.position_role, uuid, uuid)']::regprocedure[]::oid[])),
    'the new readers are stable, and run as their owner with an empty search path';
  assert (select bool_and(prosecdef and provolatile = 'v' and proconfig @> array['search_path=""']) from pg_proc
          where oid = any (array['public.appoint_acting(uuid, uuid, public.position_role, date, text)',
            'public.request_cover(uuid, uuid, date, text)',
            'public.request_acting(uuid, uuid, public.position_role, uuid, date, text)',
            'public.withdraw_acting_request(uuid)', 'public.confirm_acting(uuid)',
            'public.set_acting_until(uuid, date)',
            'public.open_acting_vote(uuid, integer, timestamp with time zone, uuid)']::regprocedure[]::oid[])),
    'the acting RPCs run as their owner with an empty search path';
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

-- §3 Readers: duties, club-wide, and the positions catalogue ---------------------------------------

\echo 'duties: Jet chairs North and casts its NEC vote; Smokey is off the NEC'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$ begin
  assert private.chair_of(pg_temp.north()) = pg_temp.f(2), 'Jet chairs North and has its casting vote (9.10, 10.9)';
  assert private.nec_voter_for(pg_temp.north()) = pg_temp.f(2), 'and casts North''s NEC vote (11.2)';
  assert pg_temp.f(2) in (select private.electors_for('nec', null)), 'so he gets North''s NEC ballot';
  assert pg_temp.helper_as(pg_temp.f(2), 'private.is_national()') = 'true', 'Jet sits on the NEC';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.is_national()') = 'false', 'Smokey is off the NEC';
  assert pg_temp.f(1) not in (select private.electors_for('nec', null)), 'and has no NEC ballot';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.can_designate_big4()') = 'false', 'nor designates Big 4 rides (5.11)';
  assert pg_temp.helper_as(pg_temp.f(2), 'private.can_designate_big4()') = 'true', 'Jet does';
  assert pg_temp.helper_as(pg_temp.f(7), 'private.is_national()') = 'true', 'Rusty, uncovered, is still on the NEC';
end $$;
rollback;

\echo 'duties: an Acting VP (West, no President), or a VP''s stand-in, chairs West but doesn''t cast its NEC vote'
begin;
do $$ begin
  perform pg_temp.end_row(pg_temp.f(107));
  perform pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() + 20, 'No VP since the ACM');
  assert private.chair_of(pg_temp.west()) = pg_temp.f(11), 'Hal, Acting VP, chairs West with no President (10.9)';
  assert private.nec_voter_for(pg_temp.west()) is null, 'but a VP votes on the NEC only while formally acting as President (11.2)';
end $$;
rollback;
begin;
do $$
declare spanner uuid;
begin
  perform pg_temp.end_row(pg_temp.f(107));
  spanner := pg_temp.seat(10, pg_temp.west(), 'vice_president');
  assert private.nec_voter_for(pg_temp.west()) = pg_temp.f(10), 'Spanner, West''s VP, casts its NEC vote with no President';
  perform pg_temp.seat(8, pg_temp.west(), 'vice_president', pg_temp.today() + 20, 'Spanner away', spanner);
  assert private.chair_of(pg_temp.west()) = pg_temp.f(8), 'Torque, covering Spanner, chairs West';
  assert private.nec_voter_for(pg_temp.west()) is null, 'but neither he nor Spanner casts West''s NEC vote';
end $$;
rollback;

\echo 'duties: an Acting Treasurer keeps only their chapter''s books'
begin;
select pg_temp.seat(6, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM');
select pg_temp.seat(8, pg_temp.west(), 'treasurer', pg_temp.today() + 20, 'Penny overseas', pg_temp.f(109));
do $$ begin
  assert pg_temp.helper_as(pg_temp.f(6), format('private.keeps_books(%L)', pg_temp.north())) = 'true', 'Gus keeps North''s books';
  assert pg_temp.helper_as(pg_temp.f(6), format('private.can_manage_fees(%L)', pg_temp.north())) = 'true', 'and handles its fees';
  assert pg_temp.helper_as(pg_temp.f(6), 'private.keeps_books(null)') = 'false', 'but not the Club fund''s books';
  assert pg_temp.helper_as(pg_temp.f(6), format('private.keeps_books(%L)', pg_temp.west())) = 'false', 'nor West''s';
  assert pg_temp.helper_as(pg_temp.f(8), format('private.keeps_books(%L)', pg_temp.west())) = 'true', 'Torque, covering Penny, keeps West''s';
  assert pg_temp.helper_as(pg_temp.f(8), 'private.keeps_books(null)') = 'false', 'but not the Club fund''s';
  assert pg_temp.helper_as(pg_temp.f(9), format('private.keeps_books(%L)', pg_temp.west())) = 'false', 'Penny, covered, has handed West''s books over';
  assert pg_temp.helper_as(pg_temp.f(9), format('private.can_manage_fees(%L)', pg_temp.west())) = 'false', 'and its fees';
  assert pg_temp.helper_as(pg_temp.f(9), 'private.keeps_books(null)') = 'false', 'and the Club fund''s books';
  assert pg_temp.helper_as(pg_temp.f(9), format('private.sees_ledger(%L)', pg_temp.west())) = 'true', 'though, still on West''s board, she sees its ledger';
  assert pg_temp.helper_as(pg_temp.f(4), 'private.keeps_books(null)') = 'true', 'Lou, National Secretary, keeps the Club fund''s books';
  assert pg_temp.helper_as(pg_temp.f(12), format('private.sees_ledger(%L)', pg_temp.north())) = 'true', 'and Kim, the Auditor, sees every ledger';
end $$;
rollback;

\echo 'club-wide: no acting row reaches the Club fund, the shop, feedback or every chapter'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
select pg_temp.seat(6, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM');
do $$
declare
  who int;
  h text;
  report uuid;
begin
  -- Jet, Acting President (North), and Gus, Acting Treasurer (North).
  foreach who in array array[2, 6] loop
    foreach h in array array['private.approves_for(null)', 'private.keeps_books(null)', 'private.shop_seat()',
                             'private.is_feedback_keeper()', 'private.sees_every_chapter()',
                             format('private.sees_board_of(%L)', pg_temp.west())] loop
      assert pg_temp.helper_as(pg_temp.f(who), h) = 'false', 'f' || who || ', acting: ' || h;
    end loop;
  end loop;
  assert pg_temp.helper_as(pg_temp.f(7), 'private.approves_for(null)') = 'true', 'Rusty, a sitting President, approves Club fund spending';
  assert pg_temp.helper_as(pg_temp.f(7), 'private.shop_seat()') = 'true', 'and runs the shop';
  assert pg_temp.helper_as(pg_temp.f(7), 'private.sees_every_chapter()') = 'true', 'and sees every chapter';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.sees_board_of(%L)', pg_temp.north())) = 'true', 'North''s board records too';
  assert pg_temp.helper_as(pg_temp.f(9), 'private.keeps_books(null)') = 'true', 'Penny, a sitting Treasurer, keeps the Club fund''s books';
  assert pg_temp.helper_as(pg_temp.f(9), 'private.shop_seat()') = 'true', 'runs the shop';
  assert pg_temp.helper_as(pg_temp.f(9), 'private.is_feedback_keeper()') = 'true', 'and keeps the feedback inbox';
  assert pg_temp.helper_as(pg_temp.f(4), 'private.sees_every_chapter()') = 'true', 'Lou, National Secretary, sees every chapter';
  assert pg_temp.helper_as(pg_temp.f(12), 'private.sees_every_chapter()') = 'false', 'Kim, the Auditor, isn''t on the NEC (11.8)';
  insert into public.app_feedback (member_id, kind, body) values (pg_temp.f(10), 'idea', 'A tyre pressure chart') returning id into report;
  assert (select array_agg(member_id order by member_id) from private.push_outbox where dedupe_key = 'feedback:' || report)
    = array[pg_temp.f(4), pg_temp.f(9)], 'a new report reaches Lou and Penny, not Gus';
end $$;
rollback;

\echo 'club-wide: a covered President keeps sees_board_of(north) and loses sees_board_of(west) and approves_for(null)'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$ begin
  assert pg_temp.helper_as(pg_temp.f(1), format('private.sees_board_of(%L)', pg_temp.north())) = 'true', 'Smokey still reads North''s board records';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.approves_for(%L)', pg_temp.north())) = 'true', 'and approves North''s spending (13.3)';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.sees_board_of(%L)', pg_temp.west())) = 'false', 'but not West''s, while covered';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.approves_for(null)') = 'false', 'nor the Club fund''s spending';
  assert pg_temp.helper_as(pg_temp.f(1), 'private.sees_every_chapter()') = 'false', 'nor every chapter';
end $$;
rollback;

\echo 'club-wide: an Acting President can''t read West''s chapter chat; a sitting President can'
begin;
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$
declare
  west_chat uuid := (select id from public.conversations where kind = 'chapter' and chapter_id = pg_temp.west());
  north_chat uuid := (select id from public.conversations where kind = 'chapter' and chapter_id = pg_temp.north());
  nec_chat uuid := (select id from public.conversations where kind = 'nec');
begin
  assert pg_temp.helper_as(pg_temp.f(2), format('private.chat_problem(%L)', west_chat)) = 'That chat is for West chapter members.',
    'Jet, Acting President (North), doesn''t read West''s chapter chat';
  assert pg_temp.helper_as(pg_temp.f(2), format('private.chat_problem(%L)', nec_chat)) is null, 'but he''s in the NEC chat';
  assert pg_temp.helper_as(pg_temp.f(7), format('private.chat_problem(%L)', north_chat)) is null, 'Rusty, a sitting President, reads North''s';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.chat_problem(%L)', west_chat)) = 'That chat is for West chapter members.',
    'Smokey, covered, doesn''t read West''s for now';
  assert pg_temp.helper_as(pg_temp.f(1), format('private.chat_problem(%L)', nec_chat)) = 'That chat is for the NEC.',
    'and is out of the NEC chat while covered';
end $$;
rollback;

\echo 'lapsed: a lapsed but open row loses approves_for, keeps_books, nec_voter_for, chair_of and sees_board_of'
-- Which of the powers Hal (Acting President, West) and Gus (Acting Treasurer, North) still have.
create function pg_temp.lapse_powers() returns text[] language plpgsql as $$
declare yes text[] := '{}';
begin
  if pg_temp.helper_as(pg_temp.f(11), format('private.approves_for(%L)', pg_temp.west()))::boolean then yes := yes || 'approves_for'::text; end if;
  if pg_temp.helper_as(pg_temp.f(11), format('private.sees_board_of(%L)', pg_temp.west()))::boolean then yes := yes || 'sees_board_of'::text; end if;
  if private.nec_voter_for(pg_temp.west()) is not distinct from pg_temp.f(11) then yes := yes || 'nec_voter_for'::text; end if;
  if private.chair_of(pg_temp.west()) is not distinct from pg_temp.f(11) then yes := yes || 'chair_of'::text; end if;
  if pg_temp.helper_as(pg_temp.f(6), format('private.keeps_books(%L)', pg_temp.north()))::boolean then yes := yes || 'keeps_books'::text; end if;
  if pg_temp.helper_as(pg_temp.f(6), format('private.can_manage_fees(%L)', pg_temp.north()))::boolean then yes := yes || 'can_manage_fees'::text; end if;
  return yes;
end $$;
begin;
select pg_temp.clock_at('2026-12-13 23:59:59 Australia/Melbourne');
select pg_temp.end_row(pg_temp.f(107));
select pg_temp.seat(11, pg_temp.west(), 'president', '2026-12-13', 'No President since Rusty stepped down', null, '2026-12-01');
select pg_temp.seat(6, pg_temp.north(), 'treasurer', '2026-12-13', 'No Treasurer since the ACM', null, '2026-12-01');
do $$
declare got text[] := pg_temp.lapse_powers();
begin
  assert got = array['approves_for', 'sees_board_of', 'nec_voter_for', 'chair_of', 'keeps_books', 'can_manage_fees'],
    'until today, Hal and Gus have their seats'' powers: ' || got::text;
end $$;
select pg_temp.clock_at('2026-12-14 00:00:00 Australia/Melbourne');
do $$
declare got text[] := pg_temp.lapse_powers();
begin
  assert not exists (select 1 from positions where member_id in (pg_temp.f(6), pg_temp.f(11)) and ended_on is not null), 'nothing closed their stints';
  assert got = '{}', 'from Melbourne midnight they have none: ' || got::text;
  assert private.nec_voter_for(pg_temp.west()) is null and private.chair_of(pg_temp.west()) is null, 'West has no voter or chair';
end $$;
rollback;

\echo 'nec_voter_before: a President seated on the day doesn''t count, the VP does; an agreed cover counts from Smokey''s start, a voted one gives null'
begin;
do $$ begin
  perform pg_temp.end_row(pg_temp.f(101));
  perform pg_temp.seat(5, pg_temp.north(), 'president');
  assert private.nec_voter_before(pg_temp.north(), pg_temp.today()) = pg_temp.f(2),
    'Ned was seated today, so on a vote opened today Jet, the VP, casts North''s ballot';
  assert private.nec_voter_before(pg_temp.north(), pg_temp.today() + 1) = pg_temp.f(5), 'on one opened tomorrow, Ned does';
  assert private.nec_voter_for(pg_temp.north()) = pg_temp.f(5), 'and he''s North''s voter now';
end $$;
rollback;
begin;
do $$
declare
  cover uuid;
  vote uuid;
begin
  cover := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
  assert private.nec_voter_before(pg_temp.north(), pg_temp.today()) = pg_temp.f(2),
    'Smokey agreed the cover, so it counts from his start: Jet casts on a vote opened before it began';
  assert private.nec_voter_before(pg_temp.north(), '2026-08-02') = pg_temp.f(2), 'even one opened in August';
  insert into votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result)
  values (pg_temp.north(), pg_temp.f(2), 'president', 'Jet acts as President (North)?', 'chapter_board', 'majority', 2,
    now() - interval '4 days', now() - interval '1 day', now() - interval '1 day', 'carried')
  returning id into vote;
  update positions set acting_vote = vote where id = cover;
  assert private.nec_voter_before(pg_temp.north(), pg_temp.today()) is null,
    'a voted cover counts from its own start, so on a vote opened today nobody casts North''s ballot';
  assert private.nec_voter_before(pg_temp.north(), pg_temp.today() + 1) = pg_temp.f(2), 'on one opened tomorrow, Jet does';
  assert private.nec_voter_for(pg_temp.north()) = pg_temp.f(2), 'and he''s North''s voter now';
end $$;
rollback;

\echo 'minutes: the draft flags Jet''s acting row and its NEC list names Jet, not Smokey'
begin;
insert into private.app_settings (key, value) values ('assistant_on', 'true');
insert into meetings (id, chapter_id, kind, title, starts_at) values
  (pg_temp.f(201), pg_temp.north(), 'general', 'November meeting', now() - interval '1 day'),
  (pg_temp.f(202), null, 'nec', 'NEC meeting', now() - interval '1 day');
select pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey overseas', pg_temp.f(101));
do $$
declare got jsonb;
begin
  got := pg_temp.value_as(pg_temp.f(2), format('public.minutes_draft_start(%L)', pg_temp.f(201)))::jsonb -> 'board';
  assert got @> '[{"role": "president", "name": "Jet Black", "acting": true}]', 'North''s draft flags Jet''s acting row: ' || got::text;
  assert got @> '[{"role": "president", "name": "Smokey Stone", "acting": false}, {"role": "vice_president", "name": "Jet Black", "acting": false}]',
    'Smokey keeps his seat, and Jet his: ' || got::text;
  got := pg_temp.value_as(pg_temp.f(2), format('public.minutes_draft_start(%L)', pg_temp.f(202)))::jsonb -> 'board';
  assert (select array_agg(b ->> 'name' order by b ->> 'name') from jsonb_array_elements(got) b where b ->> 'role' = 'president')
    = array['Jet Black', 'Rusty Nail'], 'the NEC''s Presidents are Jet, acting for Smokey, and Rusty: ' || got::text;
  assert got @> '[{"role": "president", "name": "Jet Black", "acting": true}, {"role": "nec_secretary", "name": "Lou Reed", "acting": false}]',
    'with Jet flagged, beside the national seats: ' || got::text;
end $$;
rollback;

\echo 'catalogue: no live function or policy names public.positions off the allow-list'
do $$
declare off text;
begin
  -- Each of these reads or writes the table itself, for the reason given; every other reader goes
  -- through private.held_positions, private.duty_positions or private.clubwide_positions.
  with allowed(name, why) as (values
    ('appoint_position', 'a writer'),
    ('end_position', 'a writer'),
    ('renew_auditor', 'a writer'),
    ('forget_member', 'a writer'),
    ('add_roster_position', 'a writer'),
    ('settle_chapter_proposal', 'a writer'),
    ('appoint_acting', 'a writer (Task 4)'),
    ('confirm_acting', 'a writer (Task 4)'),
    ('set_acting_until', 'a writer (Task 4)'),
    ('close_lapsed_acting', 'the lazy close, a writer'),
    ('check_covers', 'the covers trigger reads the covered row as stored'),
    ('on_position_end', 'the ending trigger, a writer'),
    ('has_carried_nec_vote', 'history: who held a seat when a vote carried'),
    ('acting_cap', 'a run''s start, from ended rows (Task 4)'),
    ('acting_needs_vote', 'when the President seat fell empty, from ended rows (Task 4)'),
    ('approval_conflict', 'rows held on an approval''s day (Task 7)')
  )
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into off
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosrc ~ '(public\.|(from|join)\s+)positions\y'
    and p.proname not in (select name from allowed);
  assert off is null, 'these name public.positions: read one of the three views, or add them to the allow-list with a reason: ' || off;
  select string_agg(schemaname || '.' || tablename || ' ' || policyname, ', ') into off
  from pg_policies where coalesce(qual, '') ~ '\ypositions\y' or coalesce(with_check, '') ~ '\ypositions\y';
  assert off is null, 'these policies name positions: ' || off;
end $$;

-- §4 Acting RPCs and caps ------------------------------------------------------------------------

-- The words each refusal uses (the spec's Appendix A), by the app's constant name.
create temp table acting_words (k text primary key, t text not null);
insert into acting_words (k, t) values
  ('ACTING_CHAPTER_ONLY', 'Acting is for chapter roles, not national seats or honours.'),
  ('SEAT_HAS_HOLDER', 'That seat has a holder. Arrange a cover instead.'),
  ('SEAT_HAS_ACTING', 'Someone is already acting in that seat, or a request is waiting.'),
  ('ONE_STINT', 'They’re already acting in a role. One stint at a time.'),
  ('OWN_SEAT_COVERED', 'Their own seat is covered, so they can’t act for anyone.'),
  ('CHAIR_NOT_BOOKS', 'An Acting President can’t also keep the chapter’s books (9.5).'),
  ('BOOKS_NOT_CHAIR', 'An Acting Treasurer can’t also be the chapter’s President (9.5).'),
  ('HIATUS_NO_LEAD', 'Members on hiatus can’t lead rides.'),
  ('COVER_BOARD_SEATS', 'Only board seats can be covered.'),
  ('COVER_FROM_BOARD', 'A cover goes to someone already on that chapter’s board.'),
  ('PRESIDENT_NEEDS_BOARD_VOTE', 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).'),
  ('ENDED_BY_VOTE', 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.'),
  ('WHY_NEEDED', 'Say why, in 120 characters or fewer.'),
  ('RUN_OVER', 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).'),
  ('ASKED_RECENTLY', 'The board voted down your request for this seat in the last 28 days.'),
  ('SMALL_BOARD', 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).'),
  ('LICENCE_ENDS', 'Their recorded licence ends before the until date (9.7).'),
  ('RECORD_INSTEAD', 'This doesn’t need a vote. Record it as acting, or ask for cover from your own seat.'),
  ('AUDITOR_STAYS_OUT', 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).'),
  ('BOARD_RECORDS_ACTING', 'Only that chapter’s board can record acting here.'),
  ('NOT_YOURSELF', 'You can’t record yourself as acting.'),
  ('OWN_SEAT_ONLY', 'You can only ask for cover of your own board seat.'),
  ('NO_REQUEST', 'That request isn’t open.'),
  ('CONFIRM_NOT_STANDIN', 'The stand-in can’t confirm their own acting.'),
  ('CONFIRM_NOT_HOLDER', 'A third board member confirms the cover you asked for (9.5).'),
  ('NEEDS_ACTING_VOTE', 'This needs a carried board vote on the request in the last 90 days.'),
  ('SEAT_ENDED', 'The seat they asked to cover has ended.'),
  ('WITHDRAW_WHO', 'Only the stand-in or the holder can withdraw this, or the person who asked before a vote on it opens.'),
  ('NOT_ACTING', 'That isn’t an acting seat.'),
  ('UNTIL_NOT_PAST', 'Pick today or later. To end it now, step down.'),
  ('EARLIER_WHO', 'Only the acting person or the holder can bring the date forward.'),
  ('LATER_WHO_EMPTY', 'Only another board member can give this more time.'),
  ('VOTED_NEEDS_NEW_VOTE', 'The board voted for this stint, so it needs a new vote to run longer.');
create function pg_temp.w(key text) returns text language sql stable as $$
  select t from acting_words where k = key
$$;
create function pg_temp.until_range(cap date) returns text language sql immutable as $$
  select 'Pick an until date from today to ' || to_char(cap, 'DD/MM/YYYY') || '.'
$$;

-- Each RPC call, as SQL text.
create function pg_temp.appoint_acting_sql(who int, ch uuid, r text, until date, why text default 'Short-handed')
returns text language sql stable as $$
  select format('public.appoint_acting(%L, %L, %L, %L, %L)', pg_temp.f(who), ch, r, until, why)
$$;
create function pg_temp.request_cover_sql(seat uuid, who int, until date, why text default 'Away for a while')
returns text language sql stable as $$
  select format('public.request_cover(%L, %L, %L, %L)', seat, pg_temp.f(who), until, why)
$$;
create function pg_temp.request_acting_sql(who int, ch uuid, r text, covers uuid, until date, why text default 'Can''t be reached')
returns text language sql stable as $$
  select format('public.request_acting(%L, %L, %L, %L, %L, %L)', pg_temp.f(who), ch, r, covers, until, why)
$$;
create function pg_temp.confirm_sql(req uuid) returns text language sql immutable as $$
  select format('public.confirm_acting(%L)', req)
$$;
create function pg_temp.withdraw_sql(req uuid) returns text language sql immutable as $$
  select format('public.withdraw_acting_request(%L)', req)
$$;
create function pg_temp.set_until_sql(pos uuid, until date) returns text language sql immutable as $$
  select format('public.set_acting_until(%L, %L)', pos, until)
$$;

-- Makes the call as member n: null when it goes through (its changes stay), else its refusal.
create function pg_temp.by(n int, call text) returns text language sql as $$
  select pg_temp.try_as(pg_temp.f(n), 'select ' || call)
$$;
-- Makes the call as member n and returns the id it hands back; a refusal stops the run.
create function pg_temp.id_by(n int, call text) returns uuid language sql as $$
  select pg_temp.value_as(pg_temp.f(n), call)::uuid
$$;

-- A vote as the owner, about member n in that role: closed n days ago after a week open with that
-- result, or (result null) open since yesterday for two more days.
create function pg_temp.vote(ch uuid, subject int, r text, electorate text, threshold text, result text,
  closed_days_ago int default 1, request uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.votes (chapter_id, subject_member_id, subject_role, question, electorate, threshold, quorum,
                            opened_at, closes_at, closed_at, result, acting_request)
  values (ch, pg_temp.f(subject), r::public.position_role, 'About a seat', electorate::public.electorate,
          threshold::public.vote_threshold, 3,
          case when result is null then now() - interval '1 day' else now() - (closed_days_ago + 7) * interval '1 day' end,
          case when result is null then now() + interval '2 days' else now() - closed_days_ago * interval '1 day' end,
          case when result is null then null else now() - closed_days_ago * interval '1 day' end,
          result::public.vote_result, request)
  returning id into v;
  return v;
end $$;

-- The moment that reads as Melbourne date d on the club clock as it stands (moved or not).
create function pg_temp.on_day(d date) returns timestamptz language sql stable as $$
  select now() + (d - private.club_date()) * interval '1 day'
$$;

-- An ACM (or another meeting) as the owner.
create function pg_temp.meeting(ch uuid, k text, at timestamptz, cancelled boolean default false) returns void language sql as $$
  insert into public.meetings (chapter_id, kind, title, starts_at, cancelled_at)
  values (ch, k::public.meeting_kind, 'A meeting', at, case when cancelled then now() end)
$$;

\echo 'routes: Smokey records Crank as Acting Treasurer (North)'
begin;
do $$
declare
  stint uuid;
  u date := pg_temp.today() + 28;
begin
  stint := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', u, 'No Treasurer since the ACM'));
  assert (select member_id = pg_temp.f(3) and chapter_id = pg_temp.north() and role = 'treasurer' and started_on = pg_temp.today()
            and acting_until = u and acting_why = 'No Treasurer since the ACM' and appointed_by = pg_temp.f(1)
            and covers is null and acting_vote is null and acting_request is null and ended_on is null
          from positions where id = stint), 'Crank acts as Treasurer from today until the date, recorded by Smokey';
  assert (select ended_on is null from positions where id = pg_temp.f(103)), 'and keeps his Road Captain seat';
end $$;
rollback;

\echo 'routes: every refusal, in order'
begin;
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  u date := pg_temp.today() + 28;
  cap date := (pg_temp.today() + interval '6 months')::date;
  cover uuid;
  req uuid;
  v uuid;
begin
  -- 1 Signed in and approved.
  perform set_config('request.jwt.claim.sub', '', true);
  assert pg_temp.refusal('select ' || pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = 'Sign in first.', 'signed out';
  update members set approval = 'suspended' where id = pg_temp.f(6);
  assert pg_temp.by(6, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = 'Only approved members can do that.', 'a suspended member';
  update members set approval = 'approved' where id = pg_temp.f(6);

  -- 2 The caller's standing: an NEC officer has none.
  assert pg_temp.by(4, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = pg_temp.w('BOARD_RECORDS_ACTING'),
    'Lou, National Secretary, isn''t on North''s board';
  assert pg_temp.by(7, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'nor is Rusty';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(3, n, 'treasurer', u)) = pg_temp.w('NOT_YOURSELF'), 'Crank can''t record himself';

  -- 3 The Auditor stays out (11.8).
  perform pg_temp.seat(12, pg_temp.west(), 'vice_president');
  assert pg_temp.by(12, pg_temp.appoint_acting_sql(10, pg_temp.west(), 'treasurer', u)) = pg_temp.w('AUDITOR_STAYS_OUT'),
    'Kim, the Auditor, also West''s VP, can''t record a Treasurer';
  assert pg_temp.by(12, pg_temp.appoint_acting_sql(10, pg_temp.west(), 'president', u)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'nor a President';
  assert pg_temp.by(12, pg_temp.appoint_acting_sql(10, pg_temp.west(), 'secretary', u)) = pg_temp.w('SEAT_HAS_HOLDER'),
    'a Secretary gets past that check';

  -- 5 Who may act.
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'nec_auditor', u)) = pg_temp.w('ACTING_CHAPTER_ONLY'), 'not a national seat';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'founder', u)) = pg_temp.w('ACTING_CHAPTER_ONLY'), 'nor an honour';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(10, n, 'treasurer', u)) = 'They’re not a member of that chapter.', 'Spanner is West''s';
  update members set approval = 'suspended' where id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = 'Approve them first.', 'a suspended member';
  update members set approval = 'approved', status = 'supporter' where id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = 'Only Full and Nomad members hold Club positions (4.6, 5.8).',
    'hold_problem: a Supporter';
  update members set status = 'nomad' where id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = 'Nomads can’t hold a board or national seat (9.1).',
    'hold_problem: a Nomad on the board';
  update members set status = 'full' where id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(3, n, 'road_captain', u)) = 'They already hold that role.', 'Crank is Road Captain';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'vice_president', u)) = pg_temp.w('SEAT_HAS_HOLDER'), 'Jet holds the VP seat';
  req := pg_temp.request(n, 'treasurer', 6, null, u, 'No Treasurer since the ACM', 3);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'treasurer', u)) = pg_temp.w('SEAT_HAS_ACTING'), 'a request is waiting';
  update acting_requests set closed_at = now(), outcome = 'withdrawn' where id = req;
  perform pg_temp.seat(6, n, 'sergeant_at_arms', u, 'No Sergeant since the ACM');
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'sergeant_at_arms', u)) = pg_temp.w('SEAT_HAS_ACTING'), 'Gus acts there';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(6, n, 'treasurer', u)) = pg_temp.w('ONE_STINT'), 'Gus acts already';
  cover := pg_temp.seat(2, n, 'president', u, 'Smokey overseas', pg_temp.f(101));
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(1, n, 'treasurer', u)) = pg_temp.w('OWN_SEAT_COVERED'), 'Jet covers Smokey''s seat';
  perform pg_temp.end_row(cover, 'holder_back');
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(1, n, 'treasurer', u)) = pg_temp.w('BOOKS_NOT_CHAIR'), 'Smokey is President';
  update members set on_hiatus = true where id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u)) = pg_temp.w('HIATUS_NO_LEAD'), 'Ned is on hiatus';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'officer', u, ' ')) = pg_temp.w('WHY_NEEDED'),
    'an Officer doesn''t lead rides, so hiatus is no bar there';
  update members set on_hiatus = false where id = pg_temp.f(5);
  insert into member_private (member_id, licence_class, licence_expiry) values (pg_temp.f(5), 'full_open', u - 1);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u)) = pg_temp.w('LICENCE_ENDS'), 'Ned''s licence ends the day before';
  update member_private set licence_expiry = u where member_id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u, ' ')) = pg_temp.w('WHY_NEEDED'), 'one lasting the stint is fine';
  update member_private set licence_class = 'learner', licence_expiry = null where member_id = pg_temp.f(5);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u)) = pg_temp.w('LICENCE_ENDS'), 'a learner''s licence';
  update member_private set licence_class = 'full_open' where member_id = pg_temp.f(5);

  -- 6 The vote rule.
  v := pg_temp.vote(n, 5, 'secretary', 'chapter_board', 'majority', 'carried', 2);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u)) = pg_temp.w('ENDED_BY_VOTE'), 'a board vote ended his acting there';
  delete from votes where id = v;
  perform pg_temp.vote(n, 5, 'secretary', 'chapter_board', 'majority', 'carried', 91);
  req := pg_temp.request(n, 'secretary', 5, null, u, 'No Secretary since the ACM', 3);
  update acting_requests set closed_at = now(), outcome = 'confirmed' where id = req;
  perform pg_temp.vote(n, 5, 'secretary', 'chapter_board', 'majority', 'carried', 2, req);
  perform pg_temp.vote(n, 5, 'secretary', 'chapter_board', 'majority', 'lost', 2);
  perform pg_temp.vote(n, 5, 'treasurer', 'chapter_board', 'majority', 'carried', 2);
  perform pg_temp.vote(pg_temp.west(), 5, 'secretary', 'chapter_board', 'majority', 'carried', 2);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, n, 'secretary', u, ' ')) = pg_temp.w('WHY_NEEDED'),
    'one closed 91 days ago, a vote for acting, a lost one, or one about another seat or chapter doesn''t count';
  perform pg_temp.end_row(pg_temp.f(101));
  perform pg_temp.seat(5, n, 'treasurer');
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('CHAIR_NOT_BOOKS'), 'Ned is Treasurer';
  perform pg_temp.end_row(id) from positions where member_id = pg_temp.f(5) and ended_on is null;
  v := pg_temp.vote(n, 5, 'president', 'chapter_board', 'majority', 'carried', 2);
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('ENDED_BY_VOTE'), 'an end vote comes first';
  delete from votes where id = v;
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'), 'Ned isn''t the VP';

  -- 7 Why, and 8 the date.
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', u, null)) = pg_temp.w('WHY_NEEDED'), 'no why';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', u, '  ')) = pg_temp.w('WHY_NEEDED'), 'a blank why';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', u, repeat('x', 121))) = pg_temp.w('WHY_NEEDED'), '121 characters';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', t - 1)) = pg_temp.until_range(cap), 'until yesterday';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', null)) = pg_temp.until_range(cap), 'no until';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', cap + 1)) = pg_temp.until_range(cap), 'past the cap';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'secretary', cap, ' ' || repeat('x', 120) || ' ')) is null,
    'up to the cap, with 120 characters of why';
  assert (select acting_why = repeat('x', 120) from positions where member_id = pg_temp.f(5) and role = 'secretary'), 'stored trimmed';
end $$;
rollback;

\echo 'routes: President (Smokey''s row ended): Crank records Jet (VP before it ended), no vote; anyone else needs one'
begin;
do $$
declare
  n uuid := pg_temp.north();
  u date := pg_temp.today() + 28;
  stint uuid;
begin
  update positions set ended_on = pg_temp.today() - 3, ended_by = pg_temp.f(1) where id = pg_temp.f(101);
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'),
    'Ned, with a VP in the chapter';
  stint := pg_temp.id_by(3, pg_temp.appoint_acting_sql(2, n, 'president', u, 'No President since Smokey stepped down'));
  assert (select member_id = pg_temp.f(2) and role = 'president' and covers is null and acting_vote is null and appointed_by = pg_temp.f(3)
          from positions where id = stint), 'Jet, VP since before the seat fell empty, acts as President with no vote (8.2)';
end $$;
rollback;
begin;
do $$
declare
  n uuid := pg_temp.north();
  u date := pg_temp.today() + 28;
begin
  update positions set ended_on = pg_temp.today() - 3, ended_by = pg_temp.f(1) where id = pg_temp.f(101);
  update positions set ended_on = pg_temp.today() - 3, ended_by = pg_temp.f(2) where id = pg_temp.f(102);
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'),
    'Ned, with no VP in the chapter';
  insert into positions (member_id, chapter_id, role, started_on, appointed_by)
  values (pg_temp.f(5), n, 'vice_president', pg_temp.today() - 3, pg_temp.f(3));
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'),
    'Ned, seated VP by Crank the day the President seat fell empty';
  update positions set started_on = pg_temp.today() - 1 where member_id = pg_temp.f(5) and role = 'vice_president';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'),
    'or after it';
  update positions set started_on = pg_temp.today() - 4 where member_id = pg_temp.f(5) and role = 'vice_president';
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(5, n, 'president', u)) is null, 'a VP seated the day before can act with no vote';
end $$;
rollback;
begin;
do $$ begin
  assert pg_temp.by(7, pg_temp.request_cover_sql(pg_temp.f(107), 8, pg_temp.today() + 28, 'Rusty overseas'))
    = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'), 'West has no VP, so Rusty''s Secretary needs a vote to cover him';
end $$;
rollback;

\echo 'routes: Lou can''t record, propose or confirm North''s Acting President'
begin;
do $$
declare
  n uuid := pg_temp.north();
  u date := pg_temp.today() + 28;
  req uuid := pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), pg_temp.today() + 28, 'Smokey overseas', 1);
begin
  assert pg_temp.by(4, pg_temp.confirm_sql(req)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'confirm';
  update acting_requests set closed_at = now(), outcome = 'withdrawn' where id = req;
  perform pg_temp.end_row(pg_temp.f(101));
  assert pg_temp.by(4, pg_temp.appoint_acting_sql(2, n, 'president', u)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'record';
  assert pg_temp.by(4, pg_temp.request_acting_sql(5, n, 'president', null, u)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'propose';
end $$;
rollback;

\echo 'routes: after a carried end vote on Jet''s stint, or a 9.3 removal of Penny as Treasurer, re-recording gets ENDED_BY_VOTE; request_acting takes it'
begin;
do $$
declare
  n uuid := pg_temp.north();
  u date := pg_temp.today() + 28;
  stint uuid;
  req uuid;
begin
  perform pg_temp.end_row(pg_temp.f(101));
  stint := pg_temp.seat(2, n, 'president', u, 'No President since Smokey stepped down');
  perform pg_temp.vote(n, 2, 'president', 'chapter_board', 'majority', 'carried', 1);
  perform pg_temp.end_row(stint, 'removed');
  assert pg_temp.by(3, pg_temp.appoint_acting_sql(2, n, 'president', u)) = pg_temp.w('ENDED_BY_VOTE'),
    'the board voted Jet out of acting there yesterday, so Crank can''t record him again';
  perform pg_temp.seat(5, n, 'secretary');
  perform pg_temp.seat(6, n, 'treasurer');
  req := pg_temp.id_by(3, pg_temp.request_acting_sql(2, n, 'president', null, u, 'Jet again, if the board agrees'));
  assert (select member_id = pg_temp.f(2) and covers is null and requested_by = pg_temp.f(3) and closed_at is null
          from acting_requests where id = req), 'a new board vote can, so Crank proposes it';
end $$;
rollback;
begin;
do $$
declare
  w uuid := pg_temp.west();
  u date := pg_temp.today() + 28;
  req uuid;
begin
  perform pg_temp.vote(w, 9, 'treasurer', 'chapter_patched', 'two_thirds', 'carried', 1);
  perform pg_temp.end_row(pg_temp.f(109), 'removed');
  assert pg_temp.by(8, pg_temp.appoint_acting_sql(9, w, 'treasurer', u)) = pg_temp.w('ENDED_BY_VOTE'),
    'West''s Full Members removed Penny as Treasurer yesterday (9.3), so Torque can''t record her acting there';
  perform pg_temp.seat(10, w, 'sergeant_at_arms');
  perform pg_temp.seat(11, w, 'road_captain');
  req := pg_temp.id_by(8, pg_temp.request_acting_sql(9, w, 'treasurer', null, u, 'Penny again, if the board agrees'));
  assert (select member_id = pg_temp.f(9) and requested_by = pg_temp.f(8) from acting_requests where id = req), 'a board vote can';
end $$;
rollback;

\echo 'caps: from 30/11/2026 and 31/01/2027'
do $$
declare n uuid := pg_temp.north();
begin
  assert private.acting_cap(n, 'president', true, '2026-11-30') = '2027-02-28', 'a cover: three months, to the month''s end';
  assert private.acting_cap(n, 'treasurer', false, '2026-11-30') = '2027-05-30', 'an empty board seat with no ACM saved: six months';
  assert private.acting_cap(n, 'president', true, '2027-01-31') = '2027-04-30', 'a cover from 31/01';
  assert private.acting_cap(n, 'treasurer', false, '2027-01-31') = '2027-07-31', 'an empty seat from 31/01';
end $$;

\echo 'caps: a North agm on 14/02/2027 caps the empty seat at 2027-02-14'
begin;
do $$
declare
  n uuid := pg_temp.north();
begin
  perform pg_temp.meeting(n, 'agm', '2027-02-14 00:30 Australia/Melbourne');
  perform pg_temp.meeting(n, 'agm', '2027-01-10 19:00 Australia/Melbourne', true);
  perform pg_temp.meeting(n, 'special', '2027-01-05 19:00 Australia/Melbourne');
  perform pg_temp.meeting(n, 'general', '2027-01-06 19:00 Australia/Melbourne');
  perform pg_temp.meeting(pg_temp.west(), 'agm', '2027-01-03 19:00 Australia/Melbourne');
  perform pg_temp.meeting(null, 'agm', '2027-01-04 19:00 Australia/Melbourne');
  perform pg_temp.meeting(n, 'agm', '2026-11-29 19:00 Australia/Melbourne');
  assert private.acting_cap(n, 'treasurer', false, '2026-11-30') = '2027-02-14',
    'the first uncancelled North ACM on or after the start, by its Melbourne date';
  assert private.acting_cap(n, 'treasurer', true, '2026-11-30') = '2027-02-28', 'a cover ignores it';
  assert private.acting_cap(n, 'tail_gunner', false, '2026-11-30') = '2027-05-30', 'so does a non-board role';
end $$;
rollback;

\echo 'caps: a 2029 agm caps at run start + 12 months'
begin;
do $$ begin
  perform pg_temp.meeting(pg_temp.north(), 'agm', '2029-03-01 19:00 Australia/Melbourne');
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, '2026-11-30') = '2027-11-30', 'never more than twelve months';
end $$;
rollback;

\echo 'caps: re-recorded the day after stepping down keeps the first start'
-- These move the club clock and touch only dates (started_on, ended_on, acting_until), which stay
-- put when it moves.
begin;
select pg_temp.clock_at('2026-11-30 12:00 Australia/Melbourne');
do $$ begin
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', '2026-12-31')) is null, 'Ned acts from 30/11';
end $$;
select pg_temp.clock_at('2026-12-10 12:00 Australia/Melbourne');
select pg_temp.end_row(id) from positions where member_id = pg_temp.f(5) and ended_on is null;
select pg_temp.clock_at('2026-12-11 12:00 Australia/Melbourne');
do $$ begin
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, '2026-12-11') = '2027-05-30', 'the run started on 30/11';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', '2027-05-31')) = pg_temp.until_range('2027-05-30'),
    'so re-recording Ned the day after he stepped down can''t reach past 30/05/2027';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(6, pg_temp.north(), 'treasurer', '2027-05-31')) = pg_temp.until_range('2027-05-30'),
    'nor can recording Gus there instead';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', '2027-05-30')) is null, 'up to it is fine';
end $$;
rollback;

\echo 'caps: an agm held since the run began: RUN_OVER for a new stint or an extension; one before it doesn''t count'
begin;
do $$
declare
  t date := pg_temp.today();
  stint uuid := pg_temp.seat(5, pg_temp.north(), 'treasurer', pg_temp.today() + 10, 'No Treasurer since the ACM', null, pg_temp.today() - 30);
begin
  perform pg_temp.meeting(pg_temp.north(), 'agm', pg_temp.on_day(t - 40));
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, t - 30) = (t - 30 + interval '6 months')::date,
    'an ACM before the run began doesn''t count';
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 20)) is null, 'so Ned''s stint can run longer';
  perform pg_temp.meeting(pg_temp.north(), 'agm', pg_temp.on_day(t - 5));
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, t - 30) = t - 5, 'the run''s ACM was five days ago';
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 25)) = pg_temp.w('RUN_OVER'), 'so it can''t run longer now';
  assert pg_temp.by(5, pg_temp.set_until_sql(stint, t + 1)) is null, 'though Ned can bring it forward';
  perform pg_temp.end_row(stint);
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(6, pg_temp.north(), 'treasurer', t + 10)) = pg_temp.w('RUN_OVER'),
    'nor can a new stint start in the seat';
end $$;
rollback;

\echo 'caps: 29 days after the last stint ended, a new run'
begin;
select pg_temp.clock_at('2026-11-30 12:00 Australia/Melbourne');
do $$ begin
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', '2026-12-31')) is null, 'Ned acts from 30/11';
end $$;
select pg_temp.clock_at('2027-01-29 12:00 Australia/Melbourne');
select private.close_lapsed_acting();
do $$ begin
  assert (select ended_on = '2027-01-01' from positions where member_id = pg_temp.f(5) and role = 'treasurer'), 'it lapsed: last day 31/12';
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, '2027-01-29') = '2027-05-30', '28 days on, the same run';
end $$;
select pg_temp.clock_at('2027-01-30 12:00 Australia/Melbourne');
do $$ begin
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, '2027-01-30') = '2027-07-30', '29 days on, a new run';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(6, pg_temp.north(), 'treasurer', '2027-07-30')) is null, 'so Gus gets six months';
end $$;
rollback;
begin;
select pg_temp.clock_at('2026-11-30 12:00 Australia/Melbourne');
do $$ begin
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', '2026-12-31')) is null, 'Ned acts from 30/11';
end $$;
select pg_temp.clock_at('2026-12-05 12:00 Australia/Melbourne');
select pg_temp.end_row(id) from positions where member_id = pg_temp.f(5) and ended_on is null;
select pg_temp.seat(6, pg_temp.north(), 'treasurer');
select pg_temp.clock_at('2026-12-06 12:00 Australia/Melbourne');
select pg_temp.end_row(id) from positions where member_id = pg_temp.f(6) and ended_on is null;
do $$ begin
  assert private.acting_cap(pg_temp.north(), 'treasurer', false, '2026-12-06') = '2027-06-06',
    'a stint before the seat''s last elected holder ended isn''t in the run';
end $$;
rollback;

\echo 'caps: an Acting Tail Gunner beside a sitting one caps at its start + 6 months'
begin;
select pg_temp.seat(6, pg_temp.north(), 'tail_gunner');
select pg_temp.meeting(pg_temp.north(), 'agm', now() + interval '10 days');
do $$
declare cap date := (pg_temp.today() + interval '6 months')::date;
begin
  assert private.acting_cap(pg_temp.north(), 'tail_gunner', false, pg_temp.today()) = cap, 'six months, ACM or not';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'tail_gunner', cap + 1)) = pg_temp.until_range(cap), 'not a day more';
  assert pg_temp.by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'tail_gunner', cap)) is null, 'Ned acts beside Gus';
  assert (select count(*) from positions where chapter_id = pg_temp.north() and role = 'tail_gunner' and ended_on is null) = 2, 'two Tail Gunners';
end $$;
rollback;

\echo 'routes: Smokey asks for Jet; Crank confirms'
begin;
do $$
declare
  u date := pg_temp.today() + 28;
  req uuid;
  pos uuid;
begin
  req := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, u, 'Smokey overseas'));
  assert (select chapter_id = pg_temp.north() and role = 'president' and member_id = pg_temp.f(2) and covers = pg_temp.f(101)
            and until = u and why = 'Smokey overseas' and requested_by = pg_temp.f(1) and closed_at is null
          from acting_requests where id = req), 'Smokey asks for Jet to cover his seat';
  assert not exists (select 1 from positions where covers = pg_temp.f(101)), 'nothing moves yet';
  pos := pg_temp.id_by(3, pg_temp.confirm_sql(req));
  assert (select member_id = pg_temp.f(2) and chapter_id = pg_temp.north() and role = 'president' and covers = pg_temp.f(101)
            and started_on = pg_temp.today() and acting_until = u and acting_why = 'Smokey overseas' and appointed_by = pg_temp.f(3)
            and acting_vote is null and acting_request = req
          from positions where id = pos), 'Crank confirms: Jet covers Smokey, with no vote behind it';
  assert (select outcome = 'confirmed' and closed_at is not null from acting_requests where id = req), 'the request is confirmed';
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('NO_REQUEST'), 'a second confirm';
  assert (select count(*) from positions where covers = pg_temp.f(101)) = 1, 'one cover';
end $$;
rollback;

\echo 'routes: asking for a cover: the refusals'
begin;
do $$
declare
  u date := pg_temp.today() + 28;
  tg uuid := pg_temp.seat(3, pg_temp.north(), 'tail_gunner');
  req uuid;
begin
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 1, u)) = pg_temp.w('NOT_YOURSELF'), 'Smokey can''t cover himself';
  assert pg_temp.by(3, pg_temp.request_cover_sql(pg_temp.f(101), 2, u)) = pg_temp.w('OWN_SEAT_ONLY'), 'Crank can''t ask for Smokey''s seat';
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(102), 3, u)) = pg_temp.w('OWN_SEAT_ONLY'), 'nor Smokey for Jet''s';
  assert pg_temp.by(3, pg_temp.request_cover_sql(tg, 2, u)) = pg_temp.w('OWN_SEAT_ONLY'), 'a Tail Gunner seat isn''t a board seat';
  req := pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms', u, 'No Sergeant since the ACM');
  assert pg_temp.by(6, pg_temp.request_cover_sql(req, 2, u)) = pg_temp.w('OWN_SEAT_ONLY'), 'nor is an acting one Gus''s own to hand on';
  perform pg_temp.end_row(req);
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 5, u)) = pg_temp.w('COVER_FROM_BOARD'), 'Ned isn''t on the board';
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 3, u)) = pg_temp.w('PRESIDENT_NEEDS_BOARD_VOTE'), 'Crank isn''t the VP';
  req := pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 1);
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, u)) = pg_temp.w('ENDED_BY_VOTE'), 'a board vote ended Jet''s acting there';
  delete from votes where id = req;
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, u, ' ')) = pg_temp.w('WHY_NEEDED'), 'a why';
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, (pg_temp.today() + interval '3 months')::date + 1))
    = pg_temp.until_range((pg_temp.today() + interval '3 months')::date), 'a cover runs three months at most';
  req := pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), u, 'Smokey overseas', 3);
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, u)) = pg_temp.w('SEAT_HAS_ACTING'), 'a request is waiting';
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'lost', 1, req);
  assert pg_temp.by(3, pg_temp.request_cover_sql(pg_temp.f(103), 2, u)) is null, 'Crank asks for Jet to cover his Road Captain seat';
  assert (select outcome = 'rejected' from acting_requests where id = req), 'which closed the voted-down request';
  update acting_requests set requested_by = pg_temp.f(1) where id = req;
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, u)) = pg_temp.w('ASKED_RECENTLY'), 'had Smokey asked, he''d wait';
  update acting_requests set closed_at = now() - interval '28 days' where id = req;
  update acting_requests set closed_at = now(), outcome = 'withdrawn' where closed_at is null;
  perform pg_temp.end_row(pg_temp.f(102));
  assert pg_temp.by(1, pg_temp.request_cover_sql(pg_temp.f(101), 3, u)) = pg_temp.w('SMALL_BOARD'), 'a board of two';
end $$;
rollback;

\echo 'routes: confirm re-runs every check'
begin;
do $$
declare req uuid := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28, 'Smokey overseas'));
begin
  assert pg_temp.by(1, pg_temp.confirm_sql(req)) = pg_temp.w('CONFIRM_NOT_HOLDER'), 'not Smokey';
  assert pg_temp.by(2, pg_temp.confirm_sql(req)) = pg_temp.w('CONFIRM_NOT_STANDIN'), 'not Jet';
  perform pg_temp.end_row(pg_temp.f(101));
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('SEAT_ENDED'), 'Smokey''s seat ended';
  assert (select closed_at is null from acting_requests where id = req), 'a refused confirm leaves the request open';
end $$;
rollback;
begin;
do $$
declare req uuid := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28, 'Smokey overseas'));
begin
  perform pg_temp.end_row(pg_temp.f(102));
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('COVER_FROM_BOARD'), 'Jet left the board';
end $$;
rollback;
begin;
do $$
declare req uuid := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28, 'Smokey overseas'));
begin
  perform pg_temp.seat(2, pg_temp.north(), 'tail_gunner', pg_temp.today() + 10, 'Short a Tail Gunner');
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('ONE_STINT'), 'Jet is acting elsewhere';
end $$;
rollback;
begin;
do $$
declare req uuid := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28, 'Smokey overseas'));
begin
  perform pg_temp.seat(2, pg_temp.north(), 'secretary');
  perform pg_temp.end_row(pg_temp.f(102));
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('NEEDS_ACTING_VOTE'),
    'Jet is still on the board as Secretary, but no longer the VP, so a cover of the President needs a vote';
end $$;
rollback;
begin;
create temp table ids as
  select pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 3, 'Smokey overseas')) as req;
select pg_temp.clock_at(now() + interval '4 days');
do $$
declare
  req uuid := (select req from ids);
  again uuid;
begin
  assert pg_temp.by(3, pg_temp.confirm_sql(req)) = pg_temp.w('NO_REQUEST'), 'its date passed';
  again := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 3, 'Smokey still overseas'));
  assert (select outcome = 'lapsed' from acting_requests where id = req), 'the old one lapsed';
  assert pg_temp.by(3, pg_temp.confirm_sql(again)) is null, 'a new request fits, and goes through';
end $$;
rollback;

\echo 'routes: a voted cover'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  n uuid := pg_temp.north();
  u date := pg_temp.today() + 28;
  req uuid;
  v uuid;
  pos uuid;
begin
  req := pg_temp.id_by(3, pg_temp.request_acting_sql(2, n, 'president', pg_temp.f(101), u, 'Smokey can''t be reached'));
  assert pg_temp.by(5, pg_temp.confirm_sql(req)) = pg_temp.w('NEEDS_ACTING_VOTE'), 'Crank asked, not Smokey, so it needs a vote';
  perform pg_temp.vote(n, 2, 'president', 'chapter_board', 'majority', 'carried', 91, req);
  assert pg_temp.by(5, pg_temp.confirm_sql(req)) = pg_temp.w('NEEDS_ACTING_VOTE'), 'one that closed 91 days ago doesn''t count';
  v := pg_temp.vote(n, 2, 'president', 'chapter_board', 'majority', 'carried', 1, req);
  assert (select private.club_date(opened_at) = pg_temp.today() - 8 from votes where id = v), 'opened 8 days ago, closed yesterday';
  pos := pg_temp.id_by(5, pg_temp.confirm_sql(req));
  assert (select covers = pg_temp.f(101) and acting_vote = v and acting_request = req and appointed_by = pg_temp.f(5)
          from positions where id = pos), 'Ned confirms it; the row records the vote and the request';
end $$;
rollback;
begin;
do $$ begin
  assert pg_temp.by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28))
    = pg_temp.w('SMALL_BOARD'), 'North''s board of three, less Jet and Smokey, leaves Crank alone';
end $$;
rollback;
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$ begin
  assert pg_temp.by(3, pg_temp.request_acting_sql(4, pg_temp.north(), 'treasurer', null, pg_temp.today() + 28))
    = pg_temp.w('RECORD_INSTEAD'), 'an empty Treasurer seat needs no vote';
  assert pg_temp.by(1, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28))
    = pg_temp.w('RECORD_INSTEAD'), 'nor does Smokey''s own cover by Jet: he asks from his seat';
  assert pg_temp.by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'tail_gunner', pg_temp.seat(4, pg_temp.north(), 'tail_gunner'),
    pg_temp.today() + 28)) = pg_temp.w('COVER_BOARD_SEATS'), 'Lou''s Tail Gunner seat can''t be covered';
end $$;
rollback;

\echo 'routes: withdraw by requester, stand-in and holder; Crank once his vote opened, Gus (seated) and Spanner get WITHDRAW_WHO'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
create function pg_temp.crank_asks() returns uuid language sql as $$
  select pg_temp.id_by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28))
$$;
do $$
declare req uuid;
begin
  req := pg_temp.crank_asks();
  assert pg_temp.by(3, pg_temp.withdraw_sql(req)) is null, 'Crank withdraws his own request';
  assert (select outcome = 'withdrawn' and closed_at is not null from acting_requests where id = req), 'withdrawn';
  assert pg_temp.by(3, pg_temp.withdraw_sql(req)) = pg_temp.w('NO_REQUEST'), 'once';
  req := pg_temp.crank_asks();
  assert pg_temp.by(2, pg_temp.withdraw_sql(req)) is null, 'Jet, the stand-in, declines';
  req := pg_temp.crank_asks();
  assert pg_temp.by(1, pg_temp.withdraw_sql(req)) is null, 'Smokey, the holder, says no';
  req := pg_temp.crank_asks();
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', null, 1, req);
  assert pg_temp.by(3, pg_temp.withdraw_sql(req)) = pg_temp.w('WITHDRAW_WHO'), 'Crank, once a vote on it opened';
  assert pg_temp.by(6, pg_temp.withdraw_sql(req)) = pg_temp.w('WITHDRAW_WHO'), 'Gus, on the board';
  assert pg_temp.by(10, pg_temp.withdraw_sql(req)) = pg_temp.w('WITHDRAW_WHO'), 'Spanner';
  assert pg_temp.by(2, pg_temp.withdraw_sql(req)) is null, 'Jet still can';
  req := pg_temp.crank_asks();
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 1, req);
  assert pg_temp.by(3, pg_temp.withdraw_sql(req)) = pg_temp.w('WITHDRAW_WHO'), 'Crank, once a vote on it carried';
  assert pg_temp.by(1, pg_temp.withdraw_sql(req)) is null, 'Smokey still can';
  perform pg_temp.end_row(pg_temp.f(101));
  req := pg_temp.id_by(3, pg_temp.request_acting_sql(5, pg_temp.north(), 'president', null, pg_temp.today() + 28, 'No President since Smokey stepped down'));
  assert pg_temp.by(6, pg_temp.withdraw_sql(req)) = pg_temp.w('WITHDRAW_WHO'), 'an empty seat has no holder: Gus still can''t';
  assert pg_temp.by(5, pg_temp.withdraw_sql(req)) is null, 'Ned, the stand-in, can';
end $$;
rollback;

\echo 'routes: after a lost vote, Crank asking again gets ASKED_RECENTLY'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  ask text := pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28);
  req uuid := pg_temp.id_by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28));
begin
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'lost', 1, req);
  assert pg_temp.by(3, ask) = pg_temp.w('ASKED_RECENTLY'), 'the board voted it down';
  perform private.close_lapsed_acting();
  assert (select outcome = 'rejected' from acting_requests where id = req), 'which closes it (a refusal rolls its own lazy close back)';
  update acting_requests set closed_at = now() - interval '27 days' where id = req;
  assert pg_temp.by(3, ask) = pg_temp.w('ASKED_RECENTLY'), '27 days on';
  assert pg_temp.by(5, ask) is null, 'another board member can ask';
  update acting_requests set closed_at = now(), outcome = 'withdrawn' where closed_at is null;
  update acting_requests set closed_at = now() - interval '28 days' where id = req;
  assert pg_temp.by(3, ask) is null, '28 days on, Crank can too';
end $$;
rollback;

\echo 'dates: set_acting_until'
begin;
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  cap date := (pg_temp.today() + interval '6 months')::date;
  stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'treasurer', pg_temp.today() + 20, 'No Treasurer since the ACM'));
begin
  assert pg_temp.by(5, pg_temp.set_until_sql(stint, t - 1)) = pg_temp.w('UNTIL_NOT_PAST'), 'not before today';
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 10)) = pg_temp.w('EARLIER_WHO'), 'Crank can''t bring it forward';
  assert pg_temp.by(5, pg_temp.set_until_sql(stint, t + 10)) is null, 'Ned can';
  assert pg_temp.by(5, pg_temp.set_until_sql(stint, t + 30)) = pg_temp.w('LATER_WHO_EMPTY'), 'but not give himself more time';
  assert pg_temp.by(10, pg_temp.set_until_sql(stint, t + 30)) = pg_temp.w('LATER_WHO_EMPTY'), 'nor can Spanner, off the board';
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, cap + 1)) = pg_temp.until_range(cap), 'nor anyone past the cap';
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, cap)) is null, 'Crank gives him more time';
  assert (select acting_until = cap and started_on = t from positions where id = stint), 'the start stays';
  assert (select array_agg(array[old_until::text, new_until::text, changed_by::text] order by id) from acting_changes where position_id = stint)
    = array[array[(t + 20)::text, (t + 10)::text, pg_temp.f(5)::text], array[(t + 10)::text, cap::text, pg_temp.f(3)::text]],
    'one change logged each time, with who';
  assert pg_temp.by(1, pg_temp.set_until_sql(pg_temp.f(103), t + 10)) = pg_temp.w('NOT_ACTING'), 'Crank''s Road Captain seat';
end $$;
rollback;
begin;
do $$
declare
  t date := pg_temp.today();
  cap date := (pg_temp.today() + interval '3 months')::date;
  cover uuid := pg_temp.id_by(3, pg_temp.confirm_sql(
    pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 20, 'Smokey overseas'))));
begin
  assert pg_temp.by(1, pg_temp.set_until_sql(cover, t + 15)) is null, 'Smokey brings it forward';
  assert pg_temp.by(2, pg_temp.set_until_sql(cover, t + 10)) is null, 'so can Jet';
  assert pg_temp.by(3, pg_temp.set_until_sql(cover, t + 5)) = pg_temp.w('EARLIER_WHO'), 'Crank can''t';
  assert pg_temp.by(2, pg_temp.set_until_sql(cover, t + 30)) = 'Only Smokey can keep this cover going longer.', 'Jet can''t extend it';
  assert pg_temp.by(3, pg_temp.set_until_sql(cover, t + 30)) = 'Only Smokey can keep this cover going longer.', 'nor Crank';
  assert pg_temp.by(1, pg_temp.set_until_sql(cover, cap + 1)) = pg_temp.until_range(cap), 'three months at most';
  assert pg_temp.by(1, pg_temp.set_until_sql(cover, cap)) is null, 'Smokey is still away';
  assert (select count(*) from acting_changes where position_id = cover) = 3, 'three changes';
end $$;
rollback;
begin;
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  v uuid := pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 1);
  cover uuid := pg_temp.seat(2, pg_temp.north(), 'president', pg_temp.today() + 20, 'Smokey can''t be reached', pg_temp.f(101));
  stint uuid;
begin
  update positions set acting_vote = v where id = cover;
  assert pg_temp.by(1, pg_temp.set_until_sql(cover, t + 30)) = pg_temp.w('VOTED_NEEDS_NEW_VOTE'), 'a voted cover needs a new vote';
  assert pg_temp.by(1, pg_temp.set_until_sql(cover, t + 10)) is null, 'though Smokey can bring it forward';
  perform pg_temp.end_row(pg_temp.f(101));
  perform pg_temp.seat(5, n, 'secretary');
  stint := pg_temp.seat(5, n, 'president', t + 20, 'No President since Smokey stepped down');
  update positions set acting_vote = v where id = stint;
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 30)) = pg_temp.w('VOTED_NEEDS_NEW_VOTE'), 'so does a voted empty-seat President';
end $$;
rollback;
begin;
do $$
declare
  t date := pg_temp.today();
  stint uuid;
begin
  perform pg_temp.end_row(pg_temp.f(101));
  stint := pg_temp.id_by(3, pg_temp.appoint_acting_sql(2, pg_temp.north(), 'president', t + 20, 'No President since Smokey stepped down'));
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 30)) is null, 'Jet, still the VP, can be given more time';
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 1);
  assert pg_temp.by(3, pg_temp.set_until_sql(stint, t + 40)) = pg_temp.w('ENDED_BY_VOTE'), 'not once the board voted to end it';
end $$;
rollback;
begin;
do $$
declare stint uuid := pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10);
begin
  assert pg_temp.by(7, pg_temp.set_until_sql(stint, pg_temp.today() + 5)) = 'That term has already ended.', 'Hal''s stint lapsed last night';
end $$;
rollback;

\echo 'auditor: Kim in a West VP seat can''t record, propose, confirm or change acting for West''s President or Treasurer, but can for Secretary'
begin;
do $$
declare
  w uuid := pg_temp.west();
  u date := pg_temp.today() + 28;
  stint uuid;
begin
  perform pg_temp.seat(12, w, 'vice_president');
  perform pg_temp.end_row(pg_temp.f(109));
  perform pg_temp.end_row(pg_temp.f(108));
  assert pg_temp.by(12, pg_temp.appoint_acting_sql(10, w, 'treasurer', u)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'record a Treasurer';
  stint := pg_temp.id_by(7, pg_temp.appoint_acting_sql(10, w, 'treasurer', u));
  assert pg_temp.by(12, pg_temp.set_until_sql(stint, u + 10)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'change one';
  assert pg_temp.by(12, pg_temp.appoint_acting_sql(11, w, 'secretary', u)) is null, 'Kim records Hal as Acting Secretary';
  stint := (select id from positions where member_id = pg_temp.f(11) and ended_on is null);
  assert pg_temp.by(12, pg_temp.set_until_sql(stint, u + 10)) is null, 'and gives him more time';
end $$;
rollback;
begin;
do $$
declare
  w uuid := pg_temp.west();
  u date := pg_temp.today() + 28;
  req uuid;
begin
  perform pg_temp.seat(12, w, 'vice_president');
  perform pg_temp.seat(10, w, 'sergeant_at_arms');
  assert (select array_agg(e order by e) from private.acting_electors(w, 'president', pg_temp.f(8), pg_temp.f(107)) e)
    = array[pg_temp.f(9), pg_temp.f(10)], 'on Torque covering Rusty: not Torque, not Rusty, not Kim (11.8)';
  assert (select array_agg(e order by e) from private.acting_electors(w, 'secretary', pg_temp.f(10), pg_temp.f(108)) e)
    = array[pg_temp.f(7), pg_temp.f(9), pg_temp.f(12)], 'on Spanner covering Torque: Kim decides a Secretary''s';
  assert pg_temp.by(9, pg_temp.request_acting_sql(8, w, 'president', pg_temp.f(107), u)) = pg_temp.w('SMALL_BOARD'),
    'so Penny''s proposal for Rusty''s seat has two to decide it';
  assert pg_temp.by(12, pg_temp.request_acting_sql(8, w, 'president', pg_temp.f(107), u)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'propose a President cover';
  assert pg_temp.by(12, pg_temp.request_acting_sql(10, w, 'secretary', pg_temp.f(108), u)) is null, 'but a Secretary cover, yes';
  update acting_requests set closed_at = now(), outcome = 'withdrawn' where closed_at is null;
  req := pg_temp.id_by(9, pg_temp.request_cover_sql(pg_temp.f(109), 8, u, 'Penny overseas'));
  assert pg_temp.by(12, pg_temp.confirm_sql(req)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'confirm a Treasurer cover';
  req := pg_temp.id_by(8, pg_temp.request_cover_sql(pg_temp.f(108), 9, u, 'Torque overseas'));
  assert pg_temp.by(12, pg_temp.confirm_sql(req)) is null, 'Kim confirms Penny covering Torque''s Secretary seat';
end $$;
rollback;

-- §5 Writers and endings, the lock catalogue, two sessions ---------------------------------------

insert into acting_words (k, t) values
  ('REPLACE_NEEDS_END', 'Someone is acting in that seat. They step down first, or a carried board vote ends their acting.'),
  ('ACTING_END_NEEDS_VOTE', 'Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3).');

create function pg_temp.appoint_sql(who int, ch uuid, r text) returns text language sql stable as $$
  select format('public.appoint_position(%L, %L, %L)', pg_temp.f(who), ch, r)
$$;
create function pg_temp.end_sql(pos uuid) returns text language sql immutable as $$
  select format('public.end_position(%L)', pos)
$$;
-- How a row ended: its reason, its first day without the seat and who ended it, or 'open'.
create function pg_temp.how_ended(pos uuid) returns text language sql stable as $$
  select concat_ws(' ', coalesce(ended_reason, 'open'), ended_on, coalesce(ended_by::text, 'nobody'))
  from public.positions where id = pos
$$;
-- The same, as expected: ended today (or on day d) for that reason, by member n (null: nobody).
create function pg_temp.ended(reason text, by_n int, d date default null) returns text language sql stable as $$
  select concat_ws(' ', reason, coalesce(d, private.club_date()), coalesce(pg_temp.f(by_n)::text, 'nobody'))
$$;
-- Smokey asks for Jet to cover his seat, and Crank confirms it: Jet's cover row.
create function pg_temp.jet_covers_smokey(why text default 'Smokey overseas') returns uuid language sql as $$
  select pg_temp.id_by(3, pg_temp.confirm_sql(pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28, why))))
$$;

\echo 'writers: electing the acting person ends their acting (replaced)'
begin;
do $$
declare
  stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM'));
  tg uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'tail_gunner', pg_temp.today() + 28, 'Short a Tail Gunner'));
  full_row uuid;
begin
  full_row := pg_temp.id_by(2, pg_temp.appoint_sql(3, pg_temp.north(), 'treasurer'));
  assert pg_temp.how_ended(stint) = pg_temp.ended('replaced', 2),
    'Jet seats Crank as Treasurer in full, which ends his acting today: ' || pg_temp.how_ended(stint);
  assert (select member_id = pg_temp.f(3) and acting_until is null and ended_on is null and appointed_by = pg_temp.f(2)
          from positions where id = full_row), 'and starts his full term';
  full_row := pg_temp.id_by(1, pg_temp.appoint_sql(5, pg_temp.north(), 'tail_gunner'));
  assert pg_temp.how_ended(tg) = pg_temp.ended('replaced', 1), 'the same for an Acting Tail Gunner: ' || pg_temp.how_ended(tg);
  assert (select count(*) from positions where member_id = pg_temp.f(5) and ended_on is null) = 1, 'Ned holds one Tail Gunner row';
end $$;
rollback;

\echo 'writers: Jet seating Lou over Crank''s acting gets REPLACE_NEEDS_END, with or without a North agm since'
begin;
do $$
declare stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM'));
begin
  assert pg_temp.by(2, pg_temp.appoint_sql(4, pg_temp.north(), 'treasurer')) = pg_temp.w('REPLACE_NEEDS_END'), 'Crank steps down first, or the board votes';
  perform pg_temp.meeting(pg_temp.north(), 'agm', now() - interval '1 day');
  assert pg_temp.by(2, pg_temp.appoint_sql(4, pg_temp.north(), 'treasurer')) = pg_temp.w('REPLACE_NEEDS_END'),
    'a saved ACM proves no election, so it changes nothing';
  assert pg_temp.how_ended(stint) = 'open nobody', 'Crank still acts';
end $$;
rollback;

\echo 'writers: Lou can''t replace an Acting President'
begin;
do $$
declare stint uuid;
begin
  perform pg_temp.end_row(pg_temp.f(101));
  stint := pg_temp.id_by(3, pg_temp.appoint_acting_sql(2, pg_temp.north(), 'president', pg_temp.today() + 28, 'No President since Smokey stepped down'));
  assert pg_temp.by(4, pg_temp.appoint_sql(5, pg_temp.north(), 'president')) = pg_temp.w('REPLACE_NEEDS_END'), 'Lou can''t seat Ned over Jet''s acting';
  assert pg_temp.how_ended(stint) = 'open nobody', 'Jet still acts';
  assert pg_temp.by(4, pg_temp.appoint_sql(2, pg_temp.north(), 'president')) is null, 'but can seat Jet himself in full';
  assert pg_temp.how_ended(stint) = pg_temp.ended('replaced', 4), 'which ends his acting: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'writers: a full Tail Gunner sits beside an acting one'
begin;
do $$
declare stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'tail_gunner', pg_temp.today() + 28, 'Short a Tail Gunner'));
begin
  assert pg_temp.by(1, pg_temp.appoint_sql(6, pg_temp.north(), 'tail_gunner')) is null, 'Smokey seats Gus as Tail Gunner in full';
  assert pg_temp.how_ended(stint) = 'open nobody', 'Ned still acts';
  assert (select count(*) from positions where chapter_id = pg_temp.north() and role = 'tail_gunner' and ended_on is null) = 2, 'two Tail Gunners';
end $$;
rollback;

\echo 'writers: a stint that lapsed last night leaves its seat free for a full appointment'
begin;
do $$
declare stint uuid := pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10);
begin
  assert pg_temp.by(7, pg_temp.appoint_sql(10, pg_temp.west(), 'vice_president')) is null, 'Rusty seats Spanner as VP in full';
  assert pg_temp.how_ended(stint) = pg_temp.ended('lapsed', null), 'Hal''s stint closed as lapsed first: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'writers: covered Smokey steps down (the cover ends left_board) and is re-seated in full: one President row has duties'
begin;
do $$
declare
  cover uuid := pg_temp.jet_covers_smokey();
  again uuid;
begin
  assert pg_temp.by(1, pg_temp.end_sql(pg_temp.f(101))) is null, 'Smokey steps down';
  assert pg_temp.how_ended(pg_temp.f(101)) = pg_temp.ended('stepped_down', 1), 'stepped down: ' || pg_temp.how_ended(pg_temp.f(101));
  assert pg_temp.how_ended(cover) = pg_temp.ended('left_board', null), 'Jet''s cover ends with his seat: ' || pg_temp.how_ended(cover);
  again := pg_temp.id_by(4, pg_temp.appoint_sql(1, pg_temp.north(), 'president'));
  assert (select array_agg(id) from private.duty_positions where chapter_id = pg_temp.north() and role = 'president') = array[again],
    'Lou seats Smokey again after his re-election: one President row has the duties, his new one';
end $$;
rollback;

\echo 'writers: seating Crank Treasurer in full after a vote ended his acting there: ENDED_BY_VOTE'
begin;
do $$
declare
  stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM'));
  v uuid := pg_temp.vote(pg_temp.north(), 3, 'treasurer', 'chapter_board', 'majority', 'carried', 0);
begin
  assert pg_temp.by(2, pg_temp.end_sql(stint)) is null, 'Jet ends Crank''s acting on the board''s vote';
  assert pg_temp.by(1, pg_temp.appoint_sql(3, pg_temp.north(), 'treasurer')) = pg_temp.w('ENDED_BY_VOTE'), 'Smokey can''t seat him in full now';
  update votes set opened_at = opened_at - interval '91 days', closes_at = closes_at - interval '91 days',
    closed_at = closed_at - interval '91 days' where id = v;
  assert pg_temp.by(1, pg_temp.appoint_sql(3, pg_temp.north(), 'treasurer')) is null, 'once the vote is 91 days old, he can';
end $$;
rollback;
begin;
do $$ begin
  perform pg_temp.vote(pg_temp.west(), 9, 'treasurer', 'chapter_patched', 'two_thirds', 'carried', 1);
  assert pg_temp.by(7, pg_temp.end_sql(pg_temp.f(109))) is null, 'Rusty removes Penny on a 9.3 vote';
  assert pg_temp.how_ended(pg_temp.f(109)) = pg_temp.ended('removed', 7), 'removed: ' || pg_temp.how_ended(pg_temp.f(109));
  assert pg_temp.by(7, pg_temp.appoint_sql(9, pg_temp.west(), 'treasurer')) is null,
    'and can seat her in full again: only acting has the board-majority shape on a board seat (the spec''s call 25)';
end $$;
rollback;

\echo 'writers: full chair and books refused only against an acting row (a full Treasurer can be seated President, 17.6)'
begin;
do $$ begin
  perform pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM'));
  perform pg_temp.end_row(pg_temp.f(101));
  assert pg_temp.by(4, pg_temp.appoint_sql(3, pg_temp.north(), 'president')) = pg_temp.w('BOOKS_NOT_CHAIR'),
    'Lou can''t seat Acting Treasurer Crank as President in full';
  perform pg_temp.end_row(pg_temp.f(107));
  assert pg_temp.by(4, pg_temp.appoint_sql(9, pg_temp.west(), 'president')) is null, 'but seats Penny, West''s Treasurer in full, as President';
end $$;
rollback;
begin;
do $$ begin
  perform pg_temp.jet_covers_smokey();
  assert pg_temp.by(1, pg_temp.appoint_sql(2, pg_temp.north(), 'treasurer')) = pg_temp.w('CHAIR_NOT_BOOKS'),
    'Smokey can''t seat Jet, acting as President for him, as Treasurer in full';
  assert pg_temp.by(1, pg_temp.appoint_sql(5, pg_temp.north(), 'treasurer')) is null, 'Ned, yes';
end $$;
rollback;

\echo 'writers: a roster claimant ends a live acting row in their seat (replaced) and fills a lapsed one'
begin;
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.f(13), 'f13@example.com', now()), (pg_temp.f(14), 'f14@example.com', now());
insert into private.roster (email, chapter_id, full_name, status, roles) values
  ('f13@example.com', pg_temp.north(), 'Bolt Upright', 'full', '{treasurer}'),
  ('f14@example.com', pg_temp.west(), 'Nut Case', 'full', '{vice_president}');
do $$
declare
  stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM'));
  lapsed uuid := pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10);
begin
  assert pg_temp.value_as(pg_temp.f(13), 'public.claim_roster()') = 'true', 'Bolt claims his place';
  assert pg_temp.how_ended(stint) = pg_temp.ended('replaced', null),
    'the sheet records his election (17.6), so Crank''s acting ends, by nobody: ' || pg_temp.how_ended(stint);
  assert (select array_agg(array[old_until::text, coalesce(new_until::text, 'ended'), changed_by::text, note])
          from acting_changes where position_id = stint)
    = array[array[(pg_temp.today() + 28)::text, 'ended', pg_temp.f(13)::text, 'Elected holder claimed the seat (17.6)']], 'and logged';
  assert (select started_on = '2026-08-01' and acting_until is null from positions
          where member_id = pg_temp.f(13) and role = 'treasurer' and ended_on is null), 'Bolt is North''s Treasurer from 1/8/2026';
  assert pg_temp.value_as(pg_temp.f(14), 'public.claim_roster()') = 'true', 'Nut claims his place';
  assert pg_temp.how_ended(lapsed) = pg_temp.ended('lapsed', null), 'Hal''s stint lapsed last night, and closes so: ' || pg_temp.how_ended(lapsed);
  assert exists (select 1 from positions where member_id = pg_temp.f(14) and role = 'vice_president' and ended_on is null),
    'and Nut sits in West''s VP seat';
end $$;
rollback;

\echo 'endings: stepped_down, holder_back (agreed and voted covers), removed with a carried chapter_board majority, ACTING_END_NEEDS_VOTE without one, Lou refused'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
do $$
declare
  n uuid := pg_temp.north();
  t date := pg_temp.today();
  stint uuid;
  cover uuid;
  req uuid;
begin
  stint := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, n, 'treasurer', t + 28, 'No Treasurer since the ACM'));
  assert pg_temp.by(3, pg_temp.end_sql(stint)) is null, 'Crank steps down from acting';
  assert pg_temp.how_ended(stint) = pg_temp.ended('stepped_down', 3), 'stepped down: ' || pg_temp.how_ended(stint);

  cover := pg_temp.jet_covers_smokey();
  assert pg_temp.by(1, pg_temp.end_sql(cover)) is null, 'Smokey is back';
  assert pg_temp.how_ended(cover) = pg_temp.ended('holder_back', 1), 'holder back: ' || pg_temp.how_ended(cover);
  req := pg_temp.request(n, 'president', 2, pg_temp.f(101), t + 20, 'Smokey can''t be reached', 3);
  perform pg_temp.vote(n, 2, 'president', 'chapter_board', 'majority', 'carried', 1, req);
  cover := pg_temp.id_by(5, pg_temp.confirm_sql(req));
  assert (select acting_vote is not null from positions where id = cover), 'a voted cover';
  assert pg_temp.by(1, pg_temp.end_sql(cover)) is null, 'Smokey is back from that too';
  assert pg_temp.how_ended(cover) = pg_temp.ended('holder_back', 1), 'holder back: ' || pg_temp.how_ended(cover);

  stint := pg_temp.id_by(1, pg_temp.appoint_acting_sql(3, n, 'treasurer', t + 28, 'No Treasurer since the ACM'));
  assert pg_temp.by(2, pg_temp.end_sql(stint)) = pg_temp.w('ACTING_END_NEEDS_VOTE'), 'Jet can''t end Crank''s acting without a vote';
  assert pg_temp.by(4, pg_temp.end_sql(stint)) = 'Only that chapter’s board can end this term.', 'Lou, an NEC officer, has no part';
  perform pg_temp.vote(n, 3, 'treasurer', 'chapter_board', 'majority', 'carried', 0);
  assert pg_temp.by(4, pg_temp.end_sql(stint)) = 'Only that chapter’s board can end this term.', 'not even after a vote';
  assert pg_temp.by(2, pg_temp.end_sql(stint)) is null, 'with a carried board majority, Jet ends it';
  assert pg_temp.how_ended(stint) = pg_temp.ended('removed', 2), 'removed: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'endings: a normal row ends stepped_down or removed'
begin;
do $$ begin
  assert pg_temp.by(3, pg_temp.end_sql(pg_temp.f(103))) is null, 'Crank steps down as Road Captain';
  assert pg_temp.how_ended(pg_temp.f(103)) = pg_temp.ended('stepped_down', 3), 'stepped down: ' || pg_temp.how_ended(pg_temp.f(103));
  perform pg_temp.vote(pg_temp.west(), 8, 'secretary', 'chapter_patched', 'two_thirds', 'carried', 1);
  assert pg_temp.by(7, pg_temp.end_sql(pg_temp.f(108))) is null, 'Rusty removes Torque on a 9.3 vote';
  assert pg_temp.how_ended(pg_temp.f(108)) = pg_temp.ended('removed', 7), 'removed: ' || pg_temp.how_ended(pg_temp.f(108));
end $$;
rollback;

\echo 'endings: the Auditor in a West VP seat can''t end West''s Acting Treasurer, even on a vote'
begin;
do $$
declare stint uuid;
begin
  perform pg_temp.seat(12, pg_temp.west(), 'vice_president');
  perform pg_temp.end_row(pg_temp.f(109));
  stint := pg_temp.id_by(7, pg_temp.appoint_acting_sql(10, pg_temp.west(), 'treasurer', pg_temp.today() + 28));
  assert pg_temp.by(12, pg_temp.end_sql(stint)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'not Kim, with no vote';
  perform pg_temp.vote(pg_temp.west(), 10, 'treasurer', 'chapter_board', 'majority', 'carried', 0);
  assert pg_temp.by(12, pg_temp.end_sql(stint)) = pg_temp.w('AUDITOR_STAYS_OUT'), 'nor with one';
  assert pg_temp.by(8, pg_temp.end_sql(stint)) is null, 'Torque ends it on the vote';
end $$;
rollback;

\echo 'endings: an acting vote never counts as a removal vote'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  req uuid := pg_temp.id_by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28));
  cover uuid;
begin
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 0, req);
  cover := pg_temp.id_by(5, pg_temp.confirm_sql(req));
  assert not private.has_carried_removal_vote(cover), 'the board majority that seated Jet doesn''t end him';
  assert pg_temp.by(3, pg_temp.end_sql(cover)) = pg_temp.w('ACTING_END_NEEDS_VOTE'), 'so Crank can''t end the cover on it';
  perform pg_temp.vote(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 'carried', 0);
  assert private.has_carried_removal_vote(cover), 'a vote to end it does';
end $$;
rollback;

\echo 'endings: a removal vote closed before the stint started doesn''t count; a 9.3 vote open when Penny stepped down and was recorded acting ends the stint once carried'
begin;
do $$
declare
  stint uuid;
  v uuid;
begin
  perform pg_temp.vote(pg_temp.north(), 3, 'treasurer', 'chapter_board', 'majority', 'carried', 5);
  stint := pg_temp.seat(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since the ACM');
  assert pg_temp.by(1, pg_temp.end_sql(stint)) = pg_temp.w('ACTING_END_NEEDS_VOTE'), 'a vote that closed before the stint began doesn''t end it';

  v := pg_temp.vote(pg_temp.west(), 9, 'treasurer', 'chapter_patched', 'two_thirds', null);
  assert pg_temp.by(9, pg_temp.end_sql(pg_temp.f(109))) is null, 'Penny steps down while a 9.3 vote about her is open';
  stint := pg_temp.id_by(7, pg_temp.appoint_acting_sql(9, pg_temp.west(), 'treasurer', pg_temp.today() + 28, 'No Treasurer since Penny stepped down'));
  assert pg_temp.by(8, pg_temp.end_sql(stint)) = pg_temp.w('ACTING_END_NEEDS_VOTE'), 'while it''s open, Torque can''t end her acting';
  update votes set closed_at = now(), result = 'carried' where id = v;
  assert pg_temp.by(8, pg_temp.end_sql(stint)) is null, 'once it carries, he can';
  assert pg_temp.how_ended(stint) = pg_temp.ended('removed', 8), 'removed: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'endings: end_position on a lapsed open row: "That term has already ended.", still lapsed'
begin;
do $$
declare stint uuid := pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10);
begin
  assert pg_temp.by(11, pg_temp.end_sql(stint)) = 'That term has already ended.', 'Hal''s stint lapsed last night';
  assert pg_temp.by(7, pg_temp.end_sql(stint)) = 'That term has already ended.', 'for Rusty too';
  assert not exists (select 1 from private.held_positions where id = stint), 'it holds nothing';
  perform private.close_lapsed_acting();
  assert pg_temp.how_ended(stint) = pg_temp.ended('lapsed', null), 'and closes as lapsed: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'endings: ending the stand-in''s own Road Captain row ends their cover (left_board)'
begin;
do $$
declare cover uuid := pg_temp.id_by(1, pg_temp.confirm_sql(pg_temp.id_by(2, pg_temp.request_cover_sql(pg_temp.f(102), 3, pg_temp.today() + 28, 'Jet away'))));
begin
  assert pg_temp.by(3, pg_temp.end_sql(pg_temp.f(103))) is null, 'Crank steps down as Road Captain';
  assert pg_temp.how_ended(pg_temp.f(103)) = pg_temp.ended('stepped_down', 3), 'stepped down: ' || pg_temp.how_ended(pg_temp.f(103));
  assert pg_temp.how_ended(cover) = pg_temp.ended('left_board', null), 'his cover of Jet''s VP seat ends: ' || pg_temp.how_ended(cover);
  assert (select note from acting_changes where position_id = cover) = 'Stand-in left the board', 'logged';
end $$;
rollback;

\echo 'endings: renewed; forgotten (forgetting the stand-in ends the acting; forgetting the holder ends the cover)'
begin;
select pg_temp.seat(5, null, 'nec_chair');
update positions set started_on = private.club_date() - 330 where id = pg_temp.f(112);
select pg_temp.vote(null, 12, 'nec_auditor', 'nec', 'two_thirds', 'carried', 1);
do $$
declare again uuid := pg_temp.id_by(5, 'public.renew_auditor()');
begin
  assert pg_temp.how_ended(pg_temp.f(112)) = pg_temp.ended('renewed', 5), 'Ned renews Kim: her old term ends, renewed: ' || pg_temp.how_ended(pg_temp.f(112));
  assert (select member_id = pg_temp.f(12) and ended_on is null from positions where id = again), 'and her new one starts';
end $$;
rollback;
begin;
do $$
declare cover uuid := pg_temp.jet_covers_smokey();
begin
  perform private.forget_member(pg_temp.f(2), null);
  assert pg_temp.how_ended(cover) = pg_temp.ended('forgotten', null), 'forgetting Jet ends his acting: ' || pg_temp.how_ended(cover);
  assert pg_temp.how_ended(pg_temp.f(102)) = pg_temp.ended('forgotten', null), 'and his VP seat: ' || pg_temp.how_ended(pg_temp.f(102));
end $$;
rollback;
begin;
do $$
declare
  cover uuid := pg_temp.jet_covers_smokey();
  lapsed uuid := pg_temp.seat(11, pg_temp.west(), 'vice_president', pg_temp.today() - 1, 'No VP since the ACM', null, pg_temp.today() - 10);
begin
  perform private.forget_member(pg_temp.f(11), null);
  assert pg_temp.how_ended(lapsed) = pg_temp.ended('lapsed', null), 'forgetting Hal closes his stint that lapsed last night as lapsed: ' || pg_temp.how_ended(lapsed);
  perform private.forget_member(pg_temp.f(1), null);
  assert pg_temp.how_ended(pg_temp.f(101)) = pg_temp.ended('forgotten', null), 'forgetting Smokey ends his seat: ' || pg_temp.how_ended(pg_temp.f(101));
  assert pg_temp.how_ended(cover) = pg_temp.ended('left_board', null), 'and Jet''s cover of it: ' || pg_temp.how_ended(cover);
end $$;
rollback;

\echo 'endings: delete_my_account refuses an acting Officer; set_member_status refuses an acting row and ignores a lapsed one'
begin;
do $$
declare
  stint uuid := pg_temp.id_by(1, pg_temp.appoint_acting_sql(5, pg_temp.north(), 'officer', pg_temp.today() + 28, 'Short an Officer'));
  to_supporter text := format('public.set_member_status(%L, %L, true)', pg_temp.f(5), 'supporter');
begin
  assert pg_temp.by(5, 'public.delete_my_account()')
    = 'Step down from your seat first, so the club can fill it. Then you can delete your account.', 'Ned acts as Officer';
  assert pg_temp.by(1, to_supporter) = 'End their positions first.', 'Smokey can''t move him to Supporter while he acts';
  update positions set started_on = pg_temp.today() - 10, acting_until = pg_temp.today() - 1 where id = stint;
  assert pg_temp.by(1, to_supporter) is null, 'once the stint has lapsed, he can';
  assert pg_temp.how_ended(stint) = pg_temp.ended('lapsed', null), 'and it closed as lapsed: ' || pg_temp.how_ended(stint);
end $$;
rollback;

\echo 'catalogue: every statement setting positions.ended_on names ended_reason'
do $$
declare
  scanned text[];
  off text;
begin
  with stmts as (
    select n.nspname || '.' || p.proname as fn, s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, regexp_split_to_table(p.prosrc, ';') s
    where n.nspname in ('public', 'private') and s ~* 'update\s+public\.positions\y' and s ~* 'ended_on\s*=')
  select array_agg(distinct fn), string_agg(distinct fn, ', ') filter (where s !~* 'ended_reason') into scanned, off from stmts;
  assert scanned @> array['public.end_position', 'public.renew_auditor', 'private.forget_member', 'private.close_lapsed_acting',
    'private.on_position_end'], 'the scan finds the writers that end rows: ' || array_to_string(scanned, ', ');
  assert off is null, 'these end a position without saying why: ' || off;
end $$;

\echo 'catalogue: every seat writer calls private.lock_seat'
do $$
declare
  writers text[];
  off text;
begin
  -- Each of these writes positions without the seat lock, for the reason given.
  with allowed(name, why) as (values
    ('close_lapsed_acting', 'the lazy close: every writer runs it under its own locks, and it only ends stints already past their date'),
    ('forget_member', 'forgetting a deleted account ends its rows; nothing seats a forgotten member'),
    ('on_position_end', 'a trigger: it runs inside the writer''s statement, under that writer''s locks'),
    ('check_covers', 'a trigger: it checks the row its writer is writing, under that writer''s locks')
  ), w as (
    select p.proname::text as name, p.prosrc ~ 'private\.lock_seat\(' as locks
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc ~* '(insert\s+into|update)\s+public\.positions\y')
  select array_agg(name order by name), string_agg(name, ', ' order by name) filter (where not locks and name not in (select name from allowed))
  into writers, off from w;
  assert writers @> array['appoint_position', 'end_position', 'add_roster_position', 'settle_chapter_proposal', 'renew_auditor',
    'appoint_acting', 'confirm_acting', 'set_acting_until'], 'the scan finds the seat writers: ' || array_to_string(writers, ', ');
  assert off is null, 'these write a seat without the seat lock: ' || off;
end $$;

-- Two sessions. The fixtures are committed, so a second session sees them; each scenario commits
-- what it needs first, leaves session A's transaction open while B runs, and ends by putting the
-- fixtures back (pg_temp.reset_acting).
create extension if not exists dblink;
-- The same database, socket, port and user as the connection the test runs on.
create function pg_temp.here() returns text language sql as $$
  select format('dbname=%s host=%s port=%s user=%s', current_database(),
    split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), session_user);
$$;
-- Opens a session as member n, in a transaction it leaves open.
create function pg_temp.open_as(conn text, n int) returns void language plpgsql as $$
begin
  perform dblink_connect(conn, pg_temp.here());
  perform dblink_exec(conn, 'begin');
  perform dblink_exec(conn, 'set local role authenticated');
  perform dblink_exec(conn, format('set local request.jwt.claim.sub = %L', pg_temp.f(n)));
end $$;
-- A session's backend process.
create function pg_temp.pid_of(conn text) returns int language sql as $$
  select p from dblink(conn, 'select pg_backend_pid()') as t(p int);
$$;
-- Waits until a session's backend is stuck waiting on a lock. True when it is, false after 10 seconds.
create function pg_temp.waits(pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists (select 1 from pg_locks where pg_locks.pid = waits.pid and not granted) then return true; end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
-- The outcome of a statement sent with dblink_send_query: its error, or null.
create function pg_temp.outcome(conn text) returns text language plpgsql as $$
declare err text;
begin
  begin
    perform * from dblink_get_result(conn) as t(r text);
  exception when others then
    err := sqlerrm;
  end;
  -- Read to the end, so the connection is free again.
  perform * from dblink_get_result(conn, false) as t(r text);
  return err;
end $$;
-- Runs call in session A, which keeps its transaction open; sends call in session B, which should
-- wait for A; commits A; and returns whether B waited and B's outcome. B's transaction stays open.
create function pg_temp.race(a_call text, b_call text, out waited boolean, out err text) language plpgsql as $$
declare b_pid int;
begin
  perform * from dblink('a', 'select ' || a_call || '::text') as t(r text);
  b_pid := pg_temp.pid_of('b');
  perform dblink_send_query('b', 'select ' || b_call || '::text');
  waited := pg_temp.waits(b_pid);
  perform dblink_exec('a', 'commit');
  err := pg_temp.outcome('b');
end $$;
-- Closes both sessions: B commits when it went through, else rolls back.
create function pg_temp.close_sessions(b_went_through boolean) returns void language plpgsql as $$
begin
  perform dblink_exec('b', case when b_went_through then 'commit' else 'rollback' end);
  perform dblink_disconnect('a');
  perform dblink_disconnect('b');
end $$;
-- Puts the committed fixtures back: removes the rows, requests, changes and pushes a scenario
-- made (covers first), and reopens the fixture rows it ended.
create function pg_temp.reset_acting() returns void language plpgsql as $$
begin
  delete from public.acting_changes;
  delete from public.positions where covers is not null;
  delete from public.positions where id not in (select pg_temp.f(100 + n) from generate_series(1, 12) n);
  delete from public.acting_requests;
  delete from private.push_outbox where data ->> 'kind' = 'acting';
  update public.positions set ended_on = null, ended_by = null, ended_reason = null where ended_on is not null;
end $$;

\echo 'two sessions: Smokey records Crank as Acting Treasurer while Crank records Jet: SEAT_HAS_ACTING'
do $$
declare r record;
begin
  perform pg_temp.open_as('a', 1);
  perform pg_temp.open_as('b', 3);
  select * into r from pg_temp.race(pg_temp.appoint_acting_sql(3, pg_temp.north(), 'treasurer', pg_temp.today() + 28),
                    pg_temp.appoint_acting_sql(2, pg_temp.north(), 'treasurer', pg_temp.today() + 28));
  perform pg_temp.close_sessions(r.err is null);
  assert r.waited, 'Crank''s record waited for Smokey''s';
  assert r.err = pg_temp.w('SEAT_HAS_ACTING'), format('then found Crank acting, not %s', coalesce(r.err, 'nothing'));
  assert (select count(*) from positions where chapter_id = pg_temp.north() and role = 'treasurer' and ended_on is null) = 1, 'one Acting Treasurer';
end $$;
select pg_temp.reset_acting();

\echo 'two sessions: Crank and Ned confirm Smokey''s request at once: one acting row, the other NO_REQUEST'
select pg_temp.seat(5, pg_temp.north(), 'secretary');
create temp table smokey_asks as
  select pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), pg_temp.today() + 28, 'Smokey overseas', 1) as id;
do $$
declare
  req uuid := (select id from smokey_asks);
  r record;
begin
  perform pg_temp.open_as('a', 3);
  perform pg_temp.open_as('b', 5);
  select * into r from pg_temp.race(pg_temp.confirm_sql(req), pg_temp.confirm_sql(req));
  perform pg_temp.close_sessions(r.err is null);
  assert r.waited, 'Ned''s confirm waited for Crank''s';
  assert r.err = pg_temp.w('NO_REQUEST'), format('then found it confirmed, not %s', coalesce(r.err, 'nothing'));
  assert (select count(*) from positions where covers = pg_temp.f(101)) = 1, 'one cover';
end $$;
select pg_temp.reset_acting();
drop table smokey_asks;

\echo 'two sessions: Crank confirms Jet''s cover while Jet steps down as VP: the cover ends (left_board)'
create temp table smokey_asks as
  select pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), pg_temp.today() + 28, 'Smokey overseas', 1) as id;
do $$
declare
  req uuid := (select id from smokey_asks);
  r record;
begin
  perform pg_temp.open_as('a', 3);
  perform pg_temp.open_as('b', 2);
  select * into r from pg_temp.race(pg_temp.confirm_sql(req), pg_temp.end_sql(pg_temp.f(102)));
  perform pg_temp.close_sessions(r.err is null);
  assert r.waited, 'Jet''s step-down waited for Crank''s confirm';
  assert r.err is null, format('then went through, not %s', r.err);
  assert pg_temp.how_ended(pg_temp.f(102)) = pg_temp.ended('stepped_down', 2), 'Jet left the board: ' || pg_temp.how_ended(pg_temp.f(102));
  assert (select pg_temp.how_ended(id) from positions where covers = pg_temp.f(101)) = pg_temp.ended('left_board', null),
    'and his new cover ended with it: ' || coalesce((select pg_temp.how_ended(id) from positions where covers = pg_temp.f(101)), 'no cover');
end $$;
select pg_temp.reset_acting();
drop table smokey_asks;

\echo 'two sessions: Crank confirms Jet as Acting President while Smokey seats Jet Treasurer in full: CHAIR_NOT_BOOKS'
create temp table smokey_asks as
  select pg_temp.request(pg_temp.north(), 'president', 2, pg_temp.f(101), pg_temp.today() + 28, 'Smokey overseas', 1) as id;
do $$
declare
  req uuid := (select id from smokey_asks);
  r record;
begin
  perform pg_temp.open_as('a', 3);
  perform pg_temp.open_as('b', 1);
  select * into r from pg_temp.race(pg_temp.confirm_sql(req), pg_temp.appoint_sql(2, pg_temp.north(), 'treasurer'));
  perform pg_temp.close_sessions(r.err is null);
  assert r.waited, 'Smokey''s appointment waited for Crank''s confirm';
  assert r.err = pg_temp.w('CHAIR_NOT_BOOKS'), format('then found Jet acting as President, not %s', coalesce(r.err, 'nothing'));
  assert not exists (select 1 from positions where member_id = pg_temp.f(2) and role = 'treasurer'), 'Jet keeps no books';
end $$;
select pg_temp.reset_acting();
drop table smokey_asks;

-- §6 Votes ------------------------------------------------------------------------------------------

insert into acting_words (k, t) values
  ('ACTING_VOTE_OPEN', 'A vote about acting stays open for at least 48 hours, so everyone affected can answer.'),
  ('NO_VOTE_NEEDED', 'This request doesn’t need a vote. A third board member confirms it.'),
  ('ACTING_END_SHAPE', 'Ending someone’s acting is a majority vote of the chapter board (9.3).');

-- open_vote as SQL text: a vote of that chapter (null: the club) about member n in that role (either
-- null for none), closing in that many hours.
create function pg_temp.open_vote_sql(ch uuid, subject int, r text, electorate text, threshold text, quorum int,
  hours int default 72) returns text language sql stable as $$
  select format('public.open_vote(%L, null, %L, %L, null, %L, %L, false, %L, %L, %L)', ch, pg_temp.f(subject),
    'About a seat', electorate, threshold, quorum, now() + hours * interval '1 hour', r)
$$;
create function pg_temp.open_acting_vote_sql(req uuid, quorum int, hours int default 72, meeting uuid default null)
returns text language sql stable as $$
  select format('public.open_acting_vote(%L, %L, %L, %L)', req, quorum, now() + hours * interval '1 hour', meeting)
$$;
create function pg_temp.close_vote_sql(v uuid) returns text language sql immutable as $$
  select format('public.close_vote(%L, null)', v)
$$;
-- Everyone with a ballot on the vote casts yes, as themselves.
create function pg_temp.all_vote_yes(v uuid) returns void language plpgsql as $$
declare e uuid;
begin
  for e in select member_id from public.vote_electors where vote_id = v and voted_at is null order by member_id loop
    assert pg_temp.try_as(e, format('select public.cast_ballot(%L, ''yes'')', v)) is null, 'every elector can cast';
  end loop;
end $$;
-- Who has a ballot on a vote, by first name in uuid order, with the chapter it belongs to when it has one.
create function pg_temp.electors(v uuid) returns text[] language sql stable as $$
  select array_agg(concat_ws(':', split_part(m.full_name, ' ', 1), c.slug) order by e.member_id)
  from public.vote_electors e join public.members m on m.id = e.member_id left join public.chapters c on c.id = e.for_chapter
  where e.vote_id = v
$$;
-- The vote as member n reads it in club_business(), or null when it isn't listed for them.
create function pg_temp.listed(n int, v uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.value_as(pg_temp.f(n), 'public.club_business()')::jsonb -> 'votes') x
  where x ->> 'id' = v::text
$$;
-- Moves a vote's opening back to that long ago, as the owner.
create function pg_temp.opened_ago(v uuid, ago interval) returns void language sql as $$
  update public.votes set opened_at = now() - ago where id = v
$$;
-- Crank asks the board to vote Jet in to cover Smokey, who can't be asked: the request.
create function pg_temp.crank_asks_jet() returns uuid language sql as $$
  select pg_temp.id_by(3, pg_temp.request_acting_sql(2, pg_temp.north(), 'president', pg_temp.f(101), pg_temp.today() + 28,
    'Smokey is in hospital'))
$$;

\echo 'votes: a vote to end acting is a chapter_board majority'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  n uuid := pg_temp.north();
  v uuid;
begin
  perform pg_temp.jet_covers_smokey();
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_patched', 'two_thirds', 2))
    = pg_temp.w('ACTING_END_SHAPE'), 'not two-thirds of the chapter''s Full Members, as for a board seat''s holder (9.3)';
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'two_thirds', 3))
    = pg_temp.w('ACTING_END_SHAPE'), 'nor two-thirds of the board';
  v := pg_temp.id_by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3));
  assert (select electorate = 'chapter_board' and threshold = 'majority' and subject_member_id = pg_temp.f(2)
            and subject_role = 'president' and acting_request is null from votes where id = v),
    'a majority of the chapter board, naming Jet and the seat he acts in';
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'vice_president', 'chapter_board', 'majority', 3))
    = 'Removing a board member is a two-thirds vote of the chapter’s Full Members at a notified, quorate meeting (9.3).',
    'Jet''s own VP seat still takes the 9.3 shape';
end $$;
rollback;

\echo 'votes: acting and end-acting votes leave out the stand-in, the holder and the Auditor; three-member North gets SMALL_BOARD; a 24-hour close gets ACTING_VOTE_OPEN'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  n uuid := pg_temp.north();
  req uuid := pg_temp.crank_asks_jet();
  v uuid;
begin
  v := pg_temp.id_by(3, pg_temp.open_acting_vote_sql(req, 3));
  assert pg_temp.electors(v) = array['Crank', 'Ned', 'Gus'], 'the vote on Crank''s request leaves out Jet and Smokey: ' || pg_temp.electors(v)::text;
  assert pg_temp.by(2, pg_temp.withdraw_sql(req)) is null, 'Jet declines';
  perform pg_temp.jet_covers_smokey();
  v := pg_temp.id_by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3));
  assert pg_temp.electors(v) = array['Crank', 'Ned', 'Gus'], 'so does a vote to end the cover Smokey then asked for: ' || pg_temp.electors(v)::text;
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3, 24)) = pg_temp.w('ACTING_VOTE_OPEN'),
    'one closing in 24 hours is refused';
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3, 47)) = pg_temp.w('ACTING_VOTE_OPEN'),
    'so is one closing in 47';
  assert pg_temp.by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3, 48)) is null, '48 hours is enough';
end $$;
rollback;
begin;
select pg_temp.seat(12, pg_temp.west(), 'vice_president');
select pg_temp.seat(10, pg_temp.west(), 'sergeant_at_arms');
select pg_temp.seat(11, pg_temp.west(), 'road_captain');
do $$
declare
  w uuid := pg_temp.west();
  req uuid;
  v uuid;
begin
  req := pg_temp.id_by(7, pg_temp.request_acting_sql(8, w, 'treasurer', pg_temp.f(109), pg_temp.today() + 28, 'Penny is in hospital'));
  v := pg_temp.id_by(7, pg_temp.open_acting_vote_sql(req, 3));
  assert pg_temp.electors(v) = array['Rusty', 'Spanner', 'Hal'],
    'Rusty''s request for Torque to cover Penny leaves out Torque, Penny and Kim, the Auditor: ' || pg_temp.electors(v)::text;
  assert pg_temp.by(9, pg_temp.withdraw_sql(req)) is null, 'Penny says no';
  perform pg_temp.id_by(7, pg_temp.confirm_sql(pg_temp.id_by(9, pg_temp.request_cover_sql(pg_temp.f(109), 8, pg_temp.today() + 28))));
  v := pg_temp.id_by(7, pg_temp.open_vote_sql(w, 8, 'treasurer', 'chapter_board', 'majority', 3));
  assert pg_temp.electors(v) = array['Rusty', 'Spanner', 'Hal'], 'so does a vote to end the cover she then asked for: ' || pg_temp.electors(v)::text;
end $$;
rollback;
begin;
do $$ begin
  perform pg_temp.jet_covers_smokey();
  assert pg_temp.by(3, pg_temp.open_vote_sql(pg_temp.north(), 2, 'president', 'chapter_board', 'majority', 3)) = pg_temp.w('SMALL_BOARD'),
    'North is Smokey, Jet and Crank: without Jet and Smokey, Crank is alone';
end $$;
rollback;

\echo 'votes: close_vote on a day-old acting vote, all voted: ACTING_VOTE_OPEN; at 48 hours it closes'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  n uuid := pg_temp.north();
  req uuid := pg_temp.crank_asks_jet();
  v uuid;
  pos uuid;
begin
  v := pg_temp.id_by(3, pg_temp.open_acting_vote_sql(req, 3));
  perform pg_temp.all_vote_yes(v);
  perform pg_temp.opened_ago(v, interval '1 day');
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) = pg_temp.w('ACTING_VOTE_OPEN'), 'a day in, with every ballot cast';
  perform pg_temp.opened_ago(v, interval '48 hours' - interval '1 second');
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) = pg_temp.w('ACTING_VOTE_OPEN'), 'a second short of 48 hours';
  perform pg_temp.opened_ago(v, interval '48 hours');
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) is null, 'at 48 hours it closes';
  assert (select result = 'carried' from votes where id = v), 'carried';
  pos := pg_temp.id_by(5, pg_temp.confirm_sql(req));
  assert (select acting_vote = v and covers = pg_temp.f(101) from positions where id = pos), 'and Ned confirms Jet''s cover on it';

  v := pg_temp.id_by(3, pg_temp.open_vote_sql(n, 2, 'president', 'chapter_board', 'majority', 3));
  perform pg_temp.all_vote_yes(v);
  perform pg_temp.opened_ago(v, interval '1 day');
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) = pg_temp.w('ACTING_VOTE_OPEN'), 'so does a vote to end his acting';
  perform pg_temp.opened_ago(v, interval '48 hours');
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) is null, 'until 48 hours';
  assert pg_temp.by(3, pg_temp.end_sql(pos)) is null, 'Crank can then end it';
  assert pg_temp.how_ended(pos) = pg_temp.ended('removed', 3), 'removed: ' || pg_temp.how_ended(pos);

  v := pg_temp.id_by(3, pg_temp.open_vote_sql(n, null, null, 'chapter_board', 'majority', 3));
  perform pg_temp.all_vote_yes(v);
  assert pg_temp.by(3, pg_temp.close_vote_sql(v)) is null, 'a board vote about nothing acting closes once everyone has voted, as before';
end $$;
rollback;

\echo 'votes: an acting vote lost closes its request as rejected when it closes'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  req uuid := pg_temp.crank_asks_jet();
  v uuid;
  e uuid;
begin
  v := pg_temp.id_by(3, pg_temp.open_acting_vote_sql(req, 3));
  for e in select member_id from vote_electors where vote_id = v loop
    assert pg_temp.try_as(e, format('select public.cast_ballot(%L, ''no'')', v)) is null, 'each votes no';
  end loop;
  perform pg_temp.opened_ago(v, interval '48 hours');
  assert pg_temp.by(5, pg_temp.close_vote_sql(v)) is null, 'Ned closes it';
  assert (select result = 'lost' from votes where id = v), 'lost';
  assert (select outcome = 'rejected' and closed_at = (select closed_at from votes where id = v) from acting_requests where id = req),
    'the request closes rejected then, so Crank''s 28 days count from the day it was lost';
end $$;
rollback;

\echo 'votes: NEC electors carry for_chapter; North''s is Jet under the cover; a chapter with no President or VP adds none'
begin;
do $$
declare v uuid;
begin
  v := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 2));
  assert pg_temp.electors(v) = array['Smokey:north', 'Rusty:west'], 'each chapter''s President, with the chapter: ' || pg_temp.electors(v)::text;
  perform pg_temp.jet_covers_smokey();
  v := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 2));
  assert pg_temp.electors(v) = array['Jet:north', 'Rusty:west'], 'Jet casts North''s under the cover Smokey agreed: ' || pg_temp.electors(v)::text;
  perform pg_temp.end_row(pg_temp.f(107));
  v := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 1));
  assert pg_temp.electors(v) = array['Jet:north'], 'West, with no President or VP, gets none: ' || pg_temp.electors(v)::text;
end $$;
rollback;

\echo 'votes: a lapsed stint gets no ballot'
begin;
select pg_temp.clock_at('2026-12-13 23:59:59 Australia/Melbourne');
select pg_temp.end_row(pg_temp.f(107));
select pg_temp.seat(10, pg_temp.west(), 'sergeant_at_arms');
create temp table hal_acts as
  select pg_temp.seat(11, pg_temp.west(), 'president', '2026-12-13', 'No President since Rusty stepped down', null, '2026-12-01') as id;
do $$
declare v uuid;
begin
  v := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 2));
  assert pg_temp.electors(v) = array['Smokey:north', 'Hal:west'], 'until today, Hal casts West''s NEC vote: ' || pg_temp.electors(v)::text;
  v := pg_temp.id_by(8, pg_temp.open_vote_sql(pg_temp.west(), null, null, 'chapter_board', 'majority', 3));
  assert pg_temp.electors(v) = array['Torque', 'Penny', 'Spanner', 'Hal'], 'and has a West board ballot: ' || pg_temp.electors(v)::text;
end $$;
select pg_temp.clock_at('2026-12-14 00:00:00 Australia/Melbourne');
do $$
declare v uuid;
begin
  v := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 1));
  assert pg_temp.electors(v) = array['Smokey:north'], 'from Melbourne midnight West has no NEC ballot: ' || pg_temp.electors(v)::text;
  v := pg_temp.id_by(8, pg_temp.open_vote_sql(pg_temp.west(), null, null, 'chapter_board', 'majority', 3));
  assert pg_temp.electors(v) = array['Torque', 'Penny', 'Spanner'], 'and Hal has no board ballot: ' || pg_temp.electors(v)::text;
  assert pg_temp.how_ended((select id from hal_acts)) = pg_temp.ended('lapsed', null), 'opening a vote closed the stint first';
end $$;
rollback;

\echo 'votes: open_acting_vote builds the question and the shape'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
select pg_temp.meeting(pg_temp.north(), 'board', now() + interval '3 days');
do $$
declare
  n uuid := pg_temp.north();
  m uuid := (select id from meetings where chapter_id = pg_temp.north() and kind = 'board' and title = 'A meeting');
  req uuid := pg_temp.crank_asks_jet();
  v uuid;
begin
  v := pg_temp.id_by(3, pg_temp.open_acting_vote_sql(req, 3, 72, m));
  assert (select question from votes where id = v)
    = 'Jet acts as President (North) for Smokey until ' || to_char(pg_temp.today() + 28, 'DD/MM/YYYY') || ': Smokey is in hospital',
    'the question, from the request: ' || (select question from votes where id = v);
  assert (select chapter_id = n and meeting_id = m and subject_member_id = pg_temp.f(2) and subject_role = 'president'
            and electorate = 'chapter_board' and threshold = 'majority' and not secret and quorum = 3 and acting_request = req
            and created_by = pg_temp.f(3) and details is null and closed_at is null and closes_at = now() + interval '72 hours'
          from votes where id = v), 'a board majority on the request, about Jet and the seat, at the meeting';
end $$;
rollback;
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
select pg_temp.end_row(pg_temp.f(101));
do $$
declare
  u date := pg_temp.today() + 28;
  req uuid := pg_temp.id_by(3, pg_temp.request_acting_sql(5, pg_temp.north(), 'president', null, pg_temp.today() + 28,
    'No President since Smokey stepped down'));
  v uuid;
  pos uuid;
begin
  assert pg_temp.by(6, pg_temp.confirm_sql(req)) = pg_temp.w('NEEDS_ACTING_VOTE'), 'Ned isn''t the sitting VP, so it waits for a vote';
  v := pg_temp.id_by(6, pg_temp.open_acting_vote_sql(req, 3));
  assert (select question from votes where id = v)
    = 'Ned acts as President (North) until ' || to_char(u, 'DD/MM/YYYY') || ': No President since Smokey stepped down',
    'an empty seat names no holder: ' || (select question from votes where id = v);
  assert pg_temp.electors(v) = array['Jet', 'Crank', 'Gus'], 'Jet, Crank and Gus decide it, not Ned: ' || pg_temp.electors(v)::text;
  perform pg_temp.all_vote_yes(v);
  perform pg_temp.opened_ago(v, interval '48 hours');
  assert pg_temp.by(6, pg_temp.close_vote_sql(v)) is null, 'Gus closes it at 48 hours';
  pos := pg_temp.id_by(6, pg_temp.confirm_sql(req));
  assert (select acting_vote = v and acting_request = req and covers is null and appointed_by = pg_temp.f(6) and acting_until = u
          from positions where id = pos), 'then confirms Ned as Acting President on the carried vote';
end $$;
rollback;

\echo 'votes: open_acting_vote refuses, in order'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
select pg_temp.meeting(pg_temp.west(), 'board', now() + interval '3 days');
do $$
declare
  req uuid;
  west_meeting uuid := (select id from meetings where chapter_id = pg_temp.west() and title = 'A meeting');
begin
  assert pg_temp.try_as(null, 'select ' || pg_temp.open_acting_vote_sql(gen_random_uuid(), 3)) like 'permission denied for function open_acting_vote%',
    'not for anon';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(gen_random_uuid(), 3)) = pg_temp.w('NO_REQUEST'), 'no such request';
  req := pg_temp.id_by(1, pg_temp.request_cover_sql(pg_temp.f(101), 2, pg_temp.today() + 28));
  assert pg_temp.by(4, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('NO_VOTE_NEEDED'),
    'Smokey asked for his own cover, so a third board member confirms it with no vote';
  assert pg_temp.by(1, pg_temp.withdraw_sql(req)) is null, 'Smokey withdraws it';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 3)) = pg_temp.w('NO_REQUEST'), 'a closed request';

  req := pg_temp.crank_asks_jet();
  assert pg_temp.by(4, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'Lou, an NEC officer, isn''t on North''s board';
  assert pg_temp.by(10, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('BOARD_RECORDS_ACTING'), 'nor is Spanner';
  assert pg_temp.by(2, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('NOT_YOURSELF'), 'Jet is the stand-in';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('ACTING_VOTE_OPEN'), 'closing in 24 hours, before the quorum';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 2, 47)) = pg_temp.w('ACTING_VOTE_OPEN'), 'or in 47';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 2)) = 'Quorum must be between 3 and 3.', 'the quorum is worked out on the three who decide it';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 4)) = 'Quorum must be between 3 and 3.', 'not on the board of five';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 3, null)) = 'Pick a closing time in the future.', 'a closing time';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 3, 1441)) = 'Votes can stay open for 60 days at most.', 'within 60 days';
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 3, 72, west_meeting)) = 'No such meeting.', 'a North meeting, not a West one';
  perform pg_temp.end_row((select id from positions where member_id = pg_temp.f(6) and role = 'sergeant_at_arms' and ended_on is null));
  assert pg_temp.by(3, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('SMALL_BOARD'),
    'with Gus off the board, Crank and Ned are too few, before the closing time';
  assert not exists (select 1 from votes where acting_request is not null), 'nothing opened';
end $$;
rollback;
begin;
select pg_temp.seat(12, pg_temp.west(), 'vice_president');
select pg_temp.seat(10, pg_temp.west(), 'sergeant_at_arms');
select pg_temp.seat(11, pg_temp.west(), 'road_captain');
do $$
declare req uuid := pg_temp.id_by(7, pg_temp.request_acting_sql(8, pg_temp.west(), 'treasurer', pg_temp.f(109), pg_temp.today() + 28,
  'Penny is in hospital'));
begin
  assert pg_temp.by(12, pg_temp.open_acting_vote_sql(req, 2, 24)) = pg_temp.w('AUDITOR_STAYS_OUT'),
    'Kim, the National Auditor in West''s VP seat, doesn''t open a vote on a Treasurer seat';
  assert pg_temp.by(9, pg_temp.open_acting_vote_sql(req, 3)) is null, 'Penny, the holder, can';
end $$;
rollback;

\echo 'votes: club_business, read as Crank and as Smokey, carries acting_request and elector_chapters'
begin;
select pg_temp.seat(5, pg_temp.north(), 'secretary');
select pg_temp.seat(6, pg_temp.north(), 'sergeant_at_arms');
do $$
declare
  req uuid := pg_temp.crank_asks_jet();
  acting uuid;
  nec uuid;
  who int;
  j jsonb;
begin
  acting := pg_temp.id_by(3, pg_temp.open_acting_vote_sql(req, 3));
  nec := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 2));
  foreach who in array array[3, 1] loop
    j := pg_temp.listed(who, acting);
    assert j ->> 'acting_request' = req::text, format('member %s reads the acting vote''s request: %s', who, j);
    assert j -> 'elector_chapters' = '{}'::jsonb, 'and no chapters: it isn''t an NEC vote';
  end loop;
  assert pg_temp.listed(3, nec) is null, 'Crank isn''t on the NEC';
  j := pg_temp.listed(1, nec);
  assert j -> 'elector_chapters' = jsonb_build_object(pg_temp.f(1), pg_temp.north(), pg_temp.f(7), pg_temp.west()),
    'Smokey reads whose chapter each NEC ballot is: ' || coalesce((j -> 'elector_chapters')::text, 'nothing');
  assert j -> 'acting_request' = 'null'::jsonb, 'it isn''t about acting';
end $$;
rollback;

\echo 'votes: Jet (VP) sees an NEC vote once Smokey''s row ends mid-vote'
begin;
do $$
declare v uuid := pg_temp.id_by(4, pg_temp.open_vote_sql(null, null, null, 'nec', 'majority', 2));
begin
  assert pg_temp.listed(2, v) is null, 'Smokey casts North''s ballot, so Jet doesn''t see the vote';
  perform pg_temp.end_row(pg_temp.f(101));
  assert pg_temp.listed(2, v) -> 'elector_chapters' ->> pg_temp.f(1)::text = pg_temp.north()::text,
    'once Smokey steps down, Jet would take North''s uncast ballot, so he sees the vote';
  update vote_electors set voted_at = now() where vote_id = v and member_id = pg_temp.f(1);
  assert pg_temp.listed(2, v) is null, 'not once North''s ballot is cast';
  update vote_electors set voted_at = null where vote_id = v;
  update votes set closed_at = now(), result = 'no_quorum' where id = v;
  assert pg_temp.listed(2, v) is null, 'nor once the vote has closed';
end $$;
rollback;

\echo 'ACTING CHECKS PASSED'
