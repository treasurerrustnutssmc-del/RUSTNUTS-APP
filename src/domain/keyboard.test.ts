import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerBottomRoom } from './keyboard';

const GAP = 8;

test('keyboard down: the composer sits clear of the home bar', () => {
  assert.equal(composerBottomRoom('android', 0, 48, GAP), 48 + GAP);
  assert.equal(composerBottomRoom('ios', 0, 34, GAP), 34 + GAP);
});

test('Android reports the keyboard without the navigation bar under it, so that is added back', () => {
  // React Native on Android sends ime height minus the system bars; the app draws edge to edge,
  // so the composer has to clear both.
  assert.equal(composerBottomRoom('android', 300, 48, GAP), 300 + 48 + GAP);
});

test('iPhone reports the whole keyboard from the bottom of the screen', () => {
  assert.equal(composerBottomRoom('ios', 336, 34, GAP), 336 + GAP);
});

test('web never moves the composer for a keyboard', () => {
  assert.equal(composerBottomRoom('web', 0, 0, GAP), GAP);
});
