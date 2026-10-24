-- Checks the ride crew: who can put whom in which spot, the refusals (the same words as
-- src/domain/crew.ts, in the same order), the link with RSVPs, and who can read the crew.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'wes@example.com', now()),      -- West President (so on the NEC)
  ('00000000-0000-0000-0000-0000000000d2', 'nora@example.com', now()),     -- North Road Captain
  ('00000000-0000-0000-0000-0000000000d3', 'rick@example.com', now()),     -- West Ride Committee
  ('00000000-0000-0000-0000-0000000000d4', 'chair@example.com', now()),    -- NEC Chairman (North member)
  ('00000000-0000-0000-0000-0000000000d5', 'fran@example.com', now()),     -- Full, first aid current
  ('00000000-0000-0000-0000-0000000000d6', 'fergus@example.com', now()),   -- FNG
  ('00000000-0000-0000-0000-0000000000d7', 'ned@example.com', now()),      -- Nomad on hiatus
  ('00000000-0000-0000-0000-0000000000d8', 'ada@example.com', now()),      -- Full, first aid ends on the ride date
  ('00000000-0000-0000-0000-0000000000d9', 'paul@example.com', now()),     -- pending
  ('00000000-0000-0000-0000-0000000000da', 'noah@example.com', now()),     -- Full, no private details at all
  ('00000000-0000-0000-0000-0000000000db', 'stranger@example.com', now()), -- signed in, no record
  ('00000000-0000-0000-0000-0000000000dc', 'gail@example.com', now()),     -- Full, first aid current
  ('00000000-0000-0000-0000-0000000000dd', 'nope@example.com', now()),     -- Full, said they can't make it
  ('00000000-0000-0000-0000-0000000000de', 'nina@example.com', now());     -- Nomad, first aid current

insert into members (id, chapter_id, full_name, road_name, status, approval, on_hiatus)
select v.id::uuid, c.id, v.name, v.road, v.status::member_status, v.approval::approval_state, v.hiatus
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes President', 'Prez', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d2', 'north', 'Nora Captain', 'Compass', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'Rick Committee', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'Charlie Chair', 'Gavel', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d5', 'west', 'Fran Full', 'Sparks', 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d6', 'west', 'Fergus FNG', null, 'fng', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d7', 'west', 'Ned Nomad', null, 'nomad', 'approved', true),
  ('00000000-0000-0000-0000-0000000000d8', 'west', 'Ada Aid', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Paul Pending', null, 'introduced', 'pending', false),
  ('00000000-0000-0000-0000-0000000000da', 'west', 'Noah NoAid', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000dc', 'west', 'Gail Going', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000dd', 'west', 'Nate Nope', null, 'full', 'approved', false),
  ('00000000-0000-0000-0000-0000000000de', 'north', 'Nina Nomad', null, 'nomad', 'approved', false)
) as v(id, slug, name, road, status, approval, hiatus)
join chapters c on c.slug = v.slug;

insert into member_private (member_id, first_aid_expiry)
select id, current_date + 365 from members
where id <> '00000000-0000-0000-0000-0000000000da' and id <> '00000000-0000-0000-0000-0000000000d8';

insert into positions (member_id, chapter_id, role)
select v.id::uuid, c.id, v.role::position_role
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'president'),
  ('00000000-0000-0000-0000-0000000000d2', 'north', 'road_captain'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'ride_committee'),
  ('00000000-0000-0000-0000-0000000000d4', null, 'nec_chair')
) as v(id, slug, role)
left join chapters c on c.slug = v.slug;
-- An ended seat gives no powers: Fran was West Road Captain once.
insert into positions (member_id, chapter_id, role, started_on, ended_on)
select '00000000-0000-0000-0000-0000000000d5', id, 'road_captain', current_date - 400, current_date - 30
from chapters where slug = 'west';

insert into rides (id, source, starts_at, all_day, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'app', now() + interval '7 days', false, 'West breakfast', 'west', null),
  ('00000000-0000-0000-0000-0000000000e2', 'app', now() + interval '7 days', false, 'Club run', 'club', null),
  ('00000000-0000-0000-0000-0000000000e3', 'app', now() + interval '7 days', false, 'North loop', 'north', null),
  ('00000000-0000-0000-0000-0000000000e4', 'app', now() + interval '7 days', false, 'Called off', 'west', now()),
  ('00000000-0000-0000-0000-0000000000e9', 'app', now() + interval '7 days', false, 'Supported run', 'supported', null);

