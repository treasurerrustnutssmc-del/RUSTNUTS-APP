-- A fuel call on a live ride. Riders sharing on the ride hear "[name] needs fuel" (push), and ride
-- leaders get the rider's number on the alert, as for an emergency or dropping out. No emergency
-- contacts: it isn't an emergency. raise_ride_alert already treats any kind but regroup alike, so a
-- fuel call needs only the ride to be on, a second press updates the open one, and it doesn't take
-- the rider off the ride.

create or replace function private.push_ride_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select lr.member_id, 'alert:' || new.id,
    case new.kind
      when 'emergency' then 'EMERGENCY: ' || who || ' needs help'
      when 'out' then who || ' is out of the ride'
      when 'fuel' then who || ' needs fuel'
      else 'Regroup pin set'
    end,
    'Open live ride', jsonb_build_object('kind', 'live-alert', 'rideId', new.ride_id)
  from public.live_riders lr
  where lr.ride_id = new.ride_id and lr.member_id <> new.member_id and lr.stops_at > now()
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;

create or replace function public.live_ride_state(p_ride uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  leader boolean;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not private.is_sharing(p_ride) then raise exception 'Share your location first.'; end if;
  leader := private.is_ride_leader(me);
  return (
    with open_emergency as (
      select distinct member_id from public.ride_alerts
      where ride_id = p_ride and kind = 'emergency' and resolved_at is null
    ),
    riders as (
      select lr.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, private.is_ride_leader(lr.member_id) as is_leader,
             mp.phone as raw_phone
      from public.live_riders lr
      join public.members m on m.id = lr.member_id
      left join public.member_private mp on mp.member_id = lr.member_id
      where lr.ride_id = p_ride and lr.stops_at > now()
    ),
    alerts as (
      select a.*, coalesce(m.road_name, split_part(m.full_name, ' ', 1)) as name, mp.phone as raw_phone
      from public.ride_alerts a
      join public.members m on m.id = a.member_id
      left join public.member_private mp on mp.member_id = a.member_id
      where a.ride_id = p_ride and (a.resolved_at is null or a.resolved_at > now() - interval '10 minutes')
    )
    select jsonb_build_object(
      'me', (select jsonb_build_object('stops_at', stops_at) from riders where member_id = me),
      'riders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'member_id', r.member_id, 'name', r.name, 'leader', r.is_leader, 'lat', r.lat, 'lng', r.lng,
          'accuracy_m', r.accuracy_m, 'updated_at', r.updated_at,
          'phone', case when r.is_leader or (leader and r.member_id in (select member_id from open_emergency))
                        then r.raw_phone end
        ) order by r.name) from riders r), '[]'::jsonb),
      'alerts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'ride_id', a.ride_id, 'member_id', a.member_id, 'kind', a.kind, 'name', a.name,
          'lat', a.lat, 'lng', a.lng, 'created_at', a.created_at, 'resolved_at', a.resolved_at,
          'phone', case when leader and a.kind in ('emergency', 'out', 'fuel') and a.resolved_at is null then a.raw_phone end
        ) order by a.created_at desc) from alerts a), '[]'::jsonb),
      'contacts', case when leader then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'member_id', c.member_id, 'name', c.name, 'relationship', c.relationship, 'phone', c.phone
        ) order by c.created_at) from public.emergency_contacts c
        where c.member_id in (select member_id from open_emergency)), '[]'::jsonb) else '[]'::jsonb end
    )
  );
end;
$$;
