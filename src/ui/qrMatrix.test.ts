import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from './qrMatrix';

test('a check-in QR: square, with the three finder squares in the corners', () => {
  const m = qrMatrix('RUSTNUTS:RN2026');
  assert.ok(m.length >= 21);
  assert.ok(m.every((row) => row.length === m.length));
  const n = m.length;
  // Each finder square has a dark 7×7 border with a light ring inside it.
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.equal(m[r][c], true);
    assert.equal(m[r + 6][c + 6], true);
    assert.equal(m[r + 1][c + 1], false);
    assert.equal(m[r + 3][c + 3], true);
  }
  assert.equal(m[n - 7][n - 7], false, 'no finder bottom right');
});

test('different codes make different patterns', () => {
  assert.notDeepEqual(qrMatrix('RUSTNUTS:RN2026'), qrMatrix('RUSTNUTS:WEST26'));
});
