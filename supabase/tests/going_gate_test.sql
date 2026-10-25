-- Checks the Going gate (docs/superpowers/specs/2026-10-25-road-rules-going-gate-design.md): a member
-- who's asked to sign (approved, not Legacy) can't say Going in set_rsvp, or be put on a crew in
-- set_crew, while their Road Rules are unsigned or expired. The refusals use the same words as
-- src/domain/roadRules.ts and come in the same place: after set_rsvp's other checks, and after
-- set_crew's eligibility checks. Maybe and Can't make it always work, nothing published means no
-- gate, and answers and crew spots already there stay.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'wes@example.com', now()),     -- West President, signed
  ('00000000-0000-0000-0000-0000000000a2', 'cora@example.com', now()),    -- Full, signed a month ago
  ('00000000-0000-0000-0000-0000000000a3', 'dora@example.com', now()),    -- Full, due soon
  ('00000000-0000-0000-0000-0000000000a4', 'ezra@example.com', now()),    -- Full, ran out
  ('00000000-0000-0000-0000-0000000000a5', 'uma@example.com', now()),     -- Full, never signed
  ('00000000-0000-0000-0000-0000000000a6', 'lou@example.com', now()),     -- Legacy, never signed
  ('00000000-0000-0000-0000-0000000000a7', 'paul@example.com', now()),    -- pending
  ('00000000-0000-0000-0000-0000000000a8', 'fergus@example.com', now()),  -- FNG, never signed
  ('00000000-0000-0000-0000-0000000000a9', 'hank@example.com', now()),    -- Nomad on hiatus, never signed
  ('00000000-0000-0000-0000-0000000000aa', 'nate@example.com', now()),    -- Full, never signed, said no
  ('00000000-0000-0000-0000-0000000000ab', 'gail@example.com', now());    -- Full, never signed, already Going and on the crew

insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus)
select v.id::uuid, c.id, v.name, null, v.status::member_status, v.approval::approval_state, v.hiatus
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'west', 'Wes President', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a2', 'west', 'Cora Current', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a3', 'west', 'Dora Due', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a4', 'west', 'Ezra Expired', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a5', 'west', 'Uma Unsigned', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a6', 'west', 'Lou Legacy', 'legacy', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a7', 'west', 'Paul Pending', 'introduced', 'pending', false),
  ('00000000-0000-0000-0000-0000000000a8', 'west', 'Fergus FNG', 'fng', 'approved', false),
  ('00000000-0000-0000-0000-0000000000a9', 'west', 'Hank Hiatus', 'nomad', 'approved', true),
  ('00000000-0000-0000-0000-0000000000aa', 'west', 'Nate Nope', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000ab', 'west', 'Gail Going', 'full', 'approved', false)
) as v(id, slug, name, status, approval, hiatus)
join chapters c on c.slug = v.slug;

-- First aid on file for everyone but Uma, so only she trips the Tail Gunner check.
insert into member_private (member_id, first_aid_expiry)
select id, current_date + 365 from members where id <> '00000000-0000-0000-0000-0000000000a5';

insert into positions (member_id, chapter_id, role)
select '00000000-0000-0000-0000-0000000000a1', id, 'president' from chapters where slug = 'west';

insert into rides (id, source, starts_at, all_day, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'app', now() + interval '7 days', false, 'West breakfast', 'west', null),
  ('00000000-0000-0000-0000-0000000000b2', 'app', now() + interval '7 days', false, 'Called off', 'west', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'app', now() - interval '1 day', false, 'Gone', 'west', null);

-- Nate said he can't make the West breakfast. Gail said Going and is its Officer, before anything
-- was published. Cora is its Road Captain.
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000aa', 'no'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ab', 'going'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'going');
insert into ride_crew (ride_id, member_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ab', 'officer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'road_captain');

-- Runs a statement as a signed-in user and returns its error, or null. Each try is undone after
-- (a savepoint), so the cases don't change each other's starting point.
create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
declare err text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
    set local role authenticated;
    execute stmt;
    raise sqlstate 'U0001';
  exception
    when sqlstate 'U0001' then err := null;
    when others then err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return err;
end $$;

