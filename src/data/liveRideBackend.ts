// What the live ride screen can ask of live mode, whichever source is behind it: the made-up
// riders of the demo, or the club database's live ride actions.

import type { AlertKind, LatLng, LiveState } from '../domain/types';
import type { LiveStateJson } from './database.types';

/** One position reading from the phone. */
export type Fix = LatLng & { accuracyM: number | null; heading: number | null; speedKmh: number | null };

export interface LiveRideBackend {
  /** Switch sharing on (or renew it); resolves to when it switches itself off. */
  start(rideId: string): Promise<string>;
  /** Post your latest fix and get back what you can see. */
  update(rideId: string, fix: Fix): Promise<LiveState>;
  state(rideId: string): Promise<LiveState>;
  /** Raise an alert where you are (null when the phone has no fix). Resolves to the alert's id. */
  raise(rideId: string, kind: AlertKind, at: LatLng | null): Promise<string>;
  resolve(alertId: string): Promise<void>;
  stop(rideId: string): Promise<void>;
}

const instant = (ts: string | null) => (ts ? new Date(ts).toISOString() : null);
const at = (lat: number | null, lng: number | null): LatLng | null => (lat === null || lng === null ? null : { lat, lng });

/** The database's live_ride_state (snake_case) as the app's LiveState. */
export function stateFromJson(rideId: string, json: LiveStateJson): LiveState {
  return {
    rideId,
    me: json.me ? { stopsAt: instant(json.me.stops_at) as string } : null,
    riders: json.riders.map((r) => ({
      memberId: r.member_id,
      name: r.name,
      leader: r.leader,
      position: at(r.lat, r.lng),
      accuracyM: r.accuracy_m,
      updatedAt: instant(r.updated_at),
      phone: r.phone,
    })),
    alerts: json.alerts.map((a) => ({
      id: a.id,
      rideId: a.ride_id,
      memberId: a.member_id,
      kind: a.kind,
      name: a.name,
      position: at(a.lat, a.lng),
      phone: a.phone,
      createdAt: instant(a.created_at) as string,
      resolvedAt: instant(a.resolved_at),
    })),
    contacts: json.contacts.map((c) => ({
      id: c.id,
      memberId: c.member_id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phone,
    })),
  };
}
