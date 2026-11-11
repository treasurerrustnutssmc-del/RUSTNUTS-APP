import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardGroups, needsYou } from './boardLayout';

const none = { pending: 0, alerts: 0, noContact: 0, fngs: 0 };

test('nothing is listed under Needs you when nothing is waiting', () => {
  assert.deepEqual(needsYou(none), []);
});

test('Needs you lists only what has a count, most urgent first, in plain words', () => {
  assert.deepEqual(needsYou({ pending: 2, alerts: 3, noContact: 0, fngs: 1 }), [
    { group: 'approvals', text: '2 people waiting for approval' },
    { group: 'people', text: '3 regos, licences or first aid certificates due' },
    { group: 'people', text: '1 FNG review' },
  ]);
});

test('singular and plural read correctly', () => {
  assert.deepEqual(needsYou({ ...none, pending: 1 })[0].text, '1 person waiting for approval');
  assert.deepEqual(needsYou({ ...none, noContact: 1 })[0].text, '1 member without an emergency contact');
  assert.deepEqual(needsYou({ ...none, noContact: 4 })[0].text, '4 members without an emergency contact');
  assert.deepEqual(needsYou({ ...none, alerts: 1 })[0].text, '1 rego, licence or first aid certificate due');
  assert.deepEqual(needsYou({ ...none, fngs: 3 })[0].text, '3 FNG reviews');
});

test('the groups come in a fixed order, and only the ones with something open start expanded', () => {
  const quiet = boardGroups(none);
  assert.deepEqual(quiet.map((g) => g.id), ['approvals', 'people', 'meetings', 'money', 'website']);
  assert.deepEqual(quiet.filter((g) => g.startsOpen), []);
  const busy = boardGroups({ pending: 2, alerts: 1, noContact: 0, fngs: 0 });
  assert.deepEqual(busy.filter((g) => g.startsOpen).map((g) => g.id), ['approvals', 'people']);
  const onlyFngs = boardGroups({ ...none, fngs: 2 });
  assert.deepEqual(onlyFngs.filter((g) => g.startsOpen).map((g) => g.id), ['people']);
});

test('each group says in one line what is inside, with counts where there are any', () => {
  const g = Object.fromEntries(boardGroups({ pending: 0, alerts: 1, noContact: 2, fngs: 3 }).map((x) => [x.id, x.summary]));
  assert.equal(g.approvals, 'Nobody waiting');
  assert.equal(g.people, '1 due, 2 without a contact, 3 FNG reviews');
  assert.equal(g.meetings, 'Attendance and check-ins');
  assert.equal(g.money, 'Fees');
  assert.equal(g.website, 'Enquiries, news, visits and app feedback');
  assert.equal(boardGroups(none).find((x) => x.id === 'people')!.summary, 'Nothing due');
});
