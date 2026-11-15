// When the app may bring up the phone's notifications prompt by itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayAskAutomatically } from './notifyIntro';

test('a new phone asks for notifications by itself, unless the member said Not now', () => {
  // On by default: the phone's own prompt comes up after the first sign-in, no card to find first.
  assert.equal(mayAskAutomatically(null), true, 'never answered: ask');
  assert.equal(mayAskAutomatically('on'), true);
  assert.equal(mayAskAutomatically('later'), false, 'said no: only Me, Notifications asks again');
  assert.equal(mayAskAutomatically(undefined), false, 'not read yet');
});
