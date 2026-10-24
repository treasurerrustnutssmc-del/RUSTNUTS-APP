// Demo build: live ride mode in memory, with made-up riders placed around you who move a little
// each time your phone reports in. It applies the same rules as the database's live ride actions.

import { LIVE_MSG, alertProblem, isRideLeader, liveProblem, personalStop, resolveProblem } from '../domain/liveRide';
import { displayName } from '../domain/profile';
import type { AlertKind, ClubData, LatLng, LiveRider, LiveState, Member, RideAlert } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { Fix, LiveRideBackend } from './liveRideBackend';

interface Sharer {
  stopsAt: string;
  position: LatLng | null;
  updatedAt: string | null;
  accuracyM: number | null;
}

interface DemoRide {
  sharers: Map<string, Sharer>;
  /** Made-up riders, placed once someone has a fix. */
  seeded: boolean;
  alerts: RideAlert[];
}

/** Who rides along in the demo, and where they sit from the first fix (km north, km east). */
const RIDE_ALONG: { memberId: string; north: number; east: number }[] = [
  { memberId: 'm-diesel', north: 0.4, east: 0.2 }, // Road Captain, out front
  { memberId: 'm-spanner', north: -0.5, east: -0.1 }, // Tail Gunner, at the back
  { memberId: 'm-sparks', north: 0.1, east: 0.3 },
  { memberId: 'm-throttle', north: -0.2, east: 0.1 },
  { memberId: 'm-chook', north: -6, east: -1.5 }, // well back, so the split shows
];