create function pg_temp.rsvp(who uuid, ride uuid, answer text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.set_rsvp(%L, %L)', ride, answer));
$$;

create function pg_temp.crew(who uuid, ride uuid, target uuid, role text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.set_crew(%L, %L, %L)', ride, target, role));
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.rsvp(uuid, uuid, text),
  pg_temp.crew(uuid, uuid, uuid, text) to authenticated;

\o
\echo 'With no Road Rules published, nobody is stopped from Going or from the crew'
do $$
declare
  ride constant uuid := '00000000-0000-0000-0000-0000000000b1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000a1';
  uma constant uuid := '00000000-0000-0000-0000-0000000000a5';
begin
  assert not exists (select 1 from road_rules_versions), 'nothing published';
  assert pg_temp.rsvp(uma, ride, 'going') is null, 'Uma says Going';
  assert pg_temp.crew(wes, ride, uma, 'officer') is null, 'Wes crews Uma';
  assert pg_temp.crew(uma, ride, uma, 'officer') is null, 'Uma volunteers';
end $$;

\o /dev/null
-- Version 1 is published, then the sign-offs: a month ago, due soon (good until ten days from now)
-- and run out (a year and a day ago), all at midday in Melbourne.
insert into road_rules_versions (number, body, fresh, published_at) values (1, '# Road Rules', true, now() - interval '2 years');
insert into road_rules_signoffs (member_id, version, signed_at)
select v.id::uuid, 1, (v.day + time '12:00') at time zone 'Australia/Melbourne'
from (values
  ('00000000-0000-0000-0000-0000000000a1', private.club_date() - 30),
  ('00000000-0000-0000-0000-0000000000a2', private.club_date() - 30),
  ('00000000-0000-0000-0000-0000000000a3', (private.club_date() - interval '1 year')::date + 10),
  ('00000000-0000-0000-0000-0000000000a4', (private.club_date() - interval '1 year')::date - 1)
) as v(id, day);
\o

\echo 'set_rsvp: Going needs the Road Rules signed (Sign the Road Rules first.); due soon still counts'
do $$
declare
  ride constant uuid := '00000000-0000-0000-0000-0000000000b1';
  sign_first constant text := 'Sign the Road Rules first.';
begin
  assert private.road_rules_signed('00000000-0000-0000-0000-0000000000a3'), 'Dora is due soon, so still signed';
  assert not private.road_rules_signed('00000000-0000-0000-0000-0000000000a4'), 'Ezra ran out';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a5', ride, 'going') = sign_first, 'never signed';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a4', ride, 'going') = sign_first, 'ran out';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a2', ride, 'going') is null, 'signed';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a3', ride, 'going') is null, 'due soon';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a6', ride, 'going') is null, 'Legacy isn''t asked to sign';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a8', ride, 'going') = sign_first, 'an FNG is asked too';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a9', ride, 'going') = sign_first, 'so is a Nomad on hiatus';
end $$;

\echo 'set_rsvp: Maybe and Can''t make it always work, and the other checks come first'
do $$
declare
  ride constant uuid := '00000000-0000-0000-0000-0000000000b1';
  uma constant uuid := '00000000-0000-0000-0000-0000000000a5';
  ezra constant uuid := '00000000-0000-0000-0000-0000000000a4';
begin
  assert pg_temp.rsvp(uma, ride, 'maybe') is null, 'Uma says Maybe';
  assert pg_temp.rsvp(uma, ride, 'no') is null, 'Uma can''t make it';
  assert pg_temp.rsvp(ezra, ride, 'maybe') is null, 'Ezra says Maybe';
  assert pg_temp.try_as(null, format('select public.set_rsvp(%L, ''going'')', ride)) = 'Sign in first.', 'signed out';
  assert pg_temp.rsvp('00000000-0000-0000-0000-0000000000a7', ride, 'going') = 'Only approved members can do that.', 'pending';
  assert pg_temp.rsvp(uma, '00000000-0000-0000-0000-0000000000bf', 'going') = 'No such ride.', 'no such ride';
  assert pg_temp.rsvp(uma, '00000000-0000-0000-0000-0000000000b2', 'going') = 'That ride was cancelled.', 'cancelled';
  assert pg_temp.rsvp(uma, '00000000-0000-0000-0000-0000000000b3', 'going') = 'That ride has already started.', 'started';
  assert pg_temp.try_as(uma, format('select public.set_rsvp(%L, null)', ride)) = 'Pick an answer.', 'no answer';
end $$;

\echo 'set_crew: an unsigned or expired target is refused (They haven’t signed the Road Rules yet.), after eligibility'
do $$
declare
  ride constant uuid := '00000000-0000-0000-0000-0000000000b1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000a1';
  uma constant uuid := '00000000-0000-0000-0000-0000000000a5';
  not_signed constant text := 'They haven’t signed the Road Rules yet.';
