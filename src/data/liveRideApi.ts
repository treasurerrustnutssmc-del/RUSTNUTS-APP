// Live build: live ride mode through the club database's actions (20270201000000_live_ride.sql).

import type { LiveRideBackend } from './liveRideBackend';
import { stateFromJson } from './liveRideBackend';
import { friendlyError, supabase } from './supabase';

const ok = <T extends { error: { message?: string; code?: string } | null; data?: unknown }>(r: T): T => {
  if (r.error) throw friendlyError(r.error);
  return r;
};

export const liveRideApi: LiveRideBackend = {
  async start(rideId) {
    const r = ok(await supabase().rpc('start_live_ride', { p_ride: rideId }));
    return new Date(r.data as string).toISOString();
  },
  async update(rideId, fix) {
    const r = ok(
      await supabase().rpc('update_live_position', {
        p_ride: rideId,
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_accuracy: fix.accuracyM,
        p_heading: fix.heading,
        p_speed: fix.speedKmh,
      }),
    );
    return stateFromJson(rideId, r.data!);
  },
  async state(rideId) {
    const r = ok(await supabase().rpc('live_ride_state', { p_ride: rideId }));
    return stateFromJson(rideId, r.data!);
  },
  async raise(rideId, kind, at) {
    const r = ok(await supabase().rpc('raise_ride_alert', { p_ride: rideId, p_kind: kind, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null }));
    return r.data as string;
  },
  async resolve(alertId) {
    ok(await supabase().rpc('resolve_ride_alert', { p_alert: alertId }));
  },
  async stop(rideId) {
    ok(await supabase().rpc('stop_live_ride', { p_ride: rideId }));
  },
};
