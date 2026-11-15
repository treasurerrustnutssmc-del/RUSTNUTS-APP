import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_DATA, STORY_TODAY } from '../data/demoStory.testkit';
import { accessLevel } from './access';
import { boardGroups, boardScope, needsYou, termsDue } from './boardLayout';
import type { Member, Position } from './types';

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
  assert.equal(g.money, 'Chapter fees');
  assert.equal(g.website, 'Enquiries, news, visits and app feedback');
  assert.equal(boardGroups(none).find((x) => x.id === 'people')!.summary, 'Nothing due');
});

// Acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md): an Acting President takes part
// in NEC business but sees no other chapter's board, and a stint isn't a term.

const member = (id: string): Member => DEMO_DATA.members.find((m) => m.id === id)!;
/** Jet (North's VP) covers Smokey's President seat. */
const jetCovers: Position = {
  id: 'p-jet-covers', memberId: 'm-jet', chapterId: 'ch-north', role: 'president', startedOn: '2026-10-15', endedOn: null,
  actingUntil: '2026-11-14', covers: 'p-9', actingWhy: 'Smokey overseas', appointedBy: 'm-crank',
};

test('the Board tab covers every chapter only for those who see every chapter, not every national level', () => {
  const covered = [...DEMO_DATA.positions, jetCovers];
  assert.equal(boardScope(member('m-rusty'), covered), null, 'the National Chairman sees every chapter');
  assert.equal(boardScope(member('m-smokey'), covered), 'ch-north');
  assert.equal(accessLevel(member('m-jet'), covered), 'national', 'an Acting President is on the NEC');
  assert.equal(boardScope(member('m-jet'), covered), 'ch-north', 'but sees only North’s board');
});

test('Attendance and terms lists terms ending or ended, never a stint', () => {
  const due = termsDue(DEMO_DATA.positions, null, STORY_TODAY).map((p) => p.id);
  assert.ok(due.includes('p-18'), 'the Auditor’s twelve months end within 60 days');
  assert.ok(!due.includes('p-19'), 'Crank’s stint ends on its until date: it isn’t a term to re-elect');
  assert.deepEqual(termsDue(DEMO_DATA.positions, 'ch-north', STORY_TODAY).map((p) => p.id), []);
});
