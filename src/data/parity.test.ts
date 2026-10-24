// Runs the shared who-can-do-what cases (supabase/tests/parity.json) against the demo.
// `npm run test:db` runs the very same cases against the real database rules, and checks the
// database refuses with exactly the demo's message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoAnswer, fixture } from './parityFixture.testkit';

test('the shared case list has cases', () => {
  assert.ok(fixture.cases.length >= 30);
});

for (const c of fixture.cases) {
  test(`demo: ${c.name} → ${c.allowed ? 'allowed' : 'refused'}`, () => {
    const refusal = demoAnswer(c);
    if (c.allowed) assert.equal(refusal, null, `refused: ${refusal}`);
    else assert.notEqual(refusal, null, 'was allowed');
  });
}
