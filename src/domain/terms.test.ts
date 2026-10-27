import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termEndsOn, termState } from './terms';
import type { Position } from './types';

const pos = (role: Position['role'], startedOn: string, over: Partial<Position> = {}): Position => ({
  id: 'p', memberId: 'm', chapterId: 'west', role, startedOn, endedOn: null, ...over,
});

test('board and Non-Board terms run two years; terms recorded before 1 Aug 2026 run from then (9.2, 17.6)', () => {
  assert.equal(termEndsOn(pos('president', '2024-05-01')), '2028-08-01');
  assert.equal(termEndsOn(pos('road_captain', '2026-08-01')), '2028-08-01');
  assert.equal(termEndsOn(pos('secretary', '2026-10-20')), '2028-10-20');
  assert.equal(termEndsOn(pos('tail_gunner', '2027-02-03')), '2029-02-03');
  assert.equal(termEndsOn(pos('nec_chair', '2026-09-01', { chapterId: null })), '2028-09-01');
  assert.equal(termEndsOn(pos('nec_secretary', '2026-09-01', { chapterId: null })), '2028-09-01');
  assert.equal(termEndsOn(pos('officer', '2028-02-29')), '2030-02-28');
});

test('the National Auditor serves twelve months (11.8); Founder is an honour with no term', () => {
  assert.equal(termEndsOn(pos('nec_auditor', '2026-11-01', { chapterId: null })), '2027-11-01');
  assert.equal(termEndsOn(pos('nec_auditor', '2025-03-01', { chapterId: null })), '2026-03-01');
  assert.equal(termEndsOn(pos('founder', '2019-01-01', { chapterId: null })), null);
});

test('a term is running, ending within 60 days, or ended', () => {
  const p = pos('secretary', '2026-10-20'); // ends 20/10/2028
  assert.equal(termState(p, '2028-08-20'), 'running');
  assert.equal(termState(p, '2028-08-21'), 'ending');
  assert.equal(termState(p, '2028-10-20'), 'ending');
  assert.equal(termState(p, '2028-10-21'), 'ended');
  assert.equal(termState({ ...p, endedOn: '2027-01-01' }, '2028-10-21'), null);
  assert.equal(termState(pos('founder', '2019-01-01'), '2030-01-01'), null);
});
