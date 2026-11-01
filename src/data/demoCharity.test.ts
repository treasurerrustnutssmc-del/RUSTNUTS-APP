import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charityCounts, charityFor, placesLeft, signupsFor } from '../domain/charity';
import { DEMO_DATA } from './demoData';

test('the demo: Ride for Kids takes sign-ups, every helper’s job is on its list, and it isn’t full', () => {
  const charity = charityFor('r-6', DEMO_DATA)!;
  assert.ok(charity, 'Ride for Kids is a charity ride');
  for (const s of signupsFor('r-6', DEMO_DATA)) {
    if (s.job !== null) assert.ok(charity.jobs.includes(s.job), `${s.memberId}'s job is listed`);
    assert.ok(s.riding || s.job !== null, `${s.memberId} rides or helps`);
  }
  assert.deepEqual(charityCounts('r-6', DEMO_DATA), { riding: 3, pillions: 1, guests: 3, helping: 3, people: 7 });
  assert.equal(placesLeft('r-6', DEMO_DATA), 51, '60 places, 7 members on bikes, 2 from the website');
  assert.equal(signupsFor('r-6', DEMO_DATA).some((s) => s.memberId === 'm-spanner'), false, 'the demo member can sign up');
});
