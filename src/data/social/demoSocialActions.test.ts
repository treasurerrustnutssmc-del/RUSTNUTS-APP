import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA as demoData } from '../demoData';
import { archiveMechanic, saveMechanic, setBirthday, setSkills, vouchMechanic, type SocialCtx } from './demoSocialActions';
import { demoSocialData } from './demoSocialData';

const ctxAs = (memberId: string): SocialCtx => ({
  social: demoSocialData('2026-10-27'),
  club: demoData,
  me: demoData.members.find((m) => m.id === memberId) ?? null,
  today: '2026-10-27',
});

test('the demo has a birthday today and one later this week', () => {
  const b = demoSocialData('2026-10-27').birthdays;
  assert.deepEqual(b.find((x) => x.memberId === 'm-torque'), { memberId: 'm-torque', month: 10, day: 27 });
  assert.deepEqual(b.find((x) => x.memberId === 'm-smokey'), { memberId: 'm-smokey', month: 10, day: 30 });
});

test('sharing, changing and taking off a birthday', () => {
  const ctx = ctxAs('m-rusty');
  const changed = setBirthday(ctx, 1, 2).birthdays.filter((b) => b.memberId === 'm-rusty');
  assert.deepEqual(changed, [{ memberId: 'm-rusty', month: 1, day: 2 }]);
  assert.equal(setBirthday(ctx, null, null).birthdays.some((b) => b.memberId === 'm-rusty'), false);
});

test('refusals come from the shared rules', () => {
  assert.throws(() => setBirthday(ctxAs('m-rusty'), 4, 31), /That day isn’t in that month\./);
  assert.throws(() => setBirthday({ ...ctxAs('m-rusty'), me: null }, 1, 1), /Sign in first\./);
});

test('the demo always has On this day photos: a year ago and three years ago', async () => {
  const { onThisDay } = await import('../../domain/social/onThisDay');
  for (const today of ['2026-10-28', '2027-02-28', '2027-01-01', '2026-12-31']) {
    const groups = onThisDay(demoSocialData(today).pastPhotos, today);
    assert.deepEqual(groups.map((g) => [g.yearsAgo, g.items.length]), [[1, 2], [3, 1]], today);
  }
  // A leap day has no date a year back: the demo stays valid, with nothing to show.
  assert.deepEqual(onThisDay(demoSocialData('2028-02-29').pastPhotos, '2028-02-29'), []);
});

test('setting skills keeps each one once, and replaces what was there', () => {
  const ctx = ctxAs('m-rusty');
  const mine = setSkills(ctx, ['tyres', 'welding', 'tyres']).skills.filter((s) => s.memberId === 'm-rusty');
  assert.deepEqual(mine, [{ memberId: 'm-rusty', skills: ['tyres', 'welding'] }]);
  assert.throws(() => setSkills(ctx, ['juggling']), /That isn’t one of the skills\./);
});

const blank = { id: null, name: 'Shed Sixteen', suburb: ' Footscray ', phone: '', website: '', speciality: '', notes: '' };

test('adding a workshop, then the one who added it changes it', () => {
  const ctx = { ...ctxAs('m-rusty'), now: '2026-10-27T01:00:00Z' };
  const { social, id } = saveMechanic(ctx, blank);
  const added = social.mechanics.find((m) => m.id === id);
  assert.equal(added?.name, 'Shed Sixteen');
  assert.equal(added?.suburb, 'Footscray');
  assert.equal(added?.addedBy, 'm-rusty');
  const changed = saveMechanic({ ...ctx, social }, { ...blank, id, name: 'Shed 16' });
  assert.equal(changed.id, id);
  assert.equal(changed.social.mechanics.find((m) => m.id === id)?.name, 'Shed 16');
  assert.equal(changed.social.mechanics.length, social.mechanics.length);
});

