-- Ride comms: one voice room per ride, open on the live ride's window to whoever could go live on it.
-- The ride-voice-token Edge Function asks this as the member, then signs a LiveKit token for the room.
-- See docs/superpowers/specs/2026-10-24-ride-comms-design.md.

create or replace function public.ride_voice_room(p_ride uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  problem text := private.live_problem(p_ride);
begin
  if problem is not null then raise exception '%', problem; end if;
  return jsonb_build_object(
    'room', 'ride-' || p_ride::text,
    'name', (select private.short_name(m) from public.members m where m.id = auth.uid())
  );
end;
$$;
revoke all on function public.ride_voice_room(uuid) from public, anon;
grant execute on function public.ride_voice_room(uuid) to authenticated;
