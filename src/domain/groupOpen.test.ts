import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleOpen } from './groupOpen';

test('a group that needs you is recorded as open', () => {
  assert.deepEqual(settleOpen({}, [{ id: 'a', startsOpen: true }, { id: 'b', startsOpen: false }]), { a: true });
});

test('nothing changes, and the same object comes back, when there is nothing new to open', () => {
  const chosen = { a: true };
  assert.equal(settleOpen(chosen, [{ id: 'a', startsOpen: true }, { id: 'b', startsOpen: false }]), chosen);
});

test('what the person chose is never overridden', () => {
  const closedByThem = { a: false };
  assert.equal(settleOpen(closedByThem, [{ id: 'a', startsOpen: true }]), closedByThem);
});

test('once opened it stays open after the thing that opened it is fixed', () => {
  const afterOpening = settleOpen({}, [{ id: 'a', startsOpen: true }]);
  // later the member adds the contact / signs the Road Rules / approves the last applicant
  assert.equal(settleOpen(afterOpening, [{ id: 'a', startsOpen: false }]), afterOpening);
  assert.equal(afterOpening.a, true);
});