-- Ada's first aid runs out on the West breakfast's Melbourne date.
insert into member_private (member_id, first_aid_expiry)
select '00000000-0000-0000-0000-0000000000d8', (starts_at at time zone 'Australia/Melbourne')::date
from rides where id = '00000000-0000-0000-0000-0000000000e1';

-- Nate said he can't make the West breakfast.
insert into rsvps (ride_id, member_id, answer) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000dd', 'no');

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

-- The same, as the authenticated role with no user at all (a lost session).
create function pg_temp.try_signed_out(stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;

create function pg_temp.count_as(who uuid, tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  execute format('select count(*) from %s', tbl) into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

-- set_crew as someone, on a ride (by its last two hex digits), for a member, in a spot.
create function pg_temp.crew(who uuid, ride text, member uuid, spot text) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.set_crew(%L, %L, %L)',
    ('00000000-0000-0000-0000-0000000000' || ride)::uuid, member, spot));
$$;

create function pg_temp.leave(who uuid, ride text, member uuid) returns text language sql as $$
  select pg_temp.try_as(who, format('select public.leave_crew(%L, %L)',
    ('00000000-0000-0000-0000-0000000000' || ride)::uuid, member));
$$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.try_signed_out(text), pg_temp.count_as(uuid, text),
  pg_temp.crew(uuid, text, uuid, text), pg_temp.leave(uuid, text, uuid) to anon, authenticated;

\o
\echo 'Crew actions are SECURITY DEFINER with an empty search_path, and only signed-in users can run them'
do $$
begin
  assert (select bool_and(prosecdef and proconfig @> array['search_path=""'])
          from pg_proc where oid in ('public.set_crew(uuid, uuid, public.crew_role)'::regprocedure,
                                     'public.leave_crew(uuid, uuid)'::regprocedure,
                                     'private.manages_ride(uuid)'::regprocedure,
                                     'public.set_rsvp(uuid, public.rsvp_answer)'::regprocedure,
                                     'public.ride_calendar()'::regprocedure)), 'definer, empty search_path';
  assert not has_function_privilege('anon', 'public.set_crew(uuid, uuid, public.crew_role)', 'execute'), 'anon set_crew';
  assert not has_function_privilege('anon', 'public.leave_crew(uuid, uuid)', 'execute'), 'anon leave_crew';
  assert not has_function_privilege('anon', 'private.manages_ride(uuid)', 'execute'), 'anon manages_ride';
  assert has_function_privilege('authenticated', 'public.set_crew(uuid, uuid, public.crew_role)', 'execute'), 'members set_crew';
  assert has_function_privilege('authenticated', 'public.leave_crew(uuid, uuid)', 'execute'), 'members leave_crew';
  assert pg_temp.crew(null, 'e1', '00000000-0000-0000-0000-0000000000d5', 'officer') is not null, 'the public can''t call it';
end $$;

\echo 'The first checks come in the app''s order: signed in, approved, the ride, cancelled, the ride day'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
begin
  assert pg_temp.try_signed_out(format('select public.set_crew(%L, %L, %L)',
    '00000000-0000-0000-0000-0000000000e1', fran, 'officer')) = 'Sign in first.', 'set: signed out';
  assert pg_temp.try_signed_out(format('select public.leave_crew(%L, %L)',
    '00000000-0000-0000-0000-0000000000e1', fran)) = 'Sign in first.', 'leave: signed out';
  assert pg_temp.crew('00000000-0000-0000-0000-0000000000d9', 'e1', '00000000-0000-0000-0000-0000000000d9', 'officer')
    = 'Only approved members can do that.', 'pending';
  assert pg_temp.crew('00000000-0000-0000-0000-0000000000db', 'e1', '00000000-0000-0000-0000-0000000000db', 'officer')
    = 'Only approved members can do that.', 'no record';
  assert pg_temp.leave('00000000-0000-0000-0000-0000000000d9', 'e1', fran) = 'Only approved members can do that.', 'leave: pending';
  assert pg_temp.crew(fran, 'ff', fran, 'officer') = 'No such ride.', 'missing ride';
  assert pg_temp.leave(fran, 'ff', fran) = 'No such ride.', 'leave: missing ride';
  assert pg_temp.crew(fran, 'e4', fran, 'officer') = 'That ride was cancelled.', 'cancelled';
  assert pg_temp.crew(rick, 'e4', '00000000-0000-0000-0000-0000000000ff', 'officer') = 'That ride was cancelled.',
    'cancelled comes before a missing member';
  assert pg_temp.leave(fran, 'e4', fran) = 'That ride was cancelled.', 'leave: cancelled';
