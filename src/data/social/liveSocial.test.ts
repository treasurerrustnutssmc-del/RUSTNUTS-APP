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
