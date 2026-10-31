// Delete my account: who has to step down first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, member } from './stage4.testkit';
import { deleteAccountProblem, STEP_DOWN_FIRST } from './account';
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
  assert.equal(deleteAccountProblem(member('chair'), d.positions), STEP_DOWN_FIRST);
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