end $$;

\echo 'The member checks come next, in order: missing, someone else, eligible, can''t make it, taken'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
  ned constant uuid := '00000000-0000-0000-0000-0000000000d7';
  noah constant uuid := '00000000-0000-0000-0000-0000000000da';
  nate constant uuid := '00000000-0000-0000-0000-0000000000dd';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
begin
  assert pg_temp.crew(rick, 'e1', '00000000-0000-0000-0000-0000000000ff', 'officer') = 'That member no longer exists.', 'missing member';
  assert pg_temp.crew(fran, 'e1', '00000000-0000-0000-0000-0000000000ff', 'officer') = 'That member no longer exists.',
    'a missing member comes before who may ask';
  assert pg_temp.crew(fran, 'e1', gail, 'officer') = 'Only the board or ride committee can put someone else on the crew.',
    'a member can''t put someone else on';
  assert pg_temp.crew(fran, 'e1', fergus, 'officer') = 'Only the board or ride committee can put someone else on the crew.',
    'who may ask comes before eligibility';
  assert pg_temp.crew(nora, 'e1', gail, 'officer') = 'Only the board or ride committee can put someone else on the crew.',
    'another chapter''s board on a West ride';
  assert pg_temp.crew(fergus, 'e1', fergus, 'officer') = 'Only Full and Nomad members can crew a ride.', 'an FNG';
  assert pg_temp.crew(rick, 'e1', fergus, 'officer') = 'Only Full and Nomad members can crew a ride.', 'a manager picks an FNG';
  assert pg_temp.crew(rick, 'e1', '00000000-0000-0000-0000-0000000000d9', 'officer') = 'Only Full and Nomad members can crew a ride.',
    'an applicant';
  assert pg_temp.crew(ned, 'e1', ned, 'officer') = 'Members on hiatus can’t crew a ride.', 'a Nomad on hiatus';
  assert pg_temp.crew(noah, 'e1', noah, 'tail_gunner') = 'Tail Gunners need a current first aid certificate on file.',
    'no first aid on file, TG';
  assert pg_temp.crew(rick, 'e1', noah, 'assistant_tail_gunner') = 'Tail Gunners need a current first aid certificate on file.',
    'no first aid on file, ATG';
  assert pg_temp.crew(rick, 'e1', nate, 'officer') = 'They said they can’t make it.', 'they said no';
  update members set status = 'fng' where id = nate;
  assert pg_temp.crew(rick, 'e1', nate, 'officer') = 'Only Full and Nomad members can crew a ride.', 'eligibility before their answer';
  update members set status = 'full' where id = nate;
  assert not exists (select 1 from ride_crew), 'nothing was written';
  assert (select answer from rsvps where member_id = nate) = 'no', 'Nate''s answer is untouched';
end $$;

\echo 'First aid has to last to the ride''s Melbourne date: that date passes, the day before doesn''t'
do $$
declare ada constant uuid := '00000000-0000-0000-0000-0000000000d8';
begin
  assert pg_temp.crew(ada, 'e1', ada, 'tail_gunner') is null, 'expires on the ride date';
  delete from ride_crew where member_id = ada;
  update member_private set first_aid_expiry = first_aid_expiry - 1 where member_id = ada;
  assert pg_temp.crew(ada, 'e1', ada, 'tail_gunner') = 'Tail Gunners need a current first aid certificate on file.', 'the day before';
  assert pg_temp.crew(ada, 'e1', ada, 'officer') is null, 'Officers don''t need it';
  update member_private set first_aid_expiry = null where member_id = ada;
  assert pg_temp.crew(ada, 'e1', ada, 'assistant_tail_gunner') = 'Tail Gunners need a current first aid certificate on file.', 'no date';
  delete from ride_crew;
  delete from rsvps where member_id = ada;
end $$;

