import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATCHUP_MAX, catchUpCount } from './catchUp';

test('the bar shows from 8 new messages (3 in the demo), and asks for at most 300', () => {
  assert.equal(catchUpCount(0, false), null);
  assert.equal(catchUpCount(7, false), null);
  assert.equal(catchUpCount(8, false), 8);
  assert.equal(catchUpCount(45, false), 45);
  assert.equal(catchUpCount(5000, false), CATCHUP_MAX);
  assert.equal(CATCHUP_MAX, 300);
  assert.equal(catchUpCount(2, true), null);
  assert.equal(catchUpCount(3, true), 8, 'the demo still asks for a full window');
});
