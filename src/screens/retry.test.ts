// A failed answer to a ride offers Retry, on Home's card and on the ride screen, so nobody has to find the button again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const rides = fs.readFileSync(path.resolve(import.meta.dirname, 'rides.tsx'), 'utf8');

test('both places that answer a ride offer Retry, but only for a lost connection', () => {
  const retries = rides.match(/label: 'Retry', onPress: \(\) => void answer\(a\)/g) || [];
  assert.equal(retries.length, 2);
  assert.equal((rides.match(/isConnectionProblem\(err\)/g) || []).length, 2, 'each Retry is guarded');
});