\echo 'A member can take an open spot; a taken one is refused; joining the crew means going'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  noah constant uuid := '00000000-0000-0000-0000-0000000000da';
  nate constant uuid := '00000000-0000-0000-0000-0000000000dd';
  nina constant uuid := '00000000-0000-0000-0000-0000000000de';
begin
  assert pg_temp.crew(fran, 'e1', fran, 'tail_gunner') is null, 'Fran takes the open TG';
  assert (select role from ride_crew where member_id = fran) = 'tail_gunner', 'she''s TG';
  assert (select assigned_by from ride_crew where member_id = fran) = fran, 'she put herself there';
  assert (select answer from rsvps where member_id = fran and ride_id = '00000000-0000-0000-0000-0000000000e1') = 'going',
    'and she''s going';
  assert pg_temp.crew(gail, 'e1', gail, 'tail_gunner') = 'That spot’s taken.', 'Gail can''t take it from her';
  assert pg_temp.crew(nina, 'e1', nina, 'assistant_tail_gunner') is null, 'a Nomad from another chapter can crew';
  assert pg_temp.crew(nate, 'e1', nate, 'officer') is null, 'Nate changes his mind and joins as an Officer';
  assert (select answer from rsvps where member_id = nate) = 'going', 'his answer becomes going';
  assert pg_temp.crew(noah, 'e1', noah, 'officer') is null, 'Officers have no first aid rule';
  assert pg_temp.crew(gail, 'e1', gail, 'officer') is null, 'a third Officer';
  assert (select count(*) from ride_crew where ride_id = '00000000-0000-0000-0000-0000000000e1' and role = 'officer') = 3,
    'Officers have no limit';
  assert pg_temp.crew(fran, 'e1', fran, 'tail_gunner') is null, 'taking your own spot again is fine';
end $$;

\echo 'Moving to another spot replaces your old one'
do $$
declare fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
begin
  assert pg_temp.crew(fran, 'e1', fran, 'road_captain') is null, 'Fran moves from TG to RC';
  assert (select count(*) from ride_crew where member_id = fran) = 1, 'one spot per person';
  assert (select role from ride_crew where member_id = fran) = 'road_captain', 'now RC';
  assert not exists (select 1 from ride_crew where ride_id = '00000000-0000-0000-0000-0000000000e1' and role = 'tail_gunner'),
    'TG is open again';
end $$;

\echo 'A crew manager can put anyone eligible in any spot, replacing whoever held it'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  ada constant uuid := '00000000-0000-0000-0000-0000000000d8';
begin
  assert pg_temp.crew(rick, 'e1', gail, 'road_captain') is null, 'Rick makes Gail RC';
  assert (select role from ride_crew where member_id = gail) = 'road_captain', 'Gail moved from Officer to RC';
  assert (select assigned_by from ride_crew where member_id = gail) = rick, 'Rick put her there';
  assert not exists (select 1 from ride_crew where member_id = fran), 'Fran is off the crew';
  assert (select answer from rsvps where member_id = fran and ride_id = '00000000-0000-0000-0000-0000000000e1') = 'going',
    'Fran''s answer stays as it was';
  assert (select count(*) from ride_crew where ride_id = '00000000-0000-0000-0000-0000000000e1' and role = 'road_captain') = 1,
    'still one RC';
  assert pg_temp.crew(rick, 'e1', rick, 'tail_gunner') is null, 'a manager can crew themselves';
  update member_private set first_aid_expiry = current_date + 365 where member_id = ada;
  assert pg_temp.crew(rick, 'e1', ada, 'officer') is null, 'Ada had no answer';
  assert (select answer from rsvps where member_id = ada) = 'going', 'and now she''s going';
end $$;

