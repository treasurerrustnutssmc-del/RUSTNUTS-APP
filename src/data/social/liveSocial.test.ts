import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBirthdays } from './liveSocial';

test('birthday rows: taken-off ones are left out', () => {
  assert.deepEqual(
    toBirthdays([
      { member_id: 'a', month: 3, day: 7 },
      { member_id: 'b', month: null, day: null },
    ]),
    [{ memberId: 'a', month: 3, day: 7 }],
  );
});

test('skills, workshops and vouches rows', async () => {
  const { toSkills, toMechanics, toVouches, saveMechanicArgs } = await import('./liveSocial');
  assert.deepEqual(toSkills([{ member_id: 'a', skills: ['tyres'] }, { member_id: 'b', skills: null }]), [
    { memberId: 'a', skills: ['tyres'] },
    { memberId: 'b', skills: [] },
  ]);
  assert.deepEqual(
    toMechanics([{ id: 'w', name: 'N', suburb: null, phone: 'p', website: null, speciality: null, notes: null, added_by: null, added_at: 't', archived_at: null }]),
    [{ id: 'w', name: 'N', suburb: null, phone: 'p', website: null, speciality: null, notes: null, addedBy: null, addedAt: 't', archivedAt: null }],
  );
  assert.deepEqual(toVouches([{ mechanic_id: 'w', member_id: 'a', vouched: true }]), [{ mechanicId: 'w', memberId: 'a', vouched: true }]);
  assert.deepEqual(saveMechanicArgs({ id: null, name: 'n', suburb: 's', phone: 'p', website: 'w', speciality: 'x', notes: 'y' }), {
    p_id: null, p_name: 'n', p_suburb: 's', p_phone: 'p', p_website: 'w', p_speciality: 'x', p_notes: 'y',
  });
});

test('listing rows, and the save_listing call', async () => {
  const { toListings, saveListingArgs } = await import('./liveSocial');
  assert.deepEqual(
    toListings([
      {
        id: 'l1', seller_id: 's', kind: 'sell', title: 'Panniers', price_dollars: 150, details: null,
        photos: [{ path: 's/a.jpg', width: 800, height: null }], listed_at: '2026-10-27T00:00:00Z', sold_at: null, taken_down_at: null,
      },
      {
        id: 'l2', seller_id: 's', kind: 'wanted', title: 'Mirror', price_dollars: null, details: 'Left', photos: null,
        listed_at: '2026-10-26T00:00:00Z', sold_at: '2026-10-27T00:00:00Z', taken_down_at: null,
      },
    ]),
    [
      {
        id: 'l1', sellerId: 's', kind: 'sell', title: 'Panniers', priceDollars: 150, details: null,
        photos: [{ path: 's/a.jpg', width: 800, height: 0 }], listedAt: '2026-10-27T00:00:00Z', soldAt: null, takenDownAt: null,
      },
      {
        id: 'l2', sellerId: 's', kind: 'wanted', title: 'Mirror', priceDollars: null, details: 'Left', photos: [],
        listedAt: '2026-10-26T00:00:00Z', soldAt: '2026-10-27T00:00:00Z', takenDownAt: null,
      },
    ],
  );
  const photos = [{ path: 's/a.jpg', width: 1, height: 2 }];
  assert.deepEqual(saveListingArgs({ id: null, kind: 'sell', title: ' T ', priceDollars: 5, details: '', photos: [] }, photos), {
    p_id: null, p_kind: 'sell', p_title: ' T ', p_price: 5, p_details: '', p_photos: photos,
  });
});

test('build update rows', async () => {
  const { toBuildUpdates } = await import('./liveSocial');
  assert.deepEqual(
    toBuildUpdates([{ id: 'u', bike_id: 'b', author_id: 'a', body: null, photos: [{ path: 'a/x.jpg', width: null, height: 5 }], posted_at: 't', taken_down_at: null }]),
    [{ id: 'u', bikeId: 'b', authorId: 'a', body: null, photos: [{ path: 'a/x.jpg', width: 0, height: 5 }], postedAt: 't', takenDownAt: null }],
  );
});

test('history and honour rows, and their save calls', async () => {
  const { toHistory, toHonours, saveHistoryArgs, saveHonourArgs } = await import('./liveSocial');
  assert.deepEqual(
    toHistory([{ id: 'e', happened_on: '2019-03-09', precision: 'month', title: 'T', story: null, added_by: null, archived_at: null }]),
    [{ id: 'e', happenedOn: '2019-03-09', precision: 'month', title: 'T', story: null, addedBy: '', archivedAt: null }],
  );
  assert.deepEqual(
    toHonours([{ id: 'h', member_id: null, name: 'Kev', honour: 'Life member', year: 2024, note: 'n', added_by: 'a', archived_at: null }]),
    [{ id: 'h', memberId: null, name: 'Kev', honour: 'Life member', year: 2024, note: 'n', addedBy: 'a', archivedAt: null }],
  );
  assert.deepEqual(saveHistoryArgs({ id: null, happenedOn: '2019-03-09', precision: 'day', title: 't', story: 's' }), {
    p_id: null, p_happened_on: '2019-03-09', p_precision: 'day', p_title: 't', p_story: 's',
  });
  assert.deepEqual(saveHonourArgs({ id: 'h', memberId: 'm', name: '', honour: 'x', year: 2024, note: '' }), {
    p_id: 'h', p_member: 'm', p_name: '', p_honour: 'x', p_year: 2024, p_note: '',
  });
});

test('bragging rights rows and calls', async () => {
  const { toAwards, toNominations, toVotes, toTallies, openAwardArgs, nominateArgs } = await import('./liveSocial');
  assert.deepEqual(
    toAwards([{ id: 'a', kind: 'ride', title: 'T', year: 2026, nominations_close: '2026-11-01', voting_close: '2026-11-10', opened_by: null, archived_at: null }]),
    [{ id: 'a', kind: 'ride', title: 'T', year: 2026, nominationsClose: '2026-11-01', votingClose: '2026-11-10', openedBy: '', archivedAt: null }],
  );
  assert.deepEqual(
    toNominations([{ id: 'n', award_id: 'a', nominated_by: 'm', ride_id: null, title: 'T', photo: { path: 'm/x.jpg', width: null, height: 4 },
      story: null, reason: null, nominated_at: 't', withdrawn_at: null }]),
    [{ id: 'n', awardId: 'a', nominatedBy: 'm', rideId: null, title: 'T', photo: { path: 'm/x.jpg', width: 0, height: 4 }, story: null,
      reason: null, nominatedAt: 't', withdrawnAt: null }],
  );
  assert.deepEqual(toVotes([{ award_id: 'a', member_id: 'm', nomination_id: 'n' }]), [{ awardId: 'a', memberId: 'm', nominationId: 'n' }]);
  assert.deepEqual(toTallies([{ nomination_id: 'n', votes: 3 }]), [{ nominationId: 'n', votes: 3 }]);
  assert.deepEqual(openAwardArgs({ kind: 'story', title: 't', year: 2026, nominationsClose: 'a', votingClose: 'b' }), {
    p_kind: 'story', p_title: 't', p_year: 2026, p_nominations_close: 'a', p_voting_close: 'b',
  });
  assert.deepEqual(nominateArgs({ awardId: 'a', rideId: 'r', title: 't', photo: null, story: 's', reason: '' }), {
    p_award: 'a', p_ride: 'r', p_title: 't', p_photo: null, p_story: 's', p_reason: '',
  });
});
