// The notifications explainer card: shown once, before the phone's own prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayAskAutomatically, NOTIFY_INTRO, showNotifyIntro } from './notifyIntro';

const undecided = { granted: false, canAskAgain: true };

test('the card shows on a phone that hasn’t been asked yet, until it’s answered', () => {
  assert.equal(showNotifyIntro({ os: 'ios', permission: undecided, answer: null }), true);
  assert.equal(showNotifyIntro({ os: 'android', permission: undecided, answer: null }), true);
  assert.equal(showNotifyIntro({ os: 'ios', permission: undecided, answer: 'on' }), false);
  assert.equal(showNotifyIntro({ os: 'ios', permission: undecided, answer: 'later' }), false);
});

test('no card once notifications are on or blocked, while loading, or on the web', () => {
  assert.equal(showNotifyIntro({ os: 'ios', permission: { granted: true, canAskAgain: true }, answer: null }), false);
  assert.equal(showNotifyIntro({ os: 'ios', permission: { granted: false, canAskAgain: false }, answer: null }), false);
  assert.equal(showNotifyIntro({ os: 'ios', permission: null, answer: null }), false, 'permission not read yet');
  assert.equal(showNotifyIntro({ os: 'ios', permission: undecided, answer: undefined }), false, 'answer not read yet');
  assert.equal(showNotifyIntro({ os: 'web', permission: undecided, answer: null }), false);
});

test('the app only brings up the phone’s prompt by itself after Turn on', () => {
  assert.equal(mayAskAutomatically('on'), true);
  assert.equal(mayAskAutomatically('later'), false);
  assert.equal(mayAskAutomatically(null), false);
  assert.equal(mayAskAutomatically(undefined), false);
});

test('the card says what notifications are for, with its two choices', () => {
  assert.deepEqual(NOTIFY_INTRO.points, ['Ride reminders', 'Live ride alerts', 'Chat messages']);
  assert.equal(NOTIFY_INTRO.turnOn, 'Turn on notifications');
  assert.equal(NOTIFY_INTRO.notNow, 'Not now');
});