\echo 'Crew managers: that chapter''s board or Ride Committee, any of them for other rides, the NEC for all'
do $$
declare
  wes constant uuid := '00000000-0000-0000-0000-0000000000d1';
  nora constant uuid := '00000000-0000-0000-0000-0000000000d2';
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  chair constant uuid := '00000000-0000-0000-0000-0000000000d4';
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  someone_else constant text := 'Only the board or ride committee can put someone else on the crew.';
begin
  assert pg_temp.crew(nora, 'e3', gail, 'officer') is null, 'North RC on a North ride';
  assert pg_temp.crew(nora, 'e2', gail, 'officer') is null, 'North RC on a club ride';
  assert pg_temp.crew(nora, 'e9', gail, 'officer') is null, 'North RC on a supported ride';
  assert pg_temp.crew(rick, 'e3', fran, 'officer') = someone_else, 'West committee on a North ride';
  assert pg_temp.crew(rick, 'e2', fran, 'officer') is null, 'West committee on a club ride';
  assert pg_temp.crew(chair, 'e1', fran, 'tail_gunner') is null, 'the NEC Chairman on a West ride';
  assert pg_temp.crew(chair, 'e3', fran, 'officer') is null, 'and a North one';
  assert pg_temp.crew(wes, 'e3', wes, 'road_captain') is null, 'a sitting President is on the NEC';
  assert pg_temp.crew(fran, 'e2', gail, 'tail_gunner') = someone_else, 'an ended seat gives no powers';
  -- The Melbourne date, which seats start on: the server's current_date can be a day behind it.
  update positions set ended_on = private.club_date() where member_id = rick;
  assert pg_temp.crew(rick, 'e1', fran, 'officer') = someone_else, 'an ended committee seat neither';
  update positions set ended_on = null where member_id = rick;
end $$;

\echo 'Stepping down: yourself, or anyone if you manage the crew'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  nina constant uuid := '00000000-0000-0000-0000-0000000000de';
  noah constant uuid := '00000000-0000-0000-0000-0000000000da';
  fergus constant uuid := '00000000-0000-0000-0000-0000000000d6';
begin
  assert pg_temp.leave(noah, 'e1', gail) = 'Only the board or ride committee can take someone else off the crew.', 'someone else';
  assert pg_temp.leave(fergus, 'e1', fergus) = 'They’re not on the crew.', 'not on it';
  assert pg_temp.leave(rick, 'e2', '00000000-0000-0000-0000-0000000000ff') = 'They’re not on the crew.', 'nobody';
  assert pg_temp.leave(noah, 'e1', noah) is null, 'Noah steps down';
  assert not exists (select 1 from ride_crew where member_id = noah and ride_id = '00000000-0000-0000-0000-0000000000e1'), 'gone';
  assert (select answer from rsvps where member_id = noah and ride_id = '00000000-0000-0000-0000-0000000000e1') = 'going',
    'stepping down leaves the answer';
  assert pg_temp.leave(rick, 'e1', nina) is null, 'Rick takes Nina off';
  assert not exists (select 1 from ride_crew where member_id = nina), 'gone too';
end $$;