const KM_PER_DEG_LAT = 111.32;
const offset = (p: LatLng, north: number, east: number): LatLng => ({
  lat: p.lat + north / KM_PER_DEG_LAT,
  lng: p.lng + east / (KM_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
});

let alertCount = 0;

export function createDemoLiveBackend(
  get: () => { data: ClubData; me: Member | null },
  now: () => string = () => new Date().toISOString(),
): LiveRideBackend {
  const rides = new Map<string, DemoRide>();
  const rideOf = (id: string): DemoRide => {
    let r = rides.get(id);
    if (!r) {
      r = { sharers: new Map(), seeded: false, alerts: [] };
      rides.set(id, r);
    }
    return r;
  };

  const requireMe = (): Member => {
    const { me } = get();
    if (!me) throw new NotAllowedError(LIVE_MSG.signIn);
    return me;
  };
  const leader = (memberId: string) => isRideLeader(memberId, get().data.positions);
  const phoneOf = (memberId: string) => get().data.privates.find((p) => p.memberId === memberId)?.phone ?? null;
  const nameOf = (memberId: string) => {
    const m = get().data.members.find((x) => x.id === memberId);
    return m ? displayName(m) : 'Rider';
  };
  const isSharing = (r: DemoRide, memberId: string) => {
    const s = r.sharers.get(memberId);
    return !!s && s.stopsAt > now();
  };
  const requireSharing = (rideId: string): { me: Member; ride: DemoRide } => {
    const me = requireMe();
    const ride = rideOf(rideId);
    if (!isSharing(ride, me.id)) throw new NotAllowedError(LIVE_MSG.notSharing);
    return { me, ride };
  };

  /** Places the made-up riders around the first fix, then nudges them 30 to 80 m each update. */
  const moveRideAlong = (ride: DemoRide, around: LatLng, meId: string, stopsAt: string) => {
    for (const r of RIDE_ALONG) {
      if (r.memberId === meId) continue;
      const existing = ride.sharers.get(r.memberId);
      if (!ride.seeded && !existing) {
        ride.sharers.set(r.memberId, { stopsAt, position: offset(around, r.north, r.east), updatedAt: now(), accuracyM: 15 });
      } else if (existing?.position && existing.updatedAt) {
        const step = (0.03 + Math.random() * 0.05) * (Math.random() < 0.5 ? -1 : 1);
        ride.sharers.set(r.memberId, { ...existing, position: offset(existing.position, step, step / 2), updatedAt: now() });
      }
    }
    ride.seeded = true;
  };

  const stateFor = (rideId: string, me: Member, ride: DemoRide): LiveState => {
    const viewerLeads = leader(me.id);
    const t = now();
    const tenMinutesAgo = new Date(new Date(t).getTime() - 10 * 60_000).toISOString();
    const openEmergency = new Set(ride.alerts.filter((a) => a.kind === 'emergency' && !a.resolvedAt).map((a) => a.memberId));
    const riders: LiveRider[] = [...ride.sharers.entries()]
      .filter(([, s]) => s.stopsAt > t)
      .map(([memberId, s]) => ({
        memberId,
        name: nameOf(memberId),
        leader: leader(memberId),
        position: s.position,
        accuracyM: s.accuracyM,
        updatedAt: s.updatedAt,
        phone: leader(memberId) || (viewerLeads && openEmergency.has(memberId)) ? phoneOf(memberId) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const alerts = ride.alerts
      .filter((a) => !a.resolvedAt || a.resolvedAt > tenMinutesAgo)
      .map((a) => ({ ...a, phone: viewerLeads && a.kind !== 'regroup' ? phoneOf(a.memberId) : null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const contacts = viewerLeads ? get().data.emergencyContacts.filter((c) => openEmergency.has(c.memberId)) : [];
    return { rideId, me: { stopsAt: (ride.sharers.get(me.id) as Sharer).stopsAt }, riders, alerts, contacts };
  };

  return {
    async start(rideId) {
      const { data, me } = get();
      const problem = liveProblem(me, data.rides.find((r) => r.id === rideId), now());
      if (problem) throw new NotAllowedError(problem);
      const ride = data.rides.find((r) => r.id === rideId);
      const stopsAt = personalStop(ride as NonNullable<typeof ride>, now());
      const r = rideOf(rideId);
      const existing = r.sharers.get((me as Member).id);
      r.sharers.set((me as Member).id, {
        stopsAt,
        position: existing?.position ?? null,
        updatedAt: existing?.updatedAt ?? null,
        accuracyM: existing?.accuracyM ?? null,
      });
      return stopsAt;
    },

    async update(rideId, fix: Fix) {
      const { me, ride } = requireSharing(rideId);
      const mine = ride.sharers.get(me.id) as Sharer;
      ride.sharers.set(me.id, { ...mine, position: { lat: fix.lat, lng: fix.lng }, accuracyM: fix.accuracyM, updatedAt: now() });
      moveRideAlong(ride, fix, me.id, mine.stopsAt);
      return stateFor(rideId, me, ride);
    },

    async state(rideId) {
      const { me, ride } = requireSharing(rideId);
      return stateFor(rideId, me, ride);
    },

    async raise(rideId, kind: AlertKind, at) {
      const me = requireMe();
      const ride = rideOf(rideId);
      const problem = alertProblem(kind, isSharing(ride, me.id), leader(me.id));
      if (problem) throw new NotAllowedError(problem);
      const t = now();
      let id: string;
      if (kind === 'regroup') {
        ride.alerts = ride.alerts.map((a) => (a.kind === 'regroup' && !a.resolvedAt ? { ...a, resolvedAt: t } : a));
      }
      const open = kind === 'regroup' ? undefined : ride.alerts.find((a) => a.memberId === me.id && a.kind === kind && !a.resolvedAt);
      if (open) {
        id = open.id;
        if (at) ride.alerts = ride.alerts.map((a) => (a.id === id ? { ...a, position: at } : a));
      } else {
        id = `a-demo-${++alertCount}`;
        ride.alerts.push({ id, rideId, memberId: me.id, kind, name: nameOf(me.id), position: at, phone: null, createdAt: t, resolvedAt: null });
      }
      if (kind === 'out') ride.sharers.delete(me.id);
      return id;
    },

    async resolve(alertId) {
      const me = requireMe();
      const ride = [...rides.values()].find((r) => r.alerts.some((a) => a.id === alertId));
      const alert = ride?.alerts.find((a) => a.id === alertId);
      if (!ride || !alert) throw new Error(LIVE_MSG.noAlert);
      const problem = resolveProblem(alert, me.id, leader(me.id));
      if (problem) throw new NotAllowedError(problem);
      ride.alerts = ride.alerts.map((a) => (a.id === alertId ? { ...a, resolvedAt: now() } : a));
    },

    async stop(rideId) {
      const me = requireMe();
      rideOf(rideId).sharers.delete(me.id);
    },
  };
}
