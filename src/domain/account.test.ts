// Delete my account: who has to step down first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, member } from './stage4.testkit';
import { CHAIR_EMAILS_US, deleteAccountProblem, STEP_DOWN_FIRST, stepDownSeats } from './account';
import type { Position } from './types';

const seat = (memberId: string, role: Position['role'], over: Partial<Position> = {}): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId: 'west', role, startedOn: '2025-01-01', endedOn: null, ...over,
});

test('signed out, nobody can delete an account', () => {
  assert.equal(deleteAccountProblem(null, club().positions), 'Sign in first.');
});

test('a sitting board or national seat holder steps down first', () => {
  const d = club();
  assert.equal(deleteAccountProblem(member('sec'), d.positions), STEP_DOWN_FIRST);
  assert.equal(deleteAccountProblem(member('chair'), d.positions), CHAIR_EMAILS_US); // the vote changes that seat (F10)
  assert.equal(deleteAccountProblem(member('auditor'), d.positions), STEP_DOWN_FIRST);
  assert.equal(deleteAccountProblem(member('rc'), [seat('rc', 'road_captain')]), STEP_DOWN_FIRST);
});

test('anyone else can delete their account, roles that aren’t seats included', () => {
  const d = club();
  assert.equal(deleteAccountProblem(member('rider'), d.positions), null);
  assert.equal(deleteAccountProblem(member('applicant', { approval: 'pending' }), d.positions), null);
  assert.equal(deleteAccountProblem(member('tg'), [seat('tg', 'tail_gunner')]), null);
  assert.equal(deleteAccountProblem(member('old'), [seat('old', 'president', { endedOn: '2026-08-01' })]), null, 'a seat they used to hold');
});

const TODAY = '2026-11-02';

test('the delete screen lists the seats to step down from, and who records the ones they can’t end', () => {
  const d = club();
  assert.deepEqual(stepDownSeats(member('sec'), d, TODAY).map((s) => [s.position.id, s.selfEnd, s.note]), [['p-sec', true, null]]);
  assert.deepEqual(stepDownSeats(member('auditor'), d, TODAY).map((s) => [s.position.id, s.selfEnd]), [['p-auditor', true]]);
  const chair = stepDownSeats(member('chair'), d, TODAY);
  assert.deepEqual(chair.map((s) => [s.position.id, s.selfEnd]), [['p-chair', false]]);
  assert.equal(chair[0].note, 'The National Chairman changes after the vote, and the club’s admin records it.');
});

test('roles that don’t stop a delete, and past seats, aren’t listed', () => {
  const positions = [seat('tg', 'tail_gunner'), seat('tg', 'president', { endedOn: '2026-08-01' })];
  assert.deepEqual(stepDownSeats(member('tg'), club({ positions }), TODAY), []);
  assert.deepEqual(stepDownSeats(member('rider'), club(), TODAY), []);
  assert.deepEqual(stepDownSeats(null, club(), TODAY), []);
});