test('only whoever added a workshop or the board can change it or take it off', () => {
  // mech-1 was added by m-spanner.
  assert.throws(() => saveMechanic(ctxAs('m-chook'), { ...blank, id: 'mech-1' }), /Only whoever added it or the board can change it\./);
  assert.throws(() => archiveMechanic(ctxAs('m-chook'), 'mech-1'), /Only whoever added it or the board can change it\./);
  const off = archiveMechanic(ctxAs('m-spanner'), 'mech-1');
  assert.ok(off.mechanics.find((m) => m.id === 'mech-1')?.archivedAt);
  assert.throws(() => archiveMechanic({ ...ctxAs('m-spanner'), social: off }, 'mech-1'), /That workshop is already off the list\./);
  assert.throws(() => vouchMechanic({ ...ctxAs('m-chook'), social: off }, 'mech-1', true), /That workshop is off the list\./);
});

test('vouching for a workshop and taking it back', () => {
  const ctx = ctxAs('m-spanner');
  const on = vouchMechanic(ctx, 'mech-4', true).vouches.filter((v) => v.mechanicId === 'mech-4' && v.memberId === 'm-spanner');
  assert.deepEqual(on, [{ mechanicId: 'mech-4', memberId: 'm-spanner', vouched: true }]);
  const off = vouchMechanic(ctx, 'mech-4', false).vouches.filter((v) => v.mechanicId === 'mech-4' && v.memberId === 'm-spanner');
  assert.deepEqual(off, [{ mechanicId: 'mech-4', memberId: 'm-spanner', vouched: false }]);
  assert.throws(() => vouchMechanic(ctx, 'nope', true), /No such workshop\./);
});

test('the demo has listings up, one sold, and one of the demo member’s', async () => {
  const { listingsFor } = await import('../../domain/social/swap');
  const social = demoSocialData('2026-10-27');
  const spanner = demoData.members.find((m) => m.id === 'm-spanner') ?? null;
  const seen = listingsFor(spanner, demoData.members, social.listings, [], demoData.positions, '2026-10-27');
  assert.equal(seen.open.length, 5);
  assert.deepEqual(seen.sold.map((l) => l.id), ['listing-6']);
  assert.ok(seen.open.some((l) => l.sellerId === 'm-spanner'));
});

test('listing, changing, selling and taking down in the demo', async () => {
  const { saveListing: save, markListingSold: sell, takeDownListing: down } = await import('./demoSocialActions');
  const ctx = { ...ctxAs('m-spanner'), now: '2026-10-27T02:00:00Z' };
  const { social, id } = save(ctx, { id: null, kind: 'sell', title: ' Tank bag ', priceDollars: 60, details: '', photos: [{ path: 'm-spanner/x.jpg', width: 10.4, height: 20 }] });
  const added = social.listings.find((l) => l.id === id);
  assert.equal(added?.title, 'Tank bag');
  assert.equal(added?.sellerId, 'm-spanner');
  assert.deepEqual(added?.photos, [{ path: 'm-spanner/x.jpg', width: 10, height: 20 }]);
  const changed = save({ ...ctx, social }, { id, kind: 'free', title: 'Tank bag', priceDollars: 60, details: 'Free to a good home', photos: [] });
  assert.equal(changed.social.listings.find((l) => l.id === id)?.priceDollars, null);
  const sold = sell({ ...ctx, social: changed.social }, id, true);
  assert.equal(sold.listings.find((l) => l.id === id)?.soldAt, '2026-10-27T02:00:00Z');
  assert.equal(sell({ ...ctx, social: sold }, id, false).listings.find((l) => l.id === id)?.soldAt, null);
  assert.throws(() => sell({ ...ctxAs('m-rusty'), social: sold }, id, false), /Only whoever listed it can change it\./);
  const gone = down({ ...ctx, social: sold }, id);
  assert.ok(gone.listings.find((l) => l.id === id)?.takenDownAt);
  assert.throws(() => down({ ...ctx, social: gone }, id), /That listing has already been taken down\./);
});

