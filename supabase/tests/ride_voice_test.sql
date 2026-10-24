-- Checks who may join a ride's voice room: the live ride rules decide.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'rita@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'pete@example.com', now());
insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, v.road, 'full', v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Rita Rider', 'Rusty', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'Pete Pending', null, 'pending')
) as v(id, name, road, approval)
join chapters c on c.slug = 'west';

insert into rides (id, source, starts_at, ends_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'app', now() + interval '1 hour', now() + interval '4 hours', 'Today', 'west', null),
  ('00000000-0000-0000-0000-0000000000b2', 'app', now() + interval '3 days', null, 'Later', 'west', null),
  ('00000000-0000-0000-0000-0000000000b3', 'app', now() + interval '1 hour', null, 'Called off', 'west', now());

-- Runs a query as someone; gives back its answer, or the error's words.
create function pg_temp.ask(who uuid, r text, stmt text) returns text language plpgsql as $$
declare answer text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  execute format('set local role %I', r);
  begin
    execute stmt into answer;
  exception when others then
    answer := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return answer;
end $$;

\o
\echo 'An approved member joins their ride''s room, on the live ride''s window'
\o /dev/null
do $$
declare rita constant uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  assert pg_temp.ask(rita, 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b1')::text$s$)::jsonb - 'closes'
    = '{"room": "ride-00000000-0000-0000-0000-0000000000b1", "name": "Rusty"}'::jsonb, 'room and road name';
  -- The token can't outlive the window: it closes 2 hours after the ride's end.
  assert (pg_temp.ask(rita, 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b1')::text$s$)::jsonb ->> 'closes')::timestamptz
    = (select ends_at + interval '2 hours' from rides where id = '00000000-0000-0000-0000-0000000000b1'), 'closes with the live window';
  assert pg_temp.ask(rita, 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b2')::text$s$)
    = 'Live ride opens 2 hours before the start.', 'not yet';
  assert pg_temp.ask(rita, 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b3')::text$s$)
    = 'That ride was cancelled.', 'cancelled';
end $$;

\o
\echo 'Nobody else gets in'
\o /dev/null
do $$
begin
  assert pg_temp.ask('00000000-0000-0000-0000-0000000000a2', 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b1')::text$s$)
    = 'Only approved members can do that.', 'pending';
  assert pg_temp.ask(null, 'authenticated', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b1')::text$s$)
    = 'Sign in first.', 'no one signed in';
  assert pg_temp.ask(null, 'anon', $s$select public.ride_voice_room('00000000-0000-0000-0000-0000000000b1')::text$s$)
    like 'permission denied%', 'anon can''t call it';
end $$;

\o
\echo 'RIDE VOICE CHECKS PASSED'
