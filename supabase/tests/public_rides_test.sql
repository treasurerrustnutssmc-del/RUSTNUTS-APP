-- Checks the website's public ride list (public_rides): anon reads it, it carries no member
-- data, only rides from the public calendars, and the window the website asks for.
-- Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

insert into rides (id, source, starts_at, ends_at, all_day, title, location, notes, category, cancelled_at) values
  ('00000000-0000-0000-0000-00000000cc01', 'feed', now() + interval '7 days', now() + interval '7 days 4 hours', false,
   'West Sunday Run', 'Bacchus Marsh', 'Meet 9am, Label: West', 'west', null),
  ('00000000-0000-0000-0000-00000000cc02', 'app', now() + interval '14 days', null, true,
   'Planning night', null, 'Members only: Roger''s place', 'club', null),
  ('00000000-0000-0000-0000-00000000cc03', 'feed', now() + interval '21 days', null, false,
   'North Pub Run', 'Whittlesea', null, 'north', now()),
  ('00000000-0000-0000-0000-00000000cc04', 'feed', now() - interval '2 years', null, false,
   'Ancient history', null, null, 'club', null),
  ('00000000-0000-0000-0000-00000000cc05', 'feed', now() + interval '3 years', null, false,
   'Far future', null, null, 'club', null);

create function pg_temp.as_anon(q text) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  set local role anon;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s) t', q) into out;
  reset role;
  return out;
end $$;

\o
do $$
declare
  rows jsonb := pg_temp.as_anon('select * from public.public_rides()');
  r jsonb;
begin
  if jsonb_array_length(rows) <> 2 then
    raise exception 'anon should see the two calendar rides in the window, saw %', rows;
  end if;
  r := rows -> 0;
  if r ->> 'title' <> 'West Sunday Run' or r ->> 'notes' <> 'Meet 9am, Label: West' or r ->> 'location' <> 'Bacchus Marsh' then
    raise exception 'calendar ride should carry its notes and location: %', r;
  end if;
  if rows::text like '%Planning night%' or rows::text like '%Roger%' then
    raise exception 'a ride made in the app is not public at all: %', rows;
  end if;
  r := rows -> 1;
  if (r ->> 'cancelled_at') is null then
    raise exception 'a cancelled ride still shows, with cancelled_at: %', r;
  end if;
  if r ? 'feed_id' or r ? 'external_uid' or r ? 'source' or r ? 'synced_at' then
    raise exception 'internal columns must not leak: %', r;
  end if;
  if (select count(*) from public.rsvps) <> 0 then
    raise exception 'the test expects no rsvps';
  end if;
end $$;

-- anon still cannot read the rides table itself, only the function.
do $$
declare err text;
begin
  begin
    set local role anon;
    perform count(*) from public.rides;
    reset role;
  exception when others then
    reset role;
    err := sqlerrm;
  end;
  if err is null or err not like '%permission denied%' then
    raise exception 'anon should be refused on public.rides, got %', coalesce(err, 'no error');
  end if;
end $$;

\echo public_rides: ok
