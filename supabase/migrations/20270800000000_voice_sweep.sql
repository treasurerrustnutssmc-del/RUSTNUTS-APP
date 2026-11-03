-- ChatGPT audit F03: nobody stays in a ride's voice room after they lose the right to be there.
-- A LiveKit token only matters when someone joins, so someone already in stays until they leave,
-- even past the ride's live window or after being suspended. The voice-sweep Edge Function lists
-- LiveKit's ride rooms and who is in each, every minute around a live ride, and this decides what
-- to do: close the rooms of rides that are over, cancelled, not yet open or unknown, and take out
-- of the rest anyone who isn't an approved member any more. The live ride rule is shared with
-- live_problem, so who may join and who may stay can't drift apart.
-- Spec: docs/superpowers/specs/2026-11-03-audit-deferred-f03-f09-design.md.

-- The live ride rule for a named member (live_problem asks it for the signed-in one).
create or replace function private.live_problem_for(p_ride uuid, p_member uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ride public.rides%rowtype;
  w record;
begin
  if not exists (select 1 from public.members where id = p_member and approval = 'approved' and status <> 'family') then
    return 'Only approved members can do that.';
  end if;
  select * into ride from public.rides where id = p_ride;
  if not found then return 'No such ride.'; end if;
  if ride.cancelled_at is not null then return 'That ride was cancelled.'; end if;
  select * into w from private.live_window(ride);
  if now() < w.opens then return 'Live ride opens 2 hours before the start.'; end if;
  if now() >= w.closes then return 'This ride’s finished.'; end if;
  return null;
end;
$$;
revoke all on function private.live_problem_for(uuid, uuid) from public, anon, authenticated;

create or replace function private.live_problem(p_ride uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  return private.live_problem_for(p_ride, auth.uid());
end;
$$;

-- Given [{room, members: [identity…]}] from LiveKit, the rooms to act on:
-- [{room, close: true}] for a ride room that should be shut, or [{room, close: false, remove: […]}].
-- Rooms not named ride-… aren't the app's and are left alone.
create or replace function public.voice_sweep(p_rooms jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
  ride_id uuid;
  room_open boolean;
  gone jsonb;
  result jsonb := '[]'::jsonb;
begin
  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then return result; end if;
  for r in select value from jsonb_array_elements(p_rooms) loop
    continue when coalesce(r->>'room', '') not like 'ride-%';
    ride_id := case when substr(r->>'room', 6) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then substr(r->>'room', 6)::uuid end;
    select coalesce(bool_or(now() >= w.opens and now() < w.closes), false) into room_open
    from public.rides x, private.live_window(x) w where x.id = ride_id;
    if not room_open then
      result := result || jsonb_build_array(jsonb_build_object('room', r->>'room', 'close', true, 'remove', '[]'::jsonb));
      continue;
    end if;
    select coalesce(jsonb_agg(m.value order by m.ord), '[]'::jsonb) into gone
    from jsonb_array_elements_text(case when jsonb_typeof(r->'members') = 'array' then r->'members' else '[]'::jsonb end)
         with ordinality as m(value, ord)
    where m.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or private.live_problem_for(ride_id, m.value::uuid) is not null;
    if jsonb_array_length(gone) > 0 then
      result := result || jsonb_build_array(jsonb_build_object('room', r->>'room', 'close', false, 'remove', gone));
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.voice_sweep(jsonb) from public, anon, authenticated;
grant execute on function public.voice_sweep(jsonb) to service_role;

-- Worth running: a ride's live window is open now or closed in the last 6 hours (a room left open by
-- a sweep that failed is still caught). No rides, no calls.
create or replace function private.voice_sweep_due()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rides r, private.live_window(r) w
    where r.starts_at > now() - interval '7 days' and r.starts_at < now() + interval '1 day'
      and w.opens <= now() and w.closes > now() - interval '6 hours'
  ) or exists (
    -- A ride called off while its room was open.
    select 1 from public.rides r
    where r.cancelled_at > now() - interval '6 hours' and r.starts_at > now() - interval '7 days'
  );
$$;
revoke all on function private.voice_sweep_due() from public, anon, authenticated;

create or replace function private.voice_sweep_url()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = 'voice_sweep_url';
$$;
revoke all on function private.voice_sweep_url() from public, anon, authenticated;

-- Every minute where pg_cron and pg_net exist (Supabase), only while a sweep is due, and only once an
-- admin sets 'voice_sweep_url'. Carries the shared cron secret like the other scheduled calls.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname = 'voice-sweep';
    perform cron.schedule('voice-sweep', '* * * * *',
      $job$select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.voice_sweep_url() as u where u is not null and private.voice_sweep_due()$job$);
  end if;
end $$;