begin
  assert pg_temp.crew(wes, ride, uma, 'officer') = not_signed, 'never signed';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a4', 'road_captain') = not_signed, 'ran out';
  assert pg_temp.crew(uma, ride, uma, 'officer') = not_signed, 'volunteering yourself';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a2', 'officer') is null, 'signed';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a3', 'tail_gunner') is null, 'due soon';
  assert pg_temp.crew(wes, ride, wes, 'road_captain') is null, 'signed, yourself';
  -- Eligibility first.
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a8', 'officer') = 'Only Full and Nomad members can crew a ride.',
    'an unsigned FNG';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a6', 'officer') = 'Only Full and Nomad members can crew a ride.',
    'Legacy';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a9', 'officer') = 'Members on hiatus can’t crew a ride.',
    'an unsigned Nomad on hiatus';
  assert pg_temp.crew(wes, ride, uma, 'tail_gunner') = 'Tail Gunners need a current first aid certificate on file.',
    'first aid before the Road Rules';
  -- Then the Road Rules, before "can't make it" and a taken spot.
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000aa', 'officer') = not_signed, 'before can''t make it';
  assert pg_temp.crew('00000000-0000-0000-0000-0000000000a3', ride, '00000000-0000-0000-0000-0000000000a3', 'road_captain') =
    'That spot’s taken.', 'Cora holds the RC spot';
  assert pg_temp.crew(uma, ride, uma, 'road_captain') = not_signed, 'before a taken spot';
  -- And "who manages" before all of it.
  assert pg_temp.crew(uma, ride, '00000000-0000-0000-0000-0000000000a4', 'officer') =
    'Only the board or ride committee can put someone else on the crew.', 'who manages comes first';
end $$;

\echo 'Answers and crew spots given before stay; a fresh version stops older sign-offs; signing lets you Go'
do $$
declare
  ride constant uuid := '00000000-0000-0000-0000-0000000000b1';
  wes constant uuid := '00000000-0000-0000-0000-0000000000a1';
  cora constant uuid := '00000000-0000-0000-0000-0000000000a2';
  gail constant uuid := '00000000-0000-0000-0000-0000000000ab';
  uma constant uuid := '00000000-0000-0000-0000-0000000000a5';
begin
  assert exists (select 1 from rsvps where ride_id = ride and member_id = gail and answer = 'going'), 'Gail is still Going';
  assert exists (select 1 from ride_crew where ride_id = ride and member_id = gail and role = 'officer'), 'and still on the crew';
  assert pg_temp.crew(wes, ride, '00000000-0000-0000-0000-0000000000a3', 'officer') is null, 'another crew change';
  assert pg_temp.crew(gail, ride, gail, 'road_captain') = 'They haven’t signed the Road Rules yet.', 'but she can''t move spots';

  -- A fresh version 2: Cora's sign-off on version 1 no longer counts.
  begin
    insert into road_rules_versions (number, body, fresh) values (2, '# Road Rules, again', true);
    assert pg_temp.rsvp(cora, ride, 'going') = 'Sign the Road Rules first.', 'signed an older version';
    assert pg_temp.crew(wes, ride, cora, 'officer') = 'They haven’t signed the Road Rules yet.', 'nor be crewed';
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  -- A small fix carries it over.
  begin
    insert into road_rules_versions (number, body, fresh) values (2, '# Road Rules, fixed', false);
    assert pg_temp.rsvp(cora, ride, 'going') is null, 'a small fix carries over';
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  assert pg_temp.try_as(uma, 'select public.sign_road_rules(1)') is null, 'Uma can sign version 1';
  begin
    perform set_config('request.jwt.claim.sub', uma::text, true);
    set local role authenticated;
    perform public.sign_road_rules(1);
    perform public.set_rsvp(ride, 'going');
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    assert exists (select 1 from rsvps where ride_id = ride and member_id = uma and answer = 'going'), 'after signing, Uma is Going';
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
end $$;

\echo 'set_rsvp and set_crew keep their grants: signed-in users only, SECURITY DEFINER, empty search_path'
do $$
declare
  fns constant regprocedure[] := array[
    'public.set_rsvp(uuid, public.rsvp_answer)'::regprocedure,
    'public.set_crew(uuid, uuid, public.crew_role)'::regprocedure];
  f regprocedure;
begin
  foreach f in array fns loop
    assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = f), format('%s: definer, empty search_path', f);
    assert not has_function_privilege('anon', f, 'execute'), format('anon can''t run %s', f);
    assert not has_function_privilege('public', f, 'execute'), format('public can''t run %s', f);
    assert has_function_privilege('authenticated', f, 'execute'), format('members can run %s', f);
  end loop;
end $$;

\echo 'GOING GATE CHECKS PASSED'
