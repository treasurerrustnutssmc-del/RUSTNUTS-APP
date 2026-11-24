-- Ride comms bubbles (Jeff, 22 Nov 2026): the app floats a bubble for each ride whose comms are on,
-- with how many are connected and an Emergency button for that ride only. The club now knows who is
-- on each ride's comms: the voice sweep records who LiveKit says is in each room every minute (right
-- even with screens off), and a phone says so the moment it joins or hangs up. An emergency now
-- reaches everyone on that ride's comms as well as everyone sharing their location on it.
-- Spec: docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.

create table if not exists public.ride_voice_presence (
  ride_id uuid not null references public.rides (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (ride_id, member_id)
);
-- Members leaving or being deleted take their rows with them quickly.
create index if not exists ride_voice_presence_member_idx on public.ride_voice_presence (member_id);
alter table public.ride_voice_presence enable row level security;
-- No policies: only the functions below read or write it.
revoke all on public.ride_voice_presence from public, anon, authenticated;

-- Seen in the last 3 minutes counts as on comms (the sweep refreshes it every minute).
create or replace function private.on_ride_comms(p_ride uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.member_id from public.ride_voice_presence p
  where p.ride_id = p_ride and p.seen_at > now() - interval '3 minutes'
$$;
revoke all on function private.on_ride_comms(uuid) from public, anon, authenticated;

-- The phone: "I've joined" (only while the ride's on and you may be there) or "I've left" (always).
create or replace function public.ride_comms_here(p_ride uuid, p_here boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  problem text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not coalesce(p_here, false) then
    delete from public.ride_voice_presence where ride_id = p_ride and member_id = me;
    return;
  end if;
  problem := private.live_problem(p_ride);
  if problem is not null then raise exception '%', problem; end if;
  insert into public.ride_voice_presence (ride_id, member_id, seen_at) values (p_ride, me, now())
  on conflict (ride_id, member_id) do update set seen_at = excluded.seen_at;
end;
$$;
revoke all on function public.ride_comms_here(uuid, boolean) from public, anon;
grant execute on function public.ride_comms_here(uuid, boolean) to authenticated;

-- For the bubbles: how many are on each ride's comms now, for rides the caller may join. Counts only.
create or replace function public.ride_comms_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ride_id', c.ride_id, 'connected', c.n) order by c.ride_id)
    from (
      select p.ride_id, count(*)::int as n
      from public.ride_voice_presence p
      where p.seen_at > now() - interval '3 minutes'
      group by p.ride_id
    ) c
    where private.live_problem_for(c.ride_id, me) is null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.ride_comms_counts() from public, anon;
grant execute on function public.ride_comms_counts() to authenticated;

-- The sweep (unchanged answer) now also records who is in each room it keeps open, and clears the
-- rooms it closes. It writes, so it's no longer stable.
create or replace function public.voice_sweep(p_rooms jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb;
  rid uuid;
  room_open boolean;
  gone jsonb;
  result jsonb := '[]'::jsonb;
begin
  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array' then return result; end if;
  for r in select value from jsonb_array_elements(p_rooms) loop
    continue when coalesce(r->>'room', '') not like 'ride-%';
    rid := case when substr(r->>'room', 6) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then substr(r->>'room', 6)::uuid end;
    select coalesce(bool_or(now() >= w.opens and now() < w.closes), false) into room_open
    from public.rides x, private.live_window(x) w where x.id = rid;
    if not room_open then
      if rid is not null then
        begin
          delete from public.ride_voice_presence p where p.ride_id = rid;
        exception when others then
          null; -- the counts are a nicety; closing the room is what matters
        end;
      end if;
      result := result || jsonb_build_array(jsonb_build_object('room', r->>'room', 'close', true, 'remove', '[]'::jsonb));
      continue;
    end if;
    select coalesce(jsonb_agg(m.value order by m.ord), '[]'::jsonb) into gone
    from jsonb_array_elements_text(case when jsonb_typeof(r->'members') = 'array' then r->'members' else '[]'::jsonb end)
         with ordinality as m(value, ord)
    where case when m.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then private.live_problem_for(rid, m.value::uuid) is not null
               else true end;
    -- Who's in the room now, less anyone being taken out. Never lets the sweep itself fail.
    begin
    delete from public.ride_voice_presence p
    where p.ride_id = rid
      and p.member_id::text not in (
        select m.value from jsonb_array_elements_text(case when jsonb_typeof(r->'members') = 'array' then r->'members' else '[]'::jsonb end) m(value)
        where not gone ? m.value
      );
    insert into public.ride_voice_presence (ride_id, member_id, seen_at)
    select distinct rid, m.value::uuid, now()
    from jsonb_array_elements_text(case when jsonb_typeof(r->'members') = 'array' then r->'members' else '[]'::jsonb end) m(value)
    where not gone ? m.value
    on conflict (ride_id, member_id) do update set seen_at = excluded.seen_at;
    exception when others then
      null;
    end;
    if jsonb_array_length(gone) > 0 then
      result := result || jsonb_build_array(jsonb_build_object('room', r->>'room', 'close', false, 'remove', gone));
    end if;
  end loop;
  -- Old rows go (a ride over for a day).
  begin
    delete from public.ride_voice_presence where seen_at < now() - interval '1 day';
  exception when others then
    null;
  end;
  return result;
end;
$$;
revoke all on function public.voice_sweep(jsonb) from public, anon, authenticated;
grant execute on function public.voice_sweep(jsonb) to service_role;

-- An emergency reaches everyone sharing on the ride and everyone on its comms (still allowed on the
-- ride), once each; the other alerts stay with the riders sharing their location.
create or replace function private.push_ride_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select t.member_id, 'alert:' || new.id,
    case new.kind
      when 'emergency' then 'EMERGENCY: ' || who || ' needs help'
      when 'out' then who || ' is out of the ride'
      when 'fuel' then who || ' needs fuel'
      else 'Regroup pin set'
    end,
    -- Someone only on comms isn't on the map yet: say which ride, and how to see where.
    case when bool_or(t.sharing) then 'Open live ride'
         else 'On ' || (select r.title from public.rides r where r.id = new.ride_id) || '. Open the live ride and share your location to see where.'
    end,
    jsonb_build_object('kind', 'live-alert', 'rideId', new.ride_id)
  from (
    select lr.member_id, true as sharing from public.live_riders lr
    where lr.ride_id = new.ride_id and lr.stops_at > now()
    union all
    select c.member_id, false from private.on_ride_comms(new.ride_id) c(member_id)
    where new.kind = 'emergency' and private.live_problem_for(new.ride_id, c.member_id) is null
  ) t
  where t.member_id <> new.member_id
  group by t.member_id
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;
