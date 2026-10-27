// Test-only (not part of the app build). The Stage 4 club with a crew on the West ride, bikes with
// ranges, and a route, for the ride planning extras' rule tests.

import { club, member } from './stage4.testkit';
import type { Bike, ClubData, Route } from './types';

export { member, ride, who } from './stage4.testkit';

/** Before the West ride (Sun 8 Nov 2026, 8:30 am Melbourne). */
export const BEFORE = '2026-11-01T00:00:00.000Z';
/** 1 am Melbourne the day after the West ride. */
export const AFTER_DAY = '2026-11-08T14:00:00.000Z';

export const bike = (id: string, memberId: string, rangeKm: number | null, over: Partial<Bike> = {}): Bike => ({
  id, memberId, make: 'Honda', model: id, year: 2015, nickname: null, isProject: false, rangeKm, ...over,
});

/** A 200 km route, straight east along the equator-ish line, with two waypoints. */
export const ROUTE: Route = {
  id: 'route-1',
  name: 'Black Spur',
  chapterId: null,
  notes: '',
  distanceM: 200_000,
  climbM: null,
  // 0.9 degrees of longitude at the equator is about 100 km; the scale to distanceM fixes the rest.
  line: [[0, 0], [0, 0.9], [0, 1.8]],
  stops: [
    { name: 'Healesville', lat: 0, lng: 0.45 },
    { name: 'Marysville', lat: 0, lng: 1.35 },
  ],
  bounds: { minLat: 0, minLng: 0, maxLat: 0, maxLng: 1.8 },
  archivedAt: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
};

/**
 * rc is the West ride's Road Captain, tg its Tail Gunner (first aid), off an Officer; all three are
 * Going. rider is Going with no crew spot. sec (West Secretary) manages West rides.
 */
export function planningClub(over: Partial<ClubData> = {}): ClubData {
  const base = club();
  return {
    ...base,
    members: [...base.members, member('rc'), member('tg'), member('off'), member('nomad', { status: 'nomad' }), member('sup', { status: 'supporter' })],
    privates: [
      { memberId: 'tg', email: null, phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry: '2030-01-01', introducedBy: null, applicationNote: null },
      { memberId: 'off', email: null, phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry: null, introducedBy: null, applicationNote: null },
    ],
    crew: [
      { rideId: 'r-west', memberId: 'rc', role: 'road_captain', assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z' },
      { rideId: 'r-west', memberId: 'tg', role: 'tail_gunner', assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z' },
      { rideId: 'r-west', memberId: 'off', role: 'officer', assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z' },
    ],
    rsvps: ['rc', 'tg', 'off', 'rider'].map((memberId) => ({ rideId: 'r-west', memberId, answer: 'going' as const, updatedAt: '2026-10-01T00:00:00.000Z' })),
    routes: [ROUTE],
    rideRoutes: [{ rideId: 'r-west', routeId: 'route-1' }],
    ...over,
  };
}
