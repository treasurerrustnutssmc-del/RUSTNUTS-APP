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

test('the rides behind ride awards: their years, a day either side', async () => {
  const { bragRideWindow, toBragRides } = await import('./liveSocial');
  const a = (kind: 'ride' | 'story', year: number) =>
    ({ id: 'x', kind, title: 't', year, nominationsClose: '', votingClose: '', openedBy: '', archivedAt: null });
  assert.equal(bragRideWindow([a('story', 2026)]), null);
  assert.deepEqual(bragRideWindow([a('ride', 2026), a('ride', 2024)]), { from: '2023-12-31T00:00:00Z', to: '2027-01-02T00:00:00Z' });
  assert.deepEqual(
    toBragRides([{ id: 'r', title: 'T', starts_at: '2026-05-01T00:00:00+00:00', ends_at: null, all_day: false, location: null, notes: null,
      category: 'club', cancelled_at: null }])[0].startsAt,
    '2026-05-01T00:00:00.000Z',
  );
});

test('badges: every ride’s route, past ones too, merged with the calendar’s', async () => {
  const { toRideRoutes, mergeRideRoutes } = await import('./liveSocial');
  assert.deepEqual(toRideRoutes([{ ride_id: 'r1', route_id: 'a' }, { ride_id: 'r2', route_id: null }]), [{ rideId: 'r1', routeId: 'a' }], 'a cleared route is none');
  assert.deepEqual(
    mergeRideRoutes([{ rideId: 'r1', routeId: 'a' }], [{ rideId: 'r1', routeId: 'b' }, { rideId: 'r2', routeId: 'c' }]),
    [{ rideId: 'r1', routeId: 'b' }, { rideId: 'r2', routeId: 'c' }],
    'the calendar’s is the fresher one',
  );
});

test('a table bigger than one page is read page by page', async () => {
  const { allPages } = await import('./liveSocial');
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const asked: [number, number][] = [];
  const got = await allPages(async (from, to) => {
    asked.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });
  assert.equal(got.data?.length, 2500);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
  const failed = await allPages(async (from) => (from ? { data: null, error: new Error('x') } : { data: rows.slice(0, 1000), error: null }));
  assert.ok(failed.error, 'a page that fails fails the lot');
  const empty = await allPages(async () => ({ data: [], error: null }));
  assert.deepEqual(empty, { data: [], error: null });
});

test('other club and invite rows, and their calls', async () => {
  const { toOtherClubs, toInvites, saveOtherClubArgs, saveInviteInArgs, inviteClubArgs, answerInviteArgs } = await import('./liveSocial');
  assert.deepEqual(
    toOtherClubs([{ id: 'c', name: 'N', town: null, contact: 'x', note: null, added_by: null, added_at: 't', archived_at: null }]),
    [{ id: 'c', name: 'N', town: null, contact: 'x', note: null, addedBy: null, addedAt: 't', archivedAt: null }],
  );
  assert.deepEqual(
    toInvites([{
      id: 'i', direction: 'in', club_id: 'c', chapter_id: null, ride_id: 'r', title: 'T', event_on: '2026-11-29', place: null,
      details: null, answer: 'yes', calendar_label: 'supported', bikes: null, note: 'n', added_by: 'a', added_at: 't',
      answered_by: 'b', answered_at: 'u', archived_at: null,
    }]),
    [{
      id: 'i', direction: 'in', clubId: 'c', chapterId: null, rideId: 'r', title: 'T', eventOn: '2026-11-29', place: null,
      details: null, answer: 'yes', calendarLabel: 'supported', bikes: null, note: 'n', addedBy: 'a', addedAt: 't',
      answeredBy: 'b', answeredAt: 'u', archivedAt: null,
    }],
  );
  assert.deepEqual(saveOtherClubArgs({ id: null, name: 'n', town: 't', contact: 'c', note: '' }), {
    p_id: null, p_name: 'n', p_town: 't', p_contact: 'c', p_note: '',
  });
  assert.deepEqual(
    saveInviteInArgs({ id: 'i', clubId: 'c', chapterId: null, title: 't', eventOn: '2026-11-29', place: '', details: 'd', rideId: null }),
    { p_id: 'i', p_club: 'c', p_chapter: null, p_title: 't', p_event_on: '2026-11-29', p_place: '', p_details: 'd', p_ride: null },
  );
  assert.deepEqual(inviteClubArgs({ rideId: 'r', clubId: 'c', note: '' }), { p_ride: 'r', p_club: 'c', p_note: '' });
  assert.deepEqual(answerInviteArgs({ id: 'i', answer: 'no', label: null, bikes: null, note: '' }), {
    p_id: 'i', p_answer: 'no', p_label: null, p_bikes: null, p_note: '',
  });
});