\echo 'Changing your answer to Maybe or Can''t make it takes you off the crew'
do $$
declare
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  ada constant uuid := '00000000-0000-0000-0000-0000000000d8';
begin
  assert pg_temp.try_as(gail, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000e1', 'going')$q$) is null, 'going';
  assert exists (select 1 from ride_crew where member_id = gail and ride_id = '00000000-0000-0000-0000-0000000000e1'), 'Going keeps it';
  assert pg_temp.try_as(gail, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000e1', 'maybe')$q$) is null, 'maybe';
  assert not exists (select 1 from ride_crew where member_id = gail and ride_id = '00000000-0000-0000-0000-0000000000e1'), 'Maybe drops it';
  assert exists (select 1 from ride_crew where member_id = gail and ride_id <> '00000000-0000-0000-0000-0000000000e1'),
    'only on that ride';
  assert pg_temp.try_as(ada, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000e1', 'no')$q$) is null, 'no';
  assert not exists (select 1 from ride_crew where member_id = ada and ride_id = '00000000-0000-0000-0000-0000000000e1'), 'No drops it';
  assert (select answer from rsvps where member_id = ada and ride_id = '00000000-0000-0000-0000-0000000000e1') = 'no', 'answer saved';
end $$;

\echo 'The crew can change all through the ride''s first Melbourne day, and not after'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  midnight timestamptz := private.club_date()::timestamp at time zone 'Australia/Melbourne';
  yesterday timestamptz := (private.club_date() - 1)::timestamp at time zone 'Australia/Melbourne';
  over constant text := 'The crew can’t change after the ride day.';
begin
  insert into rides (id, source, starts_at, ends_at, all_day, title, category) values
    ('00000000-0000-0000-0000-0000000000e5', 'app', midnight + interval '1 minute', null, false, 'Dawn patrol', 'west'),
    ('00000000-0000-0000-0000-0000000000e6', 'app', midnight - interval '1 minute', null, false, 'Midnight run', 'west'),
    ('00000000-0000-0000-0000-0000000000e7', 'app', midnight, midnight + interval '2 days', true, 'Island weekend', 'club'),
    ('00000000-0000-0000-0000-0000000000e8', 'app', yesterday, midnight + interval '1 day', true, 'Two-day tour', 'club');
  assert pg_temp.crew(fran, 'e5', fran, 'officer') is null, 'a ride that started this morning';
  assert pg_temp.crew(fran, 'e7', fran, 'officer') is null, 'an all-day ride that started today';
  assert pg_temp.crew(fran, 'e6', fran, 'officer') = over, 'a ride that started a minute before midnight';
  assert pg_temp.crew(fran, 'e8', fran, 'officer') = over, 'a tour whose first day was yesterday';
  assert pg_temp.leave(fran, 'e5', fran) is null, 'stepping down today';
  insert into ride_crew (ride_id, member_id, role) values ('00000000-0000-0000-0000-0000000000e6', fran, 'officer');
  assert pg_temp.leave(fran, 'e6', fran) = over, 'stepping down after the day';
  delete from ride_crew where ride_id = '00000000-0000-0000-0000-0000000000e6';
end $$;

\echo 'Nobody writes the crew through the API, and only approved members read it'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  before bigint := (select count(*) from ride_crew);
begin
  assert before > 0, 'there is a crew to read';
  assert pg_temp.try_as(fran, format($q$insert into ride_crew (ride_id, member_id, role) values (%L, %L, 'road_captain')$q$,
    '00000000-0000-0000-0000-0000000000e9', fran)) is not null, 'insert';
  assert pg_temp.try_as(fran, $q$update ride_crew set role = 'road_captain'$q$) is not null, 'update';
  assert pg_temp.try_as(fran, $q$delete from ride_crew$q$) is not null, 'delete';
  assert pg_temp.try_as(null, $q$delete from ride_crew$q$) is not null, 'anon delete';
  assert (select count(*) from ride_crew) = before, 'untouched';
  assert pg_temp.count_as(fran, 'ride_crew') = before, 'a member reads it all';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d6', 'ride_crew') = before, 'an FNG does too';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000d9', 'ride_crew') in (0, -1), 'an applicant can''t';
  assert pg_temp.count_as('00000000-0000-0000-0000-0000000000db', 'ride_crew') in (0, -1), 'nor a stranger';
  assert pg_temp.count_as(null, 'ride_crew') in (0, -1), 'nor the public';
end $$;

-- Reads ride_calendar() as someone, or the error.
create function pg_temp.calendar_as(who uuid) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    select public.ride_calendar() into out;
  exception when others then
    out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;
grant execute on function pg_temp.calendar_as(uuid) to anon, authenticated;

\echo 'The calendar brings the crew of the rides it shows, in spot order'
do $$
declare
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
  cal jsonb;
  north_crew jsonb;
begin
  -- Last night's ride isn't shown any more; the two-day tour still is.
  insert into ride_crew (ride_id, member_id, role) values
    ('00000000-0000-0000-0000-0000000000e6', fran, 'officer'),
    ('00000000-0000-0000-0000-0000000000e8', fran, 'officer'),
    ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'tail_gunner');
  cal := pg_temp.calendar_as(fran);
  assert cal ? 'crew', 'a crew list';
  assert jsonb_array_length(cal->'crew') = (select count(*) from ride_crew
                                             where ride_id <> '00000000-0000-0000-0000-0000000000e6'), 'every shown ride''s crew';
  assert (select bool_and((c->>'ride_id')::uuid in (select (r->>'id')::uuid from jsonb_array_elements(cal->'rides') r))
          from jsonb_array_elements(cal->'crew') c), 'only for the rides it shows';
  assert exists (select 1 from jsonb_array_elements(cal->'crew') c
                 where c->>'ride_id' = '00000000-0000-0000-0000-0000000000e8' and c->>'member_id' = fran::text), 'the tour''s crew';
  select jsonb_agg(c) into north_crew from jsonb_array_elements(cal->'crew') c
  where c->>'ride_id' = '00000000-0000-0000-0000-0000000000e3';
  assert array(select x->>'role' from jsonb_array_elements(north_crew) x)
    = array['road_captain', 'tail_gunner', 'officer', 'officer'], 'RC, TG, then Officers';
  assert north_crew->0->>'member_id' = '00000000-0000-0000-0000-0000000000d1', 'Wes is RC';
  assert north_crew->0 ?& array['ride_id', 'member_id', 'role', 'assigned_by', 'assigned_at'], 'every column';
  assert cal ? 'rides' and cal ? 'rsvps' and cal ? 'synced_at', 'the rest is still there';
  assert pg_temp.calendar_as('00000000-0000-0000-0000-0000000000d9')->'rides' = '[]', 'an applicant gets nothing';
  assert coalesce(pg_temp.calendar_as('00000000-0000-0000-0000-0000000000d9')->'crew', '[]') = '[]', 'no crew either';
  assert pg_temp.calendar_as(null) ? 'error', 'the public can''t ask';
end $$;

\echo 'set_crew, leave_crew and set_rsvp all lock the ride the same way first, so they queue instead of deadlocking'
create extension if not exists pgrowlocks;
-- The row locks held on a ride (by its last two hex digits) right now.
create function pg_temp.ride_locks(ride text) returns text[] language sql as $$
  select l.modes from pgrowlocks('public.rides') l join public.rides r on r.ctid = l.locked_row
  where r.id = ('00000000-0000-0000-0000-0000000000' || ride)::uuid;
$$;
-- Nina is on the supported run's crew for the leave_crew check below.
do $$
begin
  assert pg_temp.crew('00000000-0000-0000-0000-0000000000de', 'e9', '00000000-0000-0000-0000-0000000000de', 'officer') is null,
    'Nina volunteers';
end $$;
do $$
declare
  nina constant uuid := '00000000-0000-0000-0000-0000000000de';
  gail constant uuid := '00000000-0000-0000-0000-0000000000dc';
  rsvp_locks text[];
  crew_locks text[];
  leave_locks text[];
begin
  -- Each action runs in a block that is then undone, which also lets go of its locks.
  begin
    assert pg_temp.try_as(gail, $q$select public.set_rsvp('00000000-0000-0000-0000-0000000000e9', 'maybe')$q$) is null, 'Gail answers';
    rsvp_locks := pg_temp.ride_locks('e9');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  begin
    assert pg_temp.crew(gail, 'e9', gail, 'road_captain') is null, 'Gail volunteers';
    crew_locks := pg_temp.ride_locks('e9');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  begin
    assert pg_temp.leave(nina, 'e9', nina) is null, 'Nina steps down';
    leave_locks := pg_temp.ride_locks('e9');
    raise sqlstate 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  assert rsvp_locks = '{"For No Key Update"}', format('set_rsvp locks the ride first, not %s', rsvp_locks);
  assert crew_locks = '{"For No Key Update"}', format('set_crew locks it the same way, not %s', crew_locks);
  assert leave_locks = '{"For No Key Update"}', format('and so does leave_crew, not %s', leave_locks);
  assert exists (select 1 from ride_crew where member_id = nina and ride_id = '00000000-0000-0000-0000-0000000000e9'),
    'the checks changed nothing';
  assert pg_temp.leave(nina, 'e9', nina) is null, 'Nina steps down for real';
end $$;

\echo 'A crew spot goes with its ride and its member; who put them there is kept loosely'
do $$
declare
  rick constant uuid := '00000000-0000-0000-0000-0000000000d3';
  fran constant uuid := '00000000-0000-0000-0000-0000000000d5';
begin
  insert into ride_crew (ride_id, member_id, role) values ('00000000-0000-0000-0000-0000000000e9', rick, 'officer');
  assert exists (select 1 from ride_crew where member_id = fran and assigned_by = rick
                 and ride_id = '00000000-0000-0000-0000-0000000000e2'), 'Rick put Fran on the club run';
  delete from members where id = rick;
  assert not exists (select 1 from ride_crew where member_id = rick), 'his own spot went with him';
  assert exists (select 1 from ride_crew where member_id = fran and assigned_by is null
                 and ride_id = '00000000-0000-0000-0000-0000000000e2'), 'Fran keeps hers';
  delete from rides where id = '00000000-0000-0000-0000-0000000000e2';
  assert not exists (select 1 from ride_crew where ride_id = '00000000-0000-0000-0000-0000000000e2'), 'the ride''s crew went with it';
end $$;
