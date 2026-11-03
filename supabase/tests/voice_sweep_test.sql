-- ChatGPT audit F03: the voice sweep says which ride rooms to close and who to take out of the rest.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'rita@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'sam@example.com', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'fay@example.com', now());
insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, c.id, v.name, null, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000a1', 'Rita Rider', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'Sam Suspended', 'full', 'suspended'),
  ('00000000-0000-0000-0000-0000000000a3', 'Fay Family', 'family', 'approved')
) as v(id, name, status, approval)
join chapters c on c.slug = 'west';

insert into rides (id, source, starts_at, ends_at, title, category, cancelled_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'app', now() - interval '1 hour', now() + interval '2 hours', 'On now', 'west', null),
  ('00000000-0000-0000-0000-0000000000b2', 'app', now() - interval '8 hours', now() - interval '5 hours', 'Finished', 'west', null),
  ('00000000-0000-0000-0000-0000000000b3', 'app', now() - interval '1 hour', null, 'Called off', 'west', now()),
  ('00000000-0000-0000-0000-0000000000b4', 'app', now() + interval '3 days', null, 'Later', 'west', null);

create function pg_temp.sweep(r text, rooms jsonb) returns text language plpgsql as $$
declare answer text;
begin
  execute format('set local role %I', r);
  begin
    select public.voice_sweep(rooms)::text into answer;
  exception when others then
    answer := sqlerrm;
  end;
  reset role;
  return answer;
end $$;

\o
\echo 'A live ride keeps its room; only people who can no longer be there are taken out'
\o /dev/null
do $$
declare answer jsonb;
begin
  answer := pg_temp.sweep('service_role', $j$[
    {"room": "ride-00000000-0000-0000-0000-0000000000b1",
     "members": ["00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2",
                 "00000000-0000-0000-0000-0000000000a3", "00000000-0000-0000-0000-0000000000a9", "not-a-member"]}
  ]$j$)::jsonb;
  assert answer = $j$[{"room": "ride-00000000-0000-0000-0000-0000000000b1", "close": false,
    "remove": ["00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000a3",
               "00000000-0000-0000-0000-0000000000a9", "not-a-member"]}]$j$::jsonb, answer::text;
  answer := pg_temp.sweep('service_role', $j$[{"room": "ride-00000000-0000-0000-0000-0000000000b1",
    "members": ["00000000-0000-0000-0000-0000000000a1"]}]$j$)::jsonb;
  assert answer = '[]'::jsonb, 'nothing to do: ' || answer::text;
end $$;

\o
\echo 'A finished, cancelled, not-yet-open or unknown ride''s room is closed; other rooms are left alone'
\o /dev/null
do $$
declare answer jsonb;
begin
  answer := pg_temp.sweep('service_role', $j$[
    {"room": "ride-00000000-0000-0000-0000-0000000000b2", "members": ["00000000-0000-0000-0000-0000000000a1"]},
    {"room": "ride-00000000-0000-0000-0000-0000000000b3", "members": []},
    {"room": "ride-00000000-0000-0000-0000-0000000000b4", "members": ["00000000-0000-0000-0000-0000000000a1"]},
    {"room": "ride-00000000-0000-0000-0000-0000000000ff", "members": []},
    {"room": "ride-not-a-uuid", "members": []},
    {"room": "someone-elses-room", "members": ["x"]}
  ]$j$)::jsonb;
  assert answer = $j$[
    {"room": "ride-00000000-0000-0000-0000-0000000000b2", "close": true, "remove": []},
    {"room": "ride-00000000-0000-0000-0000-0000000000b3", "close": true, "remove": []},
    {"room": "ride-00000000-0000-0000-0000-0000000000b4", "close": true, "remove": []},
    {"room": "ride-00000000-0000-0000-0000-0000000000ff", "close": true, "remove": []},
    {"room": "ride-not-a-uuid", "close": true, "remove": []}
  ]$j$::jsonb, answer::text;
  assert pg_temp.sweep('service_role', null)::jsonb = '[]'::jsonb, 'nothing sent';
end $$;

\o
\echo 'Only the server may ask'
\o /dev/null
do $$
begin
  assert pg_temp.sweep('authenticated', '[]') like 'permission denied%', 'members';
  assert pg_temp.sweep('anon', '[]') like 'permission denied%', 'anyone';
end $$;

\o
\echo 'The sweep only runs around a ride''s live window'
\o /dev/null
do $$
begin
  assert private.voice_sweep_due(), 'a ride is on';
  update rides set cancelled_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
  assert private.voice_sweep_due(), 'a room may still be open for a ride that finished 3 hours ago';
  update rides set starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '3 hours'
   where id = '00000000-0000-0000-0000-0000000000b2';
  assert private.voice_sweep_due(), 'still due: rides were called off in the last 6 hours';
  update rides set cancelled_at = now() - interval '7 hours' where cancelled_at is not null;
  assert not private.voice_sweep_due(), 'nothing on or just finished';
  assert private.voice_sweep_url() is null, 'not set until an admin sets it';
end $$;

\o
\echo 'The live ride rule still answers as before for the signed-in member'
\o /dev/null
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  assert private.live_problem('00000000-0000-0000-0000-0000000000b4') = 'Only approved members can do that.', 'suspended';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  assert private.live_problem('00000000-0000-0000-0000-0000000000b4') = 'Live ride opens 2 hours before the start.', 'not yet';
  perform set_config('request.jwt.claim.sub', '', true);
  assert private.live_problem('00000000-0000-0000-0000-0000000000b4') = 'Sign in first.', 'nobody';
end $$;
\o
\echo 'voice sweep: all good'
