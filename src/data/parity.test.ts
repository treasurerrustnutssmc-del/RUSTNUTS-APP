// Runs the shared who-can-do-what cases (supabase/tests/parity.json) against the demo.
// `npm run test:db` runs the very same cases against the real database rules, and checks the
// database refuses with exactly the demo's message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIEFED_AT, demoAnswer, fixture } from './parityFixture.testkit';

test('the shared case list has cases', () => {
  assert.ok(fixture.cases.length >= 30);
});

test('every briefing case says which version it was made on', () => {
  const briefed = new Set((fixture.briefings ?? []).map((b) => b.ride));
  for (const c of fixture.cases.filter((x) => x.action === 'saveBriefing' || x.action === 'readBriefing')) {
    assert.ok('seen' in c && (c.seen === null || typeof c.seen === 'string'), `"${c.name}" has no seen`);
  }
  // The version-check cases are there: both refusals, and a read of the version stored.
  const named = (action: string, ride: (r: string) => boolean, seen: (s: unknown) => boolean, allowed: boolean) =>
    fixture.cases.some((c) => c.action === action && ride(String(c.ride)) && seen(c.seen) && c.allowed === allowed);
  const old = (s: unknown) => s === null || (typeof s === 'string' && Date.parse(s) < Date.parse(BRIEFED_AT) - 1);
  assert.ok(named('readBriefing', (r) => briefed.has(r), old, false), 'Got it on an older version');
  assert.ok(named('readBriefing', (r) => briefed.has(r), (s) => s === BRIEFED_AT, true), 'Got it on the version stored');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => s === null, false), 'a save opened when there was none');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => typeof s === 'string' && old(s), false), 'a save on an older version');
});

for (const c of fixture.cases) {
  test(`demo: ${c.name} → ${c.allowed ? 'allowed' : 'refused'}`, () => {
    const refusal = demoAnswer(c);
    if (c.allowed) assert.equal(refusal, null, `refused: ${refusal}`);
    else assert.notEqual(refusal, null, 'was allowed');
  });
}
