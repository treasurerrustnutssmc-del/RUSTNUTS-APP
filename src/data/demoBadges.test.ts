import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgesFor } from '../domain/social/badges';
import { introProgress } from '../domain/joining';
import { standingOf } from '../domain/standing';
import type { ClubData } from '../domain/types';
import { DEMO_DATA } from './demoData';

const season = (id: string) => id.startsWith('r-season-') || id.startsWith('cs-season-');
const without: ClubData = {
  ...DEMO_DATA,
  rides: DEMO_DATA.rides.filter((r) => !season(r.id)),
  rideRoutes: (DEMO_DATA.rideRoutes ?? []).filter((r) => !season(r.rideId)),
  big4Rides: (DEMO_DATA.big4Rides ?? []).filter((b) => !season(b.rideId)),
  checkinSessions: (DEMO_DATA.checkinSessions ?? []).filter((s) => !season(s.id)),
  attendance: (DEMO_DATA.attendance ?? []).filter((a) => !season(a.sessionId)),
};

test('the badges season leaves every standing and introduction as it was, whatever the date', () => {
  for (const today of ['2026-10-28', '2026-11-20', '2027-03-01', '2027-09-15']) {
    for (const m of DEMO_DATA.members) {
      assert.deepEqual(standingOf(m, DEMO_DATA, today), standingOf(m, without, today), `${m.id} standing on ${today}`);
      // The introduction is only shown for introduced applicants.
      if (m.status === 'introduced') assert.deepEqual(introProgress(m, DEMO_DATA, today), introProgress(m, without, today), `${m.id} introduction on ${today}`);
    }
  }
});

test('Spanner’s demo badges have something on every track', () => {
  const spanner = DEMO_DATA.members.find((m) => m.id === 'm-spanner')!;
  const b = badgesFor(spanner, DEMO_DATA, DEMO_DATA.rideRoutes ?? []);
  assert.deepEqual(b.tracks.map((t) => t.earned), ['10 rides', 'First Big 4', '1,000 km', 'Three states']);
  assert.deepEqual(b.states, ['VIC', 'NSW', 'SA']);
});
