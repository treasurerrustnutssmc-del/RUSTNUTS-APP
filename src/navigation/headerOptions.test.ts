// The back arrow: a screen reader should hear "Go back" (not an internal screen name such as
// "Tabs, back"), and the arrow should be at least 44pt square (DESIGN.md touch target rule).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(path.resolve(import.meta.dirname, 'RootNavigator.tsx'), 'utf8');
const startAt = source.indexOf('const stackHeaderOptions');
const block = source.slice(startAt, source.indexOf('\n};', startAt));

test('the back arrow is announced as "Go back", not as an internal screen name', () => {
  assert.match(block, /headerBackTitle:\s*'Back'/);
});

test('the back arrow is at least 44pt square', () => {
  assert.match(block, /headerLeft/);
  assert.match(block, /minWidth:\s*MIN_TOUCH/);
  assert.match(block, /minHeight:\s*MIN_TOUCH/);
  assert.match(source, /MIN_TOUCH\s*=\s*44/);
});
