import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rideShareText } from './share';
import type { Ride } from './types';

const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'West breakfast run', startsAt: '2026-11-06T21:30:00.000Z', endsAt: '2026-11-07T01:00:00.000Z',
  allDay: false, location: 'BP Ravenhall', notes: null, category: 'west', cancelledAt: null, ...over,
});

test('a timed ride', () => {
  assert.equal(rideShareText(ride()), 'West breakfast run · Sat 07/11/2026 8:30 am · BP Ravenhall. Answer in the Rustnuts app.');
});

test('an all-day ride, on one day and over several', () => {
  const day = { allDay: true, startsAt: '2026-11-06T13:00:00.000Z' };
  assert.equal(
    rideShareText(ride({ ...day, title: 'Show day', endsAt: '2026-11-07T13:00:00.000Z' })),
    'Show day · Sat 07/11/2026 · All day · BP Ravenhall. Answer in the Rustnuts app.',
  );
  assert.equal(
    rideShareText(ride({ ...day, title: 'Camp weekend', endsAt: '2026-11-08T13:00:00.000Z' })),
    'Camp weekend · Sat 07/11/2026 · All day, to 08/11/2026 · BP Ravenhall. Answer in the Rustnuts app.',
  );
});

test('no location, and cancelled', () => {
  assert.equal(rideShareText(ride({ location: null })), 'West breakfast run · Sat 07/11/2026 8:30 am. Answer in the Rustnuts app.');
  assert.equal(rideShareText(ride({ location: '  ' })), 'West breakfast run · Sat 07/11/2026 8:30 am. Answer in the Rustnuts app.');
  assert.equal(
    rideShareText(ride({ cancelledAt: '2026-11-01T00:00:00.000Z' })),
    'CANCELLED: West breakfast run · Sat 07/11/2026 8:30 am · BP Ravenhall.',
  );
});