test('build threads in the demo: posting on my project, taking an update down', async () => {
  const { postBuildUpdate, takeDownBuildUpdate } = await import('./demoSocialActions');
  const { buildsFor } = await import('../../domain/social/builds');
  const spanner = demoData.members.find((m) => m.id === 'm-spanner') ?? null;
  const ctx = { ...ctxAs('m-spanner'), now: '2026-10-27T03:00:00Z' };
  assert.deepEqual(buildsFor(spanner, demoData.members, demoData.bikes, ctx.social.buildUpdates, []).map((b) => b.bike.id), ['b-20', 'b-7']);
  const { social, id } = postBuildUpdate(ctx, { bikeId: 'b-7', body: ' Float bowls on. ', photos: [] });
  const posted = social.buildUpdates.find((u) => u.id === id);
  assert.equal(posted?.body, 'Float bowls on.');
  assert.equal(posted?.postedAt, '2026-10-27T03:00:00Z');
  assert.throws(() => postBuildUpdate(ctx, { bikeId: 'b-6', body: 'x', photos: [] }), /Build threads are for project bikes/);
  assert.throws(() => postBuildUpdate(ctx, { bikeId: 'b-20', body: 'x', photos: [] }), /Only the bike’s owner can post on its build\./);
  const down = takeDownBuildUpdate({ ...ctx, social }, id);
  assert.ok(down.buildUpdates.find((u) => u.id === id)?.takenDownAt);
});

test('history in the demo: the board keeps entries and honours; a member reads them', async () => {
  const { saveHistoryEntry, archiveHistoryEntry, saveHonour, archiveHonour } = await import('./demoSocialActions');
  const { timeline, honoursFor, founders, pastOfficeHolders } = await import('../../domain/social/history');
  const ctx = { ...ctxAs('m-rusty'), now: '2026-10-27T04:00:00Z' };
  const years = timeline(ctx.social.history, demoData.positions);
  assert.equal(years[0].year, 2019);
  assert.equal(years[0].entries[0].title, 'The club is founded');
  assert.ok(years.length >= 4, 'a few years of history');
  assert.ok(honoursFor(ctx.social.honours).length >= 2, 'two honours');
  assert.deepEqual(founders(demoData.members, demoData.positions).map((m) => m.id), ['m-rusty', 'm-torque']);
  assert.deepEqual(pastOfficeHolders(demoData.members, demoData.positions).map((g) => g.role), ['president', 'treasurer']);

  const { social, id } = saveHistoryEntry(ctx, { id: null, happenedOn: '2026-10-01', precision: 'month', title: ' Clubhouse lease ', story: '' });
  const added = social.history.find((e) => e.id === id);
  assert.deepEqual([added?.title, added?.story, added?.addedBy], ['Clubhouse lease', null, 'm-rusty']);
  const changed = saveHistoryEntry({ ...ctx, social }, { id, happenedOn: '2026-10-01', precision: 'day', title: 'Clubhouse lease signed', story: 'At last.' });
  assert.equal(changed.social.history.find((e) => e.id === id)?.story, 'At last.');
  const off = archiveHistoryEntry({ ...ctx, social: changed.social }, id);
  assert.equal(off.history.find((e) => e.id === id)?.archivedAt, '2026-10-27T04:00:00Z');
  assert.throws(() => archiveHistoryEntry({ ...ctx, social: off }, id), /That entry has already been taken off\./);
  assert.throws(
    () => saveHistoryEntry(ctxAs('m-spanner'), { id: null, happenedOn: '2026-10-01', precision: 'day', title: 'x', story: '' }),
    /Only the board can keep the club’s history\./,
  );

  const h = saveHonour(ctx, { id: null, memberId: null, name: ' Old Mate ', honour: 'Rider of the year', year: 2026, note: '' });
  assert.deepEqual(h.social.honours.find((x) => x.id === h.id)?.name, 'Old Mate');
  const hOff = archiveHonour({ ...ctx, social: h.social }, h.id);
  assert.ok(hOff.honours.find((x) => x.id === h.id)?.archivedAt);
  assert.throws(() => saveHonour(ctx, { id: null, memberId: 'm-ghost', name: '', honour: 'x', year: 2026, note: '' }), /No such member\./);
});
